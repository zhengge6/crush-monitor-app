export type ShotRow = {
  sender: "self" | "other";
  text: string;
  timestamp?: string | null;
  tag?: string;
};

const WIDTH = 430;
const PAGE = 12000;
const SCALE = 2;

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const ch of Array.from(raw)) {
      const next = line + ch;
      if (ctx.measureText(next).width > max && line) {
        lines.push(line);
        line = ch;
      } else line = next;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Block = { h: number; draw: (ctx: CanvasRenderingContext2D, y: number) => void };

function layout(
  rows: ShotRow[],
  title: string,
  affinity: number | null,
) {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = "16px sans-serif";
  const blocks: Block[] = [];
  blocks.push({
    h: 78,
    draw: (ctx, y) => {
      ctx.fillStyle = "#111";
      ctx.font = "600 18px sans-serif";
      ctx.fillText(title, 20, y + 28);
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "#ff6a3d";
      ctx.fillText(
        affinity == null ? "好感度 —" : `好感度 ${affinity}`,
        20,
        y + 54,
      );
    },
  });
  let lastTime = "";
  for (const row of rows) {
    const time = row.timestamp || "";
    if (time && time !== lastTime) {
      lastTime = time;
      blocks.push({
        h: 28,
        draw: (ctx, y) => {
          ctx.fillStyle = "#8e8e93";
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(time.replace(/^\d{4}年/, ""), WIDTH / 2, y + 18);
          ctx.textAlign = "left";
        },
      });
    }
    measure.font = "16px sans-serif";
    const body = wrap(measure, row.text, 250);
    measure.font = "12px sans-serif";
    const tag = row.tag ? wrap(measure, row.tag, 250) : [];
    const bubbleH = 16 + body.length * 22;
    const tagH = tag.length ? 8 + tag.length * 16 : 0;
    const h = bubbleH + tagH + 12;
    const self = row.sender === "self";
    measure.font = "16px sans-serif";
    const w = Math.min(
      280,
      Math.max(72, ...body.map((line) => measure.measureText(line).width + 28)),
    );
    blocks.push({
      h,
      draw: (ctx, y) => {
        const x = self ? WIDTH - 20 - w : 20;
        ctx.fillStyle = self ? "#1a1a1a" : "#e8e8ea";
        roundRect(ctx, x, y, w, bubbleH, 16);
        ctx.fill();
        ctx.fillStyle = self ? "#fff" : "#111";
        ctx.font = "16px sans-serif";
        body.forEach((line, i) => ctx.fillText(line, x + 14, y + 22 + i * 22));
        if (tag.length) {
          ctx.fillStyle = self ? "#14532d" : "#9a3412";
          ctx.font = "12px sans-serif";
          tag.forEach((line, i) =>
            ctx.fillText(line, self ? WIDTH - 20 - 260 : 20, y + bubbleH + 16 + i * 16),
          );
        }
      },
    });
  }
  return blocks;
}

export async function downloadLongShot(
  filename: string,
  title: string,
  affinity: number | null,
  rows: ShotRow[],
) {
  const blocks = layout(rows, title, affinity);
  const pages: Block[][] = [];
  let page: Block[] = [];
  let used = 0;
  for (const block of blocks) {
    if (page.length && used + block.h > PAGE) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(block);
    used += block.h;
  }
  if (page.length) pages.push(page);
  for (let i = 0; i < pages.length; i++) {
    const height = pages[i].reduce((sum, block) => sum + block.h, 0) + 24;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, WIDTH, height);
    let y = 12;
    for (const block of pages[i]) {
      block.draw(ctx, y);
      y += block.h;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("长截图生成失败");
    const name =
      pages.length === 1
        ? filename
        : filename.replace(/\.png$/i, "") + `-${i + 1}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
