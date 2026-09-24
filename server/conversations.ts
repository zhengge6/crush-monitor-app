import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { StoredLine } from "../shared/sync-snapshot";

const MAX_MESSAGES_TEXT_BYTES = 400 * 1024; // ~400kb

function defaultDataDir() {
  if (process.env.CRUSH_DATA_DIR) return process.env.CRUSH_DATA_DIR;
  return process.env.NODE_ENV === "production" ||
    process.env.HOST === "0.0.0.0"
    ? "/opt/crush-monitor/data"
    : join(dirname(fileURLToPath(import.meta.url)), "../data");
}

export class ConversationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const messageSchema = z.object({
  id: z.string().min(1).max(80),
  sender: z.enum(["self", "other"]),
  text: z.string().max(20000),
  timestamp: z.string().max(80).nullable().optional(),
});

const finiteNumber = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined),
  z.number().optional(),
);
const finiteNullableNumber = z.preprocess((v) => {
  if (v === null || v === undefined) return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}, z.number().nullable().optional());

const probMap = z
  .record(z.string().max(40), z.number().min(0).max(1))
  .optional();

const storedLineSchema = z.object({
  id: z.string().min(1).max(80),
  skipped: z.string().max(120).optional(),
  scoreValue: finiteNullableNumber,
  emotions: probMap,
  intents: probMap,
});

const overviewSchema = z
  .object({
    affinity: z
      .object({
        value: finiteNullableNumber,
        confidence: finiteNumber,
        status: z.string().optional(),
      })
      .optional(),
    dimensions: z
      .array(
        z.object({
          key: z.string().optional(),
          label: z.string().optional(),
          value: finiteNullableNumber,
        }),
      )
      .optional(),
    status: z.string().optional(),
    stage: z.string().optional(),
    action: z.string().optional(),
  })
  .passthrough()
  .optional();

export const syncBodySchema = z.object({
  clientConversationId: z.string().min(1).max(80).optional(),
  relation: z.string().min(1).max(40),
  selfName: z.string().max(64).optional().default(""),
  otherName: z.string().max(64).optional().default(""),
  affinity: finiteNullableNumber,
  messages: z.array(messageSchema).min(1).max(5000),
  lines: z.array(storedLineSchema).max(5000).optional(),
  overview: overviewSchema,
  note: z.string().max(2000).optional(),
  source: z.enum(["trial", "user"]).optional(),
  deviceId: z.string().min(8).max(80).optional(),
});

export type SyncBody = z.infer<typeof syncBodySchema>;

export type ConversationMessage = {
  id: string;
  sender: "self" | "other";
  text: string;
  timestamp?: string | null;
};

export type ConversationRecord = {
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
  messages: ConversationMessage[];
  lines?: StoredLine[];
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
  clientConversationId?: string;
  source?: "trial" | "user";
  deviceId?: string;
};

export type ConversationMeta = Omit<ConversationRecord, "messages"> & {
  messages?: undefined;
};

type IndexStore = {
  byId: Record<
    string,
    {
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
      clientConversationId?: string;
      source?: "trial" | "user";
      deviceId?: string;
    }
  >;
  /** userId:clientConversationId → id */
  byClient: Record<string, string>;
};

function utf8Bytes(s: string) {
  return Buffer.byteLength(s, "utf8");
}

function totalMessagesTextBytes(messages: ConversationMessage[]) {
  let n = 0;
  for (const m of messages) n += utf8Bytes(m.text);
  return n;
}

export class ConversationStore {
  private dir: string;
  private indexPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private indexCache: IndexStore | null = null;

  constructor(dataDir = defaultDataDir()) {
    this.dir = join(dataDir, "conversations");
    this.indexPath = join(this.dir, "index.json");
  }

  private async loadIndex(): Promise<IndexStore> {
    if (this.indexCache) return this.indexCache;
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<IndexStore>;
      this.indexCache = {
        byId: parsed.byId ?? {},
        byClient: parsed.byClient ?? {},
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.indexCache = { byId: {}, byClient: {} };
    }
    return this.indexCache;
  }

