import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { AssistantMessageComponent, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, TuiAltScreen, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import extension from "../src/extension.ts";
import { decorateMarkdown } from "../src/panels.ts";
import { installPanels } from "../src/patch.ts";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";

initTheme("dark", false);

function buttonLines(component: Component): string[] {
  return component.render(50).map(stripTerminalSequences).filter((line) => /\[(Copy|Copied ✓|Failed ✗)\]/.test(line));
}
async function click(component: Component, index = 0): Promise<void> {
  const lines = component.render(50).map(stripTerminalSequences);
  const rows = lines.flatMap((line, row) => /\[(Copy|Copied ✓|Failed ✗)\]/.test(line) ? [row] : []);
  const row = rows[index];
  assert.notEqual(row, undefined);
  const x = visibleWidth(lines[row].slice(0, lines[row].indexOf("["))) + 1;
  const event: TuiMouseEvent = { type: "click", button: "left", x, y: row, screenX: x, screenY: row, width: 50, height: lines.length, shift: false, alt: false, ctrl: false };
  assert.equal(component.handleMouse?.(event)?.handled, true);
  await setImmediate();
}

test("copy feedback belongs to the clicked block, with no success notifications", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const handlers = new Map<string, (event: never, context: never) => unknown>();
  const pi = { on: (event: string, handler: (event: never, context: never) => unknown) => handlers.set(event, handler) } as unknown as ExtensionAPI;
  const notices: Array<{ message: string; type: string }> = [];
  const copied: string[] = [];
  let fail = false;
  extension(pi, async (code) => {
    if (fail) throw new Error("Clipboard unavailable");
    copied.push(code);
  });
  const context = { mode: "tui", ui: { notify: (message: string, type: string) => notices.push({ message, type }) } };
  handlers.get("session_start")!({} as never, context as never);
  try {
    const component = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "```sh\necho first\n```\n\n```sh\necho second\n```" }], stopReason: "stop" } as never);
    await click(component, 0);
    assert(buttonLines(component)[0].includes(" [Copied ✓]"));
    assert(buttonLines(component)[1].includes("[Copy]"));
    t.mock.timers.tick(1500);
    await click(component, 0);
    t.mock.timers.tick(500);
    assert(buttonLines(component)[0].includes("[Copied ✓]"));
    await click(component, 1);
    fail = true;
    await click(component, 0);
    assert(buttonLines(component)[0].includes(" [Failed ✗]"));
    assert(buttonLines(component)[1].includes("[Copied ✓]"));
    fail = false;
    await click(component, 0);
    assert(buttonLines(component)[0].includes("[Copied ✓]"));
    t.mock.timers.tick(2000);
    assert(buttonLines(component).every((line) => line.includes("[Copy]")));
    assert.deepEqual(copied, ["echo first", "echo first", "echo second", "echo first"]);
    assert.deepEqual(notices, [{ message: "Clipboard unavailable", type: "error" }]);
  } finally {
    handlers.get("session_shutdown")!({} as never, context as never);
  }
});

test("feedback and its reset request renders from the captured fullscreen TUI", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const prototype = TuiAltScreen.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "requestRender");
  let renders = 0;
  prototype.requestRender = () => { renders++; };
  const original = prototype.requestRender;
  const dispose = installPanels(async () => {}, (error) => { throw error; });
  try {
    const tui = Object.create(prototype) as TuiAltScreen;
    tui.requestRender();
    const component = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "```sh\necho hi\n```" }], stopReason: "stop" } as never);
    const before = component.render(50).length;
    await click(component);
    assert.equal(renders, 2);
    assert.equal(component.render(50).length, before);
    for (const width of [14, 20, 80]) {
      const lines = component.render(width).map(stripTerminalSequences);
      assert(lines.every((line) => visibleWidth(line) <= width));
      const row = lines.findIndex((line) => line.includes("╭─"));
      const x = width - 5;
      assert.equal(component.handleMouse({ type: "press", button: "left", x, y: row, screenX: x, screenY: row, width, height: lines.length, shift: false, alt: false, ctrl: false })?.handled, true);
    }
    assert(buttonLines(component)[0].includes("[Copied ✓]"));
    t.mock.timers.tick(2000);
    assert.equal(renders, 3);
    assert(buttonLines(component)[0].includes("[Copy]"));
    dispose();
    assert.equal(prototype.requestRender, original);
  } finally {
    dispose();
    if (descriptor) Object.defineProperty(prototype, "requestRender", descriptor);
    else Reflect.deleteProperty(prototype, "requestRender");
  }
});

test("cleanup cancels feedback timers and ignores clipboard completions after disposal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveCopy!: () => void;
  const pending = new Promise<void>((resolve) => { resolveCopy = resolve; });
  let renders = 0;
  const source = "```sh\necho hi\n```";
  const markdown = new Markdown(source, 1, 0, getMarkdownTheme());
  const dispose = decorateMarkdown(markdown, source, () => pending, () => { renders++; });
  await click(markdown);
  assert(buttonLines(markdown)[0].includes("[Copy]"));
  dispose();
  resolveCopy();
  await setImmediate();
  t.mock.timers.tick(4000);
  assert.equal(renders, 0);
  assert(!markdown.render(50).some((line) => line.includes("Copied")));

  const disposeSecond = decorateMarkdown(markdown, source, async () => {}, () => { renders++; });
  markdown.invalidate();
  await click(markdown);
  assert.equal(renders, 1);
  disposeSecond();
  t.mock.timers.tick(4000);
  assert.equal(renders, 1);
});
