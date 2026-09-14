import { MMKV } from 'react-native-mmkv';
import { Platform } from 'react-native';
import { Settings, settingsDefaults, settingsParse, SettingsSchema } from './settings';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { Profile, profileDefaults, profileParse } from './profile';
import type { PermissionMode } from '@/components/PermissionModeSelector';
import type { SessionDraft } from './storageTypes';

const mmkv = new MMKV();
const NEW_SESSION_DRAFT_KEY = 'new-session-draft-v1';

/**
 * On web mmkv is backed by localStorage, which throws once the origin's ~5MB
 * quota is full instead of evicting anything. Every write therefore has to be
 * treated as fallible: an unguarded `mmkv.set` surfaced to the user as a
 * "Failed to execute 'setItem' on 'Storage'" error dialog, and on the settings
 * path it also aborted the sync that was supposed to follow.
 *
 * The message cache is by far the biggest consumer and the only thing worth
 * sacrificing, so a failed write drops cached sessions (least recently used
 * first) and retries. Returns false when the value still would not fit, which
 * lets callers carry on with in-memory state instead of throwing.
 */
function setPersisted(key: string, value: string): boolean {
    for (;;) {
        try {
            mmkv.set(key, value);
            return true;
        } catch {
            if (!evictOldestSessionMessagesCache()) return false;
        }
    }
}

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini' | 'cursor';
export type NewSessionSessionType = 'simple' | 'worktree';

export interface NewSessionDraft {
    input: string;
    selectedMachineId: string | null;
    selectedPath: string | null;
    agentType: NewSessionAgentType;
    permissionMode: PermissionMode;
    sessionType: NewSessionSessionType;
    images?: Array<{ uri: string; width: number; height: number; mimeType: string }>;
    updatedAt: number;
}

export function loadSettings(): { settings: Settings, version: number | null } {
    const settings = mmkv.getString('settings');
    if (settings) {
        try {
            const parsed = JSON.parse(settings);
            return { settings: settingsParse(parsed.settings), version: parsed.version };
        } catch (e) {
            console.error('Failed to parse settings', e);
            return { settings: { ...settingsDefaults }, version: null };
        }
    }
    return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number) {
    setPersisted('settings', JSON.stringify({ settings, version }));
}

export function loadPendingSettings(): Partial<Settings> {
    const pending = mmkv.getString('pending-settings');
    if (pending) {
        try {
            const parsed = JSON.parse(pending);
            return SettingsSchema.partial().parse(parsed);
        } catch (e) {
            console.error('Failed to parse pending settings', e);
            return {};
        }
    }
    return {};
}

export function savePendingSettings(settings: Partial<Settings>) {
    setPersisted('pending-settings', JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            return localSettingsParse(parsed);
        } catch (e) {
            console.error('Failed to parse local settings', e);
            return { ...localSettingsDefaults };
        }
    }
    return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings) {
    setPersisted('local-settings', JSON.stringify(settings));
}

export function loadThemePreference(): 'light' | 'dark' | 'adaptive' {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            const settings = localSettingsParse(parsed);
            return settings.themePreference;
        } catch (e) {
            console.error('Failed to parse local settings for theme preference', e);
            return localSettingsDefaults.themePreference;
        }
    }
    return localSettingsDefaults.themePreference;
}

export function loadSessionDrafts(): Record<string, SessionDraft> {
    const drafts = mmkv.getString('session-drafts');
    if (drafts) {
        try {
            const raw = JSON.parse(drafts);
            const result: Record<string, SessionDraft> = {};
            for (const [key, value] of Object.entries(raw)) {
                if (typeof value === 'string') {
                    result[key] = { text: value, images: [] };
                } else if (value && typeof value === 'object' && 'text' in (value as any)) {
                    result[key] = value as SessionDraft;
                }
            }
            return result;
        } catch (e) {
            console.error('Failed to parse session drafts', e);
            return {};
        }
    }
    return {};
}

export function saveSessionDrafts(drafts: Record<string, SessionDraft>) {
    setPersisted('session-drafts', JSON.stringify(drafts));
}

