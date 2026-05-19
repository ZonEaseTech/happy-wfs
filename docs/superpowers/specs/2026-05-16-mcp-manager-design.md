# MCP Manager — Structured List + Form

**Date:** 2026-05-16
**Status:** Approved
**Scope:** `packages/happy-app` (Settings → MCP management)

## Problem

The "MCP 管理" screen (`sources/app/(app)/settings/mcp-config.tsx`) has two groups:

1. **Per-model config** — tapping Claude / Codex / Gemini calls `openFile()`, which
   opens the raw config file in a text editor (`FileViewerModal` on desktop web, the
   `/settings/machine-edit` route on mobile).
2. **Browse directory** — opens `~/.claude` etc. in a file browser.

Editing MCP servers therefore means hand-editing raw JSON / TOML. This is error-prone
(syntax mistakes, wrong key names, no field guidance) and offers no overview of which
servers are configured.

We want group 1 to instead pop up a **structured MCP server list + add/edit form**, so
users manage servers through a guided UI. Group 2 is unchanged.

## Approach

Tapping a model in group 1 opens a single popup (`McpServersModal`) that:

- reads the model's config file from the selected machine,
- parses MCP servers into a unified in-memory model,
- shows a list (server name + transport badge, per-row edit / delete, an "Add" button),
- switches in-place to a form view for add / edit,
- writes changes back to the file.

Parsing / serialization lives in a pure, network-free module (`mcpConfig.ts`) so it is
fully unit-testable. The modal handles I/O and UI only.

Config files differ in format and field naming, so each model has its own **codec**:

| Model  | File                     | Format | Servers location      |
|--------|--------------------------|--------|-----------------------|
| Claude | `~/.claude/settings.json`| JSON   | `mcpServers` object   |
| Gemini | `~/.gemini/settings.json`| JSON   | `mcpServers` object   |
| Codex  | `~/.codex/config.toml`   | TOML   | `[mcp_servers.<name>]`|

(File paths match what `mcp-config.tsx` already targets — unchanged.)

## Data Model

```typescript
// packages/happy-app/sources/utils/mcpConfig.ts

export type McpTarget = 'claude' | 'codex' | 'gemini';
export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServer {
    name: string;
    transport: McpTransport;
    // stdio
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // http / sse
    url?: string;
    headers?: Record<string, string>;
    // Any keys the codec did not recognize, preserved verbatim on round-trip
    // so editing one server never drops fields from another or from itself.
    extras?: Record<string, unknown>;
}
```

`extras` is the round-trip safety net: unknown per-server keys (e.g. `cwd`, `timeout`,
`disabled`, vendor-specific fields) survive a load → edit → save cycle untouched.

## Module API — `mcpConfig.ts` (pure)

```typescript
/** Parse a config file's content into MCP servers. Throws on malformed JSON/TOML. */
export function parseMcpServers(content: string, target: McpTarget): McpServer[];

/**
 * Produce updated file content with `servers` written back.
 * Preserves all non-MCP content of the original file.
 */
export function applyMcpServers(
    originalContent: string,
    servers: McpServer[],
    target: McpTarget,
): string;
```

### JSON codec (Claude, Gemini)

- **Parse:** `JSON.parse` → read `mcpServers` (missing ⇒ `[]`). For each entry, detect
  transport and map known keys to `McpServer`; collect the rest into `extras`.
- **Apply:** `JSON.parse` the original (empty/whitespace ⇒ `{}`), replace **only** the
  `mcpServers` key, `JSON.stringify(obj, null, 2)`. Every other top-level key
  (`permissions`, `hooks`, `env`, …) is preserved because it stays in the parsed object.
- **Transport key naming differs and is owned by the codec:**
  - Claude: stdio `{ command, args, env }`; remote `{ type: "http"|"sse", url, headers }`.
  - Gemini: stdio `{ command, args, env }`; SSE `{ url }`; HTTP `{ httpUrl }`; `headers`.
  - Exact key names are confirmed against each CLI's current docs/source **during
    implementation** — not guessed in code. The codec boundary isolates this so a
    naming fix touches one function.

### TOML codec (Codex)

- **Parse:** parse with `smol-toml` → read the `mcp_servers` table; map each
  `[mcp_servers.<name>]` sub-table to an `McpServer` (unrecognized keys → `extras`).
- **Apply — surgical region replacement, NOT full re-stringify:**
  1. Scan the original text line-by-line for TOML table headers.
  2. Delete every block whose header starts with `[mcp_servers` / `[[mcp_servers`
     (a block runs from its header to the line before the next top-level `[`/`[[`
     header, or EOF).
  3. Append freshly serialized `[mcp_servers.<name>]` blocks at the end.
  - This keeps all non-MCP settings **and their comments** byte-identical. Only the
    `mcp_servers` region is rewritten; comments *inside* MCP blocks are not preserved
    (acceptable — those blocks are now UI-managed).

## Components

### New: `sources/components/McpServersModal.tsx`

Controlled-visibility component, same pattern as `FileViewerModal` (parent owns
`visible`). Props:

