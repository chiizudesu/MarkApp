# MarkApp

Lightweight Electron markdown editor with a **Claude** agent sidebar: Cursor-style chat, section-scoped edits, inline diff preview, templates with `{{placeholders}}`, and Obsidian-flavored markdown.

## Develop

```bash
cd markapp
npm install
npm run dev
```

Set your **Anthropic API key** in **Settings** (gear in the title bar).

## Build

```bash
npm run build
npm run dist
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as |
| Ctrl+Shift+C | Copy entire document |
| Ctrl+L | Toggle agent panel |
| Ctrl+K | Quick AI (current section) |
| Ctrl+Shift+P | Command palette |

## Project layout

- `electron/` — main process, IPC, `electron-store` settings
- `src/` — React UI, CodeMirror 6 editor,* Claude client*
- `templates/` — bundled `.md` templates

Chat history for a saved file is stored next to it as `*.markapp.chat.json`.
