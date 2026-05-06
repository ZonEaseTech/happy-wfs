// Native fallback. The bt-style file viewer is web/PC only — on mobile the
// existing /session/[id]/file route is used instead.

export interface FileViewerModalProps {
    visible: boolean;
    onClose: () => void;
    sessionId?: string;
    machineId?: string;
    initialFilePath?: string;
    initialCwd?: string;
    /** Git-tracked-state hint from the caller. Web modal opens diff mode by default when set. */
    initialFromGit?: 'unstaged' | 'staged';
}

export function FileViewerModal(_props: FileViewerModalProps): null {
    return null;
}