export function loadNewSessionDraft(): NewSessionDraft | null {
    const raw = mmkv.getString(NEW_SESSION_DRAFT_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const input = typeof parsed.input === 'string' ? parsed.input : '';
        const selectedMachineId = typeof parsed.selectedMachineId === 'string' ? parsed.selectedMachineId : null;
        const selectedPath = typeof parsed.selectedPath === 'string' ? parsed.selectedPath : null;
        const agentType: NewSessionAgentType = parsed.agentType === 'codex' || parsed.agentType === 'gemini' || parsed.agentType === 'cursor'
            ? parsed.agentType
            : 'claude';
        const permissionMode: PermissionMode = typeof parsed.permissionMode === 'string'
            ? (parsed.permissionMode as PermissionMode)
            : 'default';
        const sessionType: NewSessionSessionType = parsed.sessionType === 'worktree' ? 'worktree' : 'simple';
        const images = Array.isArray(parsed.images) ? parsed.images.filter(
            (img: any) => img && typeof img.uri === 'string' && typeof img.width === 'number'
                && typeof img.height === 'number' && typeof img.mimeType === 'string'
        ) : [];
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();

        return {
            input,
            selectedMachineId,
            selectedPath,
            agentType,
            permissionMode,
            sessionType,
            images,
            updatedAt,
        };
    } catch (e) {
        console.error('Failed to parse new session draft', e);
        return null;
    }
}

export function saveNewSessionDraft(draft: NewSessionDraft) {
    setPersisted(NEW_SESSION_DRAFT_KEY, JSON.stringify(draft));
}

export function clearNewSessionDraft() {
    mmkv.delete(NEW_SESSION_DRAFT_KEY);
}

export function loadProfile(): Profile {
    const profile = mmkv.getString('profile');
    if (profile) {
        try {
            const parsed = JSON.parse(profile);
            return profileParse(parsed);
        } catch (e) {
            console.error('Failed to parse profile', e);
            return { ...profileDefaults };
        }
    }
    return { ...profileDefaults };
}

export function saveProfile(profile: Profile) {
    setPersisted('profile', JSON.stringify(profile));
}

// Simple temporary text storage for passing large strings between screens
export function storeTempText(content: string): string {
    const id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setPersisted(`temp_text_${id}`, content);
    return id;
}

export function retrieveTempText(id: string): string | null {
    const content = mmkv.getString(`temp_text_${id}`);
    if (content) {
        // Auto-delete after retrieval
        mmkv.delete(`temp_text_${id}`);
        return content;
    }
    return null;
}

const SESSION_LAST_VIEWED_KEY = 'session-last-viewed-at';
const BROWSER_LAST_PATHS_KEY = 'browser-last-paths-v1';

export function loadSessionLastViewedAt(): Map<string, number> {
    const raw = mmkv.getString(SESSION_LAST_VIEWED_KEY);
    if (raw) {
        try {
            const obj = JSON.parse(raw);
            return new Map(Object.entries(obj));
        } catch (e) {
            return new Map();
        }
    }
    return new Map();
}

export function saveSessionLastViewedAt(map: Map<string, number>) {
    setPersisted(SESSION_LAST_VIEWED_KEY, JSON.stringify(Object.fromEntries(map)));
}

const SESSION_GOAL_PINS_KEY = 'session-goal-pins.v2';
const SESSION_GOAL_PINS_LEGACY_KEY = 'session-goal-pins.v1';

type SessionGoalPinRecord = { text: string; messageId: string; pinnedAt: number };

export function loadSessionGoalPins(): Record<string, SessionGoalPinRecord[]> {
    const raw = mmkv.getString(SESSION_GOAL_PINS_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    // Migrate v1 (one pin per session) to v2 (list per session)
    const legacy = mmkv.getString(SESSION_GOAL_PINS_LEGACY_KEY);
    if (!legacy) return {};
    try {
        const parsed = JSON.parse(legacy) as Record<string, SessionGoalPinRecord>;
        const migrated = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, [v]]));
        saveSessionGoalPins(migrated);
        return migrated;
    } catch {
        return {};
    }
}

export function saveSessionGoalPins(pins: Record<string, SessionGoalPinRecord[]>) {
    setPersisted(SESSION_GOAL_PINS_KEY, JSON.stringify(pins));
}

