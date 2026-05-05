# impl-monaco

## Dependency
- Added `@monaco-editor/react@^4.6.0` to `packages/happy-app/package.json` dependencies (resolved to `4.7.0`).
- Did NOT add `monaco-editor` directly — `@monaco-editor/react` ships its CDN-loader fallback (peer-dep warning is expected and intentional).

## Install result
- Command run: `yarn install --ignore-scripts` at monorepo root (`/workspace/workspace/wt-impl-monaco`).
- Note: monorepo uses **yarn 1.22.22**, not pnpm — task brief said pnpm but `package.json` / `yarn.lock` make yarn the actual package manager.
- Result: ✅ success (`Done in 475.49s.`, lockfile saved).
- Peer warnings (informational, not blocking):
  - `@monaco-editor/react@4.7.0` has unmet peer `monaco-editor>=0.25.0 <1` — expected; CDN loader covers it at runtime.

## MonacoEditor.web.tsx props signature
```ts
interface MonacoEditorProps {
  value: string;
  onChange?: (v: string) => void;
  path: string;
  readOnly?: boolean;
  theme?: 'vs-dark' | 'vs';   // default 'vs-dark'
  height?: number | string;   // default '100%'
}
```

Behavior:
- `React.lazy(() => import('@monaco-editor/react'))` to keep Monaco out of the initial bundle.
- Wrapped in `React.Suspense` with `fallback={<div>Loading editor…</div>}`.
- `readOnly` defaults to `!onChange` (i.e. omitting `onChange` makes it read-only).
- Monaco language is computed via `inferLanguage(path)` and passed to the editor.
- Editor options: `minimap.enabled=false`, `automaticLayout=true`, `scrollBeyondLastLine=false`, `wordWrap='on'`, `fontSize=13`.
- `inferLanguage` is exported as a named export.

## Native fallback (`MonacoEditor.tsx`)
- Renders read-only `<ScrollView><Text selectable>{value}</Text></ScrollView>`.
- Same `MonacoEditorProps` type; ignores `onChange` / `theme`.
- Metro auto-resolves `MonacoEditor.web.tsx` on web and `MonacoEditor.tsx` on native — no extra config.

## inferLanguage extension coverage

| Extension(s) / basename | Monaco language |
|---|---|
| `ts`, `tsx`, `cts`, `mts` | `typescript` |
| `js`, `jsx`, `cjs`, `mjs` | `javascript` |
| `json`, `jsonc` | `json` |
| `py` | `python` |
| `go` | `go` |
| `rs` | `rust` |
| `java` | `java` |
| `kt`, `kts` | `kotlin` |
| `swift` | `swift` |
| `c`, `h` | `c` |
| `cpp`, `cc`, `cxx`, `hpp` | `cpp` |
| `cs` | `csharp` |
| `php` | `php` |
| `rb` | `ruby` |
| `sh`, `bash`, `zsh` | `shell` |
| `yml`, `yaml` | `yaml` |
| `toml` | `toml` |
| `xml`, `svg` | `xml` |
| `html`, `htm` | `html` |
| `css`, `scss`, `sass`, `less` | `css` |
| `md`, `mdx` | `markdown` |
| `sql` | `sql` |
| `graphql`, `gql` | `graphql` |
| basename `Dockerfile` (any case) / `Dockerfile.*` | `dockerfile` |
| basename `Makefile` / `makefile` / `GNUmakefile` | `makefile` |
| basename `.env` / `.env.*` | `shell` |
| anything else | `plaintext` |

## Verify
- `npx tsc --noEmit` in `packages/happy-app`: no errors attributable to `MonacoEditor.tsx` or `MonacoEditor.web.tsx`. Pre-existing errors in unrelated files (`happy-wire` module not built yet, missing i18n keys) are present but out of scope for this task.

## Files changed
- `packages/happy-app/package.json` — added `@monaco-editor/react` dep
- `packages/happy-app/sources/components/MonacoEditor.web.tsx` — new
- `packages/happy-app/sources/components/MonacoEditor.tsx` — new
- `yarn.lock` — updated by yarn install
