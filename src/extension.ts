import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPanels } from "./patch.ts";

export default function (pi: ExtensionAPI, copy: typeof copyToClipboard = copyToClipboard): void {
  let dispose: (() => void) | undefined;
  let generation = 0;
  pi.on("session_start", (_event, ctx) => {
    const current = ++generation;
    dispose?.();
    dispose = undefined;
    if (ctx.mode !== "tui") return;
    try {
      dispose = installPanels(async (code) => {
        try {
          await copy(code);
        } catch (error) {
          if (current === generation) ctx.ui.notify(error instanceof Error ? error.message : "Clipboard copy failed", "error");
          throw error;
        }
      }, (error) => {
        ctx.ui.notify(`Code panels unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
      });
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  });
  pi.on("session_shutdown", () => {
    generation++;
    dispose?.();
    dispose = undefined;
  });
}
