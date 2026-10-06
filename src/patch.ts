import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, TuiAltScreen } from "@earendil-works/pi-tui";
import { decorateMarkdown } from "./panels.ts";

const patchKey = Symbol.for("pi-code-blocks.updateContent");

export function installPanels(copy: (code: string) => void | Promise<void>, onError: (error: unknown) => void): () => void {
  const prototype = AssistantMessageComponent.prototype;
  const state = prototype as unknown as Record<symbol, boolean>;
  if (state[patchKey]) throw new Error("Pi code-block panels are already loaded");
  const original = prototype.updateContent;
  if (typeof original !== "function") throw new Error("Unsupported Pi assistant renderer");
  const restores = new WeakMap<Markdown, () => void>();
  const instances = new Set<WeakRef<Markdown>>();
  let warned = false;
  let active = true;
  // ExtensionContext does not expose the live TUI. Observe its normal render
  // requests so async clipboard results and reset timers can repaint the button.
  const tuiPrototype = TuiAltScreen.prototype;
  const requestDescriptor = Object.getOwnPropertyDescriptor(tuiPrototype, "requestRender");
  const originalRequest = tuiPrototype.requestRender;
  let renderer: WeakRef<TuiAltScreen> | undefined;
  const wrappedRequest: typeof originalRequest = function (this: TuiAltScreen, force) {
    if (active) renderer = new WeakRef(this);
    originalRequest.call(this, force);
  };
  const repaint = () => renderer?.deref()?.requestRender();
  const wrapped: typeof original = function (this: AssistantMessageComponent, message, streaming) {
    original.call(this, message, streaming);
    if (!active) return;
    try {
      const container = this.children[0];
      if (!(container instanceof Container)) throw new Error("Unsupported Pi assistant content container");
      const markdown = container.children.filter((child): child is Markdown => child instanceof Markdown);
      const text = message.content.filter((content) => content.type === "text" && content.text.trim());
      if (markdown.length !== text.length) throw new Error("Unsupported Pi assistant content layout");
      for (const reference of instances) if (!reference.deref()) instances.delete(reference);
      for (let i = 0; i < markdown.length; i++) {
        const content = text[i];
        if (content.type !== "text") continue;
        restores.set(markdown[i], decorateMarkdown(markdown[i], content.text, copy, repaint));
        instances.add(new WeakRef(markdown[i]));
      }
    } catch (error) {
      for (const child of (this.children[0] as Container)?.children ?? []) {
        if (child instanceof Markdown) {
          restores.get(child)?.();
          restores.delete(child);
        }
      }
      if (!warned) { warned = true; onError(error); }
    }
  };
  state[patchKey] = true;
  prototype.updateContent = wrapped;
  tuiPrototype.requestRender = wrappedRequest;
  return () => {
    if (!active) return;
    active = false;
    // Do not overwrite a wrapper installed later by another extension.
    if (prototype.updateContent === wrapped) prototype.updateContent = original;
    delete state[patchKey];
    if (tuiPrototype.requestRender === wrappedRequest) {
      if (requestDescriptor) Object.defineProperty(tuiPrototype, "requestRender", requestDescriptor);
      else Reflect.deleteProperty(tuiPrototype, "requestRender");
    }
    renderer = undefined;
    for (const reference of instances) {
      const instance = reference.deref();
      if (instance) restores.get(instance)?.();
    }
    instances.clear();
  };
}
