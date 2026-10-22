/**
 * Pick up the sessions a previous daemon left behind.
 *
 * The daemon only knows its children in memory. After it restarts (upgrade,
 * crash, container rebuild) the server still lists sessions as active on
 * this machine, but nobody here tracks them, and the ones whose process
 * died stay in the app as online until the server's sweep gives up on them.
 *
 * On start we ask the server for the sessions it considers active on this
 * machine. A session whose process is still running is tracked again, so
 * `happy daemon list` and stop-session work. A session whose process is gone
 * is resumed the same way the app's resume button does it: fork the agent's
 * own transcript, spawn a new happy session from the copy, and mark the old
 * one inactive so a later restart does not resume it twice.
 */

import { logger } from '@/ui/logger';
import type { Metadata } from '@/api/types';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

export interface ServerSessionSnapshot {
    id: string;
    active: boolean;
    activeAt: number;
    /** Decrypted metadata; null when this machine cannot read the row */
    metadata: Record<string, any> | null;
}

export type ResumeAgent = 'claude' | 'codex' | 'gemini' | 'cursor';

export interface SessionToResume {
    id: string;
    agent: ResumeAgent;
    directory: string;
    /** What the agent's fork needs: its own session id, or the happy id for gemini */
    forkSource: string;
    title?: string;
    metadata: Record<string, any>;
}

export interface SessionToTrack {
    id: string;
    pid: number;
    metadata: Record<string, any>;
}

export interface AdoptionPlan {
    track: SessionToTrack[];
    resume: SessionToResume[];
    /** Active on this machine, process gone, but nothing to resume from */
    skipped: Array<{ id: string; reason: string }>;
}

function pickAgent(metadata: Record<string, any>): ResumeAgent {
    switch (metadata.flavor) {
        case 'codex':
        case 'gemini':
        case 'cursor':
            return metadata.flavor;
        default:
            return 'claude';
    }
}

/** Same source the app's resume uses for each agent (useResumeSession). */
function pickForkSource(id: string, agent: ResumeAgent, metadata: Record<string, any>): string | null {
    switch (agent) {
        case 'claude': return typeof metadata.claudeSessionId === 'string' ? metadata.claudeSessionId : null;
        case 'codex': return typeof metadata.codexSessionId === 'string' ? metadata.codexSessionId : null;
        case 'cursor': return typeof metadata.cursorSessionId === 'string' ? metadata.cursorSessionId : null;
        case 'gemini': return id;
    }
}

export function planSessionAdoption(opts: {
    sessions: ServerSessionSnapshot[];
    alivePids: Set<number>;
    machineId: string;
}): AdoptionPlan {
    const plan: AdoptionPlan = { track: [], resume: [], skipped: [] };

    const mine = opts.sessions
        .filter((s) => s.active && s.metadata && s.metadata.machineId === opts.machineId)
        .sort((a, b) => b.activeAt - a.activeAt);

    for (const session of mine) {
        const metadata = session.metadata!;
        const pid = typeof metadata.hostPid === 'number' ? metadata.hostPid : null;

        if (pid !== null && opts.alivePids.has(pid)) {
            plan.track.push({ id: session.id, pid, metadata });
            continue;
        }

        const directory = typeof metadata.path === 'string' ? metadata.path : null;
        if (!directory) {
            plan.skipped.push({ id: session.id, reason: 'no path in metadata' });
            continue;
        }
        const agent = pickAgent(metadata);
        const forkSource = pickForkSource(session.id, agent, metadata);
        if (!forkSource) {
            plan.skipped.push({ id: session.id, reason: `no ${agent} session id to resume from` });
            continue;
        }
        plan.resume.push({
            id: session.id,
            agent,
            directory,
            forkSource,
            title: typeof metadata.summary?.text === 'string' ? metadata.summary.text
                : typeof metadata.name === 'string' ? metadata.name : undefined,
            metadata,
        });
    }

    return plan;
}

export interface ForkOutcome {
    success: boolean;
    /** Whatever the spawned CLI's --resume expects for this agent */
    resumeSessionId?: string;
    errorMessage?: string;
}

export interface SessionAdoptionDeps {
    machineId: string;
    listActiveSessions: () => Promise<ServerSessionSnapshot[]>;
    /** PIDs of happy session processes running on this machine right now */
    listAliveSessionPids: () => Promise<Set<number>>;
    fork: (agent: ResumeAgent, source: string) => Promise<ForkOutcome>;
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
    archiveSession: (sessionId: string) => Promise<boolean>;
    track: (session: SessionToTrack) => void;
}

export interface SessionAdoptionReport {
    tracked: number;
    resumed: Array<{ from: string; to: string }>;
    failed: Array<{ id: string; reason: string }>;
    skipped: Array<{ id: string; reason: string }>;
}

export async function adoptSessionsFromPreviousRun(deps: SessionAdoptionDeps): Promise<SessionAdoptionReport> {
    const report: SessionAdoptionReport = { tracked: 0, resumed: [], failed: [], skipped: [] };

    const [sessions, alivePids] = await Promise.all([deps.listActiveSessions(), deps.listAliveSessionPids()]);
    const plan = planSessionAdoption({ sessions, alivePids, machineId: deps.machineId });
    report.skipped = plan.skipped;

    for (const session of plan.track) {
        deps.track(session);
        report.tracked++;
    }

    // One at a time: each resume starts an agent process, and the machine may
    // be coming back from exactly the kind of overload that killed them.
    for (const session of plan.resume) {
        try {
            const forked = await deps.fork(session.agent, session.forkSource);
            if (!forked.success || !forked.resumeSessionId) {
                report.failed.push({ id: session.id, reason: forked.errorMessage || `${session.agent} fork failed` });
                continue;
            }
            const spawned = await deps.spawnSession({
                machineId: deps.machineId,
                directory: session.directory,
                agent: session.agent,
                resumeSessionId: forked.resumeSessionId,
                intent: 'resume',
                sessionTitle: session.title,
                skipForkSession: true,
                approvedNewDirectoryCreation: false,
            });
            if (spawned.type !== 'success') {
                report.failed.push({
                    id: session.id,
                    reason: spawned.type === 'error' ? spawned.errorMessage : `directory missing: ${spawned.directory}`,
                });
                continue;
            }
            // The old process is gone and will never send session-end; without
            // this the next restart would resume the same session again.
            if (!await deps.archiveSession(session.id)) {
                logger.warn(`[DAEMON ADOPT] Resumed ${session.id} as ${spawned.sessionId} but could not mark the old session inactive`);
            }
            report.resumed.push({ from: session.id, to: spawned.sessionId });
        } catch (error) {
            report.failed.push({ id: session.id, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    return report;
}
