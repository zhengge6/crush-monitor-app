import { test } from "node:test";
import assert from "node:assert/strict";
import { exportDialogue } from "../shared/export-chat";
import { parseChat } from "../shared/parser";
import { lineCovers } from "../server/replay-analysis";
import type { Message } from "../shared/types";

test("exported dialogue round-trips through the importer", () => {
  const text = exportDialogue(
    [
      { sender: "self", text: "今晚吃饭吗" },
      { sender: "other", text: "好\n晚点说" },
    ],
    "我",
    "景甜",
  );
  const parsed = parseChat(text);
  assert.deepEqual(
    parsed.messages.map((m) => [m.speaker, m.text]),
    [
      ["我", "今晚吃饭吗"],
      ["景甜", "好\n晚点说"],
    ],
  );
});

test("cached other-message tags count as covered", () => {
  const message: Message = {
    id: "1",
    sender: "other",
    text: "在",
    timestamp: null,
    kind: "text",
  };
  assert.equal(lineCovers(message, undefined), false);
  assert.equal(
    lineCovers(message, { id: "1", emotions: { calm: 1 } }),
    true,
  );
  assert.equal(
    lineCovers(
      { ...message, sender: "self" },
      { id: "1", scoreValue: 80 },
    ),
    true,
  );
});