/**
 * Decrypted-message cache, one mmkv entry per session so writing one session
 * never rewrites the others. Lets a session render its history instantly on
 * open while the network bootstrap runs; the server response then merges over
 * it by message id, so a stale cache can only ever be briefly visible.
 * The entry also carries how far back the cached range reaches, so a session
 * whose history was already backfilled does not have to pull it again.
 */
const SESSION_MESSAGES_CACHE_PREFIX = 'session-messages.v1.';
const SESSION_MESSAGES_CACHE_INDEX_KEY = 'session-messages.v1.index';
/**
 * How many sessions keep a cached copy. Kept low on web because the per-session
 * budget below times this count is the worst case for the whole origin: 30 x
 * 384KB is ~11.5MB against a ~5MB localStorage quota, so the cache alone could
 * fill storage and make every *other* write (settings, drafts) throw.
 * 6 x 384KB is ~2.3MB, which leaves the rest of the app room to breathe.
 */
const SESSION_MESSAGES_CACHE_MAX_SESSIONS = Platform.OS === 'web' ? 6 : 30;
/**
 * Serialized budget for one session. On web mmkv is backed by localStorage,
 * where the whole origin shares roughly 5MB and an over-quota write throws
 * instead of evicting, so a cached session there stays deliberately small.
 */
export const SESSION_MESSAGES_CACHE_MAX_BYTES = Platform.OS === 'web' ? 384 * 1024 : 4 * 1024 * 1024;

export interface SessionMessagesCacheEntry {
    messages: unknown[];
    /** Seq of the oldest cached message; null when it cannot be determined. */
    oldestSeq: number | null;
    /** Whether older history exists on the server beyond the cached range. */
    hasMore: boolean;
}

function sessionMessagesCacheKey(sessionId: string): string {
    return `${SESSION_MESSAGES_CACHE_PREFIX}${sessionId}`;
}

/**
 * Drops the least recently used cached session to free storage. Returns false
 * when there is nothing left to give back, which is the signal to stop
 * retrying a write. Index bookkeeping uses the raw setter: the index is tiny,
 * and routing it through setPersisted would recurse back into eviction.
 */
function evictOldestSessionMessagesCache(): boolean {
    const index = loadSessionMessagesCacheIndex();
    const evicted = index.pop();
    if (!evicted) return false;
    mmkv.delete(sessionMessagesCacheKey(evicted));
    try {
        mmkv.set(SESSION_MESSAGES_CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
        // The delete above already freed space; a stale index only costs one
        // extra eviction attempt next time.
    }
    return true;
}

function loadSessionMessagesCacheIndex(): string[] {
    const raw = mmkv.getString(SESSION_MESSAGES_CACHE_INDEX_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

export function loadSessionMessagesCache(sessionId: string): SessionMessagesCacheEntry | null {
    const raw = mmkv.getString(sessionMessagesCacheKey(sessionId));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.messages)) return null;
        return {
            messages: parsed.messages,
            oldestSeq: typeof parsed.oldestSeq === 'number' ? parsed.oldestSeq : null,
            // Entries written before the cache tracked its range say nothing
            // about the rest of the conversation, so assume more exists.
            hasMore: typeof parsed.hasMore === 'boolean' ? parsed.hasMore : true,
        };
    } catch {
        return null;
    }
}

