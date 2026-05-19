# MCP Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-file editing of the "MCP 管理" screen with a structured MCP-server list + add/edit form popup.

**Architecture:** A pure, network-free `mcpConfig.ts` module parses/serializes MCP servers for three per-CLI codecs (Claude/Gemini JSON, Codex TOML). A controlled `McpServersModal` component handles file I/O (`machineReadFile`/`machineWriteFile`) and UI; `mcp-config.tsx` opens it instead of the raw editor, keeping raw edit only as the parse-error fallback.

**Tech Stack:** React Native (Expo), TypeScript, `smol-toml` (new dep, TOML reading), vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-mcp-manager-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/happy-app/sources/utils/mcpConfig.ts` (new) | Pure parse/serialize: types + 3 codecs |
| `packages/happy-app/sources/utils/mcpConfig.test.ts` (new) | vitest coverage of the codecs |
| `packages/happy-app/sources/components/McpServersModal.tsx` (new) | List + form popup, file I/O |
| `packages/happy-app/sources/app/(app)/settings/mcpTargets.ts` (new) | `ConfigTarget` type + `CONFIG_TARGETS` (hoisted out of mcp-config.tsx so the modal can import without a cycle) |
| `packages/happy-app/sources/app/(app)/settings/mcp-config.tsx` (modify) | Open the modal; keep raw edit as fallback |
| `packages/happy-app/sources/text/_default.ts` + 10 `translations/*.ts` (modify) | `mcpManager.*` strings |
| `packages/happy-app/CHANGELOG.md` (modify) | Release note |

---

## Task 1: Add `smol-toml` dependency

**Files:**
- Modify: `packages/happy-app/package.json`

- [ ] **Step 1: Install**

Run from `packages/happy-app`:
```bash
yarn add smol-toml
```
Expected: `package.json` gains `"smol-toml": "^1.x"` under `dependencies`; `yarn.lock` updated.

- [ ] **Step 2: Verify import resolves**

Run from `packages/happy-app`:
```bash
node -e "const t=require('smol-toml'); console.log(typeof t.parse)"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add packages/happy-app/package.json yarn.lock
git commit -m "build(app): add smol-toml for MCP config parsing"
```

---

## Task 2: `mcpConfig.ts` — types + JSON codec parse

**Files:**
- Create: `packages/happy-app/sources/utils/mcpConfig.ts`
- Test: `packages/happy-app/sources/utils/mcpConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcpConfig.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { parseMcpServers } from './mcpConfig';

describe('parseMcpServers — JSON (claude)', () => {
    it('returns [] when mcpServers is absent', () => {
        expect(parseMcpServers('{}', 'claude')).toEqual([]);
        expect(parseMcpServers('', 'claude')).toEqual([]);
    });

    it('parses a stdio server', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' } } } });
        expect(parseMcpServers(content, 'claude')).toEqual([
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' }, extras: undefined },
        ]);
    });

    it('parses an http server via type', () => {
        const content = JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
        expect(parseMcpServers(content, 'claude')).toEqual([
            { name: 'api', transport: 'http', url: 'https://x', headers: { A: 'b' }, extras: undefined },
        ]);
    });

    it('keeps unknown keys in extras', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'x', timeout: 30 } } });
        expect(parseMcpServers(content, 'claude')[0].extras).toEqual({ timeout: 30 });
    });

    it('reads gemini httpUrl as http and bare url as sse', () => {
        const content = JSON.stringify({ mcpServers: { a: { httpUrl: 'https://h' }, b: { url: 'https://s' } } });
        const parsed = parseMcpServers(content, 'gemini');
        expect(parsed[0]).toMatchObject({ name: 'a', transport: 'http', url: 'https://h' });
        expect(parsed[1]).toMatchObject({ name: 'b', transport: 'sse', url: 'https://s' });
    });

    it('throws on malformed JSON', () => {
        expect(() => parseMcpServers('{bad', 'claude')).toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run from `packages/happy-app`: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: FAIL — `parseMcpServers` not exported / module missing.

- [ ] **Step 3: Implement types + JSON parse**

Create `mcpConfig.ts`:
```typescript
export type McpTarget = 'claude' | 'codex' | 'gemini';
export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServer {
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    /** Per-server keys the codec did not recognize, preserved on round-trip. */
    extras?: Record<string, unknown>;
}

// Keys a JSON codec recognizes; everything else goes to `extras`.
const JSON_KNOWN_KEYS = ['type', 'command', 'args', 'env', 'url', 'httpUrl', 'headers'];

export function parseMcpServers(content: string, target: McpTarget): McpServer[] {
    if (target === 'codex') return parseCodexServers(content);
    return parseJsonServers(content, target);
}

function parseJsonServers(content: string, target: McpTarget): McpServer[] {
    const trimmed = content.trim();
    const root = trimmed ? JSON.parse(trimmed) : {};
    const mcp = root?.mcpServers;
    if (!mcp || typeof mcp !== 'object') return [];
    return Object.entries(mcp).map(([name, raw]) =>
        jsonEntryToServer(name, (raw ?? {}) as Record<string, unknown>, target),
    );
}

