// Native fallback. The bt-style file viewer is web/PC only — on mobile the
// existing /session/[id]/file route is used instead.

export interface FileViewerModalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    initialFilePath?: string;
    initialCwd?: string;
}

export function FileViewerModal(_props: FileViewerModalProps): null {
    return null;
}
