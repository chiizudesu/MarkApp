import { PDFDocument, PageSizes, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { PdfHeadingStyle, PdfLayoutSpec, PdfListStyle } from "@/types/pdfLayoutSpec";

/** pdf-lib rejects RGB components outside [0, 1]; blends like `accent * 0.4 + 0.75` can exceed 1. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rgb01(r: number, g: number, b: number) {
  return rgb(clamp01(r), clamp01(g), clamp01(b));
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, "");
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const out: string[] = [];
  for (const para of normalized.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        line = trial;
      } else {
        if (line) out.push(line);
        if (font.widthOfTextAtSize(w, size) <= maxWidth) {
          line = w;
        } else {
          let chunk = "";
          for (const ch of w) {
            const t2 = chunk + ch;
            if (font.widthOfTextAtSize(t2, size) <= maxWidth) chunk = t2;
            else {
              if (chunk) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

type LayoutCtx = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  width: number;
  height: number;
  margin: number;
  contentLeft: number;
  contentWidth: number;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
  accent: { r: number; g: number; b: number };
};

function newPage(ctx: LayoutCtx): void {
  ctx.page = ctx.pdfDoc.addPage(PageSizes.A4);
  const { width, height } = ctx.page.getSize();
  ctx.width = width;
  ctx.height = height;
  ctx.y = height - ctx.margin;
}

function ensureSpace(ctx: LayoutCtx, need: number): void {
  if (ctx.y - need < ctx.margin) {
    newPage(ctx);
  }
}

function drawLines(
  ctx: LayoutCtx,
  lines: string[],
  size: number,
  lineGap: number,
  color: { r: number; g: number; b: number },
  bold = false,
): number {
  const font = bold ? ctx.fontBold : ctx.font;
  const lineH = size * lineGap;
  let used = 0;
  for (const ln of lines) {
    ensureSpace(ctx, lineH);
    ctx.page.drawText(ln, {
      x: ctx.contentLeft,
      y: ctx.y - size,
      size,
      font,
      color: rgb01(color.r, color.g, color.b),
    });
    ctx.y -= lineH;
    used += lineH;
  }
  return used;
}

function blockSpacing(afterBlock: boolean): number {
  return afterBlock ? 10 : 0;
}

function effectiveHeadingStyle(level: 1 | 2 | 3, explicit?: PdfHeadingStyle): PdfHeadingStyle {
  if (explicit === "plain" || explicit === "pill" || explicit === "accent_bar") return explicit;
  return level === 1 ? "accent_bar" : "pill";
}

function effectiveListStyle(explicit?: PdfListStyle): PdfListStyle {
  if (explicit === "plain" || explicit === "pills" || explicit === "cards") return explicit;
  return "cards";
}

/** Verbatim "Label – detail" / "Label - detail" / "Label: detail" for pill+body layout (no wording change). */
function splitListItemPhrases(item: string): { head: string; tail: string } | null {
  const s = item.trim();
  const a = s.match(/^(.+?)\s+–\s+(.+)$/);
  if (a) return { head: a[1]!.trim(), tail: a[2]!.trim() };
  const b = s.match(/^(.+?)\s+—\s+(.+)$/);
  if (b) return { head: b[1]!.trim(), tail: b[2]!.trim() };
  const c = s.match(/^(.+?)\s+-\s+(.+)$/);
  if (c) return { head: c[1]!.trim(), tail: c[2]!.trim() };
  const d = s.match(/^([^:]+):\s+(.+)$/);
  if (d && d[1]!.trim().length <= 100) return { head: d[1]!.trim(), tail: d[2]!.trim() };
  return null;
}

function drawHeadingRich(
  ctx: LayoutCtx,
  level: 1 | 2 | 3,
  text: string,
  styleIn: PdfHeadingStyle | undefined,
  accent: { r: number; g: number; b: number },
) {
  const style = effectiveHeadingStyle(level, styleIn);
  const sizes = { 1: 17, 2: 14.5, 3: 12.5 } as const;
  const size = sizes[level];
  const lineH = size * 1.38;

  if (style === "plain") {
    const lines = wrapToWidth(text, ctx.fontBold, size, ctx.contentWidth);
    const totalH = lines.length * lineH + 6;
    ensureSpace(ctx, totalH);
    for (const ln of lines) {
      ensureSpace(ctx, lineH);
      ctx.page.drawText(ln, {
        x: ctx.contentLeft,
        y: ctx.y - size,
        size,
        font: ctx.fontBold,
        color: rgb01(accent.r * 0.4 + 0.08, accent.g * 0.4 + 0.08, accent.b * 0.4 + 0.08),
      });
      ctx.y -= lineH;
    }
    ctx.y -= 4;
    return;
  }

  const barW = 5;
  const innerPadX = style === "accent_bar" ? barW + 12 : 10;
  const textMaxW = ctx.contentWidth - innerPadX - (style === "pill" ? 10 : 4);
  const lines = wrapToWidth(text, ctx.fontBold, size, textMaxW);
  const blockPad = style === "pill" ? 14 : 10;
  const totalH = lines.length * lineH + blockPad;
  ensureSpace(ctx, totalH + 8);

  const top = ctx.y;
  const bottom = top - totalH;

  if (style === "pill") {
    ctx.page.drawRectangle({
      x: ctx.contentLeft,
      y: bottom,
      width: ctx.contentWidth,
      height: totalH,
      color: rgb01(accent.r, accent.g, accent.b),
      opacity: 0.12,
      borderColor: rgb01(accent.r * 0.3 + 0.52, accent.g * 0.3 + 0.52, accent.b * 0.3 + 0.52),
      borderWidth: 0.75,
    });
  } else {
    ctx.page.drawRectangle({
      x: ctx.contentLeft,
      y: bottom,
      width: barW,
      height: totalH,
      color: rgb01(accent.r, accent.g, accent.b),
    });
  }

  const textX = ctx.contentLeft + innerPadX;
  let ty = top - (style === "pill" ? 8 : 6) - size;
  const textColor = rgb01(accent.r * 0.32 + 0.08, accent.g * 0.32 + 0.08, accent.b * 0.32 + 0.08);
  for (const ln of lines) {
    ctx.page.drawText(ln, {
      x: textX,
      y: ty,
      size,
      font: ctx.fontBold,
      color: textColor,
    });
    ty -= lineH;
  }
  ctx.y = bottom - 10;
}

function drawBulletsRich(
  ctx: LayoutCtx,
  items: string[],
  styleIn: PdfListStyle | undefined,
  bodyColor: { r: number; g: number; b: number },
  accent: { r: number; g: number; b: number },
) {
  const style = effectiveListStyle(styleIn);
  const size = 10.5;
  const lh = size * 1.42;

  if (style === "plain") {
    const bulletIndent = 14;
    for (const item of items) {
      const lines = wrapToWidth(item, ctx.font, size, ctx.contentWidth - bulletIndent);
      let i = 0;
      for (const ln of lines) {
        ensureSpace(ctx, lh);
        if (i === 0) {
          ctx.page.drawText("•", {
            x: ctx.contentLeft,
            y: ctx.y - size,
            size,
            font: ctx.font,
            color: rgb01(accent.r, accent.g, accent.b),
          });
        }
        ctx.page.drawText(ln, {
          x: ctx.contentLeft + bulletIndent,
          y: ctx.y - size,
          size,
          font: ctx.font,
          color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
        });
        ctx.y -= lh;
        i++;
      }
    }
    return;
  }

  if (style === "pills") {
    for (const item of items) {
      const split = splitListItemPhrases(item);
      if (split) {
        const labelW = ctx.fontBold.widthOfTextAtSize(split.head, size);
        const pillPadX = 9;
        const pillH = size + 12;
        const pillW = Math.min(labelW + pillPadX * 2, ctx.contentWidth * 0.44);
        const gap = 10;
        const detailW = Math.max(80, ctx.contentWidth - pillW - gap);
        const detailLines = wrapToWidth(split.tail, ctx.font, size, detailW);
        const rowH = Math.max(pillH + 10, detailLines.length * lh + 10) + 4;
        ensureSpace(ctx, rowH + 4);

        const rowTop = ctx.y;
        const rowBottom = rowTop - rowH;
        const pillBottom = rowBottom + (rowH - pillH) / 2;

        ctx.page.drawRectangle({
          x: ctx.contentLeft,
          y: pillBottom,
          width: pillW,
          height: pillH,
          color: rgb01(accent.r, accent.g, accent.b),
          opacity: 0.2,
          borderColor: rgb01(accent.r * 0.45 + 0.4, accent.g * 0.45 + 0.4, accent.b * 0.45 + 0.4),
          borderWidth: 0.55,
        });
        const labelBaseline = pillBottom + pillH * 0.38;
        ctx.page.drawText(split.head, {
          x: ctx.contentLeft + pillPadX,
          y: labelBaseline,
          size,
          font: ctx.fontBold,
          color: rgb01(accent.r * 0.45 + 0.12, accent.g * 0.45 + 0.12, accent.b * 0.45 + 0.12),
        });

        let dy = rowTop - 8 - size;
        const dx = ctx.contentLeft + pillW + gap;
        for (const ln of detailLines) {
          ctx.page.drawText(ln, {
            x: dx,
            y: dy,
            size,
            font: ctx.font,
            color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
          });
          dy -= lh;
        }
        ctx.y = rowBottom - 4;
      } else {
        const pillPadX = 10;
        const lines = wrapToWidth(item, ctx.fontBold, size, ctx.contentWidth - pillPadX * 2 - 8);
        const lineH2 = size * 1.35;
        const chipH = Math.max(lines.length * lineH2 + 12, size + 16);
        ensureSpace(ctx, chipH + 6);
        const top = ctx.y;
        const bottom = top - chipH;
        ctx.page.drawRectangle({
          x: ctx.contentLeft,
          y: bottom,
          width: ctx.contentWidth,
          height: chipH,
          color: rgb01(accent.r, accent.g, accent.b),
          opacity: 0.1,
          borderColor: rgb01(accent.r * 0.35 + 0.55, accent.g * 0.35 + 0.55, accent.b * 0.35 + 0.55),
          borderWidth: 0.5,
        });
        let ty = top - 7 - size;
        for (const ln of lines) {
          ctx.page.drawText(ln, {
            x: ctx.contentLeft + pillPadX,
            y: ty,
            size,
            font: ctx.fontBold,
            color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
          });
          ty -= lineH2;
        }
        ctx.y = bottom - 6;
      }
    }
    return;
  }

  // cards (default rich)
  const inner = 12;
  const bar = 4;
  for (const item of items) {
    const lines = wrapToWidth(item, ctx.font, size, ctx.contentWidth - inner * 2 - bar - 4);
    const h = Math.max(lines.length * lh + inner * 2, 40);
    ensureSpace(ctx, h + 10);
    const top = ctx.y;
    const bottom = top - h;

    ctx.page.drawRectangle({
      x: ctx.contentLeft,
      y: bottom,
      width: ctx.contentWidth,
      height: h,
      color: rgb01(0.97, 0.97, 0.98),
      borderColor: rgb01(accent.r * 0.2 + 0.78, accent.g * 0.2 + 0.78, accent.b * 0.2 + 0.78),
      borderWidth: 0.6,
    });
    ctx.page.drawRectangle({
      x: ctx.contentLeft,
      y: bottom,
      width: bar,
      height: h,
      color: rgb01(accent.r, accent.g, accent.b),
    });

    let ty = top - inner - size;
    const tx = ctx.contentLeft + bar + inner;
    for (const ln of lines) {
      ctx.page.drawText(ln, {
        x: tx,
        y: ty,
        size,
        font: ctx.font,
        color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
      });
      ty -= lh;
    }
    ctx.y = bottom - 8;
  }
}

export async function renderPdfLayoutToBytes(spec: PdfLayoutSpec): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb01(spec.meta.accentColor);
  const margin = 50;
  const contentLeft = margin;
  const page0 = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page0.getSize();
  const contentWidth = width - 2 * margin;

  const ctx: LayoutCtx = {
    pdfDoc,
    page: page0,
    width,
    height,
    margin,
    contentLeft,
    contentWidth,
    y: height - margin,
    font,
    fontBold,
    accent,
  };

  const bodyColor = { r: 0.12, g: 0.12, b: 0.14 };

  let first = true;
  for (const block of spec.blocks) {
    if (!first) ctx.y -= blockSpacing(true);
    first = false;

    switch (block.type) {
      case "title": {
        const titleSize = 22;
        const lines = wrapToWidth(block.text, ctx.fontBold, titleSize, ctx.contentWidth);
        const lineH = titleSize * 1.25;
        const padY = 14;
        const bandH = lines.length * lineH + padY * 2;
        ensureSpace(ctx, bandH + 8);
        const bandTop = ctx.y;
        ctx.page.drawRectangle({
          x: ctx.contentLeft - 8,
          y: ctx.y - bandH,
          width: ctx.contentWidth + 16,
          height: bandH,
          color: rgb01(accent.r, accent.g, accent.b),
          opacity: 0.12,
        });
        ctx.y = bandTop - padY;
        for (const ln of lines) {
          ensureSpace(ctx, lineH);
          ctx.page.drawText(ln, {
            x: ctx.contentLeft,
            y: ctx.y - titleSize,
            size: titleSize,
            font: ctx.fontBold,
            color: rgb01(accent.r * 0.5 + 0.2, accent.g * 0.5 + 0.2, accent.b * 0.5 + 0.22),
          });
          ctx.y -= lineH;
        }
        ctx.y -= 6;
        ctx.page.drawLine({
          start: { x: ctx.contentLeft, y: ctx.y },
          end: { x: ctx.contentLeft + ctx.contentWidth, y: ctx.y },
          thickness: 2.5,
          color: rgb01(accent.r, accent.g, accent.b),
          opacity: 0.55,
        });
        ctx.y -= 10;
        break;
      }
      case "heading": {
        drawHeadingRich(ctx, block.level, block.text, block.style, accent);
        break;
      }
      case "paragraph": {
        const isLead = block.variant === "lead";
        const size = isLead ? 12 : 11;
        const color = isLead
          ? { r: bodyColor.r * 0.85 + 0.05, g: bodyColor.g * 0.85 + 0.05, b: bodyColor.b * 0.85 + 0.05 }
          : bodyColor;
        const lines = wrapToWidth(block.text, ctx.font, size, ctx.contentWidth);
        drawLines(ctx, lines, size, isLead ? 1.5 : 1.45, color, false);
        break;
      }
      case "bullets": {
        drawBulletsRich(ctx, block.items, block.style, bodyColor, accent);
        break;
      }
      case "table": {
        const n = block.headers.length;
        if (n < 1 || block.rows.some((r) => r.length !== n)) break;
        const colW = ctx.contentWidth / n;
        const pad = 5;
        const fs = 9;
        const lh = fs * 1.35;
        const innerW = Math.max(10, colW - 2 * pad);
        const lineGray = rgb01(0.55, 0.55, 0.58);

        const rowData = [
          { bold: true as const, cells: block.headers },
          ...block.rows.map((cells) => ({ bold: false as const, cells })),
        ];

        const layouts = rowData.map((row) => {
          const f = row.bold ? ctx.fontBold : ctx.font;
          const lineArrays = row.cells.map((cell) => {
            const t = (cell ?? "").trim();
            return wrapToWidth(t.length > 0 ? t : " ", f, fs, innerW);
          });
          const maxLines = Math.max(1, ...lineArrays.map((a) => a.length));
          return { lineArrays, height: maxLines * lh + pad * 2, bold: row.bold };
        });

        const totalH = layouts.reduce((s, l) => s + l.height, 0);
        ensureSpace(ctx, totalH + 12);

        let rowTop = ctx.y;
        for (let ri = 0; ri < layouts.length; ri++) {
          const lay = layouts[ri]!;
          const rowH = lay.height;
          const rowBottom = rowTop - rowH;

          ctx.page.drawLine({
            start: { x: ctx.contentLeft, y: rowTop },
            end: { x: ctx.contentLeft + ctx.contentWidth, y: rowTop },
            thickness: 0.5,
            color: lineGray,
          });
          for (let ci = 0; ci <= n; ci++) {
            const x = ctx.contentLeft + ci * colW;
            ctx.page.drawLine({
              start: { x, y: rowTop },
              end: { x, y: rowBottom },
              thickness: 0.5,
              color: lineGray,
            });
          }

          let cx = ctx.contentLeft;
          const f = lay.bold ? ctx.fontBold : ctx.font;
          for (let ci = 0; ci < n; ci++) {
            const lines = lay.lineArrays[ci] ?? [];
            let ty = rowTop - pad - fs;
            for (const ln of lines) {
              ctx.page.drawText(ln, {
                x: cx + pad,
                y: ty,
                size: fs,
                font: f,
                color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
              });
              ty -= lh;
            }
            cx += colW;
          }
          rowTop = rowBottom;
        }
        ctx.page.drawLine({
          start: { x: ctx.contentLeft, y: rowTop },
          end: { x: ctx.contentLeft + ctx.contentWidth, y: rowTop },
          thickness: 0.5,
          color: lineGray,
        });
        ctx.y = rowTop - 10;
        break;
      }
      case "callout": {
        const size = 10.5;
        const pad = 10;
        const barW = 4;
        const titleLines = block.title ? wrapToWidth(block.title, ctx.fontBold, size + 1, ctx.contentWidth - pad * 2 - barW) : [];
        const bodyLines = wrapToWidth(block.body, ctx.font, size, ctx.contentWidth - pad * 2 - barW);
        const lineTitle = (size + 1) * 1.35;
        const lineBody = size * 1.4;
        const innerH =
          titleLines.length * lineTitle +
          bodyLines.length * lineBody +
          pad * 2 +
          (titleLines.length && bodyLines.length ? 6 : 0);
        ensureSpace(ctx, innerH + 12);

        const boxTop = ctx.y;
        const boxBottom = ctx.y - innerH;
        ctx.page.drawRectangle({
          x: ctx.contentLeft,
          y: boxBottom,
          width: ctx.contentWidth,
          height: innerH,
          color: rgb01(0.96, 0.96, 0.97),
          borderColor: rgb01(accent.r * 0.4 + 0.75, accent.g * 0.4 + 0.75, accent.b * 0.4 + 0.76),
          borderWidth: 0.5,
        });
        ctx.page.drawRectangle({
          x: ctx.contentLeft,
          y: boxBottom,
          width: barW,
          height: innerH,
          color: rgb01(accent.r, accent.g, accent.b),
        });

        let cy = boxTop - pad;
        for (const ln of titleLines) {
          ctx.page.drawText(ln, {
            x: ctx.contentLeft + pad + barW,
            y: cy - (size + 1),
            size: size + 1,
            font: ctx.fontBold,
            color: rgb01(accent.r * 0.35 + 0.15, accent.g * 0.35 + 0.15, accent.b * 0.35 + 0.15),
          });
          cy -= lineTitle;
        }
        if (titleLines.length && bodyLines.length) cy -= 6;
        for (const ln of bodyLines) {
          ctx.page.drawText(ln, {
            x: ctx.contentLeft + pad + barW,
            y: cy - size,
            size,
            font: ctx.font,
            color: rgb01(bodyColor.r, bodyColor.g, bodyColor.b),
          });
          cy -= lineBody;
        }
        ctx.y = boxBottom - 8;
        break;
      }
      case "divider": {
        ensureSpace(ctx, 16);
        ctx.page.drawLine({
          start: { x: ctx.contentLeft, y: ctx.y - 6 },
          end: { x: ctx.contentLeft + ctx.contentWidth, y: ctx.y - 6 },
          thickness: 0.75,
          color: rgb01(accent.r * 0.5 + 0.5, accent.g * 0.5 + 0.5, accent.b * 0.5 + 0.5),
        });
        ctx.y -= 16;
        break;
      }
      default:
        break;
    }
  }

  const bytes = await pdfDoc.save();
  return bytes;
}
