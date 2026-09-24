import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { analyze, requestSchema } from "./analysis";
import {
  providerStatus,
  resolveRequestProvider,
  ConfigurationError,
} from "./provider-config";
import { ProviderError, providerErrorMessage } from "./provider";
import {
  redeemStore,
  RedeemError,
  DAILY_LIMIT,
  isRedeemEnabled,
} from "./redeem";
import {
  authStore,
  AuthError,
  requireAuth,
  requireAdmin,
  bearerToken,
  type PublicUser,
} from "./auth";
import {
  conversationStore,
  ConversationError,
  syncBodySchema,
} from "./conversations";
import { trialStore, TrialError, TRIAL_LIMIT } from "./trial";

/** Bump to force clients to drop cached redeem sessions. */
const CACHE_EPOCH = process.env.CACHE_EPOCH || "20260924-force-1";

const app = express();
app.disable("x-powered-by");
app.use("/api/conversations/sync", express.json({ limit: "1mb" }));
app.use("/api", express.json({ limit: "512kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => {
  const redeemOn = isRedeemEnabled();
  res.json({
    ...providerStatus(),
    redeem: redeemOn
      ? { dailyLimit: DAILY_LIMIT, enabled: true }
      : {
          dailyLimit: null,
          enabled: false,
          // VIP redeem codes still work for post-trial unlock
          vipRedeem: true,
        },
    auth: { enabled: true },
    trial: { limit: TRIAL_LIMIT, enabled: true },
    cacheEpoch: CACHE_EPOCH,
  });
});

app.get("/api/quota", async (req, res) => {
  try {
    const deviceId =
      (typeof req.headers["x-device-id"] === "string" &&
        req.headers["x-device-id"]) ||
      (typeof req.query.deviceId === "string" && req.query.deviceId) ||
      "";
    const token =
      (typeof req.headers["x-redeem-token"] === "string" &&
        req.headers["x-redeem-token"]) ||
      (typeof req.query.token === "string" && req.query.token) ||
      undefined;
    if (!deviceId) {
      res.status(400).json({ error: "缺少设备标识" });
      return;
    }
    const authUser = await authStore.getUserByToken(bearerToken(req));
    const redeem = await redeemStore.quotaStatus(deviceId, token);
    // VIP / active redeem session → unlimited
    if (redeem.unlimited || (redeem.redeemed && isRedeemEnabled())) {
      res.json({
        ...redeem,
        loggedIn: !!authUser,
        username: authUser?.username,
        trial: { remaining: null, limit: TRIAL_LIMIT, used: null },
      });
      return;
    }
    const trial = await trialStore.status(deviceId);
    res.json({
      redeemed: false,
      remainingToday: trial.remaining,
      dailyLimit: trial.limit,
      unlimited: false,
      openAccess: false,
      loggedIn: !!authUser,
      username: authUser?.username,
      trial: {
        remaining: trial.remaining,
        limit: trial.limit,
        used: trial.used,
      },
      day: redeem.day,
    });
  } catch (error) {
    if (error instanceof RedeemError || error instanceof TrialError) {
      res.status((error as RedeemError).status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.post("/api/redeem", async (req, res) => {
  try {
    const code =
      typeof req.body?.code === "string" ? req.body.code : "";
    const deviceId =
      (typeof req.headers["x-device-id"] === "string" &&
        req.headers["x-device-id"]) ||
      (typeof req.body?.deviceId === "string" && req.body.deviceId) ||
      "";
    if (!code.trim()) {
      res.status(400).json({ error: "请输入兑换码" });
      return;
    }
    const result = await redeemStore.redeem(code, deviceId);
    res.json(result);
  } catch (error) {
    if (error instanceof RedeemError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username =
      typeof req.body?.username === "string" ? req.body.username : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const result = await authStore.register(username, password);
    res.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username =
      typeof req.body?.username === "string" ? req.body.username : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const result = await authStore.login(username, password);
    res.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    await authStore.logout(bearerToken(req));
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = (req as typeof req & { user?: PublicUser }).user;
  res.json({ user });
});

app.post("/api/conversations/sync", async (req, res) => {
  try {
    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "同步数据格式无效" });
      return;
    }
    const body = parsed.data;
    const authUser = await authStore.getUserByToken(bearerToken(req));
    let user: { id: string; username: string };
    if (authUser) {
      user = { id: authUser.id, username: authUser.username };
      body.source = body.source ?? "user";
    } else {
      const headerDevice =
        typeof req.headers["x-device-id"] === "string"
          ? req.headers["x-device-id"].trim()
          : "";
      const deviceId = (body.deviceId || headerDevice || "").trim();
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(deviceId)) {
        res.status(400).json({ error: "试用同步需要有效设备标识" });
        return;
      }
      const short = deviceId.slice(0, 8);
      user = { id: `guest:${deviceId}`, username: `试用·${short}` };
      body.source = "trial";
      body.deviceId = deviceId;
    }
    const result = await conversationStore.upsert(user, body);
    res.json(result);
  } catch (error) {
    if (error instanceof ConversationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.get("/api/admin/conversations", requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await conversationStore.listForAdmin({ limit, offset, q });
    res.json(result);
  } catch (error) {
    if (error instanceof ConversationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.get("/api/admin/conversations/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const record = await conversationStore.getById(id);
    if (!record) {
      res.status(404).json({ error: "对话不存在" });
      return;
    }
    res.json({ conversation: record });
  } catch (error) {
    if (error instanceof ConversationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

app.post("/api/admin/codes", requireAdmin, async (req, res) => {
  try {
    const codes = Array.isArray(req.body?.codes)
      ? req.body.codes
      : req.body?.code
        ? [
            {
              code: String(req.body.code),
              active: req.body.active,
              note: req.body.note,
              unlimited: req.body.unlimited,
              maxDevices: req.body.maxDevices,
            },
          ]
        : null;
    if (!codes?.length) {
      res.status(400).json({ error: "需要 codes 数组或单个 code" });
      return;
    }
    const list = await redeemStore.upsertCodes(codes);
    res.json({ codes: list });
  } catch (error) {
    if (error instanceof RedeemError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});


app.post("/api/admin/wipe-access", requireAdmin, async (req, res) => {
  const keep = Array.isArray(req.body?.keepActive)
    ? req.body.keepActive.map(String)
    : ["疯狂星期四"];
  const result = await redeemStore.wipeAccess({ keepActive: keep });
  res.json({ ok: true, cacheEpoch: CACHE_EPOCH, ...result });
});

app.get("/api/admin/codes", requireAdmin, async (req, res) => {
  res.json({ codes: await redeemStore.listCodes() });
});

let calls = 0;
let windowAt = Date.now();
let active = 0;
const budgets = new Map<string, { count: number; at: number }>();

function clientProviderOverrides(req: express.Request) {
  const headerKey = req.headers["x-jev-api-key"];
  const headerProvider = req.headers["x-jev-provider"];
  const body = req.body as { apiKey?: unknown; provider?: unknown };
  const apiKey =
    (typeof headerKey === "string" && headerKey) ||
    (typeof body?.apiKey === "string" && body.apiKey) ||
    null;
  const provider =
    (typeof headerProvider === "string" && headerProvider) ||
    (typeof body?.provider === "string" && body.provider) ||
    null;
  return { apiKey, provider };
}

app.post("/api/analyze", async (req, res) => {
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== `${req.protocol}://${req.headers.host}` &&
    !["http://127.0.0.1:5178", "http://localhost:5178"].includes(origin)
  ) {
    res.status(403).json({ error: "请求来源不允许" });
    return;
  }
  const valid = requestSchema.safeParse(req.body);
  if (!valid.success) {
    res.status(400).json({ error: "聊天结构或长度不符合要求，请校正后重试" });
    return;
  }

  const overrides = clientProviderOverrides(req);
  const hasOwnKey = !!(overrides.apiKey && String(overrides.apiKey).trim());
  let quotaMeta: {
    remainingToday: number | null;
    dailyLimit: number | null;
    unlimited?: boolean;
    code?: string;
  } | null = null;

  if (!hasOwnKey) {
    const deviceId =
      typeof req.headers["x-device-id"] === "string"
        ? req.headers["x-device-id"]
        : "";
    const redeemToken =
      typeof req.headers["x-redeem-token"] === "string"
        ? req.headers["x-redeem-token"]
        : "";
    const runId =
      typeof req.headers["x-run-id"] === "string"
        ? req.headers["x-run-id"]
        : "";
    const isExample = req.headers["x-crush-example"] === "1";

    // Login alone does not unlock analysis — need redeem/VIP (or trial / own key).
    const authUser = await authStore.getUserByToken(bearerToken(req));
    void authUser; // reserved for conversation sync attribution
    if (redeemToken && deviceId) {
      // Redeem / VIP session (works even when REDEEM_ENABLED=false for VIP)
      try {
        quotaMeta = await redeemStore.authorizeAnalyze({
          deviceId,
          token: redeemToken,
          runId: runId || `legacy-${Date.now()}`,
        });
      } catch (error) {
        if (!(error instanceof RedeemError)) throw error;
        // Invalid/expired session → fall through to trial; quota exhausted stays 429
        if (error.status !== 401) {
          res.status(error.status).json({ error: error.message });
          return;
        }
      }
    }

    if (!quotaMeta) {
      if (isRedeemEnabled() && !redeemToken) {
        // Legacy full redeem gate: require code when enabled and no trial path
        // Still allow anonymous trial first
      }
      // 3) Anonymous trial (3 free analyses per device). Example peek skips consume.
      if (!deviceId) {
        res.status(400).json({ error: "缺少设备标识" });
        return;
      }
      if (isExample) {
        try {
          const st = await trialStore.status(deviceId);
          quotaMeta = {
            remainingToday: st.remaining,
            dailyLimit: st.limit,
            unlimited: false,
          };
        } catch (error) {
          if (error instanceof TrialError) {
            res.status(error.status).json({ error: error.message });
            return;
          }
          throw error;
        }
      } else {
        try {
          const st = await trialStore.authorize({
            deviceId,
            runId: runId || `legacy-${Date.now()}`,
          });
          quotaMeta = {
            remainingToday: st.remaining,
            dailyLimit: st.limit,
            unlimited: false,
          };
        } catch (error) {
          if (error instanceof TrialError) {
            res.status(error.status).json({
              error: error.message,
              code: error.code || "REDEEM_REQUIRED",
              used: error.extra?.used ?? TRIAL_LIMIT,
              limit: error.extra?.limit ?? TRIAL_LIMIT,
            });
            return;
          }
          throw error;
        }
      }
    }
  }

  let config;
  try {
    config = resolveRequestProvider(overrides);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      res.status(503).json({
        error:
          error.message ||
          "服务端未配置内置 Key，请在设置中填写自己的 API Key，或联系管理员。",
      });
      return;
    }
    throw error;
  }

  const now = Date.now();
  if (now - windowAt > 3600000) {
    calls = 0;
    windowAt = now;
    budgets.clear();
  }
  const key = req.ip || "local";
  let entry = budgets.get(key);
  if (!entry || now - entry.at > 60000) {
    entry = { count: 0, at: now };
    budgets.set(key, entry);
  }
  if (entry.count >= 180 || calls >= 3000 || active >= 8) {
    res.setHeader(
      "Retry-After",
      String(
        calls >= 3000
          ? Math.max(1, Math.ceil((windowAt + 3600000 - now) / 1000))
          : Math.max(1, Math.ceil((entry.at + 60000 - now) / 1000)),
      ),
    );
    res.status(429).json({ error: "分析请求较多，已保留进度，请稍后继续" });
    return;
  }
  entry.count++;
  calls++;
  active++;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const result = await analyze(valid.data, controller.signal, config);
    if (quotaMeta) {
      res.setHeader("X-Quota-Remaining", String(quotaMeta.remainingToday));
      res.setHeader("X-Quota-Limit", String(quotaMeta.dailyLimit));
    }
    // Persist chat for admin review (don't fail the analyze if sync fails)
    if (valid.data.task === "overview") {
      try {
        const deviceId =
          (typeof req.headers["x-device-id"] === "string" &&
            req.headers["x-device-id"].trim()) ||
          "";
        const authUser = await authStore.getUserByToken(bearerToken(req));
        const user = authUser
          ? { id: authUser.id, username: authUser.username }
          : deviceId && /^[a-zA-Z0-9_-]{8,80}$/.test(deviceId)
            ? {
                id: `guest:${deviceId}`,
                username: `试用·${deviceId.slice(0, 8)}`,
              }
            : null;
        if (user) {
          const clientConversationId =
            typeof req.headers["x-client-conversation-id"] === "string"
              ? req.headers["x-client-conversation-id"].trim().slice(0, 80)
              : undefined;
          const ov = result.overview;
          await conversationStore.upsert(user, {
            clientConversationId: clientConversationId || undefined,
            relation: valid.data.relation,
            selfName: "",
            otherName: "",
            affinity: ov?.affinity?.value ?? null,
            messages: valid.data.messages
              .filter((m) => m.kind === "text" && m.text.trim())
              .map((m) => ({
                id: m.id,
                sender: m.sender,
                text: m.text,
                timestamp: m.timestamp,
              })),
            overview: ov
              ? {
                  affinity: {
                    value: ov.affinity?.value ?? null,
                    confidence: ov.affinity?.confidence,
                    status: ov.affinity?.status,
                  },
                  dimensions: ov.affinityDimensions?.map((d) => ({
                    key: d.key,
                    label: d.label,
                    value: d.judgment?.value ?? null,
                  })),
                  stage: ov.stage,
                  action: ov.action,
                  status: "complete",
                }
              : undefined,
            source: authUser ? "user" : "trial",
            deviceId: deviceId || undefined,
          });
        }
      } catch (syncErr) {
        console.warn("[sync] analyze persist failed", syncErr);
      }
    }
    res.json(result);
  } catch (error) {
    const code = Number((error as { status?: number }).status) || 502;
    if (!res.headersSent && !controller.signal.aborted)
      res.status(code >= 400 && code < 600 ? code : 502).json({
        error:
          error instanceof ConfigurationError || error instanceof ProviderError
            ? error.message
            : providerErrorMessage(error),
      });
  } finally {
    active--;
  }
});


const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const indexHtml = join(dist, "index.html");

function sendSpa(
  res: express.Response,
  next: express.NextFunction,
  status = 200,
) {
  res.status(status);
  res.type("html");
  res.sendFile(indexHtml, (err) => {
    if (!err) return;
    if (!res.headersSent) {
      res
        .status(500)
        .type("html")
        .send("<!doctype html><title>Error</title><p>SPA index missing</p>");
      return;
    }
    next(err);
  });
}

// Static assets first — existing files get correct MIME; missing /assets/* must 404 (never HTML)
app.use(express.static(dist, { index: false, fallthrough: true }));

app.get(["/", "/index.html"], (_req, res, next) => sendSpa(res, next));

// Express 5 SPA fallback: no app.get("*"); never HTML-for-JS on /assets/*
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Non-GET document hits (e.g. POST / with bad JSON) → SPA, never raw JSON page
    if (!req.path.startsWith("/api")) {
      sendSpa(res, next);
      return;
    }
    return next();
  }
  if (req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/assets/")) {
    res.status(404).type("text").send("Not found");
    return;
  }
  if (res.headersSent) return next();
  sendSpa(res, next);
});

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string }).type;
    const status =
      type === "entity.too.large"
        ? 413
        : type === "entity.parse.failed"
          ? 400
          : Number((err as { status?: number }).status) || 500;
    const isApi = req.path.startsWith("/api");
    const accept = String(req.headers.accept || "");
    const wantsHtml =
      !isApi &&
      (accept.includes("text/html") || !accept.includes("application/json"));
    // Never dump raw JSON into document navigations (Chrome JSON viewer bug)
    if (wantsHtml) {
      sendSpa(res, next, 200);
      return;
    }
    res.status(status >= 400 && status < 600 ? status : 400).json({
      error:
        type === "entity.too.large" || type === "entity.parse.failed"
          ? "输入格式或体积不受支持"
          : "请求处理失败",
    });
  },
);

const port = Number(process.env.PORT || 3178);
const host = process.env.HOST || "127.0.0.1";

void (async () => {
  try {
    const seeded = await authStore.seedAdmin();
    if (seeded)
      console.log(`[auth] admin ready: ${seeded.username}`);
  } catch (e) {
    console.warn("[auth] seedAdmin failed", e);
  }
  app.listen(port, host, () => {
    const status = providerStatus();
    console.log(`Crush API: http://${host}:${port}`);
    const redeemOn = isRedeemEnabled();
    console.log(
      status.serverKeyConfigured
        ? redeemOn
          ? `Jev: ${status.provider} · ${status.model} · server key configured; redeem codes + user keys supported`
          : `Jev: ${status.provider} · ${status.model} · server key configured; redeem DISABLED (unlimited open access)`
        : `Jev: redeem/user keys required · default ${status.defaultProvider} · ${status.model}`,
    );
    console.log("[auth] username/password login enabled");
  });
})();
