import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response, NextFunction } from "express";

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

export type UserRole = "user" | "admin";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  createdAt: string;
};

export type SessionRecord = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type UsersStore = { users: Record<string, UserRecord> };
type SessionsStore = { sessions: Record<string, SessionRecord> };

export type PublicUser = {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
};

function defaultDataDir() {
  if (process.env.CRUSH_DATA_DIR) return process.env.CRUSH_DATA_DIR;
  return process.env.NODE_ENV === "production" ||
    process.env.HOST === "0.0.0.0"
    ? "/opt/crush-monitor/data"
    : join(dirname(fileURLToPath(import.meta.url)), "../data");
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff-]+$/;

export function normalizeUsername(raw: string) {
  const username = raw.trim();
  if (username.length < 3 || username.length > 32)
    throw new AuthError(400, "用户名需为 3–32 个字符");
  if (!USERNAME_RE.test(username))
    throw new AuthError(
      400,
      "用户名仅支持字母、数字、下划线、连字符与中文",
    );
  return username;
}

export function validatePassword(password: string) {
  if (typeof password !== "string" || password.length < 6)
    throw new AuthError(400, "密码至少 6 位");
  return password;
}

async function hashPassword(password: string, salt: string) {
  const buf = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return buf.toString("hex");
}

function toPublic(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  };
}

export class AuthStore {
  private usersPath: string;
  private sessionsPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private usersCache: UsersStore | null = null;
  private sessionsCache: SessionsStore | null = null;

  constructor(dataDir = defaultDataDir()) {
    this.usersPath = join(dataDir, "users.json");
    this.sessionsPath = join(dataDir, "sessions.json");
  }

  private async loadUsers(): Promise<UsersStore> {
    if (this.usersCache) return this.usersCache;
    try {
      const raw = await readFile(this.usersPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UsersStore>;
      this.usersCache = { users: parsed.users ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.usersCache = { users: {} };
    }
    return this.usersCache;
  }

  private async loadSessions(): Promise<SessionsStore> {
    if (this.sessionsCache) return this.sessionsCache;
    try {
      const raw = await readFile(this.sessionsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionsStore>;
      this.sessionsCache = { sessions: parsed.sessions ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.sessionsCache = { sessions: {} };
    }
    return this.sessionsCache;
  }

  private async persistUsers(store: UsersStore) {
    this.usersCache = store;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.usersPath), { recursive: true });
        const tmp = `${this.usersPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
        await rename(tmp, this.usersPath);
      });
    await this.writeQueue;
  }

  private async persistSessions(store: SessionsStore) {
    this.sessionsCache = store;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.sessionsPath), { recursive: true });
        const tmp = `${this.sessionsPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
        await rename(tmp, this.sessionsPath);
      });
    await this.writeQueue;
  }

  private findByUsername(store: UsersStore, username: string) {
    const lower = username.toLowerCase();
    return Object.values(store.users).find(
      (u) => u.username.toLowerCase() === lower,
    );
  }

  async seedAdmin() {
    const username = (process.env.ADMIN_USERNAME || "").trim();
    const password = process.env.ADMIN_PASSWORD || "";
    if (!username || !password) return null;
    let normalized: string;
    try {
      normalized = normalizeUsername(username);
    } catch {
      console.warn("[auth] ADMIN_USERNAME invalid; skip seedAdmin");
      return null;
    }
    if (password.length < 4) {
      console.warn("[auth] ADMIN_PASSWORD too short; skip seedAdmin");
      return null;
    }
    const store = await this.loadUsers();
    const existing = this.findByUsername(store, normalized);
    const salt = existing?.salt || randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.salt = salt;
      existing.role = "admin";
      existing.username = normalized;
      await this.persistUsers(store);
      return toPublic(existing);
    }
    const id = randomBytes(12).toString("hex");
    const user: UserRecord = {
      id,
      username: normalized,
      passwordHash,
      salt,
      role: "admin",
      createdAt: now,
    };
    store.users[id] = user;
    await this.persistUsers(store);
    return toPublic(user);
  }

