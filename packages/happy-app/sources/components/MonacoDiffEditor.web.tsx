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
    return (
        <React.Suspense fallback={<div style={{ padding: 12, fontFamily: 'monospace' }}>Loading diff…</div>}>
            <LazyDiff
                original={original}
                modified={modified}
                language={language}
                theme={theme}
                height={height}
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