function jsonEntryToServer(name: string, entry: Record<string, unknown>, target: McpTarget): McpServer {
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
        if (!JSON_KNOWN_KEYS.includes(k)) extras[k] = v;
    }
    const extrasOrUndef = Object.keys(extras).length ? extras : undefined;
    const headers = entry.headers as Record<string, string> | undefined;

    if (target === 'gemini') {
        if (typeof entry.httpUrl === 'string') {
            return { name, transport: 'http', url: entry.httpUrl, headers, extras: extrasOrUndef };
        }
        if (typeof entry.url === 'string') {
            return { name, transport: 'sse', url: entry.url, headers, extras: extrasOrUndef };
        }
    } else {
        if (entry.type === 'http' || entry.type === 'sse') {
            return { name, transport: entry.type, url: entry.url as string, headers, extras: extrasOrUndef };
        }
        if (typeof entry.url === 'string') {
            return { name, transport: 'http', url: entry.url, headers, extras: extrasOrUndef };
        }
    }
    return {
        name,
        transport: 'stdio',
        command: entry.command as string | undefined,
        args: entry.args as string[] | undefined,
        env: entry.env as Record<string, string> | undefined,
        extras: extrasOrUndef,
    };
}

// parseCodexServers defined in Task 4 — leave a stub that Task 4 replaces:
function parseCodexServers(_content: string): McpServer[] {
    throw new Error('not implemented');
}
```

- [ ] **Step 4: Run test, verify JSON tests pass**

Run from `packages/happy-app`: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: the 6 `JSON (claude)` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/utils/mcpConfig.ts packages/happy-app/sources/utils/mcpConfig.test.ts
git commit -m "feat(app): parse MCP servers from Claude/Gemini JSON config"
```

---

## Task 3: JSON codec — `applyMcpServers`

**Files:**
- Modify: `packages/happy-app/sources/utils/mcpConfig.ts`
- Test: `packages/happy-app/sources/utils/mcpConfig.test.ts`

- [ ] **Step 1: Write the failing test** — append to `mcpConfig.test.ts`:

```typescript
import { applyMcpServers } from './mcpConfig';

describe('applyMcpServers — JSON', () => {
    it('writes mcpServers and preserves other top-level keys', () => {
        const original = JSON.stringify({ permissions: { allow: ['x'] }, mcpServers: {} }, null, 2);
        const out = applyMcpServers(original, [
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y'], env: { K: 'V' } },
        ], 'claude');
        const parsed = JSON.parse(out);
        expect(parsed.permissions).toEqual({ allow: ['x'] });
        expect(parsed.mcpServers.fs).toEqual({ command: 'npx', args: ['-y'], env: { K: 'V' } });
    });

    it('round-trips a claude http server', () => {
        const content = JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
        const out = applyMcpServers(content, parseMcpServers(content, 'claude'), 'claude');
        expect(JSON.parse(out).mcpServers.api).toEqual({ type: 'http', url: 'https://x', headers: { A: 'b' } });
    });

    it('uses httpUrl for gemini http servers', () => {
        const out = applyMcpServers('', [{ name: 'a', transport: 'http', url: 'https://h' }], 'gemini');
        expect(JSON.parse(out).mcpServers.a).toEqual({ httpUrl: 'https://h' });
    });

    it('preserves extras on the server entry', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'x', timeout: 30 } } });
        const out = applyMcpServers(content, parseMcpServers(content, 'claude'), 'claude');
        expect(JSON.parse(out).mcpServers.fs).toEqual({ command: 'x', timeout: 30 });
    });

    it('builds valid output from empty content', () => {
        const out = applyMcpServers('', [{ name: 's', transport: 'stdio', command: 'c' }], 'claude');
        expect(JSON.parse(out)).toEqual({ mcpServers: { s: { command: 'c' } } });
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: FAIL — `applyMcpServers` not exported.

- [ ] **Step 3: Implement** — add to `mcpConfig.ts`:

```typescript
export function applyMcpServers(originalContent: string, servers: McpServer[], target: McpTarget): string {
    if (target === 'codex') return applyCodexServers(originalContent, servers);
    return applyJsonServers(originalContent, servers, target);
}

/** Drop undefined values and empty objects/arrays from an entry. */
function compact(entry: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
        if (v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
        out[k] = v;
    }
    return out;
}

function serverToJsonEntry(s: McpServer, target: McpTarget): Record<string, unknown> {
    const extras = s.extras ?? {};
    if (s.transport === 'stdio') {
        return compact({ command: s.command, args: s.args, env: s.env, ...extras });
    }
    if (target === 'gemini') {
        return s.transport === 'http'
            ? compact({ httpUrl: s.url, headers: s.headers, ...extras })
            : compact({ url: s.url, headers: s.headers, ...extras });
    }
    return compact({ type: s.transport, url: s.url, headers: s.headers, ...extras });
}

