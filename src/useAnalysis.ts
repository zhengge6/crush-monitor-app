import { useRef, useState } from "react";
import { incrementalJobs, overviewJob } from "../shared/incremental";
import {
  collectEvents,
  boundedContext,
  type MemoryEvent,
} from "../shared/memory";
import {
  RUBRIC,
  requestContextKey,
  type Message,
  type Relation,
  type Overview,
  type LineResult,
  type AnalysisRequest,
  type AnalysisResponse,
} from "../shared/types";
import {
  loadCredentials,
  loadRedeemSession,
  getDeviceId,
  newRunId,
  type SavedConversation,
  type Trend,
} from "./storage";
import { loadAuthToken, getClientConversationId } from "./auth";
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
export function useAnalysis() {
  const [overview, setOverview] = useState<Overview | null>(null),
    [overviewFresh, setOverviewFresh] = useState(false),
    [lines, setLines] = useState<Record<string, LineResult>>({}),
    [events, setEvents] = useState<Record<string, MemoryEvent>>({}),
    [trend, setTrend] = useState<Trend[]>([]),
    [status, setStatus] = useState<"idle" | "loading" | "complete" | "error">(
      "idle",
    ),
    [error, setError] = useState(""),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [latency, setLatency] = useState(0),
    [analyzedCount, setAnalyzedCount] = useState(0);
  const rev = useRef(0),
    controller = useRef<AbortController | null>(null),
    base = useRef<{ messages: Message[]; relation: Relation } | null>(null),
    savedLines = useRef(lines),
    savedEvents = useRef(events),
    processed = useRef(0);
  function cancel() {
    rev.current++;
    controller.current?.abort();
    setStatus("idle");
  }
  function reset() {
    cancel();
    base.current = null;
    savedLines.current = {};
    savedEvents.current = {};
    processed.current = 0;
    setLines({});
    setEvents({});
    setTrend([]);
    setOverview(null);
    setOverviewFresh(false);
    setError("");
    setLatency(0);
    setAnalyzedCount(0);
  }
  function restore(s: SavedConversation) {
    reset();
    base.current = { messages: s.messages, relation: s.relation };
    if (s.rubric !== RUBRIC) return;
    savedLines.current = s.lines;
    savedEvents.current = s.events;
    processed.current = s.analyzedCount;
    setLines(s.lines);
    setEvents(s.events);
    setTrend(s.trend);
    setOverview(s.overview);
    setOverviewFresh(s.completed);
    setAnalyzedCount(s.analyzedCount);
    setStatus(s.completed ? "complete" : "idle");
  }
  async function run(
    messages: Message[],
    relation: Relation,
    opts?: { example?: boolean },
  ) {
    const revision = ++rev.current;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const runId = newRunId();
    const started = performance.now();
    setStatus("loading");
    setError("");
    setOverviewFresh(false);
    const previous = base.current;
    const append =
      !!previous &&
      previous.relation === relation &&
      previous.messages.length <= messages.length &&
      previous.messages.every(
        (m, i) =>
          m.id === messages[i].id &&
          m.sender === messages[i].sender &&
          m.text === messages[i].text &&
          m.timestamp === messages[i].timestamp,
      );
    const changed = !append || messages.length !== processed.current;
    let nextLines: Record<string, LineResult> = append
      ? { ...savedLines.current }
      : {};
    let nextEvents: Record<string, MemoryEvent> = append
      ? { ...savedEvents.current }
      : {};
    if (!append) {
      setTrend([]);
      setOverview(null);
      processed.current = 0;
      setAnalyzedCount(0);
    }
    savedEvents.current = nextEvents;
    setEvents(nextEvents);
    base.current = { messages, relation };
    for (const m of messages)
      if (m.kind === "text" && Array.from(m.text).length > 12000)
        nextLines[m.id] = {
          id: m.id,
          skipped: "单条超过12,000字，已保存，请拆分后分析",
          score: {
            value: null,
            confidence: 0,
            status: "insufficient",
            probabilities: {},
          },
        };
    setLines(nextLines);
    savedLines.current = nextLines;
    const jobs = incrementalJobs(
      messages,
      relation,
      revision,
      nextLines,
      nextEvents,
      changed,
    );
    if (!append) jobs.reverse();
    const first = overviewJob(messages, relation, revision, nextEvents);
    if (!first.messages.length) {
      setStatus("error");
      setError("记录已保存，但没有可分析的文字。单条过长的消息请拆分。");
      return;
    }
    let failed = 0,
      done = 0;
    setProgress({ done: 0, total: jobs.length + 2 });
    async function execute(job: AnalysisRequest) {
      let data: AnalysisResponse | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        const creds = loadCredentials();
        const redeem = loadRedeemSession();
        const deviceId = getDeviceId();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
          "X-Run-Id": runId,
          "X-Client-Conversation-Id": getClientConversationId(),
        };
        const authTok = loadAuthToken();
        if (authTok) headers.Authorization = `Bearer ${authTok}`;
        if (opts?.example) headers["X-Crush-Example"] = "1";
        if (creds.apiKey.trim()) {
          headers["X-Jev-Api-Key"] = creds.apiKey.trim();
          headers["X-Jev-Provider"] = creds.provider || "typesafe";
        } else if (redeem?.token) {
          headers["X-Redeem-Token"] = redeem.token;
        }
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers,
          body: JSON.stringify(job),
          signal: ctrl.signal,
        });
        if ([429, 529].includes(response.status) && attempt < 3) {
          await pause(
            Math.min(
              60000,
              Number(response.headers.get("retry-after") || 2 ** attempt) *
                1000,
            ),
            ctrl.signal,
          );
          continue;
        }
        const body = await response.json();
        if (!response.ok) {
          const err = new Error(body.error || "分析失败") as Error & {
            code?: string;
            status?: number;
          };
          err.code =
            typeof body.code === "string" ? body.code : undefined;
          err.status = response.status;
          throw err;
        }
        data = body;
        break;
      }
      if (!data || data.revision !== revision || data.rubricVersion !== RUBRIC)
        throw new Error("分析版本不匹配，请刷新重试");
      if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(requestContextKey(job)),
        );
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== data.contextHash)
          throw new Error("分析上下文不匹配，请重试");
      }
      if (rev.current !== revision) return;
      if (data.overview) {
        setOverview(data.overview);
        setLatency(Math.round(performance.now() - started));
      }
      const added = Object.fromEntries(
        (data.lines ?? []).map((l) => [l.id, l]),
      );
      nextLines = { ...nextLines, ...added };
      nextEvents = collectEvents(added, nextEvents);
      for (const update of data.memoryUpdates ?? []) {
        const old = nextEvents[update.id];
        if (old)
          nextEvents[update.id] = {
            ...old,
            status: update.status,
            resolvedBy:
              update.status === "resolved"
                ? (update.evidenceId ?? undefined)
                : update.status === "uncertain"
                  ? old.resolvedBy
                  : undefined,
          };
      }
      savedLines.current = nextLines;
      savedEvents.current = nextEvents;
      setLines(nextLines);
      setEvents(nextEvents);
      return data;
    }
    async function safely(job: AnalysisRequest) {
      try {
        return await execute(job);
      } catch (e) {
        if (!ctrl.signal.aborted) {
          failed++;
          setError((e as Error).message);
        }
      } finally {
        if (rev.current === revision)
          setProgress((p) => ({ ...p, done: ++done }));
      }
    }
    // Initial overview is provisional until historical event extraction completes.
    await safely(first);
    async function worker() {
      while (jobs.length && rev.current === revision) {
        const job = jobs.shift()!;
        // Refresh retrieved evidence as earlier chunks finish extracting events.
        const positions = job.targetIds.map((id) =>
          messages.findIndex((m) => m.id === id),
        );
        const firstTarget = Math.min(...positions),
          lastTarget = Math.max(...positions);
        const revised = boundedContext(
          messages,
          Math.max(0, firstTarget - 80),
          job.task === "self_message"
            ? lastTarget + 1
            : Math.min(messages.length, lastTarget + 21),
          nextEvents,
          job.task === "self_message",
        );
        // Keep deliberately retrieved distant corrections paired with the newest context.
        if (job.memory?.some((e) => job.targetIds.includes(e.id)))
          await safely(job);
        else if (
          job.targetIds.every((id) => revised.messages.some((m) => m.id === id))
        )
          await safely({ ...job, ...revised });
        else await safely(job);
      }
    }
    await Promise.all([worker(), worker()]);
    if (rev.current !== revision) return;
    const final = await safely(
      overviewJob(messages, relation, revision, nextEvents),
    );
    if (rev.current !== revision) return;
    setOverviewFresh(!!final?.overview && !failed);
    setStatus(failed ? "error" : "complete");
    if (final?.overview && !failed) {
      processed.current = messages.length;
      setAnalyzedCount(messages.length);
      setTrend((old) => {
        const point = {
          at: new Date().toISOString(),
          value: final.overview!.affinity.value,
          count: messages.length,
        };
        return old.at(-1)?.count === point.count
          ? [...old.slice(0, -1), point]
          : [...old, point];
      });
    }
  }
  return {
    overview,
    overviewFresh,
    lines,
    events,
    trend,
    status,
    error,
    clearError: () => setError(""),
    progress,
    latency,
    analyzedCount,
    run,
    cancel,
    reset,
    restore,
  };
}
