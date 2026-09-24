export function exportDialogue(
  messages: Array<{ sender: "self" | "other"; text: string }>,
  selfName: string,
  otherName: string,
) {
  const self = selfName.trim() || "我";
  const other = otherName.trim() || "对方";
  return messages
    .map((message) => {
      const name = message.sender === "self" ? self : other;
      const text = message.text.replace(/\r\n?/g, "\n");
      const [first, ...rest] = text.split("\n");
      return [`${name}：${first ?? ""}`, ...rest].join("\n");
    })
    .join("\n");
}