  private async persistIndex(store: IndexStore) {
    this.indexCache = store;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
        await rename(tmp, this.indexPath);
      });
    await this.writeQueue;
  }

  private filePath(id: string) {
    // sanitize id to filename-safe
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id))
      throw new ConversationError(400, "对话标识无效");
    return join(this.dir, `${id}.json`);
  }

  private async writeRecord(record: ConversationRecord) {
    await mkdir(this.dir, { recursive: true });
    const path = this.filePath(record.id);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(record), "utf8");
    await rename(tmp, path);
  }

  async upsert(
    user: { id: string; username: string },
    body: SyncBody,
  ): Promise<{ id: string }> {
    const messages: ConversationMessage[] = body.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      timestamp: m.timestamp ?? null,
    }));
    if (totalMessagesTextBytes(messages) > MAX_MESSAGES_TEXT_BYTES)
      throw new ConversationError(
        413,
        "对话文本过大（超过约 400KB），请精简后再同步",
      );

    const index = await this.loadIndex();
    const now = new Date().toISOString();
    let id: string | undefined;
    let createdAt = now;

    if (body.clientConversationId) {
      const key = `${user.id}:${body.clientConversationId}`;
      const existingId = index.byClient[key];
      if (existingId && index.byId[existingId]) {
        id = existingId;
        createdAt = index.byId[existingId].createdAt;
      }
    }

    if (!id) {
      id = randomBytes(12).toString("hex");
    }

    const affinity =
      body.affinity ??
      body.overview?.affinity?.value ??
      null;

    const record: ConversationRecord = {
      id,
      userId: user.id,
      username: user.username,
      createdAt,
      updatedAt: now,
      relation: body.relation,
      selfName: body.selfName || "",
      otherName: body.otherName || "",
      messageCount: messages.length,
      affinity: typeof affinity === "number" ? affinity : null,
      messages,
      lines: (body.lines || []).filter((line) =>
        messages.some((m) => m.id === line.id),
      ),
      overview: body.overview
        ? {
            affinity: body.overview.affinity,
            dimensions: body.overview.dimensions,
            status: body.overview.status,
            stage: body.overview.stage,
            action: body.overview.action,
          }
        : undefined,
      note: body.note,
      clientConversationId: body.clientConversationId,
      source: body.source,
      deviceId: body.deviceId,
    };

    await this.writeRecord(record);

    index.byId[id] = {
      id,
      userId: user.id,
      username: user.username,
      createdAt,
      updatedAt: now,
      relation: body.relation,
      selfName: record.selfName,
      otherName: record.otherName,
      messageCount: messages.length,
      affinity: record.affinity,
      clientConversationId: body.clientConversationId,
      source: body.source,
      deviceId: body.deviceId,
    };
    if (body.clientConversationId) {
      index.byClient[`${user.id}:${body.clientConversationId}`] = id;
    }
    await this.persistIndex(index);
    return { id };
  }

  async saveAnalysis(
    id: string,
    patch: {
      lines: StoredLine[];
      overview?: ConversationRecord["overview"];
      affinity: number | null;
    },
  ) {
    const record = await this.getById(id);
    if (!record) throw new ConversationError(404, "对话不存在");
    const now = new Date().toISOString();
    const ids = new Set(record.messages.map((m) => m.id));
    record.lines = patch.lines.filter((line) => ids.has(line.id));
    record.overview = patch.overview ?? record.overview;
    record.affinity = patch.affinity;
    record.updatedAt = now;
    await this.writeRecord(record);
    const index = await this.loadIndex();
    const meta = index.byId[id];
    if (meta) {
      meta.updatedAt = now;
      meta.affinity = patch.affinity;
      await this.persistIndex(index);
    }
    return record;
  }

  async listForAdmin(opts: {
    limit?: number;
    offset?: number;
    q?: string;
  }): Promise<{ items: ConversationMeta[]; total: number }> {
    const index = await this.loadIndex();
    let items = Object.values(index.byId);
    const q = (opts.q || "").trim().toLowerCase();
    if (q) {
      items = items.filter(
        (x) =>
          x.username.toLowerCase().includes(q) ||
          x.relation.toLowerCase().includes(q) ||
          x.selfName.toLowerCase().includes(q) ||
          x.otherName.toLowerCase().includes(q) ||
          x.id.toLowerCase().includes(q),
      );
    }
    items.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const total = items.length;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const slice = items.slice(offset, offset + limit).map((meta) => ({
      ...meta,
      messages: undefined,
    }));
    return { items: slice, total };
  }

  async getById(id: string): Promise<ConversationRecord | null> {
    try {
      const raw = await readFile(this.filePath(id), "utf8");
      return JSON.parse(raw) as ConversationRecord;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}

export const conversationStore = new ConversationStore();
export { MAX_MESSAGES_TEXT_BYTES };
