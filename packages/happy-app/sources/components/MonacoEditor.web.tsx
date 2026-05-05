import * as React from 'react';

const LazyMonaco = React.lazy(() => import('@monaco-editor/react'));

export interface MonacoEditorProps {
    value: string;
    onChange?: (v: string) => void;
    path: string;
    readOnly?: boolean;
    theme?: 'vs-dark' | 'vs';
    height?: number | string;
    /**
     * Called once monaco's editor instance is mounted. Used by the IDE
     * toolbar to drive built-in actions (find, replace, gotoLine).
     * Typed as `unknown` to avoid pulling monaco's type defs into RN's
     * type-check graph; callers cast to `monaco.editor.IStandaloneCodeEditor`.
     */
    onMount?: (editor: unknown) => void;
    /** Editor font size in px. Default 14. */
    fontSize?: number;
}

const EXT_LANG: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    cts: 'typescript',
    mts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    cjs: 'javascript',
    mjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    sass: 'css',
    less: 'css',
    md: 'markdown',
    mdx: 'markdown',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
};

export function inferLanguage(path: string): string {
    const basename = path.split(/[\\/]/).pop() ?? path;
    if (basename === 'Dockerfile' || /^Dockerfile(\..+)?$/.test(basename) || basename.toLowerCase() === 'dockerfile') {
        return 'dockerfile';
    }
    if (basename === 'Makefile' || basename === 'makefile' || basename === 'GNUmakefile') {
        return 'makefile';
    }
    if (basename === '.env' || /^\.env(\..+)?$/.test(basename)) {
        return 'shell';
    }
    const dotIdx = basename.lastIndexOf('.');
    if (dotIdx <= 0 || dotIdx === basename.length - 1) {
        return 'plaintext';
    }
    const ext = basename.slice(dotIdx + 1).toLowerCase();
    return EXT_LANG[ext] ?? 'plaintext';
}

export function MonacoEditor({
    value,
    onChange,
    path,
    readOnly,
    theme = 'vs-dark',
    height = '100%',
    onMount,
    fontSize = 14,
}: MonacoEditorProps) {
    const language = React.useMemo(() => inferLanguage(path), [path]);
    const effectiveReadOnly = readOnly ?? !onChange;
    const handleChange = React.useCallback(
        (next: string | undefined) => {
            if (onChange) onChange(next ?? '');
        },
        [onChange],
    );
    const handleMount = React.useCallback(
        (editor: unknown) => {
            if (onMount) onMount(editor);
        },
        [onMount],
    );
    return (
        <React.Suspense fallback={<div style={{ padding: 12, fontFamily: 'monospace' }}>Loading editor…</div>}>
            <LazyMonaco
                value={value}
                onChange={handleChange}
                onMount={handleMount}
                path={path}
                language={language}
                theme={theme}
                height={height}
                options={{
                    readOnly: effectiveReadOnly,
                    minimap: { enabled: false },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    fontSize,
                    wordWrap: 'on',
                }}
            />
        </React.Suspense>
    );
}

export default MonacoEditor;
