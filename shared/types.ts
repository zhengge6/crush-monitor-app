import type { MemoryEvent, MemoryUpdate } from "./memory";
import type { AffinityDimension } from "./affinity";
export type Relation = "crush" | "new" | "couple" | "friend" | "advisor" | "platonic";
export type Message = {
  id: string;
  sender: "self" | "other";
  text: string;
  timestamp: string | null;
  kind: "text" | "unreadable";
};
export type Parsed = {
  speaker: string;
  text: string;
  timestamp: string | null;
};
export type Judgment = {
  value: number | null;
  confidence: number;
  status: "clear" | "ambiguous" | "insufficient";
  probabilities: Record<string, number>;
};
export type LineResult = {
  event?: { kind: MemoryEvent["kind"]; confidence: number };
  skipped?: string;
  id: string;
  score: Judgment;
  emotions?: Record<string, number>;
  intents?: Record<string, number>;
  replyType?: string;
  replyConfidence?: number;
  tone?: string;
  tones?: Record<string, number>;
  toneConfidence?: number;
};
export type Overview = {
  memoryEvidenceIds?: string[];
  contextCount?: number;
  affinity: Judgment;
  affinityDimensions?: AffinityDimension[];
  affinityRawValue?: number;
  boundaryApplied?: boolean;
  stage: string;
  rapport?: Judgment;
  action: string;
  alternative?: string;
  evidenceId: string | null;
  actionEvidenceId: string | null;
};
export type Snapshot = {
  revision: number;
  messages: Message[];
  lines: Record<string, LineResult>;
  overview: Overview;
  relation: Relation;
  at: string;
  latencyMs: number;
  source: "live" | "fixture";
  comparable: boolean;
};
export type Task = "overview" | "other_messages" | "self_message";
export type AnalysisRequest = {
  memory?: Pick<MemoryEvent, "id" | "kind" | "status" | "resolvedBy">[];
  revision: number;
  relation: Relation;
  messages: Message[];
  task: Task;
  targetIds: string[];
};
export type AnalysisResponse = {
  memoryUpdates?: MemoryUpdate[];
  revision: number;
  contextHash: string;
  model: string;
  rubricVersion: string;
  overview?: Overview;
  lines?: LineResult[];
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
};
export const MODEL = "jev-1.13.0";
export const RUBRIC = "crush-2026-09-24.1";
export const RELATIONS: Record<Relation, string> = {
  crush: "Crush / 暧昧中",
  new: "刚认识",
  couple: "恋爱中",
  friend: "普通朋友",
  advisor: "研究生导师",
  platonic: "纯友谊异性",
};
/** Extra framing for Chinese social norms; appended into analysis context. */
export const RELATION_HINTS: Record<Relation, string> = {
  crush:
    "暧昧靠试探与对你特别的信号来判断；礼貌、已读乱回、说工作忙≠拒绝，也不=喜欢。",
  new: "刚认识以客气和兴趣为主；回得慢、语气淡很正常，别浪漫化。",
  couple:
    "已确认恋爱：看情绪是否接住、冲突能否修复，不因关系身份自动高分。",
  friend:
    "普通朋友看互帮与边界；聚餐起哄、互损玩笑≠暧昧。",
  advisor:
    "研究生导师·人情社会：尊师重道、论文/组会、节日问候、延迟回复常见；事务关心≠暧昧，严禁浪漫化师生。",
  platonic:
    "纯友谊异性：关心陪伴默认友谊；单独吃饭/开玩笑要结合是否越界，勿默认暧昧。",
};
export const TONES: Record<string, string> = {
  warm: "关心靠近",
  playful: "俏皮试探",
  neutral: "平静交流",
  polite: "礼貌客气",
  upset: "不满委屈",
  closing: "回避收尾",
  unknown: "难以判断",
};
export const STAGES: Record<string, string> = {
  unknown: "信息不足",
  contact: "刚搭上线",
  flow: "聊得起来",
  flirt: "出现暧昧",
  date: "有具体约会安排",
  mutual: "明确互表心意",
};
export const ACTIONS: Record<string, { label: string; detail: string }> = {
  continue: { label: "顺着聊", detail: "接住刚才的话题，别急着切换频道。" },
  ask: {
    label: "轻轻追问",
    detail: "问一个具体、容易回答的小问题，把球轻轻递过去。",
  },
  empathize: {
    label: "先接情绪",
    detail: "先回应对方的感受，再考虑讲道理或给建议。",
  },
  flirt: {
    label: "轻轻调情",
    detail: "顺着已经被接住的玩笑，留一点刚刚好的暧昧。",
  },
  invite: {
    label: "试着约一下",
    detail: "把共同兴趣变成一个具体、没有压力的小邀约。",
  },
  clarify: {
    label: "直接问清",
    detail: "这句话有不止一种理解，温和确认比反复猜更有效。",
  },
  wait: {
    label: "等对方接球",
    detail: "球已经递出去了。先留一点空间，不用急着补发。",
  },
  close: {
    label: "今天先收尾",
    detail: "让聊天停在舒服的位置，下次还有话可说。",
  },
  respect: {
    label: "尊重边界",
    detail: "对方表达了拒绝或需要空间。尊重这个意思，停止推进。",
  },
  insufficient: {
    label: "再多一点上下文",
    detail: "这几句话还看不准，补上前后文再一起看看。",
  },
};
export function grade(n: number | null) {
  return n === null
    ? "看不准"
    : n >= 80
      ? "妙"
      : n >= 60
        ? "稳"
        : n >= 40
          ? "一般"
          : n >= 20
            ? "有点尬"
            : "刹车";
}
export function affinityLabel(n: number | null) {
  return n === null
    ? "信号待观察"
    : n >= 80
      ? "明显加温"
      : n >= 60
        ? "互动偏热"
        : n >= 40
          ? "有来有回"
          : n >= 20
            ? "信号偏克制"
            : "信号偏弱";
}
export function statusLabel(j?: Judgment) {
  return !j || j.status === "insufficient"
    ? "信息不足"
    : j.status === "clear"
      ? "判断较明确"
      : "有歧义";
}
export function meanQuality(
  messages: Message[],
  lines: Record<string, LineResult>,
) {
  const v = messages
    .filter((m) => m.sender === "self")
    .map((m) => lines[m.id]?.score.value)
    .filter((x): x is number => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
export function contextKey(messages: Message[], relation: Relation) {
  return JSON.stringify({
    model: MODEL,
    rubric: RUBRIC,
    relation,
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      timestamp: m.timestamp,
      kind: m.kind,
    })),
  });
}

export function requestContextKey(input: AnalysisRequest) {
  return (
    contextKey(input.messages, input.relation) +
    JSON.stringify(
      (input.memory ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        status: e.status,
        resolvedBy: e.resolvedBy,
      })),
    )
  );
}
