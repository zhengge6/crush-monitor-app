/** Client auth + conversation sync helpers (Bearer token in localStorage). */

export type AuthUser = {
  id: string;
  username: string;
  role: "user" | "admin";
  createdAt: string;
};

const TOKEN_KEY = "crush-monitor:auth-token";
const USER_KEY = "crush-monitor:auth-user";

export function loadAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function loadCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    if (!u?.id || !u?.username) return null;
    return u;
  } catch {
    return null;
  }
}

export function saveAuthSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function api<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.body && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";
  const token = opts.token === undefined ? loadAuthToken() : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const { token: _t, ...rest } = opts;
  const res = await fetch(path, { ...rest, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : `请求失败 (${res.status})`,
    );
  return body as T;
}

export async function register(username: string, password: string) {
  const body = await api<{
    user: AuthUser;
    token: string;
    expiresAt: string;
  }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    token: null,
  });
  saveAuthSession(body.token, body.user);
  return body;
}

export async function login(username: string, password: string) {
  const body = await api<{
    user: AuthUser;
    token: string;
    expiresAt: string;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    token: null,
  });
  saveAuthSession(body.token, body.user);
  return body;
}

export async function logout() {
  const token = loadAuthToken();
  try {
    if (token)
      await api<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
        token,
      });
  } catch {
    /* still clear local */
  }
  clearAuthSession();
}

export async function me() {
  const body = await api<{ user: AuthUser }>("/api/auth/me");
  if (body.user) {
    const token = loadAuthToken();
    if (token) saveAuthSession(token, body.user);
  }
  return body.user;
}

export type SyncPayload = {
  clientConversationId?: string;
  relation: string;
  selfName?: string;
  otherName?: string;
  affinity?: number | null;
  messages: Array<{
    id: string;
    sender: "self" | "other";
    text: string;
    timestamp?: string | null;
  }>;
  overview?: {
    affinity?: {
      value?: number | null;
      confidence?: number;
      status?: string;
    };
    dimensions?: Array<{
      key?: string;
      label?: string;
      value?: number | null;
    }>;
    status?: string;
    stage?: string;
    action?: string;
  };
  note?: string;
  source?: "trial" | "user";
  deviceId?: string;
};

function sanitizeSyncPayload(payload: SyncPayload): SyncPayload {
  const messages = payload.messages
    .filter((m) => m && (m.sender === "self" || m.sender === "other"))
    .map((m) => ({
      id: String(m.id || "").slice(0, 80) || "m",
      sender: m.sender,
      text: String(m.text ?? "").slice(0, 20000),
      timestamp:
        m.timestamp == null
          ? null
          : String(m.timestamp).slice(0, 80),
    }))
    .filter((m) => m.text.trim().length > 0)
    .slice(0, 5000);
  const cleanNum = (n: unknown): number | null | undefined => {
    if (n === null) return null;
    if (typeof n === "number" && Number.isFinite(n)) return n;
    return undefined;
  };
  let overview = payload.overview;
  if (overview) {
    overview = {
      ...overview,
      affinity: overview.affinity
        ? {
            value: cleanNum(overview.affinity.value) ?? null,
            confidence: cleanNum(overview.affinity.confidence) ?? undefined,
            status: overview.affinity.status,
          }
        : undefined,
      dimensions: overview.dimensions?.map((d) => ({
        key: d.key,
        label: d.label,
        value: cleanNum(d.value) ?? null,
      })),
      action: typeof overview.action === "string" ? overview.action : undefined,
      stage: typeof overview.stage === "string" ? overview.stage : undefined,
      status: typeof overview.status === "string" ? overview.status : undefined,
    };
  }
  return {
    ...payload,
    clientConversationId: payload.clientConversationId
      ? String(payload.clientConversationId).slice(0, 80)
      : undefined,
    selfName: (payload.selfName ?? "").slice(0, 64),
    otherName: (payload.otherName ?? "").slice(0, 64),
    affinity: cleanNum(payload.affinity) ?? null,
    messages,
    overview,
  };
}

export async function syncConversation(payload: SyncPayload) {
  const body = sanitizeSyncPayload(payload);
  if (!body.messages.length) return { id: "" };
  const headers: Record<string, string> = {};
  if (body.deviceId) headers["x-device-id"] = body.deviceId;
  try {
    return await api<{ id: string }>("/api/conversations/sync", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // Allow trial sync without login; server accepts deviceId guest.
      token: loadAuthToken(),
    });
  } catch (err) {
    // Overview shape can drift; still save the chat lines for admin.
    if (body.overview) {
      const { overview: _drop, ...rest } = body;
      return api<{ id: string }>("/api/conversations/sync", {
        method: "POST",
        headers,
        body: JSON.stringify(rest),
        token: loadAuthToken(),
      });
    }
    throw err;
  }
}


export type AdminConversationMeta = {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  relation: string;
  selfName: string;
  otherName: string;
  messageCount: number;
  affinity: number | null;
};

export async function adminList(opts?: {
  limit?: number;
  offset?: number;
  q?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.offset) q.set("offset", String(opts.offset));
  if (opts?.q) q.set("q", opts.q);
  const qs = q.toString();
  return api<{ items: AdminConversationMeta[]; total: number }>(
    `/api/admin/conversations${qs ? `?${qs}` : ""}`,
  );
}

export async function adminGet(id: string) {
  return api<{
    conversation: AdminConversationMeta & {
      messages: Array<{
        id: string;
        sender: "self" | "other";
        text: string;
        timestamp?: string | null;
      }>;
      overview?: SyncPayload["overview"];
      note?: string;
    };
  }>(`/api/admin/conversations/${encodeURIComponent(id)}`);
}


export type AdminRedeemCode = {
  code: string;
  active: boolean;
  note?: string;
  createdAt: string;
  unlimited?: boolean;
  maxDevices?: number | null;
};

export async function adminListCodes() {
  return api<{ codes: AdminRedeemCode[] }>("/api/admin/codes");
}

export async function adminUpsertCodes(
  codes: Array<{
    code: string;
    active?: boolean;
    note?: string;
    unlimited?: boolean;
    maxDevices?: number | null;
  }>,
) {
  return api<{ codes: AdminRedeemCode[] }>("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
}

/** Stable client id for upsert across syncs of the same local workspace. */
export function getClientConversationId(): string {
  const KEY = "crush-monitor:client-conversation-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
      id =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().replace(/-/g, "")
          : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `c${Date.now().toString(36)}`;
  }
}

export function resetClientConversationId() {
  try {
    localStorage.removeItem("crush-monitor:client-conversation-id");
  } catch {
    /* ignore */
  }
}
