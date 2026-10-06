import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { stripTerminalSequences, type MarkdownTheme } from "@earendil-works/pi-tui";

const host = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle/index.js");

test("the actual extension loads into Pi's bundled renderer and cleans up on shutdown", async () => {
  const pi: typeof import("@earendil-works/pi-coding-agent") = await import(pathToFileURL(host).href);
  const loaded = await pi.discoverAndLoadExtensions([resolve("src/extension.ts")], process.cwd(), resolve("test/empty-agent-dir"));
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert(extension);
  const notices: string[] = [];
  const context = { mode: "tui", ui: { notify: (message: string) => notices.push(message) } };
  const original = pi.AssistantMessageComponent.prototype.updateContent;
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" } as never, context as never);
  try {
    const plain = (text: string) => text;
    const theme = Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map((key) => [key, plain])) as unknown as MarkdownTheme;
    const component = new pi.AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "```sh\necho hello\n```" }], stopReason: "stop" } as never, false, theme);
    assert(component.render(50).map(stripTerminalSequences).some((line) => line.includes("[Copy]")));
    assert.deepEqual(notices, []);
  } finally {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "reload" } as never, context as never);
  }
  assert.equal(pi.AssistantMessageComponent.prototype.updateContent, original);
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" } as never, { ...context, mode: "print" } as never);
  assert.equal(pi.AssistantMessageComponent.prototype.updateContent, original);
});
