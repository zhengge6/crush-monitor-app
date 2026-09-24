import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DAILY_LIMIT = 3;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Hardcoded VIP codes: unlimited analyses + unlimited devices. */
const VIP_CODES = new Set(["疯狂星期四"]);

export type RedeemCode = {
  active: boolean;
  note?: string;
  createdAt: string;
  /** Skip daily 3-cap when true. */
  unlimited?: boolean;
  /** null/undefined = no device cap; number = max bound devices. */
  maxDevices?: number | null;
};

type DeviceRecord = {
  code: string;
  redeemedAt: string;
  /** ISO date (Asia/Shanghai YYYY-MM-DD) → consumed run ids */
  days: Record<string, string[]>;
};

type SessionRecord = {
  deviceId: string;
  code: string;
  createdAt: string;
  expiresAt: string;
};

type Store = {
  codes: Record<string, RedeemCode>;
  devices: Record<string, DeviceRecord>;
  sessions: Record<string, SessionRecord>;
};

function defaultDataDir() {
  if (process.env.CRUSH_DATA_DIR) return process.env.CRUSH_DATA_DIR;
  // Prefer production path when present; fall back to repo-local data/
  return process.env.NODE_ENV === "production" ||
    process.env.HOST === "0.0.0.0"
    ? "/opt/crush-monitor/data"
    : join(dirname(fileURLToPath(import.meta.url)), "../data");
}

function shanghaiDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** Preserve CJK; ASCII still uppercased for legacy codes. */
function normalizeCode(code: string) {
  const t = code.trim();
  if (/[\u4e00-\u9fff]/.test(t)) return t;
  return t.toUpperCase();
}

function isVipCode(code: string, meta?: RedeemCode | null) {
  if (meta?.unlimited) return true;
  const n = normalizeCode(code);
  return VIP_CODES.has(n) || VIP_CODES.has(code.trim());
}

function ensureVipMeta(store: Store, code: string): RedeemCode {
  const n = normalizeCode(code);
  const prev = store.codes[n];
  if (prev?.unlimited && prev.active) return prev;
  const meta: RedeemCode = {
    active: true,
    unlimited: true,
    maxDevices: null,
    note: prev?.note || "VIP unlimited",
    createdAt: prev?.createdAt || new Date().toISOString(),
  };
  store.codes[n] = meta;
  return meta;
}

function normalizeDeviceId(id: string) {
  const v = id.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(v))
    throw new RedeemError(400, "设备标识无效，请刷新页面重试");
  return v;
}

