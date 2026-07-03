import { describe, expect, it } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';
import {
    extractFriendMentionUsernames,
    resolveMentionedFriends,
} from './chatFriendMentions';

function friend(id: string, username: string, firstName = username, lastName: string | null = null): UserProfile {
    return {
        id,
        username,
        firstName,
        lastName,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

describe('chat friend mentions', () => {
    it('extracts unique usernames from plain chat text', () => {
        expect(extractFriendMentionUsernames('please ask @alice and @bob, cc @alice')).toEqual(['alice', 'bob']);
    });

    it('matches usernames case-insensitively while returning canonical friend records', () => {
        const friends = [friend('u1', 'Alice'), friend('u2', 'bob')];

        expect(resolveMentionedFriends('ping @alice and @BOB', friends).map(item => item.id)).toEqual(['u1', 'u2']);
    });



    it('resolves company coworkers by username when they are included as mention candidates', () => {
        const people = [friend('u1', 'alice', 'Alice'), friend('u2', 'qiuxiang', '7c00')];

        expect(resolveMentionedFriends('ping @qiuxiang', people).map(item => item.id)).toEqual(['u2']);
    });

    it('resolves a unique display name alias exactly once', () => {
        const people = [friend('u1', 'alice', 'Alice'), friend('u2', 'qiuxiang', '7c00')];

        expect(resolveMentionedFriends('ping @7c00', people).map(item => item.id)).toEqual(['u2']);
    });

    it('does not resolve duplicate display name aliases', () => {
        const people = [friend('u1', 'qiuxiang', '7c00'), friend('u2', 'other', '7c00')];

        expect(resolveMentionedFriends('ping @7c00', people)).toEqual([]);
    });

    it('ignores file-style @ mentions so existing file autocomplete remains safe', () => {
        expect(extractFriendMentionUsernames('open @workspace/AGENTS.md and @src/App.tsx')).toEqual([]);
    });

    it('ignores emails and unknown usernames during friend resolution', () => {
        const friends = [friend('u1', 'alice')];

        expect(extractFriendMentionUsernames('email a@b.com and ping @missing')).toEqual(['missing']);
        expect(resolveMentionedFriends('email a@b.com and ping @missing', friends)).toEqual([]);
    });
});
