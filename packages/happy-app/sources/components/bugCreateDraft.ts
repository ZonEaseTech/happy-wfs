import type { BugTiptapDoc, BugTiptapNode } from '@/sync/bugRichContent';

const STORAGE_KEY = 'happy.bugCreateDraft.v1';

// localStorage only exists on web; native has no draft persistence.
function draftStorage(): Storage | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
}

/**
 * Draft persisted when the create-bug modal is closed mid-typing (web only).
 * Image nodes are dropped: their blob object URLs do not survive a reload,
 * so only the text survives into the restored draft.
 */
export function buildBugCreateDraftDoc(
    contentJson: BugTiptapDoc | null | undefined,
    plainText: string,
): BugTiptapDoc | null {
    if (!plainText.trim() || !contentJson?.content?.length) return null;
    const content = contentJson.content.filter((node: BugTiptapNode) => node.type !== 'image');
    if (content.length === 0) return null;
    return { type: 'doc', content };
}

export function readBugCreateDraft(): BugTiptapDoc | null {
    const storage = draftStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<BugTiptapDoc>;
        if (parsed?.type === 'doc' && Array.isArray(parsed.content) && parsed.content.length > 0) {
            return parsed as BugTiptapDoc;
        }
    } catch {
        // Ignore invalid localStorage data.
    }
    return null;
}

export function writeBugCreateDraft(doc: BugTiptapDoc | null) {
    const storage = draftStorage();
    if (!storage) return;
    try {
        if (!doc) {
            storage.removeItem(STORAGE_KEY);
        } else {
            storage.setItem(STORAGE_KEY, JSON.stringify(doc));
        }
    } catch {
        // Persistence is best-effort only.
    }
}
