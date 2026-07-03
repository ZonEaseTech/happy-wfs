import type { UserProfile } from '@/sync/friendTypes';

// Conservative chat mention grammar. Do not match file-style mentions such as
// @src/App.tsx or @README.md, but allow normal trailing punctuation like @alice.
const FRIEND_MENTION_RE = /(^|[^A-Za-z0-9_./-])@([A-Za-z0-9][A-Za-z0-9_-]{0,38})(?![A-Za-z0-9_/-]|\.[A-Za-z0-9])/g;

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

export function resolveMentionedFriends(text: string, friends: UserProfile[]): UserProfile[] {
    const friendsByUsername = new Map<string, UserProfile>();
    for (const friend of friends) {
        friendsByUsername.set(friend.username.toLowerCase(), friend);
    }

    return extractFriendMentionUsernames(text)
        .map(username => friendsByUsername.get(username.toLowerCase()))
        .filter((friend): friend is UserProfile => Boolean(friend));
}
