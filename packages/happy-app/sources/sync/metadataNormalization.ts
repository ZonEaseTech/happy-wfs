import { MetadataSchema, type Metadata } from './storageTypes';

// Every write rebuilds metadata from this list, so a field missing here is
// wiped by the next unrelated write from this app (marking a session viewed,
// a rename, ...). New MetadataSchema fields must be added — the test checks.
export const SESSION_METADATA_WRITE_KEYS = [
    'path',
    'host',
    'version',
    'name',
    'os',
    'model',
    'reasoningEffort',
    'models',
    'currentModelCode',
    'operatingModes',
    'currentOperatingModeCode',
    'thoughtLevels',
    'currentThoughtLevelCode',
    'summary',
    'summaryPinned',
    'awaitingClosure',
    'reviewPending',
    'sidebarOrder',
    'autoReviewGuard',
    'machineId',
    'claudeSessionId',
    'codexSessionId',
    'cursorSessionId',
    'tools',
    'slashCommands',
    'skills',
    'homeDir',
    'happyHomeDir',
    'hostPid',
    'flavor',
    'isWorktree',
    'worktreeBasePath',
    'worktreeBranchName',
    'worktreePrUrl',
    'reviewOfSessionId',
    'workspaceRepos',
    'workspacePath',
    'injectedMemoryIds',
    'externalContext',
    'sessionIcon',
    'completionDismissedAt',
    'goalPins',
    'targetDevice',
    'targetDevices',
] as const;

export function normalizeSessionMetadataForWrite(metadata: Metadata): Metadata {
    const seen = new WeakSet<object>();
    const toPlain = (value: unknown, depth = 0): unknown => {
        if (typeof value === 'function') return undefined;
        if (depth > 8) return undefined;
        if (value && typeof value === 'object') {
            try {
                if (seen.has(value)) return undefined;
                seen.add(value);
            } catch {
                return undefined;
            }
            if (Array.isArray(value)) {
                const plainArray: unknown[] = [];
                for (let index = 0; index < value.length; index++) {
                    try {
                        plainArray.push(toPlain(value[index], depth + 1));
                    } catch {
                        plainArray.push(undefined);
                    }
                }
                return plainArray;
            }
            const plainObject: Record<string, unknown> = {};
            let keys: string[];
            try {
                keys = Object.keys(value);
            } catch {
                return undefined;
            }
            for (const key of keys) {
                let rawChild: unknown;
                try {
                    rawChild = (value as Record<string, unknown>)[key];
                } catch {
                    continue;
                }
                const child = toPlain(rawChild, depth + 1);
                if (child !== undefined) {
                    plainObject[key] = child;
                }
            }
            return plainObject;
        }
        return value;
    };

    // Avoid walking arbitrary observable/proxy keys. Some session row objects
    // expose circular bookkeeping via enumerable properties; schema parsing
    // would strip those keys anyway, but traversing them first can overflow.
    const source = metadata as Record<string, unknown>;
    const plain: Record<string, unknown> = {};
    for (const key of SESSION_METADATA_WRITE_KEYS) {
        let rawChild: unknown;
        try {
            rawChild = source[key];
        } catch {
            continue;
        }
        const child = toPlain(rawChild);
        if (child !== undefined) {
            plain[key] = child;
        }
    }
    return MetadataSchema.parse(plain);
}
