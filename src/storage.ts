/**
 * Browser-local persistence only.
 * Conversation / analysis / relation / UI workspace live in IndexedDB;
 * deviceId, redeem session, and API credentials live in localStorage.
 * Opening the site on another phone/browser never sees this chat history.
 * Server redeem usage is keyed by deviceId for quota only — chat transcripts
 * are never stored in a shared server-side conversation store.
 */
import {
  RUBRIC,
  type Message,
  type Relation,
  type LineResult,
  type Overview,
} from "../shared/types";
import type { MemoryEvent } from "../shared/memory";
export type Trend = { at: string; value: number | null; count: number };
export type SideSnapshot = {
  rubric: string;
  messages: Message[];
  self: string;
  other: string;
  relation: Relation;
  lines: Record<string, LineResult>;
  events: Record<string, MemoryEvent>;
  overview: Overview | null;
  trend: Trend[];
  analyzedCount: number;
  completed: boolean;
};
export type SavedConversation = {
  schema: 1;
  rubric: string;
  messages: Message[];
  self: string;
  other: string;
  relation: Relation;
  lines: Record<string, LineResult>;
  events: Record<string, MemoryEvent>;
  overview: Overview | null;
  trend: Trend[];
  analyzedCount: number;
  completed: boolean;
  sides?: SideSnapshot[];
};
export function sameAssignment(
  a: Message[],
  b: Message[],
  relationA: Relation,
  relationB: Relation,
) {
  if (relationA !== relationB || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.sender !== y.sender ||
      x.text !== y.text ||
      x.timestamp !== y.timestamp ||
      x.kind !== y.kind
    )
      return false;
  }
  return true;
}

export function upsertSide(sides: SideSnapshot[], current: SavedConversation) {
  if (!current.completed || !current.messages.length || current.rubric !== RUBRIC)
    return sides;
  const snap: SideSnapshot = {
    rubric: current.rubric,
    messages: current.messages,
    self: current.self,
    other: current.other,
    relation: current.relation,
    lines: current.lines,
    events: current.events,
    overview: current.overview,
    trend: current.trend,
    analyzedCount: current.analyzedCount,
    completed: true,
  };
  const next = sides.slice();
  const index = next.findIndex(
    (side) =>
      side.rubric === snap.rubric &&
      sameAssignment(side.messages, snap.messages, side.relation, snap.relation),
  );
  if (index >= 0) next[index] = snap;
  else next.push(snap);
  return next.slice(-6);
}

export function findSide(
  sides: SideSnapshot[],
  messages: Message[],
  relation: Relation,
) {
  for (let i = sides.length - 1; i >= 0; i--) {
    const side = sides[i];
    if (
      side.completed &&
      side.rubric === RUBRIC &&
      sameAssignment(side.messages, messages, side.relation, relation)
    )
      return side;
  }
  return undefined;
}

let connection: Promise<IDBDatabase> | undefined;
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("crush-monitor", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      connection = undefined;
      reject(req.error);
    };
  }));
}
export async function loadConversation(): Promise<
  SavedConversation | undefined
> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database
      .transaction("workspace")
      .objectStore("workspace")
      .get("current");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
// Serial transactions ensure clearing cannot be followed by an older queued save.
let queue: Promise<void> = Promise.resolve();
export function saveConversation(value: SavedConversation | null) {
  const operation = queue
    .catch(() => {})
    .then(async () => {
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction("workspace", "readwrite");
        if (value) tx.objectStore("workspace").put(value, "current");
        else tx.objectStore("workspace").delete("current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("保存被中断"));
      });
    });
  queue = operation;
  return operation;
}

const CRED_KEY = "crush-monitor:jev-credentials";
const DEVICE_KEY = "crush-monitor:device-id";
const REDEEM_KEY = "crush-monitor:redeem:v2";
const CACHE_EPOCH_KEY = "crush-monitor:cache-epoch";
const LEGACY_REDEEM_KEYS = ["crush-monitor:redeem"];
const COOKIE_NAME = "crush_device_id";

export type JevCredentials = {
  provider: "typesafe" | "vercel" | "openrouter";
  apiKey: string;
};

export type RedeemSession = {
  token: string;
  code: string;
  expiresAt?: string;
};

function readCookie(name: string) {
  try {
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
    );
    return m ? decodeURIComponent(m[1]) : "";
  } catch {
    return "";
  }
}

function writeCookie(name: string, value: string) {
  try {
    const maxAge = 60 * 60 * 24 * 400;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    /* private mode may block */
  }
}

/** Durable device id: localStorage UUID mirrored to cookie. Private mode resets both. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY) || readCookie(COOKIE_NAME);
    if (!id || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
      id = "";
      try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
          id = crypto.randomUUID().replace(/-/g, "");
      } catch {
        /* http://IP is not a secure context */
      }
      if (!id)
        id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
    localStorage.setItem(DEVICE_KEY, id);
    writeCookie(COOKIE_NAME, id);
    return id;
  } catch {
    return `ephemeral${Date.now().toString(36)}`;
  }
}

export function loadCredentials(): JevCredentials {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return { provider: "typesafe", apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<JevCredentials>;
    const provider =
      parsed.provider === "vercel" || parsed.provider === "openrouter"
        ? parsed.provider
        : "typesafe";
    return {
      provider,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { provider: "typesafe", apiKey: "" };
  }
}

export function saveCredentials(value: JevCredentials) {
  localStorage.setItem(
    CRED_KEY,
    JSON.stringify({
      provider: value.provider || "typesafe",
      apiKey: value.apiKey || "",
    }),
  );
}

export function loadRedeemSession(): RedeemSession | null {
  try {
    const raw = localStorage.getItem(REDEEM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RedeemSession>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      code: typeof parsed.code === "string" ? parsed.code : "",
      expiresAt:
        typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}

export function saveRedeemSession(value: RedeemSession | null) {
  if (!value) localStorage.removeItem(REDEEM_KEY);
  else localStorage.setItem(REDEEM_KEY, JSON.stringify(value));
}

export function newRunId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      return crypto.randomUUID().replace(/-/g, "");
  } catch {
    /* insecure context */
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Drop stale local redeem/auth caches when server CACHE_EPOCH changes. */
export function applyCacheEpoch(epoch: string | null | undefined) {
  if (!epoch) return false;
  try {
    const prev = localStorage.getItem(CACHE_EPOCH_KEY);
    if (prev === epoch) return false;
    for (const k of LEGACY_REDEEM_KEYS) localStorage.removeItem(k);
    localStorage.removeItem(REDEEM_KEY);
    localStorage.setItem(CACHE_EPOCH_KEY, epoch);
    return true;
  } catch {
    return false;
  }
}

