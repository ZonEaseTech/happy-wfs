import * as React from 'react';
import { Platform } from 'react-native';
import type { LocalImage } from '@/components/ImagePreview';
import {
    BugShareExpiredError,
    addPublicBugComment,
    changePublicBugStatus,
    createPublicBug,
    getPublicBug,
    listPublicBugs,
    loginBugShare,
    uploadPublicBugAttachment,
} from '@/sync/apiBugs';
import type { BugReportDetail, BugReportSummary, BugStatus } from '@/sync/bugTypes';
import { t } from '@/text';

const STORAGE_KEY = 'happy.bugShareSession.v1';

type BugShareSession = {
    token: string;
    nickname: string;
};

function readStoredSession(): BugShareSession | null {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<BugShareSession>;
        if (typeof parsed.token === 'string' && typeof parsed.nickname === 'string') {
            return { token: parsed.token, nickname: parsed.nickname };
        }
    } catch {
        // Ignore invalid localStorage data.
    }
    return null;
}

function writeStoredSession(session: BugShareSession | null) {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
        if (!session) {
            window.localStorage?.removeItem(STORAGE_KEY);
        } else {
            window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
        }
    } catch {
        // Persistence is best-effort only.
    }
}

function toSummary(bug: BugReportDetail): BugReportSummary {
    return {
        id: bug.id,
        displayNumber: bug.displayNumber,
        displayId: bug.displayId,
        title: bug.title,
        description: bug.description,
        status: bug.status,
        visibility: bug.visibility,
        createdByNickname: bug.createdByNickname,
        attachmentCount: bug.attachmentCount,
        commentCount: bug.commentCount,
        lastActivityAt: bug.lastActivityAt,
        createdAt: bug.createdAt,
        updatedAt: bug.updatedAt,
    };
}

export function useBugShareBoard() {
    const [session, setSession] = React.useState<BugShareSession | null>(() => readStoredSession());
    const [bugs, setBugs] = React.useState<BugReportSummary[]>([]);
    const [pendingCount, setPendingCount] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const logout = React.useCallback((message?: string) => {
        setSession(null);
        writeStoredSession(null);
        setBugs([]);
        setPendingCount(0);
        if (message) setError(message);
    }, []);

    const handleError = React.useCallback((errorValue: unknown) => {
        if (errorValue instanceof BugShareExpiredError) {
            logout(t('bug.shareExpired'));
            return;
        }
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }, [logout]);

    const updateBugInList = React.useCallback((bug: BugReportDetail | BugReportSummary) => {
        const summary = 'comments' in bug ? toSummary(bug) : bug;
        setBugs((current) => {
            const without = current.filter((item) => item.id !== summary.id);
            const next = [summary, ...without].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
            setPendingCount(next.filter((item) => item.status === 'pending').length);
            return next;
        });
    }, []);

    const login = React.useCallback(async (accessCode: string, nickname: string) => {
        setLoading(true);
        setError(null);
        try {
            const next = await loginBugShare(accessCode, nickname);
            const nextSession = { token: next.token, nickname: next.nickname };
            setSession(nextSession);
            writeStoredSession(nextSession);
        } catch (errorValue) {
            handleError(errorValue);
            throw errorValue;
        } finally {
            setLoading(false);
        }
    }, [handleError]);

    const refresh = React.useCallback(async (query?: string) => {
        if (!session?.token) return;
        setLoading(true);
        setError(null);
        try {
            const result = await listPublicBugs(session.token, { query, limit: 100 });
            setBugs(result.bugs);
            setPendingCount(result.pendingCount);
        } catch (errorValue) {
            handleError(errorValue);
        } finally {
            setLoading(false);
        }
    }, [handleError, session?.token]);

    React.useEffect(() => {
        if (!session?.token) return;
        void refresh();
    }, [refresh, session?.token]);

    const requireToken = React.useCallback(() => {
        if (!session?.token) throw new Error(t('bug.shareExpired'));
        return session.token;
    }, [session?.token]);

    const getBug = React.useCallback(async (bugId: string): Promise<BugReportDetail> => {
        const token = requireToken();
        try {
            return await getPublicBug(token, bugId);
        } catch (errorValue) {
            handleError(errorValue);
            throw errorValue;
        }
    }, [handleError, requireToken]);

    const uploadImages = React.useCallback(async (bugId: string, images: LocalImage[], commentId?: string): Promise<BugReportDetail> => {
        const token = requireToken();
        let updated: BugReportDetail | null = null;
        for (const image of images) {
            updated = await uploadPublicBugAttachment(token, bugId, image, commentId);
        }
        if (!updated) updated = await getPublicBug(token, bugId);
        updateBugInList(updated);
        return updated;
    }, [requireToken, updateBugInList]);

    const createBugWithImages = React.useCallback(async (description: string, images: LocalImage[]): Promise<BugReportDetail> => {
        const token = requireToken();
        try {
            let bug = await createPublicBug(token, { description });
            updateBugInList(bug);
            if (images.length > 0) {
                bug = await uploadImages(bug.id, images);
            }
            return bug;
        } catch (errorValue) {
            handleError(errorValue);
            throw errorValue;
        }
    }, [handleError, requireToken, updateBugInList, uploadImages]);

    const addCommentWithImages = React.useCallback(async (bugId: string, body: string, images: LocalImage[]): Promise<BugReportDetail> => {
        const token = requireToken();
        try {
            const result = await addPublicBugComment(token, bugId, body);
            let bug = result.bug;
            if (images.length > 0) {
                bug = await uploadImages(bugId, images, result.commentId);
            }
            updateBugInList(bug);
            return bug;
        } catch (errorValue) {
            handleError(errorValue);
            throw errorValue;
        }
    }, [handleError, requireToken, updateBugInList, uploadImages]);

    const changeStatus = React.useCallback(async (bugId: string, status: BugStatus, action?: 'return_to_pending'): Promise<BugReportDetail> => {
        const token = requireToken();
        try {
            const bug = await changePublicBugStatus(token, bugId, { status, action });
            updateBugInList(bug);
            return bug;
        } catch (errorValue) {
            handleError(errorValue);
            throw errorValue;
        }
    }, [handleError, requireToken, updateBugInList]);

    return {
        isLoggedIn: !!session?.token,
        nickname: session?.nickname ?? '',
        bugs,
        pendingCount,
        loading,
        error,
        login,
        logout,
        refresh,
        getBug,
        createBugWithImages,
        addCommentWithImages,
        uploadImages,
        changeStatus,
    };
}