export function saveSessionMessagesCache(sessionId: string, entry: SessionMessagesCacheEntry) {
    const payload = JSON.stringify({ ...entry, savedAt: Date.now() });

    // Publish the MRU index before the payload: eviction reads the index back
    // from storage, and this session sitting at the front makes it the last
    // candidate to be dropped while older ones are shed to make room.
    const index = [sessionId, ...loadSessionMessagesCacheIndex().filter((id) => id !== sessionId)];
    for (const staleId of index.splice(SESSION_MESSAGES_CACHE_MAX_SESSIONS)) {
        mmkv.delete(sessionMessagesCacheKey(staleId));
    }
    try {
        mmkv.set(SESSION_MESSAGES_CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
        // The index is tiny; if even it will not fit, the payload write below
        // frees space and a stale index only costs one extra eviction later.
    }

    if (!setPersisted(sessionMessagesCacheKey(sessionId), payload)) {
        // Nothing left to free: drop this session's cache rather than leave a
        // half-written entry behind.
        clearSessionMessagesCache(sessionId);
    }
}

export function clearSessionMessagesCache(sessionId: string) {
    mmkv.delete(sessionMessagesCacheKey(sessionId));
    const index = loadSessionMessagesCacheIndex().filter((id) => id !== sessionId);
    try {
        mmkv.set(SESSION_MESSAGES_CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
        // Reached from the out-of-storage path in saveSessionMessagesCache, so
        // it has to stay non-throwing. The entry above is already gone; a stale
        // index only costs one extra eviction attempt later.
    }
}

export function loadBrowserLastPaths(): Record<string, string> {
    const raw = mmkv.getString(BROWSER_LAST_PATHS_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, string>;
    } catch {
        return {};
    }
}

export function loadBrowserLastPath(rootPath: string): string | null {
    if (!rootPath) return null;
    const map = loadBrowserLastPaths();
    const value = map[rootPath];
    if (typeof value !== 'string' || value.length === 0) return null;
    return value;
}

export function saveBrowserLastPath(rootPath: string, path: string): void {
    if (!rootPath || !path) return;
    const map = loadBrowserLastPaths();
    map[rootPath] = path;
    setPersisted(BROWSER_LAST_PATHS_KEY, JSON.stringify(map));
}

export function loadRegisteredReposLocal(): { repos: Record<string, any[]>; versions: Record<string, number> } {
    const raw = mmkv.getString('registered-repos');
    if (!raw) return { repos: {}, versions: {} };
    try {
        const parsed = JSON.parse(raw);
        return { repos: parsed.repos || {}, versions: parsed.versions || {} };
    } catch {
        return { repos: {}, versions: {} };
    }
}

export function saveRegisteredReposLocal(repos: Record<string, any[]>, versions: Record<string, number>): void {
    setPersisted('registered-repos', JSON.stringify({ repos, versions }));
}

export function loadSharedByMeCache(userId: string): any[] {
    const raw = mmkv.getString(`shared-by-me-${userId}`);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveSharedByMeCache(userId: string, data: any[]): void {
    setPersisted(`shared-by-me-${userId}`, JSON.stringify(data));
}

// Per-session list of memory IDs the user has muted locally for this session.
// CLI does not consume this yet — purely a client-side preference for now.
const MUTED_MEMORY_IDS_KEY_PREFIX = 'mutedMemoryIds:';

export function loadMutedMemoryIds(sessionId: string): string[] {
    if (!sessionId) return [];
    const raw = mmkv.getString(MUTED_MEMORY_IDS_KEY_PREFIX + sessionId);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
        return [];
    }
}

export function saveMutedMemoryIds(sessionId: string, ids: string[]): void {
    if (!sessionId) return;
    if (ids.length === 0) {
        mmkv.delete(MUTED_MEMORY_IDS_KEY_PREFIX + sessionId);
        return;
    }
    setPersisted(MUTED_MEMORY_IDS_KEY_PREFIX + sessionId, JSON.stringify(ids));
}

// Cached copy of the user's full memory list (both active and archived rows),
// so the memory screen and picker render instantly instead of waiting on the
// network. Revalidated in the background — see sync/memoryCache.ts.
const MEMORY_CACHE_KEY = 'memory-cache-v1';

export interface MemoryCacheEntry {
    items: unknown[];
    updatedAt: number;
}

export function loadMemoryCache(): MemoryCacheEntry | null {
    const raw = mmkv.getString(MEMORY_CACHE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items) || typeof parsed.updatedAt !== 'number') {
            return null;
        }
        return { items: parsed.items, updatedAt: parsed.updatedAt };
    } catch {
        return null;
    }
}

export function saveMemoryCache(entry: MemoryCacheEntry): void {
    setPersisted(MEMORY_CACHE_KEY, JSON.stringify(entry));
}

export function clearMemoryCache(): void {
    mmkv.delete(MEMORY_CACHE_KEY);
}

export function clearPersistence() {
    mmkv.clearAll();
}