function applyJsonServers(originalContent: string, servers: McpServer[], target: McpTarget): string {
    const trimmed = originalContent.trim();
    const root = trimmed ? JSON.parse(trimmed) : {};
    const mcp: Record<string, unknown> = {};
    for (const s of servers) mcp[s.name] = serverToJsonEntry(s, target);
    root.mcpServers = mcp;
    return JSON.stringify(root, null, 2) + '\n';
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: all JSON apply tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/utils/mcpConfig.ts packages/happy-app/sources/utils/mcpConfig.test.ts
git commit -m "feat(app): serialize MCP servers back to Claude/Gemini JSON"
```

---

## Task 4: TOML codec — parse (Codex)

**Files:**
- Modify: `packages/happy-app/sources/utils/mcpConfig.ts`
- Test: `packages/happy-app/sources/utils/mcpConfig.test.ts`

- [ ] **Step 1: Write the failing test** — append to `mcpConfig.test.ts`:

```typescript
describe('parseMcpServers — TOML (codex)', () => {
    it('returns [] when there are no mcp_servers tables', () => {
        expect(parseMcpServers('model = "gpt-5"\n', 'codex')).toEqual([]);
        expect(parseMcpServers('', 'codex')).toEqual([]);
    });

    it('parses a stdio server table', () => {
        const toml = '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "pkg"]\n\n[mcp_servers.fs.env]\nK = "V"\n';
        expect(parseMcpServers(toml, 'codex')).toEqual([
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' }, extras: undefined },
        ]);
    });

    it('parses a url table as http', () => {
        const toml = '[mcp_servers.api]\nurl = "https://x"\n';
        expect(parseMcpServers(toml, 'codex')[0]).toMatchObject({ name: 'api', transport: 'http', url: 'https://x' });
    });

    it('throws on malformed TOML', () => {
        expect(() => parseMcpServers('[mcp_servers.', 'codex')).toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: FAIL — `parseCodexServers` throws `not implemented`.

- [ ] **Step 3: Implement** — in `mcpConfig.ts`, add the import at the top and replace the `parseCodexServers` stub:

```typescript
// top of file:
import { parse as parseToml } from 'smol-toml';

// Codex MCP table keys the codec recognizes.
const CODEX_KNOWN_KEYS = ['command', 'args', 'env', 'url', 'http_headers'];

function parseCodexServers(content: string): McpServer[] {
    const trimmed = content.trim();
    const root = trimmed ? (parseToml(trimmed) as Record<string, unknown>) : {};
    const mcp = root.mcp_servers as Record<string, unknown> | undefined;
    if (!mcp || typeof mcp !== 'object') return [];
    return Object.entries(mcp).map(([name, raw]) =>
        codexTableToServer(name, (raw ?? {}) as Record<string, unknown>),
    );
}

function codexTableToServer(name: string, table: Record<string, unknown>): McpServer {
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(table)) {
        if (!CODEX_KNOWN_KEYS.includes(k)) extras[k] = v;
    }
    const extrasOrUndef = Object.keys(extras).length ? extras : undefined;
    if (typeof table.url === 'string') {
        return {
            name, transport: 'http', url: table.url,
            headers: table.http_headers as Record<string, string> | undefined,
            extras: extrasOrUndef,
        };
    }
    return {
        name, transport: 'stdio',
        command: table.command as string | undefined,
        args: table.args as string[] | undefined,
        env: table.env as Record<string, string> | undefined,
        extras: extrasOrUndef,
    };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: TOML parse tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/utils/mcpConfig.ts packages/happy-app/sources/utils/mcpConfig.test.ts
git commit -m "feat(app): parse MCP servers from Codex TOML config"
```

---

## Task 5: TOML codec — apply (surgical region replace)

**Files:**
- Modify: `packages/happy-app/sources/utils/mcpConfig.ts`
- Test: `packages/happy-app/sources/utils/mcpConfig.test.ts`

- [ ] **Step 1: Write the failing test** — append to `mcpConfig.test.ts`:

```typescript
describe('applyMcpServers — TOML (codex)', () => {
    it('preserves non-MCP settings and comments, replaces mcp_servers region', () => {
        const original = '# top comment\nmodel = "gpt-5"\n\n[mcp_servers.old]\ncommand = "x"\n';
        const out = applyMcpServers(original, [
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y'], env: { K: 'V' } },
        ], 'codex');
        expect(out).toContain('# top comment');
        expect(out).toContain('model = "gpt-5"');
        expect(out).not.toContain('[mcp_servers.old]');
        expect(out).toContain('[mcp_servers.fs]');
        expect(out).toContain('command = "npx"');
        expect(out).toContain('args = ["-y"]');
        expect(out).toContain('[mcp_servers.fs.env]');
        expect(out).toContain('K = "V"');
    });

    it('round-trips a stdio server', () => {
        const original = '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "pkg"]\n';
        const out = applyMcpServers(original, parseMcpServers(original, 'codex'), 'codex');
        expect(parseMcpServers(out, 'codex')).toEqual(parseMcpServers(original, 'codex'));
    });

    it('writes a url server', () => {
        const out = applyMcpServers('', [{ name: 'api', transport: 'http', url: 'https://x' }], 'codex');
        expect(out).toContain('[mcp_servers.api]');
        expect(out).toContain('url = "https://x"');
    });

    it('escapes quotes and backslashes in values', () => {
        const out = applyMcpServers('', [{ name: 's', transport: 'stdio', command: 'a"b\\c' }], 'codex');
        expect(out).toContain('command = "a\\"b\\\\c"');
    });

    it('preserves scalar extras on a server', () => {
        const original = '[mcp_servers.fs]\ncommand = "x"\nstartup_timeout_ms = 5000\n';
        const out = applyMcpServers(original, parseMcpServers(original, 'codex'), 'codex');
        expect(out).toContain('startup_timeout_ms = 5000');
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: FAIL — `applyCodexServers` not defined.

- [ ] **Step 3: Implement** — add to `mcpConfig.ts`:

```typescript
function tomlString(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function tomlArray(values: string[]): string {
    return '[' + values.map(tomlString).join(', ') + ']';
}

/** Emit a `[mcp_servers.<name>.<sub>]` table for a key/value map. */
function tomlSubTable(serverName: string, sub: string, map: Record<string, string>): string {
    const lines = [`[mcp_servers.${serverName}.${sub}]`];
    for (const [k, v] of Object.entries(map)) lines.push(`${k} = ${tomlString(v)}`);
    return lines.join('\n');
}

function serverToCodexBlock(s: McpServer): string {
    const head = [`[mcp_servers.${s.name}]`];
    const subTables: string[] = [];
    if (s.transport === 'stdio') {
        if (s.command) head.push(`command = ${tomlString(s.command)}`);
        if (s.args && s.args.length) head.push(`args = ${tomlArray(s.args)}`);
        if (s.env && Object.keys(s.env).length) subTables.push(tomlSubTable(s.name, 'env', s.env));
    } else {
        if (s.url) head.push(`url = ${tomlString(s.url)}`);
        if (s.headers && Object.keys(s.headers).length) {
            subTables.push(tomlSubTable(s.name, 'http_headers', s.headers));
        }
    }
    // Re-emit scalar extras (e.g. Codex's startup_timeout_ms) so editing one
    // server never drops another's keys. Non-scalar extras are not preserved.
    for (const [k, v] of Object.entries(s.extras ?? {})) {
        if (typeof v === 'string') head.push(`${k} = ${tomlString(v)}`);
        else if (typeof v === 'number' || typeof v === 'boolean') head.push(`${k} = ${String(v)}`);
    }
    return [head.join('\n'), ...subTables].join('\n\n');
}

/** True for a line that opens an `[mcp_servers...]` or `[[mcp_servers...]]` table. */
function isMcpServersHeader(line: string): boolean {
    const m = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (!m) return false;
    const name = m[1].trim();
    return name === 'mcp_servers' || name.startsWith('mcp_servers.');
}

function isAnyTableHeader(line: string): boolean {
    return /^\s*\[\[?\s*[^\]]+?\s*\]\]?\s*$/.test(line);
}

function applyCodexServers(originalContent: string, servers: McpServer[]): string {
    const lines = originalContent.split('\n');
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
        if (isAnyTableHeader(line)) {
            skipping = isMcpServersHeader(line);
        }
        if (!skipping) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    const blocks = servers.map(serverToCodexBlock);
    const body = kept.join('\n');
    const parts = [body, ...blocks].filter(p => p.length > 0);
    return parts.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run test, verify full suite passes**

Run: `npx vitest run sources/utils/mcpConfig.test.ts`
Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/utils/mcpConfig.ts packages/happy-app/sources/utils/mcpConfig.test.ts
git commit -m "feat(app): serialize MCP servers back to Codex TOML"
```

---

## Task 6: Hoist `ConfigTarget` to a shared module

**Files:**
- Create: `packages/happy-app/sources/app/(app)/settings/mcpTargets.ts`
- Modify: `packages/happy-app/sources/app/(app)/settings/mcp-config.tsx`

- [ ] **Step 1: Create `mcpTargets.ts`** with the `ConfigTarget` type and `CONFIG_TARGETS` array moved verbatim out of `mcp-config.tsx` (lines defining `type ConfigTarget` and `const CONFIG_TARGETS`):

```typescript
import { Ionicons } from '@expo/vector-icons';

export type ConfigTarget = {
    key: 'claude' | 'codex' | 'gemini';
    title: string;
    subtitle: string;
    fileName: string;
    dirName: string;
    language: string;
    validateJson?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
};

export const CONFIG_TARGETS: ConfigTarget[] = [
    { key: 'claude', title: 'Claude', subtitle: '~/.claude/settings.json · mcpServers', fileName: '.claude/settings.json', dirName: '.claude', language: 'JSON', validateJson: true, icon: 'sparkles-outline', color: '#5856D6' },
    { key: 'codex', title: 'Codex', subtitle: '~/.codex/config.toml · [mcp_servers.*]', fileName: '.codex/config.toml', dirName: '.codex', language: 'TOML', icon: 'code-slash-outline', color: '#111111' },
    { key: 'gemini', title: 'Gemini', subtitle: '~/.gemini/settings.json · mcpServers', fileName: '.gemini/settings.json', dirName: '.gemini', language: 'JSON', validateJson: true, icon: 'diamond-outline', color: '#AF52DE' },
];
```

- [ ] **Step 2: Update `mcp-config.tsx`** — delete its local `ConfigTarget` type + `CONFIG_TARGETS` const, add:

```typescript
import { ConfigTarget, CONFIG_TARGETS } from './mcpTargets';
```

- [ ] **Step 3: Verify typecheck**

Run from `packages/happy-app`: `yarn typecheck`
Expected: PASS (no other code referenced the moved symbols).

- [ ] **Step 4: Commit**

```bash
git add "packages/happy-app/sources/app/(app)/settings/mcpTargets.ts" "packages/happy-app/sources/app/(app)/settings/mcp-config.tsx"
git commit -m "refactor(app): hoist MCP ConfigTarget into a shared module"
```

---

## Task 7: `McpServersModal` — load + list view

**Files:**
- Create: `packages/happy-app/sources/components/McpServersModal.tsx`

- [ ] **Step 1: Implement the modal skeleton, file load, and list view:**

```typescript
import * as React from 'react';
import { View, Text, Modal as RNModal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { machineReadFile, machineWriteFile } from '@/sync/ops';
import { parseMcpServers, applyMcpServers, type McpServer } from '@/utils/mcpConfig';
import type { ConfigTarget } from '@/app/(app)/settings/mcpTargets';
import { Modal } from '@/modal';
import { t } from '@/text';

interface McpServersModalProps {
    visible: boolean;
    onClose: () => void;
    machineId: string;
    target: ConfigTarget;
    filePath: string;
    onRequestRawEdit: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';
type View = 'list' | 'form';

export function McpServersModal(props: McpServersModalProps) {
    const { theme } = useUnistyles();
    const [loadState, setLoadState] = React.useState<LoadState>('loading');
    const [errorMessage, setErrorMessage] = React.useState('');
    const [originalContent, setOriginalContent] = React.useState('');
    const [servers, setServers] = React.useState<McpServer[]>([]);
    const [view, setView] = React.useState<View>('list');
    const [editing, setEditing] = React.useState<McpServer | null>(null);
    const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (!props.visible) return;
        setLoadState('loading');
        setView('list');
        (async () => {
            const res = await machineReadFile(props.machineId, props.filePath);
            const content = res.success ? (res.content ?? '') : '';
            try {
                setServers(parseMcpServers(content, props.target.key));
                setOriginalContent(content);
                setLoadState('ready');
            } catch (e) {
                setErrorMessage(e instanceof Error ? e.message : String(e));
                setLoadState('error');
            }
        })();
    }, [props.visible, props.machineId, props.filePath, props.target.key]);

    const persist = React.useCallback(async (next: McpServer[]) => {
        setSaving(true);
        try {
            const content = applyMcpServers(originalContent, next, props.target.key);
            const res = await machineWriteFile(props.machineId, props.filePath, content);
            if (!res.success) {
                Modal.alert(t('common.error'), res.error || t('mcpManager.saveFailed'));
                return false;
            }
            setOriginalContent(content);
            setServers(next);
            return true;
        } finally {
            setSaving(false);
        }
    }, [originalContent, props.machineId, props.filePath, props.target.key]);

    const handleDelete = React.useCallback(async (index: number) => {
        const ok = await Modal.confirm(t('mcpManager.deleteTitle'), t('mcpManager.deleteMessage', { name: servers[index].name }), {
            confirmText: t('common.delete'), cancelText: t('common.cancel'),
        });
        if (ok) await persist(servers.filter((_, i) => i !== index));
    }, [servers, persist]);

    const handleSubmitForm = React.useCallback(async (server: McpServer) => {
        const next = editingIndex === null
            ? [...servers, server]
            : servers.map((s, i) => (i === editingIndex ? server : s));
        if (await persist(next)) setView('list');
    }, [servers, editingIndex, persist]);

    return (
        <RNModal visible={props.visible} animationType="slide" onRequestClose={props.onClose} transparent={false}>
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
                    <Pressable onPress={view === 'form' ? () => setView('list') : props.onClose} hitSlop={10}>
                        <Ionicons name={view === 'form' ? 'arrow-back' : 'close'} size={24} color={theme.colors.text} />
                    </Pressable>
                    <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: theme.colors.text }}>
                        {view === 'form'
                            ? t(editingIndex === null ? 'mcpManager.addTitle' : 'mcpManager.editTitle')
                            : t('mcpManager.title', { target: props.target.title })}
                    </Text>
                    {view === 'list' && loadState === 'ready' && (
                        <Pressable onPress={() => { setEditing(null); setEditingIndex(null); setView('form'); }} hitSlop={10}>
                            <Ionicons name="add" size={26} color={theme.colors.text} />
                        </Pressable>
                    )}
                </View>

                {loadState === 'loading' && <ActivityIndicator style={{ marginTop: 40 }} />}

                {loadState === 'error' && (
                    <View style={{ padding: 24, gap: 12 }}>
                        <Text style={{ color: theme.colors.text }}>{t('mcpManager.parseError')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{errorMessage}</Text>
                        <Pressable onPress={props.onRequestRawEdit}>
                            <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.openRawFile')}</Text>
                        </Pressable>
                    </View>
                )}

                {loadState === 'ready' && view === 'list' && (
                    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                        {servers.length === 0 && (
                            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 24 }}>
                                {t('mcpManager.empty')}
                            </Text>
                        )}
                        {servers.map((s, i) => (
                            <View key={s.name + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surfaceHigh }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.colors.text, fontWeight: '500' }}>{s.name}</Text>
                                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{s.transport}</Text>
                                </View>
                                <Pressable onPress={() => { setEditing(s); setEditingIndex(i); setView('form'); }} hitSlop={8}>
                                    <Ionicons name="create-outline" size={20} color={theme.colors.textSecondary} />
                                </Pressable>
                                <Pressable onPress={() => handleDelete(i)} hitSlop={8} disabled={saving}>
                                    <Ionicons name="trash-outline" size={20} color={theme.colors.deleteAction} />
                                </Pressable>
                            </View>
                        ))}
                    </ScrollView>
                )}

                {loadState === 'ready' && view === 'form' && (
                    <McpServerForm
                        initial={editing}
                        existingNames={servers.filter((_, i) => i !== editingIndex).map(s => s.name)}
                        saving={saving}
                        onSubmit={handleSubmitForm}
                        onCancel={() => setView('list')}
                    />
                )}
            </View>
        </RNModal>
    );
}
```

(`McpServerForm` is created in Task 8 — this file will not typecheck until then; that is expected.)

- [ ] **Step 2: Commit** (after Task 8 typechecks)

Deferred — committed together with Task 8.

---

## Task 8: `McpServerForm` — add/edit form

**Files:**
- Modify: `packages/happy-app/sources/components/McpServersModal.tsx`

- [ ] **Step 1: Append the `McpServerForm` component** to `McpServersModal.tsx`:

```typescript
import { TextInput } from 'react-native';

const TRANSPORTS: McpServer['transport'][] = ['stdio', 'http', 'sse'];

function toPairs(map?: Record<string, string>): Array<[string, string]> {
    return map ? Object.entries(map) : [];
}
function fromPairs(pairs: Array<[string, string]>): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [k, v] of pairs) if (k.trim()) out[k.trim()] = v;
    return Object.keys(out).length ? out : undefined;
}

