import { test } from "node:test";
import assert from "node:assert/strict";
import { findSide, upsertSide, type SavedConversation } from "../src/storage";
import { RUBRIC, type Message } from "../shared/types";

const msg = (id: string, sender: "self" | "other", text: string): Message => ({
  id,
  sender,
  text,
  timestamp: null,
  kind: "text",
});

function saved(messages: Message[], completed = true): SavedConversation {
  return {
    schema: 1,
    rubric: RUBRIC,
    messages,
    self: "我",
    other: "对方",
    relation: "crush",
    lines: {},
    events: {},
    overview: null,
    trend: [],
    analyzedCount: messages.length,
    completed,
  };
}

test("swapping back to a finished identity reuses that snapshot", () => {
  const mine = [msg("1", "self", "在吗"), msg("2", "other", "在")];
  const theirs = [msg("1", "other", "在吗"), msg("2", "self", "在")];
  let sides = upsertSide([], saved(mine));
  sides = upsertSide(sides, saved(theirs));
  assert.equal(findSide(sides, mine, "crush")?.messages[0].sender, "self");
  assert.equal(findSide(sides, theirs, "crush")?.messages[0].sender, "other");
  assert.equal(findSide(sides, mine, "friend"), undefined);
  assert.equal(upsertSide(sides, saved(mine, false)).length, 2);
});
