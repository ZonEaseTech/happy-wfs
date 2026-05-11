import * as React from 'react';
import { SessionListViewItem, useSessionListViewData, useSharedSessions, useOwnSessionsSharedByMe } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { useAwaitingClosure } from '@/sync/awaitingClosure';

// Returns only active sessions for the main "Active" tab. Sessions the user
// has marked "awaiting closure" are filtered out — they live exclusively in
// the dedicated "待完结" tab so the active list stays focused on actually-
// active work.
export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const closureMarks = useAwaitingClosure(s => s.marks);

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const filtered: SessionListViewItem[] = [];
        let pendingProjectGroup: SessionListViewItem | null = null;
        let inSharedSection = false;
        let pendingSharedHeader: SessionListViewItem | null = null;

        for (const item of data) {
            // Keep shared section, but still filter inactive sessions within it
            if (item.type === 'header' && item.title === 'Shared with me') {
                inSharedSection = true;
                pendingSharedHeader = item;
                continue;
            }
            if (inSharedSection) {
                if (item.type === 'session' && item.session.active && !(item.session.id in closureMarks)) {
                    if (pendingSharedHeader) {
                        filtered.push(pendingSharedHeader);
                        pendingSharedHeader = null;
                    }
                    filtered.push(item);
                }
                continue;
            }

            if (item.type === 'project-group') {
                pendingProjectGroup = item;
                continue;
            }

            if (item.type === 'session') {
                if (item.session.active && !(item.session.id in closureMarks)) {
                    if (pendingProjectGroup) {
                        filtered.push(pendingProjectGroup);
                        pendingProjectGroup = null;
                    }
                    filtered.push(item);
                }
                continue;
            }

            pendingProjectGroup = null;

            if (item.type === 'active-sessions') {
                const remaining = item.sessions.filter(s => !(s.id in closureMarks));
                if (remaining.length > 0) {
                    filtered.push({ ...item, sessions: remaining });
                }
            }
        }

        return filtered;
    }, [data, closureMarks]);
}

// Returns only sessions marked as "awaiting closure", sorted by the time the
// user marked them (most recent first). This is the "待完结" tab — sessions
// the user has verified and is keeping pinned until they explicitly close
// out the work. Pulled from the master list regardless of active/inactive
// state so a closure mark survives the agent going idle.
//
// Note: active sessions are bundled inside a single `type: 'active-sessions'`
// container item (sessions: Session[]), while inactive sessions appear as
// flat `type: 'session'` items. We must walk both shapes — an earlier version
// only looked at `type: 'session'` and silently dropped every marked active
// session, leaving this tab perpetually empty even when marks existed.
export function useClosureSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const marks = useAwaitingClosure(s => s.marks);

    return React.useMemo(() => {
        if (!data) return null;
        const sessions: Session[] = [];
        let inSharedSection = false;
        for (const item of data) {
            if (item.type === 'header' && item.title === 'Shared with me') {
                inSharedSection = true;
                continue;
            }
            if (inSharedSection) continue;
            if (item.type === 'active-sessions') {
                for (const s of item.sessions) {
                    if (s.id in marks) sessions.push(s);
                }
                continue;
            }
            if (item.type === 'session' && item.session.id in marks) {
                sessions.push(item.session);
            }
        }
        if (sessions.length === 0) return [];
        // Sort by marked-at descending so the most recently marked floats
        // to the top of the list. Wrap into a single active-sessions
        // container so SessionsList renderItem dispatches to
        // ActiveSessionsGroupCompact — that gives us the same compact rows
        // + right-click menu (including the "取消待完结" item) as the
        // Active tab. The group's internal sort already keys on
        // awaitingClosureMarks, so order is preserved.
        sessions.sort((a, b) => (marks[b.id] ?? 0) - (marks[a.id] ?? 0));
        return [{ type: 'active-sessions', sessions }];
    }, [data, marks]);
}

