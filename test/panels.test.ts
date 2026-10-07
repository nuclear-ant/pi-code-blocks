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

test("literal panel headers cannot steal another panel's copy target", () => {
  const block = "```sh\necho first\n```";
  const seed = new Markdown(block, 0, 0, theme);
  const restoreSeed = decorateMarkdown(seed, block, () => {});
  const header = stripTerminalSequences(seed.render(50)[0]);
  restoreSeed();
  const source = `${header}\n\n${block}\n\n\`\`\`sh\necho second\n\`\`\``;
  const markdown = new Markdown(source, 0, 0, theme) as Markdown & Pick<Component, "handleMouse">;
  const copied: string[] = [];
  const restore = decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  try {
    for (const width of [50, 50, 60, 50]) {
      const rendered = markdown.render(width);
      assert(rendered.every((line) => !line.includes("pi-code-blocks;")));
      const lines = rendered.map(stripTerminalSequences);
      const rows = lines.flatMap((line, row) => line.includes("[Copy]") ? [row] : []);
      const event = (row: number): TuiMouseEvent => {
        const x = lines[row].indexOf("[Copy]") + 1;
        return { type: "click", button: "left", x, y: row, screenX: x, screenY: row, width, height: lines.length, shift: false, alt: false, ctrl: false };
      };
      assert.equal(markdown.handleMouse?.(event(rows[0])), undefined);
      for (const row of rows.slice(1)) assert.equal(markdown.handleMouse?.(event(row))?.handled, true);
    }
    assert.deepEqual(copied, Array(4).fill(["echo first", "echo second"]).flat());
  } finally { restore(); }
});

test("indented code cannot consume a fenced block's source payload", () => {
  const source = "    echo   hi\n\n```\necho\thi\n```";
  const markdown = new Markdown(source, 1, 0, theme);
  const copied: string[] = [];
  const restore = decorateMarkdown(markdown, source, (code) => { copied.push(code); });
  try {
    const lines = markdown.render(50).map(stripTerminalSequences);
    assert(lines.findIndex((line) => line.includes("[Copy]")) > lines.findIndex((line) => line.includes("echo   hi")));
    click(markdown);
    assert.deepEqual(copied, ["echo\thi"]);
  } finally { restore(); }
});

test("ambiguous normalized source blocks retain plain rendering, including after transforms", () => {
  const source = "```\necho\thi\n```\n\n```\necho   hi\n```";
  for (const options of [undefined, { transform: () => "```\necho   hi\n```" }]) {
    const markdown = new Markdown(source, 1, 0, theme, undefined, options);
    const expected = new Markdown(source, 1, 0, theme, undefined, options).render(50);
    const restore = decorateMarkdown(markdown, source, () => assert.fail("ambiguous copy"));
    try { assert.deepEqual(markdown.render(50), expected); }
    finally { restore(); }
  }
  const identical = "```\necho\thi\n```\n\n```\necho\thi\n```";
  const markdown = new Markdown(identical, 1, 0, theme);
  const copied: string[] = [];
  const restore = decorateMarkdown(markdown, identical, (code) => { copied.push(code); });
  try {
    click(markdown, 50, 0);
    click(markdown, 50, 1);
    assert.deepEqual(copied, ["echo\thi", "echo\thi"]);
  } finally { restore(); }
});

test("narrow headers and feedback stay on one line with usable copy targets", async () => {
  for (const nested of [false, true]) {
    const source = nested ? "> ```sh\n> echo hi\n> ```" : "```sh\necho hi\n```";
    for (let innerWidth = 12; innerWidth <= 18; innerWidth++) {
      const width = innerWidth + 2 + (nested ? 2 : 0);
      const markdown = new Markdown(source, 1, 0, theme) as Markdown & Pick<Component, "handleMouse">;
      const copied: string[] = [];
      const restore = decorateMarkdown(markdown, source, (code) => { copied.push(code); });
      try {
        click(markdown, width);
        await Promise.resolve();
        for (let render = 0; render < 2; render++) {
          const lines = markdown.render(width).map(stripTerminalSequences);
          assert.equal(lines.length, 3, lines.join("\n"));
          assert(lines.every((line) => visibleWidth(line) <= width));
          assert(lines[0].includes("─╮"));
          const x = visibleWidth(lines[0].slice(0, lines[0].indexOf("["))) + 1;
          assert.equal(markdown.handleMouse?.({ type: "press", button: "left", x, y: 0, screenX: x, screenY: 0, width, height: lines.length, shift: false, alt: false, ctrl: false })?.handled, true);
        }
        assert.deepEqual(copied, ["echo hi"]);
      } finally { restore(); }
    }
  }
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
