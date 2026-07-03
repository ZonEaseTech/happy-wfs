// Conservative chat mention grammar. Do not match file-style mentions such as
// @src/App.tsx or @README.md, but allow normal trailing punctuation like @alice.
const FRIEND_MENTION_RE = /(^|[^A-Za-z0-9_./-])@([A-Za-z0-9][A-Za-z0-9_-]{0,38})(?![A-Za-z0-9_/-]|\.[A-Za-z0-9])/g;

export type MentionableUser = {
    id: string;
    username: string;
    firstName?: string | null;
    lastName?: string | null;
};

export function getMentionableDisplayName(user: MentionableUser): string {
    const fullName = [user.firstName, user.lastName]
        .map(value => value?.trim())
        .filter(Boolean)
        .join(' ');
    return fullName || user.username;
}

export function extractFriendMentionUsernames(text: string): string[] {
    const usernames: string[] = [];
    const seen = new Set<string>();

    for (const match of text.matchAll(FRIEND_MENTION_RE)) {
        const username = match[2];
        if (!username) {
            continue;
        }
        const key = username.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        usernames.push(username);
    }

    return usernames;
}

export function resolveMentionedFriends<T extends MentionableUser>(text: string, people: T[]): T[] {
    const peopleByUsername = new Map<string, T>();
    const displayNameBuckets = new Map<string, T[]>();

    for (const person of people) {
        peopleByUsername.set(person.username.toLowerCase(), person);
        const displayName = getMentionableDisplayName(person).toLowerCase();
        const existing = displayNameBuckets.get(displayName) ?? [];
        existing.push(person);
        displayNameBuckets.set(displayName, existing);
    }

    const resolved: T[] = [];
    const seenIds = new Set<string>();
    for (const username of extractFriendMentionUsernames(text)) {
        const key = username.toLowerCase();
        const person = peopleByUsername.get(key) ?? (() => {
            const displayMatches = displayNameBuckets.get(key) ?? [];
            return displayMatches.length === 1 ? displayMatches[0] : undefined;
        })();
        if (!person || seenIds.has(person.id)) {
            continue;
        }
        seenIds.add(person.id);
        resolved.push(person);
    }

    return resolved;
}
