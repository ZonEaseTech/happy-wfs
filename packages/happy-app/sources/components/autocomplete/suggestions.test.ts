import { describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    FriendMentionSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({
    searchCommands: vi.fn(),
}));

vi.mock('@/sync/suggestionFile', () => ({
    searchFiles: vi.fn(),
}));

import { searchFiles } from '@/sync/suggestionFile';
import { getSuggestions } from './suggestions';

function friend(id: string, username: string, firstName = username): UserProfile {
    return {
        id,
        username,
        firstName,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

describe('autocomplete suggestions', () => {
    it('returns matching friend suggestions before file suggestions for @ queries', async () => {
        vi.mocked(searchFiles).mockResolvedValueOnce([
            {
                fullPath: 'src/alarm.ts',
                fileName: 'alarm.ts',
                filePath: 'src/',
                fileType: 'file',
            },
        ]);

        const suggestions = await getSuggestions('session-1', '@al', {
            friends: [friend('u1', 'alice', 'Alice'), friend('u2', 'bob', 'Bob')],
            includeFriends: true,
        });

        expect(suggestions.map(item => item.key)).toEqual(['friend-u1', 'file-src/alarm.ts']);
        expect(suggestions.map(item => item.text)).toEqual(['@alice', '@src/alarm.ts']);
    });

    it('does not include friend suggestions when friend suggestions are disabled', async () => {
        vi.mocked(searchFiles).mockResolvedValueOnce([]);

        const suggestions = await getSuggestions('session-1', '@ali', {
            friends: [friend('u1', 'alice', 'Alice')],
            includeFriends: false,
        });

        expect(suggestions).toEqual([]);
    });
});