```typescript
interface McpServersModalProps {
    visible: boolean;
    onClose: () => void;
    machineId: string;
    target: ConfigTarget;        // existing type, exported from mcp-config.tsx
    filePath: string;            // resolved e.g. `${homeDir}/.claude/settings.json`
    onRequestRawEdit: () => void; // parse-error fallback → parent's openFile()
}
```

`ConfigTarget` (and the codec mapping) is exported from `mcp-config.tsx` — or hoisted to
a small shared module — so the modal can import it instead of redefining it.

Internal state:

- `loadState`: `'loading' | 'ready' | 'error'`
- `servers: McpServer[]`, `originalContent: string`
- `view: 'list' | 'form'`, `editing: McpServer | null` (`null` = adding new)
- `saving: boolean`

Views:

- **List view** — each row: server name, a transport badge (`stdio` / `http` / `sse`),
  edit and delete affordances; a header "Add" button. Empty state when no servers.
- **Form view** — fields: `name`; transport segmented control (`stdio` / `http` / `sse`);
  then transport-specific fields:
  - stdio: `command`, `args` (one input per arg, add/remove rows), `env` (key/value rows)
  - http / sse: `url`, `headers` (key/value rows) — identical fields, transport only
    changes how the codec serializes the entry
  - "Save" validates (non-empty name, unique name, required transport field) and returns
    to the list view; "Cancel" discards.

Lifecycle:

- On `visible` true → `machineReadFile(machineId, path)`; `success:false` with a
  not-found error ⇒ treat as empty config (`originalContent = ''`, `servers = []`).
- Parse error ⇒ `loadState = 'error'` with the message and a **"Open file" fallback**
  link (reuses the existing raw-edit path) so a corrupt file is still recoverable.
- "Save" (modal-level) → `applyMcpServers(originalContent, servers, target.key)` →
  `machineWriteFile`. On success close; on failure show an inline error and stay open.

The modal is cross-platform (RN primitives, works on web); no `.web.tsx` split.

### Modified: `sources/app/(app)/settings/mcp-config.tsx`

- Add state `mcpManagerTarget: ConfigTarget | null`.
- Group 1 `onPress`: `openFile(target)` → `requireOnline(() => setMcpManagerTarget(target))`.
- `openFile` and the desktop/mobile raw-edit routing are kept and reused **only** as the
  parse-error fallback.
- Render `<McpServersModal visible={!!mcpManagerTarget} target={mcpManagerTarget} … />`.
- Group 2 (browse directory) and `FileViewerModal` usage: unchanged.

## Data Flow

```
tap model
  → requireOnline()                       (machine present + online)
  → setMcpManagerTarget(target)           → modal opens
  → machineReadFile(machineId, path)
  → parseMcpServers(content, target.key)  → McpServer[]   (list view)
  → add / edit / delete                   → local state only
  → Save: applyMcpServers(original, servers, target.key)
  → machineWriteFile(machineId, path, newContent)
  → close
```

## Error Handling

- **No machine / offline:** existing `requireOnline` guard, unchanged.
- **File not found:** treated as an empty config (lets users create the first server).
- **Malformed JSON/TOML:** modal shows the error + an "Open file" link to raw editing.
- **Write failure:** inline error in the modal; servers stay in local state, not lost.
- **Form validation:** empty name, duplicate name, missing required transport field are
  blocked before leaving the form view.
- Follows the repo rule "never show loading errors — always retry" for transient read
  failures; a genuine parse error is a real state and is surfaced (with the fallback).

## Dependency

- Add `smol-toml` to `packages/happy-app` (small, modern, pure-JS TOML parser; used for
  **reading** Codex TOML). Writing uses the surgical region replacement above.

## Testing

`sources/utils/mcpConfig.test.ts` (vitest, no network):

- JSON round-trip (Claude + Gemini): parse → apply with no changes ⇒ `mcpServers`
  semantically unchanged; other top-level keys preserved.
- TOML round-trip (Codex): non-MCP settings + their comments preserved byte-for-byte;
  `[mcp_servers.*]` blocks correctly replaced.
- stdio and http servers both parse and serialize correctly per codec.
- `extras` survives a load → edit-other-server → save cycle.
- Adding a server to an empty / missing config produces valid output.
- Malformed JSON / TOML throws (so the modal can catch it).

Run after changes: `yarn typecheck` in `packages/happy-app`;
`npx vitest run sources/utils/mcpConfig.test.ts`.

## i18n & Changelog

- New strings under a `mcpManager.*` namespace, added to all 10 translation files
  (`en`, `ru`, `pl`, `es`, `ca`, `it`, `pt`, `ja`, `zh-Hans`, `zh-Hant`).
- Update `CHANGELOG.md`, then `npx tsx sources/scripts/parseChangelog.ts`.

## Out of Scope

- Group 2 "browse directory" behavior.
- Raw file editing UX (kept only as the parse-error fallback).
- Changing which files / paths are managed.
- Validating that an MCP server actually starts / connects.
- Preserving comments *inside* `[mcp_servers.*]` TOML blocks.

## Known Limitations

- Editing Codex MCP servers rewrites the `mcp_servers` region; comments inside those
  specific blocks are lost (everything else in `config.toml` is preserved).
- Saving a JSON config (Claude / Gemini) re-stringifies the whole file with 2-space
  indentation, so unrelated keys may be reflowed cosmetically (content unchanged).
