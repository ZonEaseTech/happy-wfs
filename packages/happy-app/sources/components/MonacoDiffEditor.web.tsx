import * as React from 'react';
import { inferLanguage } from '@/components/MonacoEditor';

const LazyDiff = React.lazy(async () => {
    const mod = await import('@monaco-editor/react');
    return { default: mod.DiffEditor };
});

export interface MonacoDiffEditorProps {
    original: string;
    modified: string;
    path: string;
    theme?: 'vs-dark' | 'vs';
    height?: number | string;
    fontSize?: number;
}

export function MonacoDiffEditor({
    original,
    modified,
    path,
    theme = 'vs-dark',
    height = '100%',
    fontSize = 14,
}: MonacoDiffEditorProps) {
    const language = React.useMemo(() => inferLanguage(path), [path]);
    // When the file (path) changes, request a fresh "scroll to first diff"
    // on the next onDidUpdateDiff. Keeps mid-edit scroll from getting yanked
    // back: only the first diff computation per file performs the reveal.
    const needsRevealRef = React.useRef(true);
    React.useEffect(() => { needsRevealRef.current = true; }, [path]);

    const handleMount = React.useCallback((editor: any) => {
        if (!editor || typeof editor.onDidUpdateDiff !== 'function') return;
        editor.onDidUpdateDiff(() => {
            if (!needsRevealRef.current) return;
            const changes = editor.getLineChanges?.();
            if (!changes || changes.length === 0) return;
            const first = changes[0];
            const line = first?.modifiedStartLineNumber || first?.originalStartLineNumber || 1;
            const modifiedEditor = editor.getModifiedEditor?.();
            // reveal "near top" leaves a few lines of context above the hunk.
            modifiedEditor?.revealLineNearTop?.(line, 0);
            needsRevealRef.current = false;
        });
    }, []);

    return (
        <React.Suspense fallback={<div style={{ padding: 12, fontFamily: 'monospace' }}>Loading diff…</div>}>
            <LazyDiff
                original={original}
                modified={modified}
                language={language}
                theme={theme}
                height={height}
                onMount={handleMount}
                options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    renderSideBySide: true,
                    fontSize,
                    wordWrap: 'on',
                }}
            />
        </React.Suspense>
    );
}

export default MonacoDiffEditor;
