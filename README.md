# Pi Code Blocks

Bordered, syntax-highlighted code panels with clickable clipboard buttons for [Pi](https://pi.dev).

This extension changes how assistant code blocks are displayed—not the response, saved conversation, or model context. It copies code from the source rather than the wrapped terminal display, preserving tabs and code-body whitespace.

## Install

From npm:

```sh
pi install npm:@nuclear-ant/pi-code-blocks
```

Or directly from GitHub:

```sh
pi install git:github.com/nuclear-ant/pi-code-blocks
```

Run `/reload` in an existing Pi session after installing or updating.

## Use

Click **Copy** in a code block's header. That button shows **Copied ✓** on success or **Failed ✗** on failure, then resets after two seconds. Clipboard failures also report an error with the underlying reason.

Panels support streaming responses, multiple code blocks, nested lists and blockquotes, and terminal resizing. They use Pi's existing syntax-highlighting theme.

**Clickable buttons and timed feedback require fullscreen mode**, which is Pi's default. To select it explicitly:

```sh
pi --tui-mode fullscreen
```

Regular mode displays the panels but leaves mouse handling to the terminal. Print, JSON, and RPC modes are unchanged.

The extension uses Pi's clipboard helper. On Linux, it may require `wl-clipboard` for Wayland or `xclip`/`xsel` for X11. Remote and headless sessions depend on the terminal's OSC 52 clipboard support.

## Compatibility

Tested with **Pi 1.0.2**. This extension relies on unsupported renderer internals: it wraps the assistant component's content update method, decorates Markdown instances, and observes fullscreen render requests. Pi updates can break those integration points; other extensions patching the same renderer may conflict.

It does not edit installed Pi files. Its patches and feedback timers are cleaned up on reload and shutdown. When a source block cannot be matched safely to rendered code, it keeps Pi's normal rendering instead of offering an incorrect copy action.

## Development

Requires Node.js 22.19 or newer. Pi packages used by tests are pinned development dependencies; users receive the host packages from Pi itself.

```sh
npm ci --ignore-scripts
```

```sh
npm run check
```

```sh
npm test
```

Try the extension without installing it:

```sh
pi -e ./src/extension.ts
```

Inspect the publishable files:

```sh
npm pack --dry-run
```

Only the extension source, package metadata, README, and license are distributed. Publishing runs type-checking and tests first.

## License

MIT. See [LICENSE](LICENSE).
