import { incrementalJobs, overviewJob } from "../shared/incremental";
import { collectEvents, type MemoryEvent } from "../shared/memory";
import { compactLine, compactLines, type StoredLine } from "../shared/sync-snapshot";
import {
  RELATIONS,
  type AnalysisRequest,
  type LineResult,
  type Message,
  type Overview,
  type Relation,
} from "../shared/types";
import { analyze } from "./analysis";
import type { ConversationRecord } from "./conversations";
import { getProviderConfig } from "./provider-config";

const media =
  /^\[(?:图片|语音|视频|动画表情|表情包|文件|不支持的消息|撤回消息)\]$/;

function asRelation(value: string): Relation {
  return value in RELATIONS ? (value as Relation) : "crush";
}

function toAnalysisMessages(record: ConversationRecord): Message[] {
  return record.messages.map((m) => ({
    id: m.id,
    sender: m.sender,
    text: m.text,
    timestamp: m.timestamp ?? null,
    kind: media.test(m.text.trim()) ? "unreadable" : "text",
  }));
}

function storedToLine(line: StoredLine): LineResult {
  const scoreValue =
    typeof line.scoreValue === "number" && Number.isFinite(line.scoreValue)
      ? line.scoreValue
      : null;
  return {
    id: line.id,
    skipped: line.skipped,
    emotions: line.emotions,
    intents: line.intents,
    score: {
      value: scoreValue,
      confidence: scoreValue == null ? 0 : 1,
      status: scoreValue == null ? "insufficient" : "clear",
      probabilities: {},
    },
  };
}

export function lineCovers(message: Message, line?: StoredLine) {
  if (!line) return false;
  if (line.skipped) return true;
  if (message.kind !== "text" || Array.from(message.text).length > 12000)
    return true;
  if (message.sender === "other")
    return Boolean(line.emotions || line.intents);
  return typeof line.scoreValue === "number";
}

export function tagsCached(record: ConversationRecord) {
  const messages = toAnalysisMessages(record);
  const byId = new Map((record.lines || []).map((line) => [line.id, line]));
  return messages.every((message) => lineCovers(message, byId.get(message.id)));
}

function overviewPatch(overview: Overview | undefined) {
  if (!overview) return undefined;
  return {
    affinity: {
      value: overview.affinity?.value ?? null,
      confidence: overview.affinity?.confidence,
      status: overview.affinity?.status,
    },
    dimensions: overview.affinityDimensions?.map((d) => ({
      key: d.key,
      label: d.label,
      value: d.judgment?.value ?? null,
    })),
    stage: overview.stage,
    action: overview.action,
    status: "complete",
  };
}

export async function analyzeRecord(record: ConversationRecord) {
  if (tagsCached(record))
    return { cached: true as const, lines: record.lines || [], overview: record.overview, affinity: record.affinity };
  const messages = toAnalysisMessages(record);
  const relation = asRelation(record.relation);
  const config = getProviderConfig();
  let nextLines: Record<string, LineResult> = Object.fromEntries(
    (record.lines || []).map((line) => [line.id, storedToLine(line)]),
  );
  let nextEvents: Record<string, MemoryEvent> = {};
  nextEvents = collectEvents(nextLines, nextEvents);
  const revision = 1;
  const jobs = incrementalJobs(
    messages,
    relation,
    revision,
    nextLines,
    nextEvents,
    false,
  );
  let overview: Overview | undefined;
  const runJob = async (job: AnalysisRequest) => {
    const data = await analyze(job, undefined, config);
    if (data.overview) overview = data.overview;
    const added = Object.fromEntries((data.lines ?? []).map((line) => [line.id, line]));
    nextLines = { ...nextLines, ...added };
    nextEvents = collectEvents(added, nextEvents);
    for (const update of data.memoryUpdates ?? []) {
      const old = nextEvents[update.id];
      if (!old) continue;
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
  };
  await runJob(overviewJob(messages, relation, revision, nextEvents));
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift()!;
      await runJob(job);
    }
  };
  await Promise.all([worker(), worker()]);
  await runJob(overviewJob(messages, relation, revision, nextEvents));
  const lines = compactLines(nextLines);
  const affinity =
    typeof overview?.affinity?.value === "number" ? overview.affinity.value : record.affinity;
  return {
    cached: false as const,
    lines,
    overview: overviewPatch(overview),
    affinity,
  };
}

export { compactLine };
