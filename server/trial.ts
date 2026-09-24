import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TRIAL_LIMIT = Number(process.env.TRIAL_LIMIT || 3);

function defaultDataDir() {
  if (process.env.CRUSH_DATA_DIR) return process.env.CRUSH_DATA_DIR;
  return process.env.NODE_ENV === "production" ||
    process.env.HOST === "0.0.0.0"
    ? "/opt/crush-monitor/data"
    : join(dirname(fileURLToPath(import.meta.url)), "../data");
}

type DeviceTrial = {
  /** Unique analysis run ids that consumed a trial slot */
  runs: string[];
  updatedAt: string;
};

type Store = { devices: Record<string, DeviceTrial> };

export class TrialError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function normalizeDeviceId(id: string) {
  const v = id.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(v))
    throw new TrialError(400, "设备标识无效，请刷新页面重试");
  return v;
}

export class TrialStore {
  private path: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: Store | null = null;

  constructor(dataDir = defaultDataDir()) {
    this.path = join(dataDir, "trials.json");
  }

  private async load(): Promise<Store> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<Store>;
      this.cache = { devices: parsed.devices ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.cache = { devices: {} };
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

  remaining(device: DeviceTrial | undefined) {
    const used = device?.runs?.length ?? 0;
    return Math.max(0, TRIAL_LIMIT - used);
  }

  async status(rawDeviceId: string) {
    const deviceId = normalizeDeviceId(rawDeviceId);
    const store = await this.load();
    const device = store.devices[deviceId];
    const used = device?.runs?.length ?? 0;
    return {
      used,
      remaining: Math.max(0, TRIAL_LIMIT - used),
      limit: TRIAL_LIMIT,
    };
  }

  /**
   * Consume one trial slot per unique runId (same analysis session = one slot).
   * Throws TrialError 403 REDEEM_REQUIRED when exhausted.
   */
  async authorize(opts: { deviceId: string; runId: string }) {
    const deviceId = normalizeDeviceId(opts.deviceId);
    const runId = opts.runId.trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(runId))
      throw new TrialError(400, "分析会话标识无效");

    const store = await this.load();
    let device = store.devices[deviceId];
    if (!device) {
      device = { runs: [], updatedAt: new Date().toISOString() };
      store.devices[deviceId] = device;
    }
    const runs = new Set(device.runs);
    if (!runs.has(runId)) {
      if (runs.size >= TRIAL_LIMIT) {
        throw new TrialError(
          403,
          "免费试玩次数已用完，请输入兑换码继续",
          "REDEEM_REQUIRED",
          { used: runs.size, limit: TRIAL_LIMIT },
        );
      }
      runs.add(runId);
      device.runs = [...runs];
      device.updatedAt = new Date().toISOString();
      await this.persist(store);
    }
    return {
      remaining: Math.max(0, TRIAL_LIMIT - runs.size),
      used: runs.size,
      limit: TRIAL_LIMIT,
      unlimited: false,
    };
  }
}

export const trialStore = new TrialStore();
