import { test } from "node:test";
import assert from "node:assert/strict";
import { compactLine } from "../shared/sync-snapshot";
import { syncBodySchema } from "../server/conversations";
import type { LineResult } from "../shared/types";

test("compact line keeps the three labels the chat UI shows", () => {
  const line: LineResult = {
    id: "m1",
    score: { value: 82, confidence: 0.8, status: "clear", probabilities: {} },
    emotions: { happy: 0.7, calm: 0.2, angry: 0.1, sad: 0 },
    intents: { flirt: 0.6, ask: 0.3, unknown: 0.1, share: 0 },
  };
  const stored = compactLine(line);
  assert.equal(stored.scoreValue, 82);
  assert.deepEqual(Object.keys(stored.emotions || {}), ["happy", "calm", "angry"]);
  assert.equal(Object.keys(stored.intents || {}).length, 3);
  const parsed = syncBodySchema.parse({
    relation: "crush",
    messages: [{ id: "m1", sender: "other", text: "在吗" }],
    lines: [stored],
  });
  assert.equal(parsed.lines?.[0]?.emotions?.happy, 0.7);
});
