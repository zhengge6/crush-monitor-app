import {
  type Message,
  type Snapshot,
  type Judgment,
  type LineResult,
} from "./types";
export const examples = [
  {
    name: "孙宇晨×景甜",
    tag: "暧昧未明的微信夜聊",
    relation: "crush" as const,
    // self = 孙宇晨, other = 景甜
    speakers: { self: "孙宇晨", other: "景甜" } as const,
    lines: [
      ["self", "在吗？刚才路过三里屯，突然想起你说想喝那家店的柠檬茶"],
      ["other", "哈哈你还记得啊"],
      ["self", "当然。你那天说完我就记备忘录了😂"],
      ["other", "嗯"],
      ["other", "我这周杀青忙疯了，今天才稍微喘口气"],
      ["self", "那更得补一杯。明天晚上有空吗？就当放松"],
      ["other", "明天啊……行程还没定死"],
      ["self", "不定死也行，我跟着你的空档走"],
      ["other", "你最近是不是太闲了"],
      ["self", "不闲。就是想找个不那么吵的人吃饭"],
      ["other", "……油嘴"],
      ["self", "认真的。你要是累，我也可以只送茶到剧组门口，不打扰"],
      ["other", "算了，还是出来吧。周日晚行吗？别太正式"],
      ["self", "周日。你定地方，我开车"],
      ["other", "那就老地方附近随便找家安静的。先这样，我去补个觉😴"],
    ],
  },
  {
    name: "礼貌婉拒",
    tag: "体面收尾，也很妙",
    relation: "crush" as const,
    lines: [
      ["self", "周末要不要出去走走？"],
      ["other", "谢谢你，不过我只想和你做普通朋友。"],
      ["self", "明白，谢谢你直接告诉我。"],
      ["other", "也谢谢你的理解。"],
    ],
  },
  {
    name: "情侣拌嘴",
    tag: "先接情绪，再接话",
    relation: "couple" as const,
    lines: [
      ["other", "你今天都没怎么理我"],
      ["self", "工作有点多，刚刚忙完。"],
      ["other", "我知道你忙，但我也想被惦记一下。"],
      ["self", "是我没顾上，下次忙之前先和你说一声。今天累不累？"],
      ["other", "其实有点。你现在能陪我聊一会吗？"],
    ],
  },
];
/** WeChat QQ-export style transcript for「用示例试试」. */
export function exampleText(index: number) {
  const e = examples[index] as (typeof examples)[number] & {
    speakers?: { self: string; other: string };
  };
  const selfName = e.speakers?.self ?? "我";
  const otherName = e.speakers?.other ?? "Crush";
  // Spread timestamps over one evening so the parser keeps speakers stable.
  const base = [
    "09-20 21:14:08",
    "09-20 21:14:32",
    "09-20 21:15:01",
    "09-20 21:15:18",
    "09-20 21:16:40",
    "09-20 21:17:12",
    "09-20 21:18:05",
    "09-20 21:18:44",
    "09-20 21:19:20",
    "09-20 21:20:03",
    "09-20 21:20:28",
    "09-20 21:21:15",
    "09-20 21:22:50",
    "09-20 21:23:11",
    "09-20 21:24:02",
  ];
  return e.lines
    .map(([s, t], i) => {
      const name = s === "self" ? selfName : otherName;
      const ts = base[i] ?? base[base.length - 1]!;
      return `${name}: ${ts}\n${t}`;
    })
    .join("\n\n");
}
const j = (value: number | null): Judgment => ({
  value,
  confidence: value === null ? 0.2 : 0.82,
  status: value === null ? "insufficient" : "clear",
  probabilities:
    value === null
      ? { "0": 0.2, "1": 0.2, "2": 0.2, "3": 0.2, "4": 0.2 }
      : { "3": 0.2, "4": 0.8 },
});
export function fixtureSnapshot(
  index: number,
  count: number,
  revision: number,
): Snapshot {
  const e = examples[index];
  const messages: Message[] = e.lines
    .slice(0, count)
    .map(([sender, text], i) => ({
      id: `fixture-${index}-${i}`,
      sender: sender as "self" | "other",
      text,
      timestamp: null,
      kind: "text",
    }));
  const lines: Record<string, LineResult> = {};
  const full = count === e.lines.length;
  const values =
    index === 0
      ? [70, 78, 82, 74, 76, 80, 68, 84, 72, 86, 70, 88, 90, 92, 85]
      : index === 1
        ? [68, 12, 91, 38]
        : [42, 55, 54, 88, 73];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    lines[m.id] = {
      id: m.id,
      score: j(values[i]),
      ...(m.sender === "other"
        ? {
            tone:
              index === 0
                ? "warm"
                : index === 1
                  ? "polite"
                  : i === 0 || i === 2
                    ? "upset"
                    : "warm",
            tones: { warm: 0.8, neutral: 0.15, unknown: 0.05 },
            toneConfidence: 0.8,
          }
        : {}),
    };
  }
  return {
    revision,
    messages,
    lines,
    relation: e.relation,
    at: new Date().toISOString(),
    source: "fixture",
    latencyMs: 0,
    comparable: count > 2,
    overview: {
      affinity: j(
        index === 0
          ? full
            ? 86
            : count >= 4
              ? 74
              : null
          : index === 1
            ? 23
            : 64,
      ),
      stage:
        index === 0 && count >= 4 ? "date" : index === 0 ? "flow" : "contact",
      rapport: index === 2 ? j(72) : undefined,
      action:
        index === 1
          ? "respect"
          : index === 2
            ? "empathize"
            : full
              ? "continue"
              : count % 2
                ? "wait"
                : "clarify",
      evidenceId: messages.at(-1)?.id || null,
      actionEvidenceId: messages.at(-1)?.id || null,
    },
  };
}
