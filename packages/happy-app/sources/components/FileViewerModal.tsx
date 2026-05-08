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
    /**
     * When provided, the left tree renders ONLY these absolute paths (as a
     * static tree built from the list) instead of calling listDirectory.
     * Used by the git-status entry point so the tree shows just changed files.
     * Native ignores it (the modal is web-only).
     */
    restrictPaths?: string[];
    /** Optional per-file +/− chips (web only). */
    restrictPathStats?: Record<string, { added: number; removed: number }>;
}

export function FileViewerModal(_props: FileViewerModalProps): null {
    return null;
}
