import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, visibleWidth, type Component, type MarkdownTheme, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { sourceBlocks } from "../src/source.ts";
import { decorateMarkdown } from "../src/panels.ts";
import { installPanels } from "../src/patch.ts";

initTheme("dark", false);
const plain = (text: string) => text;
const theme: MarkdownTheme = {
  heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain,
  codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain,
  listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain,
};
function click(component: Component, width = 50, buttonIndex = 0): void {
  const lines = component.render(width).map(stripTerminalSequences);
  const rows = lines.flatMap((line, row) => line.includes("[Copy]") ? [row] : []);
  const row = rows[buttonIndex];
  assert.notEqual(row, undefined, lines.join("\n"));
  const x = visibleWidth(lines[row].slice(0, lines[row].indexOf("[Copy]"))) + 1;
  const event: TuiMouseEvent = { type: "press", button: "left", x, y: row, screenX: x, screenY: row, width, height: lines.length, shift: false, alt: false, ctrl: false };
  assert.equal(component.handleMouse?.(event)?.handled, true);
  component.handleMouse?.({ ...event, type: "release" });
  assert.equal(component.handleMouse?.({ ...event, type: "click" })?.handled, true);
}

test("extracts fenced source including tabs, whitespace, Unicode, and embedded fences", () => {
  assert.deepEqual(sourceBlocks("Before\n\n````sh\n\tprintf '你好'  \n```\n\n````\n\n~~~ts\nconst x = 1;\n~~~"), [
    { language: "sh", code: "\tprintf '你好'  \n```\n" },
    { language: "ts", code: "const x = 1;" },
  ]);
});

test("preserves code-body tabs inside blockquotes and list items", () => {
  assert.deepEqual(sourceBlocks("> ```sh\n> \tprintf x\n> ```\n\n- example\n\n  ```sh\n  \tprintf y\n  ```"), [
    { language: "sh", code: "\tprintf x" }, { language: "sh", code: "\tprintf y" },
  ]);
});

test("handles partial closing fences during streaming", () => {
  for (const ending of ["", "`", "``"]) {
    assert.deepEqual(sourceBlocks("```sh\necho hi\n" + ending), [{ language: "sh", code: "echo hi" }]);
  }
});

test("renders and copies distinct code blocks without changing Markdown text", () => {
  const source = "Before\n\n```sh\n\tprintf 'hello'  \n```\n\nBetween\n\n```ts\nconst value = 2;\n```\n\nAfter";
  const markdown = new Markdown(source, 1, 0, theme);
  const copied: string[] = [];
  const restore = decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  const lines = markdown.render(50).map(stripTerminalSequences);
  assert(lines.some((line) => line.trim() === "Before"));
  assert(lines.some((line) => line.trim() === "Between"));
  assert(lines.some((line) => line.trim() === "After"));
  assert(lines.some((line) => line.includes("╭─ sh")));
  click(markdown, 50, 0);
  click(markdown, 50, 1);
  assert.deepEqual(copied, ["\tprintf 'hello'  ", "const value = 2;"]);
  restore();
  assert.deepEqual(markdown.render(50), new Markdown(source, 1, 0, theme).render(50));
});

test("buttons remain aligned after resize, wrapping, cached renders, and invalidation", () => {
  const source = "```sh\necho '你好 🐱 abcdefghijklmnopqrstuvwxyz'\n```";
  const markdown = new Markdown(source, 1, 0, theme);
  const copied: string[] = [];
  decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  for (const width of [50, 20, 20, 80, 14]) {
    assert(markdown.render(width).every((line) => visibleWidth(line) <= width));
    click(markdown, width);
  }
  markdown.invalidate();
  click(markdown, 30);
  assert.equal(copied.length, 6);
  assert(copied.every((code) => code === "echo '你好 🐱 abcdefghijklmnopqrstuvwxyz'"));
});

test("nested panels copy the original payload", () => {
  const source = "> ```sh\n> \tprintf x\n> ```\n\n- example\n\n  ```sh\n  \tprintf y\n  ```";
  const markdown = new Markdown(source, 1, 0, theme);
  const copied: string[] = [];
  decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  click(markdown, 50, 0);
  click(markdown, 50, 1);
  assert.deepEqual(copied, ["\tprintf x", "\tprintf y"]);
});

test("only the copy button handles mouse presses and clicks", () => {
  const source = "```sh\necho hi\n```";
  const markdown = new Markdown(source, 1, 0, theme);
  const copied: string[] = [];
  decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  const lines = markdown.render(50).map(stripTerminalSequences);
  const row = lines.findIndex((line) => line.includes("[Copy]"));
  const x = lines[row].indexOf("[Copy]") + 1;
  const event: TuiMouseEvent = { type: "press", button: "left", x, y: row, screenX: x, screenY: row, width: 50, height: lines.length, shift: false, alt: false, ctrl: false };
  const target = markdown as Markdown & Pick<Component, "handleMouse">;
  assert.equal(target.handleMouse?.(event)?.handled, true);
  assert.deepEqual(copied, []);
  assert.equal(target.handleMouse?.({ ...event, x: 1 }), undefined);
  assert.equal(target.handleMouse?.({ ...event, button: "right" }), undefined);
  assert.equal(target.handleMouse?.({ ...event, type: "drag" }), undefined);
  assert.equal(target.handleMouse?.({ ...event, type: "click" })?.handled, true);
  assert.deepEqual(copied, ["echo hi"]);
});

test("retains plain rendering when source and transformed code do not match", () => {
  const markdown = new Markdown("```sh\necho changed\n```", 1, 0, theme);
  const original = markdown.render(50);
  markdown.invalidate();
  decorateMarkdown(markdown, "```sh\necho original\n```", () => assert.fail("incorrect copy"));
  assert.deepEqual(markdown.render(50), original);
});

test("assistant patch handles history, streaming, thinking, cleanup, and reinstallation", () => {
  const original = AssistantMessageComponent.prototype.updateContent;
  const copied: string[] = [];
  const dispose = installPanels((code) => { copied.push(code); }, (error) => { throw error; });
  const source = "```sh\necho hi\n```";
  const message = { role: "assistant" as const, content: [{ type: "thinking" as const, thinking: "Reasoning" }, { type: "text" as const, text: source }], stopReason: "stop" as const };
  const before = JSON.stringify(message);
  try {
    const history = new AssistantMessageComponent(message as never, false, theme);
    assert(history.render(50).map(stripTerminalSequences).some((line) => line.includes("Reasoning")));
    click(history);
    const live = new AssistantMessageComponent(undefined, false, theme);
    for (const ending of ["", "`", "``", "```"]) {
      live.updateContent({ ...message, content: [{ type: "text", text: "```sh\necho hi\n" + ending }] } as never, true);
      click(live);
    }
    live.updateContent(message as never, false);
    live.invalidate();
    click(live);
    assert.equal(JSON.stringify(message), before);
    assert.deepEqual(copied, Array(6).fill("echo hi"));
    dispose();
    assert.equal(AssistantMessageComponent.prototype.updateContent, original);
    assert(history.render(50).some((line) => stripTerminalSequences(line).trim() === "```sh"));
    const second = installPanels(() => {}, (error) => { throw error; });
    second();
    dispose();
    assert.equal(AssistantMessageComponent.prototype.updateContent, original);
  } finally { dispose(); }
});
