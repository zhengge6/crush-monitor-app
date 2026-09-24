import { test } from "node:test";
import assert from "node:assert/strict";
import { withinScope, recentScope } from "../shared/parser";
import { MAX_MESSAGES, MAX_TEXT_CHARS } from "../shared/limits";
import { buildRequest, requestSchema } from "../server/analysis";
import { AFFINITY_DIMENSIONS, composeAffinity } from "../shared/affinity";
import type { Message } from "../shared/types";
const messages = (n: number, text = "普通聊天内容"): Message[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `message-${i}`,
    sender: i % 2 ? "self" : "other",
    text: `${text}`,
    timestamp: null,
    kind: "text",
  }));
test("单次API含双方最多500条，范围裁选函数不丢掉尾部", () => {
  const ms = messages(MAX_MESSAGES + 1);
  assert.equal(withinScope(ms), false);
  assert.equal(recentScope(ms).length, MAX_MESSAGES);
  assert.equal(recentScope(ms)[0].id, "message-1");
  for (const [count, expected] of [
    [500, true],
    [501, false],
  ] as const) {
    const req = {
      messages: ms.slice(0, count),
      relation: "crush",
      revision: 1,
      task: "overview",
      targetIds: [],
    };
    assert.equal(requestSchema.safeParse(req).success, expected);
  }
  assert.equal(withinScope(messages(1, "好".repeat(MAX_TEXT_CHARS))), true);
  assert.equal(
    withinScope(messages(1, "好".repeat(MAX_TEXT_CHARS + 1))),
    false,
  );
});

test("同批我方回复物理隔离未来内容，不把其它问题的上下文放进共享state", () => {
  const ms = messages(6);
  ms.forEach((m, i) => (m.text = `UNIQUE_MESSAGE_${i}`));
  const req = buildRequest({
    messages: ms,
    relation: "crush",
    revision: 1,
    task: "self_message",
    targetIds: [ms[1].id, ms[3].id, ms[5].id],
  });
  for (const i of [1, 3, 5]) {
    const own = JSON.stringify({
      state: req.state,
      question: req.questions[`${ms[i].id}_score`],
    });
    assert.ok(own.includes(`UNIQUE_MESSAGE_${i}`));
    for (let j = i + 1; j < ms.length; j++)
      assert.ok(!own.includes(`UNIQUE_MESSAGE_${j}`));
  }
});

test("六维按固定权重合成，确定度不乘分数，拒绝不能被高分抵消", () => {
  const dims = AFFINITY_DIMENSIONS.map((d, i) => ({
    ...d,
    judgment: {
      value: [80, 60, 70, 50, 40, 30][i],
      confidence: 0.3,
      status: "insufficient" as const,
      probabilities: {},
    },
  }));
  assert.equal(
    dims.reduce((s, d) => s + d.weight, 0),
    100,
  );
  const a = composeAffinity(dims, 0.1);
  assert.equal(a.affinity.value, 58);
  assert.equal(a.affinity.status, "insufficient");
  const b = composeAffinity(dims, 0.8);
  assert.equal(b.rawValue, 58);
  assert.equal(b.affinity.value, 25);
  assert.equal(b.boundaryApplied, true);
});
test("总览使用独立维度且引用候选不突破Jev 255项限制", () => {
  const req = buildRequest({
    messages: messages(500),
    relation: "crush",
    revision: 1,
    task: "overview",
    targetIds: [],
  });
  assert.equal(req.questions.affinity, undefined);
  for (const d of AFFINITY_DIMENSIONS)
    assert.equal(req.questions[`affinity_${d.key}`].type, "score");
  const evidence = req.questions.evidence as {
    criteria: Record<string, unknown>;
  };
  assert.equal(Object.keys(evidence.criteria).length, 201);
  assert.equal(req.state.messages[0].id, "0");
});