  async register(rawUsername: string, rawPassword: string) {
    const username = normalizeUsername(rawUsername);
    const password = validatePassword(rawPassword);
    const store = await this.loadUsers();
    if (this.findByUsername(store, username))
      throw new AuthError(409, "用户名已被占用");
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    const id = randomBytes(12).toString("hex");
    const user: UserRecord = {
      id,
      username,
      passwordHash,
      salt,
      role: "user",
      createdAt: new Date().toISOString(),
    };
    store.users[id] = user;
    await this.persistUsers(store);
    const session = await this.createSession(id);
    return { user: toPublic(user), token: session.token, expiresAt: session.expiresAt };
  }

  async login(rawUsername: string, rawPassword: string) {
    const username = normalizeUsername(rawUsername);
    if (typeof rawPassword !== "string" || !rawPassword)
      throw new AuthError(400, "请输入密码");
    const password = rawPassword;
    const store = await this.loadUsers();
    const user = this.findByUsername(store, username);
    if (!user) throw new AuthError(401, "用户名或密码错误");
    const hash = await hashPassword(password, user.salt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(user.passwordHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new AuthError(401, "用户名或密码错误");
    const session = await this.createSession(user.id);
    return { user: toPublic(user), token: session.token, expiresAt: session.expiresAt };
  }

  private async createSession(userId: string) {
    const store = await this.loadSessions();
    const now = Date.now();
    for (const [token, s] of Object.entries(store.sessions)) {
      if (new Date(s.expiresAt).getTime() < now) delete store.sessions[token];
    }
    const token = randomBytes(24).toString("hex");
    const record: SessionRecord = {
      token,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    store.sessions[token] = record;
    await this.persistSessions(store);
    return record;
  }

  async logout(token: string) {
    if (!token) return;
    const store = await this.loadSessions();
    if (store.sessions[token]) {
      delete store.sessions[token];
      await this.persistSessions(store);
    }
  }

  async getUserByToken(token: string): Promise<PublicUser | null> {
    if (!token) return null;
    const sessions = await this.loadSessions();
    const session = sessions.sessions[token];
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      delete sessions.sessions[token];
      await this.persistSessions(sessions);
      return null;
    }
    const users = await this.loadUsers();
    const user = users.users[session.userId];
    if (!user) return null;
    return toPublic(user);
  }

  async listUsers() {
    const store = await this.loadUsers();
    return Object.values(store.users).map(toPublic);
  }
}

export const authStore = new AuthStore();

export function bearerToken(req: Request): string {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer "))
    return h.slice(7).trim();
  return "";
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = bearerToken(req);
    const user = await authStore.getUserByToken(token);
    if (!user) {
      res.status(401).json({ error: "请先登录" });
      return;
    }
    (req as Request & { user?: PublicUser; authToken?: string }).user = user;
    (req as Request & { user?: PublicUser; authToken?: string }).authToken =
      token;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const adminToken = process.env.ADMIN_TOKEN || "";
    const header =
      (typeof req.headers["x-admin-token"] === "string" &&
        req.headers["x-admin-token"]) ||
      "";
    if (adminToken && header && header === adminToken) {
      (req as Request & { user?: PublicUser }).user = {
        id: "admin-token",
        username: "admin",
        role: "admin",
        createdAt: new Date(0).toISOString(),
      };
      next();
      return;
    }
    const token = bearerToken(req);
    const user = await authStore.getUserByToken(token);
    if (!user || user.role !== "admin") {
      res.status(401).json({ error: "需要管理员权限" });
      return;
    }
    (req as Request & { user?: PublicUser; authToken?: string }).user = user;
    (req as Request & { user?: PublicUser; authToken?: string }).authToken =
      token;
    next();
  } catch (e) {
    next(e);
  }
}

export { SESSION_TTL_MS };
