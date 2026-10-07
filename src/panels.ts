import { randomUUID } from "node:crypto";
import {
  Markdown, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type Component, type MarkdownTheme, type Token, type Tokens, type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { sourceBlocks, type CodeBlock } from "./source.ts";

// These fields are TypeScript-private, not JavaScript #private. Keep this
// unsupported Pi boundary confined to the instance adapter.
interface MarkdownInternals {
  theme: MarkdownTheme;
  renderToken(token: Token, width: number, nextType?: string, style?: unknown): string[];
}

interface Button {
  marker: string;
  start: number;
  end: number;
  block: CodeBlock;
}

export function decorateMarkdown(markdown: Markdown, source: string, copy: (code: string) => void | Promise<void>, requestRender: () => void = () => {}, feedbackMs = 2000): () => void {
  const target = markdown as Markdown & Pick<Component, "handleMouse">;
  const internal = markdown as unknown as MarkdownInternals;
  if (typeof internal.renderToken !== "function" || !internal.theme) {
    throw new Error("Unsupported Pi Markdown renderer");
  }
  const blocks = sourceBlocks(source);
  const markerPrefix = `\x1b_pi-code-blocks;${randomUUID()};`;
  const originalToken = internal.renderToken;
  const originalRender = markdown.render;
  const originalMouse = target.handleMouse;
  let buttons: Button[] = [];
  let collecting: Button[] = [];
  let used = new Set<CodeBlock>();
  let hits: Array<{ row: number; start: number; end: number; block: CodeBlock }> = [];
  const feedback = new Map<CodeBlock, "Copied ✓" | "Failed ✗">();
  const attempts = new Map<CodeBlock, number>();
  const timers = new Map<CodeBlock, ReturnType<typeof setTimeout>>();
  let active = true;

  function showFeedback(block: CodeBlock, label: "Copied ✓" | "Failed ✗", attempt: number): void {
    if (!active || attempts.get(block) !== attempt) return;
    clearTimeout(timers.get(block));
    feedback.set(block, label);
    markdown.invalidate();
    requestRender();
    const timer = setTimeout(() => {
      timers.delete(block);
      feedback.delete(block);
      if (!active) return;
      markdown.invalidate();
      requestRender();
    }, feedbackMs);
    timer.unref();
    timers.set(block, timer);
  }

  internal.renderToken = function (token, width, nextType, style) {
    if (token.type !== "code" || width < 12) return originalToken.call(this, token, width, nextType, style);
    const code = token as Tokens.Code;
    if (!/^ {0,3}(`{3,}|~{3,})/.test(code.raw)) return originalToken.call(this, token, width, nextType, style);
    const matches = blocks.filter((block) => block.language === (code.lang ?? "") && block.code.replaceAll("\t", "   ") === code.text);
    const block = matches.find((block) => !used.has(block));
    // Rendering expands tabs, so different source payloads can look identical.
    if (!block || matches.some((match) => match.code !== block.code)) return originalToken.call(this, token, width, nextType, style);
    used.add(block);
    const gap = width > 12 ? " " : "";
    const buttonWidth = Math.min(10, width - 6 - gap.length);
    const label = stripTerminalSequences(truncateToWidth(stripTerminalSequences(block.language.split(/\s/)[0] || "code"), Math.max(0, width - buttonWidth - 7 - gap.length)));
    const left = `╭─ ${label}${label ? " " : ""}`;
    const button = stripTerminalSequences(truncateToWidth(`[${feedback.get(block) ?? "Copy"}]`, buttonWidth));
    const right = gap + " ".repeat(buttonWidth - visibleWidth(button)) + button + " ─╮";
    const header = left + "─".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right))) + right;
    const start = visibleWidth(header) - 3 - visibleWidth(button);
    // Carry header identity through Pi's wrapping without matching message text.
    const marker = `${markerPrefix}${collecting.length}\x1b\\`;
    collecting.push({ marker, start, end: start + visibleWidth(button), block });
    const theme = this.theme;
    const lines = [marker + theme.codeBlockBorder(header)];
    const highlighted = theme.highlightCode?.(code.text, code.lang) ?? code.text.split("\n").map((line) => theme.codeBlock(line));
    for (const line of highlighted) {
      for (const wrapped of wrapTextWithAnsi(line, width - 4)) {
        lines.push(theme.codeBlockBorder("│ ") + wrapped + " ".repeat(Math.max(0, width - 4 - visibleWidth(wrapped))) + theme.codeBlockBorder(" │"));
      }
    }
    lines.push(theme.codeBlockBorder("╰" + "─".repeat(width - 2) + "╯"));
    if (nextType && nextType !== "space") lines.push("");
    return lines;
  };

  markdown.render = function (width) {
    collecting = [];
    used = new Set();
    const lines = originalRender.call(this, width);
    if (collecting.length) buttons = collecting;
    hits = [];
    const rendered = [...lines];
    let from = 0;
    for (const button of buttons) {
      for (let row = from; row < lines.length; row++) {
        const index = lines[row].indexOf(button.marker);
        if (index < 0) continue;
        const offset = visibleWidth(lines[row].slice(0, index));
        hits.push({ row, start: offset + button.start, end: offset + button.end, block: button.block });
        rendered[row] = rendered[row].replace(button.marker, "");
        from = row + 1;
        break;
      }
    }
    return rendered;
  };

  target.handleMouse = function (event: TuiMouseEvent) {
    const hit = hits.find((hit) => hit.row === event.y && event.x >= hit.start && event.x < hit.end);
    if (!hit || event.button !== "left") return originalMouse?.call(this, event);
    if (event.type === "press") return { handled: true, render: false };
    if (event.type === "click") {
      const attempt = (attempts.get(hit.block) ?? 0) + 1;
      attempts.set(hit.block, attempt);
      try {
        Promise.resolve(copy(hit.block.code)).then(
          () => showFeedback(hit.block, "Copied ✓", attempt),
          () => showFeedback(hit.block, "Failed ✗", attempt),
        );
      } catch {
        showFeedback(hit.block, "Failed ✗", attempt);
      }
      return { handled: true, render: false };
    }
    return undefined;
  };

  return () => {
    if (!active) return;
    active = false;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    feedback.clear();
    internal.renderToken = originalToken;
    markdown.render = originalRender;
    if (originalMouse) target.handleMouse = originalMouse;
    else delete target.handleMouse;
    markdown.invalidate();
  };
}