// Returns only inactive sessions for the "Inactive" tab, grouped by date
export function useInactiveSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();

    return React.useMemo(() => {
        if (!data) {
            return null;
        }

        // Collect all inactive sessions from the main list (excluding shared section)
        const inactiveSessions: Session[] = [];
        let inSharedSection = false;

        for (const item of data) {
            if (item.type === 'header' && item.title === 'Shared with me') {
                inSharedSection = true;
                continue;
            }
            if (inSharedSection) {
                continue;
            }
            if (item.type === 'session' && !item.session.active) {
                inactiveSessions.push(item.session);
            }
        }

        if (inactiveSessions.length === 0) {
            return [];
        }

        inactiveSessions.sort((a, b) => b.updatedAt - a.updatedAt);

        return groupSessionsByDate(inactiveSessions);
    }, [data]);
}

// Groups sessions by date with headers (Today, Yesterday, X days ago)
function groupSessionsByDate(sessions: Session[]): SessionListViewItem[] {
    const listData: SessionListViewItem[] = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    let currentDateGroup: Session[] = [];
    let currentDateString: string | null = null;

    const flushGroup = () => {
        if (currentDateGroup.length === 0 || !currentDateString) return;

        const groupDate = new Date(currentDateString);
        const sessionDateOnly = new Date(groupDate.getFullYear(), groupDate.getMonth(), groupDate.getDate());

        let headerTitle: string;
        if (sessionDateOnly.getTime() === today.getTime()) {
            headerTitle = 'Today';
        } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
            headerTitle = 'Yesterday';
        } else {
            const diffTime = today.getTime() - sessionDateOnly.getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            headerTitle = `${diffDays} days ago`;
        }

        listData.push({ type: 'header', title: headerTitle });
        for (const sess of currentDateGroup) {
            listData.push({ type: 'session', session: sess });
        }
    };

    for (const session of sessions) {
        const sessionDate = new Date(session.updatedAt);
        const dateString = sessionDate.toDateString();

        if (currentDateString !== dateString) {
            flushGroup();
            currentDateString = dateString;
            currentDateGroup = [session];
        } else {
            currentDateGroup.push(session);
        }
    }
    flushGroup();

    return listData;
}

export function useSharedSessionListViewData(): SessionListViewItem[] | null {
    const sessions = useSharedSessions();
    const isReady = useSessionListViewData() !== null;

    return React.useMemo(() => {
        if (!isReady) {
            return null;
        }

        if (sessions.length === 0) {
            return [];
        }

        const activeSessions: Session[] = [];
        const inactiveSessions: Session[] = [];

        for (const session of sessions) {
            if (session.active) {
                activeSessions.push(session);
            } else {
                inactiveSessions.push(session);
            }
        }

        activeSessions.sort((a, b) => b.updatedAt - a.updatedAt);
        inactiveSessions.sort((a, b) => b.updatedAt - a.updatedAt);

        const listData: SessionListViewItem[] = [];

        if (activeSessions.length > 0) {
            listData.push({ type: 'active-sessions', sessions: activeSessions });
        }

        listData.push(...groupSessionsByDate(inactiveSessions));

        return listData;
    }, [sessions, isReady]);
}

// Returns list view data for sessions the current user has shared with others (isShared === true)
export function useSharedByMeSessionListViewData(): SessionListViewItem[] | null {
    const sharedByMe = useOwnSessionsSharedByMe();
    const isReady = useSessionListViewData() !== null;

    return React.useMemo(() => {
        if (!isReady) {
            return null;
        }

        if (sharedByMe.length === 0) {
            return [];
        }

        const activeSessions: Session[] = [];
        const inactiveSessions: Session[] = [];

        for (const session of sharedByMe) {
            if (session.active) {
                activeSessions.push(session);
            } else {
                inactiveSessions.push(session);
            }
        }

        activeSessions.sort((a, b) => b.updatedAt - a.updatedAt);
        inactiveSessions.sort((a, b) => b.updatedAt - a.updatedAt);

        const listData: SessionListViewItem[] = [];

        if (activeSessions.length > 0) {
            listData.push({ type: 'active-sessions', sessions: activeSessions });
        }

        listData.push(...groupSessionsByDate(inactiveSessions));

        return listData;
    }, [sharedByMe, isReady]);
}
