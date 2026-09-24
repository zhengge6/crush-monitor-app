import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChat, toMessages } from "../shared/parser";

test("QQ month-day headers keep names stable across dates and repeated speakers", () => {
  const result = parseChat(
    "小雨: 09-17 19:26:53\n这个剧还可以\n\n小雨: 09-17 19:27:07\n简单，治愈就行\n\nAlex Lee: 09-18 19:27:32\n还是喜欢情节和表演",
  );
  assert.deepEqual(result.messages, [
    { speaker: "小雨", timestamp: "09-17 19:26:53", text: "这个剧还可以" },
    { speaker: "小雨", timestamp: "09-17 19:27:07", text: "简单，治愈就行" },
    {
      speaker: "Alex Lee",
      timestamp: "09-18 19:27:32",
      text: "还是喜欢情节和表演",
    },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("QQ full dates, Chinese colon, multiline bodies and URLs", () => {
  const result = parseChat(
    "甲：2026-09-17 19:26:53\r\n计划：看电影\r\nhttps://example.com\r\n\r\n乙: 2026/09/18 19:27\r\n好",
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, "计划：看电影\nhttps://example.com");
  assert.equal(result.messages[1].speaker, "乙");
});

test("WhatsApp bracket exports handle bidi marks, AM/PM, names with spaces and multiline text", () => {
  const result = parseChat(
    "\uFEFF\u200e[9/17/26, 7:26:53\u202fPM] Alex Lee: Hello 😊\nNote: bring tea\n\nSee you soon\n[9/17/26, 7:27:00 PM] Me: Sure",
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].speaker, "Alex Lee");
  assert.equal(result.messages[0].timestamp, "9/17/26, 7:26:53\u202fPM");
  assert.equal(
    result.messages[0].text,
    "Hello 😊\nNote: bring tea\n\nSee you soon",
  );
  assert.deepEqual(result.warnings, []);
});

test("WhatsApp dash exports preserve ambiguous dates and skip system notifications", () => {
  const result = parseChat(
    "17/09/2026, 19:25 - Messages and calls are end-to-end encrypted.\n17/09/2026, 19:26 - Alex: Hi\n17/09/2026, 19:27 - A contact joined\n09/10/2026, 19:28 - Me: Hello",
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, "Hi");
  assert.equal(result.messages[1].timestamp, "09/10/2026, 19:28");
  assert.equal(result.warnings.length, 1);
});

test("WhatsApp common English attachment placeholders are not analyzed as words", () => {
  const result = parseChat(
    "17.09.26, 19:26 - Alex: <Media omitted>\n17.09.26, 19:27 - Me: Got it",
  );
  assert.equal(toMessages(result.messages, "Me")[0].kind, "unreadable");
});

test("manual transcripts accept English names; unlabelled text never invents senders", () => {
  const result = parseChat(
    "Alex Lee: Dinner tonight?\nMe: Sounds good\nhttps://example.com",
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].speaker, "Alex Lee");
  assert.match(result.messages[1].text, /https:\/\/example.com/);
  assert.equal(
    parseChat("Dinner tonight?\nSounds good").messages[0].speaker,
    "未分配",
  );
});

test("WeChat copies with 下午 or a month-day stamp still resolve to two people", () => {
  const afternoon = parseChat(
    "小明\n2026年9月24日 下午7:26\n今晚吃饭吗\n我\n2026年9月24日 下午7:27\n好",
  );
  assert.deepEqual(
    afternoon.messages.map((m) => m.speaker),
    ["小明", "我"],
  );
  assert.equal(afternoon.messages[0].timestamp, "2026年9月24日 下午7:26");
  const shortDate = parseChat(
    "小明 9/24 19:26\n今晚吃饭吗\n我 9/25 19:27\n好",
  );
  assert.deepEqual(
    shortDate.messages.map((m) => [m.speaker, m.timestamp]),
    [
      ["小明", "9/24 19:26"],
      ["我", "9/25 19:27"],
    ],
  );
  assert.deepEqual(shortDate.warnings, []);
});

test("existing bracket and name-time transcripts preserve colon-bearing bodies", () => {
  const result = parseChat(
    "[2026-09-17 19:26] Alex: Hi\nNote: hello\n[2026-09-17 19:27] Me: Yes",
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, "Hi\nNote: hello");
  assert.equal(
    parseChat("Alex 2026-09-17 19:26\nHello\nMe 2026-09-17 19:27\nHi").messages
      .length,
    2,
  );
});