function McpServerForm(props: {
    initial: McpServer | null;
    existingNames: string[];
    saving: boolean;
    onSubmit: (s: McpServer) => void;
    onCancel: () => void;
}) {
    const { theme } = useUnistyles();
    const [name, setName] = React.useState(props.initial?.name ?? '');
    const [transport, setTransport] = React.useState<McpServer['transport']>(props.initial?.transport ?? 'stdio');
    const [command, setCommand] = React.useState(props.initial?.command ?? '');
    const [args, setArgs] = React.useState<string[]>(props.initial?.args ?? []);
    const [envPairs, setEnvPairs] = React.useState(toPairs(props.initial?.env));
    const [url, setUrl] = React.useState(props.initial?.url ?? '');
    const [headerPairs, setHeaderPairs] = React.useState(toPairs(props.initial?.headers));

    const nameError = !name.trim()
        ? t('mcpManager.errNameRequired')
        : props.existingNames.includes(name.trim())
            ? t('mcpManager.errNameDuplicate')
            : '';
    const fieldError = transport === 'stdio'
        ? (!command.trim() ? t('mcpManager.errCommandRequired') : '')
        : (!url.trim() ? t('mcpManager.errUrlRequired') : '');
    const canSave = !nameError && !fieldError && !props.saving;

    const submit = () => {
        if (!canSave) return;
        const server: McpServer = {
            name: name.trim(),
            transport,
            extras: props.initial?.extras,
            ...(transport === 'stdio'
                ? { command: command.trim(), args: args.filter(a => a.length > 0), env: fromPairs(envPairs) }
                : { url: url.trim(), headers: fromPairs(headerPairs) }),
        };
        props.onSubmit(server);
    };

    const input = { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 10, color: theme.colors.text } as const;
    const label = { color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 } as const;

    return (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={label}>{t('mcpManager.fieldName')}</Text>
            <TextInput value={name} onChangeText={setName} autoCapitalize="none" style={input} placeholder="my-server" placeholderTextColor={theme.colors.textSecondary} />
            {!!nameError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{nameError}</Text>}

            <Text style={label}>{t('mcpManager.fieldTransport')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                {TRANSPORTS.map(tr => (
                    <Pressable key={tr} onPress={() => setTransport(tr)}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: transport === tr ? theme.colors.radio.active : theme.colors.surfaceHigh }}>
                        <Text style={{ color: transport === tr ? theme.colors.button.primary.tint : theme.colors.text }}>{tr}</Text>
                    </Pressable>
                ))}
            </View>

            {transport === 'stdio' ? (
                <>
                    <Text style={label}>{t('mcpManager.fieldCommand')}</Text>
                    <TextInput value={command} onChangeText={setCommand} autoCapitalize="none" style={input} placeholder="npx" placeholderTextColor={theme.colors.textSecondary} />
                    {!!fieldError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{fieldError}</Text>}
                    <KeyList title={t('mcpManager.fieldArgs')} values={args} onChange={setArgs} />
                    <PairList title={t('mcpManager.fieldEnv')} pairs={envPairs} onChange={setEnvPairs} />
                </>
            ) : (
                <>
                    <Text style={label}>{t('mcpManager.fieldUrl')}</Text>
                    <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" style={input} placeholder="https://example.com/mcp" placeholderTextColor={theme.colors.textSecondary} />
                    {!!fieldError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{fieldError}</Text>}
                    <PairList title={t('mcpManager.fieldHeaders')} pairs={headerPairs} onChange={setHeaderPairs} />
                </>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <Pressable onPress={props.onCancel} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.text }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={submit} disabled={!canSave}
                    style={{ flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', opacity: canSave ? 1 : 0.5, backgroundColor: theme.colors.button.primary.background }}>
                    <Text style={{ color: theme.colors.button.primary.tint }}>{t('common.save')}</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
}

/** Editable list of single string values (args). */
function KeyList(props: { title: string; values: string[]; onChange: (v: string[]) => void }) {
    const { theme } = useUnistyles();
    return (
        <>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 }}>{props.title}</Text>
            {props.values.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <TextInput value={v} autoCapitalize="none"
                        onChangeText={(text) => props.onChange(props.values.map((x, j) => (j === i ? text : x)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <Pressable onPress={() => props.onChange(props.values.filter((_, j) => j !== i))} hitSlop={8}>
                        <Ionicons name="remove-circle-outline" size={22} color={theme.colors.deleteAction} />
                    </Pressable>
                </View>
            ))}
            <Pressable onPress={() => props.onChange([...props.values, ''])}>
                <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.addRow')}</Text>
            </Pressable>
        </>
    );
}

/** Editable list of key/value pairs (env, headers). */
function PairList(props: { title: string; pairs: Array<[string, string]>; onChange: (p: Array<[string, string]>) => void }) {
    const { theme } = useUnistyles();
    return (
        <>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 }}>{props.title}</Text>
            {props.pairs.map(([k, v], i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <TextInput value={k} placeholder="KEY" autoCapitalize="none" placeholderTextColor={theme.colors.textSecondary}
                        onChangeText={(text) => props.onChange(props.pairs.map((p, j) => (j === i ? [text, p[1]] : p)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <TextInput value={v} placeholder="value" autoCapitalize="none" placeholderTextColor={theme.colors.textSecondary}
                        onChangeText={(text) => props.onChange(props.pairs.map((p, j) => (j === i ? [p[0], text] : p)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <Pressable onPress={() => props.onChange(props.pairs.filter((_, j) => j !== i))} hitSlop={8}>
                        <Ionicons name="remove-circle-outline" size={22} color={theme.colors.deleteAction} />
                    </Pressable>
                </View>
            ))}
            <Pressable onPress={() => props.onChange([...props.pairs, ['', '']])}>
                <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.addRow')}</Text>
            </Pressable>
        </>
    );
}
```

- [ ] **Step 2: Verify typecheck**

Run from `packages/happy-app`: `yarn typecheck`
Expected: PASS. If `theme.colors.*` names mismatch, correct them against `sources/theme.ts` (use the nearest existing token — e.g. `surfaceHigh`, `divider`, `deleteAction`, `radio.active`, `button.primary`).

- [ ] **Step 3: Commit**

```bash
git add packages/happy-app/sources/components/McpServersModal.tsx
git commit -m "feat(app): add MCP servers list + form modal"
```

---

## Task 9: Wire `McpServersModal` into `mcp-config.tsx`

**Files:**
- Modify: `packages/happy-app/sources/app/(app)/settings/mcp-config.tsx`

- [ ] **Step 1: Add state + render the modal.** In `MCPConfigScreen`:

Add imports:
```typescript
import { McpServersModal } from '@/components/McpServersModal';
```

Add state near the other `useState`s:
```typescript
const [mcpManagerTarget, setMcpManagerTarget] = React.useState<ConfigTarget | null>(null);
```

Change the group-1 `Item` `onPress` from `() => openFile(target)` to:
```typescript
onPress={() => requireOnline(() => setMcpManagerTarget(target))}
```

Before the closing `</View>`, alongside the existing `FileViewerModal`, render:
```typescript
{machineId && mcpManagerTarget && (
    <McpServersModal
        visible={!!mcpManagerTarget}
        onClose={() => setMcpManagerTarget(null)}
        machineId={machineId}
        target={mcpManagerTarget}
        filePath={`${homeDir}/${mcpManagerTarget.fileName}`}
        onRequestRawEdit={() => {
            const tgt = mcpManagerTarget;
            setMcpManagerTarget(null);
            openFile(tgt);
        }}
    />
)}
```

Keep `openFile` and `browseDir` as-is (group 2 + the fallback).

- [ ] **Step 2: Verify typecheck**

Run from `packages/happy-app`: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "packages/happy-app/sources/app/(app)/settings/mcp-config.tsx"
git commit -m "feat(app): open structured MCP manager from the config screen"
```

---

## Task 10: i18n — `mcpManager.*` strings

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: all 10 of `packages/happy-app/sources/text/translations/{en,ru,pl,es,ca,it,pt,ja,zh-Hans,zh-Hant}.ts`

- [ ] **Step 1: Add the `mcpManager` block** to `_default.ts` (English source), inside the same object level as the existing `mcpConfig` block:

```typescript
mcpManager: {
    title: ({ target }: { target: string }) => `${target} · MCP servers`,
    addTitle: 'Add MCP server',
    editTitle: 'Edit MCP server',
    empty: 'No MCP servers configured.',
    addRow: '+ Add',
    deleteTitle: 'Delete server',
    deleteMessage: ({ name }: { name: string }) => `Delete "${name}"?`,
    saveFailed: 'Failed to save the config file.',
    parseError: 'Could not parse this config file.',
    openRawFile: 'Open the raw file instead',
    fieldName: 'Name',
    fieldTransport: 'Transport',
    fieldCommand: 'Command',
    fieldArgs: 'Arguments',
    fieldEnv: 'Environment variables',
    fieldUrl: 'URL',
    fieldHeaders: 'Headers',
    errNameRequired: 'Name is required.',
    errNameDuplicate: 'A server with this name already exists.',
    errCommandRequired: 'Command is required.',
    errUrlRequired: 'URL is required.',
},
```

- [ ] **Step 2: Add the same block to `zh-Hans.ts`** (Simplified Chinese), inside the matching object level:

```typescript
mcpManager: {
    title: ({ target }: { target: string }) => `${target} · MCP 服务器`,
    addTitle: '添加 MCP 服务器',
    editTitle: '编辑 MCP 服务器',
    empty: '尚未配置 MCP 服务器。',
    addRow: '+ 添加',
    deleteTitle: '删除服务器',
    deleteMessage: ({ name }: { name: string }) => `确定删除“${name}”？`,
    saveFailed: '保存配置文件失败。',
    parseError: '无法解析该配置文件。',
    openRawFile: '改为打开源文件',
    fieldName: '名称',
    fieldTransport: '传输方式',
    fieldCommand: '命令',
    fieldArgs: '参数',
    fieldEnv: '环境变量',
    fieldUrl: 'URL',
    fieldHeaders: '请求头',
    errNameRequired: '名称不能为空。',
    errNameDuplicate: '已存在同名服务器。',
    errCommandRequired: '命令不能为空。',
    errUrlRequired: 'URL 不能为空。',
},
```

- [ ] **Step 3: Add the block to the remaining 9 files** (`zh-Hant`, `ja`, `ru`, `pl`, `es`, `ca`, `it`, `pt`, `en`). Per repo i18n rule, the key set must match `_default.ts` exactly. Use the English values from Step 1 as the fallback for any language without a dedicated translation (the repo already does this for other late-added keys); translate `zh-Hant` and `ja` if straightforward.

- [ ] **Step 4: Verify typecheck**

Run from `packages/happy-app`: `yarn typecheck`
Expected: PASS — all 11 files have an identical `mcpManager` key set.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/text
git commit -m "i18n(app): add MCP manager strings"
```

---

## Task 11: Full verification + CHANGELOG

**Files:**
- Modify: `packages/happy-app/CHANGELOG.md`

- [ ] **Step 1: Run the full focused verification**

Run from `packages/happy-app`:
```bash
npx vitest run sources/utils/mcpConfig.test.ts
yarn typecheck
```
Expected: all tests PASS; typecheck PASS.

- [ ] **Step 2: Add a CHANGELOG entry.** Prepend under `# Changelog` in `packages/happy-app/CHANGELOG.md`:

```markdown
## Version 9 - 2026-05-17

Structured MCP server management.

- MCP management: tapping Claude / Codex / Gemini now opens a structured server list with an add/edit form instead of the raw config file; corrupt files still fall back to raw editing.
```

(If the team prefers no per-commit CHANGELOG, skip this step — confirm with the user.)

- [ ] **Step 3: Commit**

```bash
git add packages/happy-app/CHANGELOG.md
git commit -m "docs(app): changelog for MCP manager"
```

---

## Notes for the executor

- `docs/` is never committed (`.claude/rules/docs.md`) — this plan file and the spec stay local.
- Theme token names (`theme.colors.*`) in Tasks 7-8 are best-effort; if `yarn typecheck` flags one, open `sources/theme.ts` and substitute the nearest existing token. Do not invent tokens.
- The modal is built on React Native's `Modal`; if `FileViewerModal` reveals a project-preferred overlay pattern, matching it is acceptable but not required.
- Per-CLI HTTP/SSE key names (Claude `type`+`url`, Gemini `httpUrl`/`url`, Codex `url`+`http_headers`) are isolated inside `mcpConfig.ts`; a future correction touches only that file.
