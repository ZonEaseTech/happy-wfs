// Native fallback. Diff-mode in the file viewer is web/PC only.

export interface MonacoDiffEditorProps {
    original: string;
    modified: string;
    path: string;
    theme?: 'vs-dark' | 'vs';
    height?: number | string;
    fontSize?: number;
}

export function MonacoDiffEditor(_props: MonacoDiffEditorProps): null {
    return null;
}

export default MonacoDiffEditor;
