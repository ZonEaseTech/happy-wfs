import { useFriendRequests, useFeedHasBadge } from '@/sync/storage';

// Hook to check if inbox has unread content worth an indicator dot.
// Deliberately narrow: only unread feed items (e.g. mentions, notices)
// and incoming friend requests count. App updates, outgoing requests
// and changelog entries live in the inbox but should not light the dot.
export function useInboxHasContent(): boolean {
    const friendRequests = useFriendRequests();
    const feedHasBadge = useFeedHasBadge();

    return friendRequests.length > 0 || feedHasBadge;
}