export class RedeemError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isRedeemEnabled(): boolean {
  const v = (process.env.REDEEM_ENABLED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

export class RedeemStore {
  private path: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: Store | null = null;

  constructor(dataDir = defaultDataDir()) {
    this.path = join(dataDir, "usage.json");
  }

  private async load(): Promise<Store> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<Store>;
      this.cache = {
        codes: parsed.codes ?? {},
        devices: parsed.devices ?? {},
        sessions: parsed.sessions ?? {},
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.cache = { codes: {}, devices: {}, sessions: {} };
      // Seed from redeem-codes.json if present (admin-editable companion file)
      try {
        const seedPath = join(dirname(this.path), "redeem-codes.json");
        const seed = JSON.parse(await readFile(seedPath, "utf8")) as {
          codes?: Record<string, RedeemCode | boolean | string>;
        };
        for (const [k, v] of Object.entries(seed.codes ?? {})) {
          const code = normalizeCode(k);
          if (typeof v === "boolean")
            this.cache.codes[code] = {
              active: v,
              createdAt: new Date().toISOString(),
            };
          else if (typeof v === "string")
            this.cache.codes[code] = {
              active: true,
              note: v,
              createdAt: new Date().toISOString(),
            };
          else
            this.cache.codes[code] = {
              active: v.active !== false,
              note: v.note,
              unlimited: !!v.unlimited,
              maxDevices: v.maxDevices ?? null,
              createdAt: v.createdAt || new Date().toISOString(),
            };
        }
      } catch {
        /* no seed file */
      }
    }
    // Always ensure hardcoded VIP codes exist (even if usage.json already seeded)
    for (const vip of VIP_CODES) {
      ensureVipMeta(this.cache, vip);
    }
    return this.cache;
  }

  private async persist(store: Store) {
    this.cache = store;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
        await rename(tmp, this.path);
      });
    await this.writeQueue;
  }

  async listCodes() {
    const store = await this.load();
    return Object.entries(store.codes).map(([code, meta]) => ({
      code,
      ...meta,
    }));
  }

  async upsertCodes(
    codes: Array<{
      code: string;
      active?: boolean;
      note?: string;
      unlimited?: boolean;
      maxDevices?: number | null;
    }>,
  ) {
    const store = await this.load();
    const now = new Date().toISOString();
    for (const item of codes) {
      const code = normalizeCode(item.code);
      // Allow CJK VIP-style codes or legacy ASCII codes
      if (!/^[\u4e00-\u9fffA-Z0-9_-]{2,40}$/.test(code))
        throw new RedeemError(400, `兑换码格式无效: ${item.code}`);
      const prev = store.codes[code];
      store.codes[code] = {
        active: item.active ?? prev?.active ?? true,
        note: item.note ?? prev?.note,
        unlimited: item.unlimited ?? prev?.unlimited ?? isVipCode(code),
        maxDevices:
          item.maxDevices !== undefined
            ? item.maxDevices
            : (prev?.maxDevices ?? (isVipCode(code) ? null : undefined)),
        createdAt: prev?.createdAt ?? now,
      };
    }
    await this.persist(store);
    return this.listCodes();
  }

  /** Wipe all sessions/devices and deactivate every code except keepActive. */
  async wipeAccess(opts?: { keepActive?: string[] }) {
    const store = await this.load();
    const keep = new Set(
      (opts?.keepActive ?? ["疯狂星期四"]).map((c) => normalizeCode(c)),
    );
    store.sessions = {};
    store.devices = {};
    for (const [code, meta] of Object.entries(store.codes)) {
      if (keep.has(code)) {
        store.codes[code] = {
          ...meta,
          active: true,
          unlimited: true,
          maxDevices: null,
          note: meta.note || "今日兑换码",
        };
      } else {
        store.codes[code] = { ...meta, active: false };
      }
    }
    for (const vip of VIP_CODES) {
      if (keep.has(normalizeCode(vip))) ensureVipMeta(store, vip);
    }
    await this.persist(store);
    return {
      kept: [...keep],
      codes: await this.listCodes(),
      sessionsCleared: true,
    };
  }

  async redeem(rawCode: string, rawDeviceId: string) {
    const code = normalizeCode(rawCode);
    const deviceId = normalizeDeviceId(rawDeviceId);
    const store = await this.load();
    let meta = store.codes[code];
    // Seed VIP only when missing; never revive an admin-deactivated code
    if (!meta && isVipCode(code)) {
      meta = ensureVipMeta(store, code);
    }
    if (!meta || !meta.active)
      throw new RedeemError(400, "兑换码无效或已停用");

    const vip = isVipCode(code, meta);
    const now = Date.now();
    // Drop expired sessions for this device
    for (const [token, s] of Object.entries(store.sessions)) {
      if (new Date(s.expiresAt).getTime() < now) delete store.sessions[token];
    }

    // VIP: do not bind / consume per-device quota records
    if (!vip) {
      const existing = store.devices[deviceId];
      if (existing && existing.code !== code) {
        store.devices[deviceId] = {
          code,
          redeemedAt: new Date().toISOString(),
          days: existing.days || {},
        };
      } else if (!existing) {
        store.devices[deviceId] = {
          code,
          redeemedAt: new Date().toISOString(),
          days: {},
        };
      }
    }

    const token = randomBytes(24).toString("hex");
    store.sessions[token] = {
      // VIP sessions ignore device binding on authorize
      deviceId: vip ? "*" : deviceId,
      code,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
    };
    await this.persist(store);

    if (vip) {
      return {
        token,
        deviceId,
        code,
        remainingToday: null as number | null,
        dailyLimit: null as number | null,
        unlimited: true,
        expiresAt: store.sessions[token].expiresAt,
      };
    }

    const remaining = this.remainingFor(store.devices[deviceId]);
    return {
      token,
      deviceId,
      code,
      remainingToday: remaining,
      dailyLimit: DAILY_LIMIT,
      unlimited: false,
      expiresAt: store.sessions[token].expiresAt,
    };
  }

  private remainingFor(device: DeviceRecord | undefined) {
    if (!device) return DAILY_LIMIT;
    const day = shanghaiDay();
    const used = device.days[day]?.length ?? 0;
    return Math.max(0, DAILY_LIMIT - used);
  }

  /**
   * Authorize a built-in-key analyze call.
   * Each unique runId per device per Shanghai day consumes 1 of 3 daily uses.
   * VIP codes skip the daily cap and device binding.
   */
  async authorizeAnalyze(opts: {
    deviceId: string;
    token: string;
    runId: string;
  }) {
    const deviceId = normalizeDeviceId(opts.deviceId);
    const runId = opts.runId.trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(runId))
      throw new RedeemError(400, "分析会话标识无效");

    const store = await this.load();
    const session = store.sessions[opts.token];
    if (!session) throw new RedeemError(401, "兑换会话无效，请重新输入兑换码");

    const codeMeta = store.codes[session.code] ?? null;
    // Do not revive deactivated codes via VIP hardcode
    const vip = isVipCode(session.code, codeMeta);

    if (!vip && session.deviceId !== deviceId)
      throw new RedeemError(401, "兑换会话无效，请重新输入兑换码");
    if (new Date(session.expiresAt).getTime() < Date.now())
      throw new RedeemError(401, "兑换会话已过期，请重新兑换");
    if (!codeMeta?.active)
      throw new RedeemError(403, "兑换码已停用，请联系管理员");

    if (vip) {
      return {
        remainingToday: null as number | null,
        dailyLimit: null as number | null,
        unlimited: true,
        code: session.code,
      };
    }

    let device = store.devices[deviceId];
    if (!device) {
      device = {
        code: session.code,
        redeemedAt: new Date().toISOString(),
        days: {},
      };
      store.devices[deviceId] = device;
    }

    const day = shanghaiDay();
    const runs = new Set(device.days[day] ?? []);
    if (!runs.has(runId)) {
      if (runs.size >= DAILY_LIMIT)
        throw new RedeemError(
          429,
          `今日免费额度已用完（${DAILY_LIMIT} 次/设备/天）。可明日再试，或在设置中粘贴自己的 API Key。`,
        );
      runs.add(runId);
      device.days[day] = [...runs];
      // Prune old days (keep ~14)
      const keys = Object.keys(device.days).sort();
      while (keys.length > 14) {
        delete device.days[keys.shift()!];
      }
      await this.persist(store);
    }

    return {
      remainingToday: Math.max(0, DAILY_LIMIT - runs.size),
      dailyLimit: DAILY_LIMIT,
      unlimited: false,
      code: session.code,
    };
  }

  async quotaStatus(deviceId: string, token?: string) {
    // When redeem gate is off, still honor VIP redeem sessions for post-trial unlock.
    // Anonymous users without VIP fall through to the trial counter in /api/quota.
    if (!isRedeemEnabled()) {
      const store = await this.load();
      const id = normalizeDeviceId(deviceId);
      if (token) {
        const session = store.sessions[token];
        const vip = !!(
          session && isVipCode(session.code, store.codes[session.code])
        );
        const valid =
          !!session &&
          (vip || session.deviceId === id) &&
          new Date(session.expiresAt).getTime() > Date.now();
        if (valid && vip) {
          return {
            redeemed: true,
            remainingToday: null as number | null,
            dailyLimit: null as number | null,
            unlimited: true,
            code: session!.code,
            day: shanghaiDay(),
          };
        }
      }
      return {
        redeemed: false,
        remainingToday: null as number | null,
        dailyLimit: null as number | null,
        unlimited: false,
        openAccess: false,
        day: shanghaiDay(),
      };
    }
    const store = await this.load();
    const id = normalizeDeviceId(deviceId);
    const device = store.devices[id];
    let redeemed = false;
    let unlimited = false;
    let code: string | undefined;
    if (token) {
      const session = store.sessions[token];
      const vip = !!(session && isVipCode(session.code, store.codes[session.code]));
      redeemed = !!(
        session &&
        (vip || session.deviceId === id) &&
        new Date(session.expiresAt).getTime() > Date.now()
      );
      if (redeemed && session) {
        code = session.code;
        unlimited = vip || !!store.codes[session.code]?.unlimited;
      }
    } else {
      redeemed = !!device;
      if (device) {
        code = device.code;
        unlimited = isVipCode(device.code, store.codes[device.code]);
      }
    }
    if (unlimited) {
      return {
        redeemed,
        remainingToday: null as number | null,
        dailyLimit: null as number | null,
        unlimited: true,
        code,
        day: shanghaiDay(),
      };
    }
    return {
      redeemed,
      remainingToday: this.remainingFor(device),
      dailyLimit: DAILY_LIMIT,
      unlimited: false,
      code,
      day: shanghaiDay(),
    };
  }
}

export function hashCode(code: string) {
  return createHash("sha256").update(normalizeCode(code)).digest("hex").slice(0, 12);
}

export const redeemStore = new RedeemStore();
export { DAILY_LIMIT, VIP_CODES, isVipCode, normalizeCode };
