import { describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => {
    const now = new Date('2026-10-28T00:00:00Z');
    const created: any[] = [];
    const bugRow = {
        id: 'bug-1', displayNumber: 406, title: 't', description: 'd', contentJson: null, status: 'verify', visibility: 'shared',
        createdByNickname: null, createdByUser: null, sessionId: null, lastActivityAt: now, createdAt: now, updatedAt: now,
        attachments: [], statusHistory: [],
    };
    const tx = {
        created,
        bugReport: {
            findFirst: vi.fn(async () => bugRow),
            update: vi.fn(async () => bugRow),
            findUnique: vi.fn(async () => ({
                ...bugRow,
                comments: created.map((data, i) => ({ id: `c${i}`, ...data, createdAt: now, attachments: [] })),
            })),
        },
        bugComment: { create: vi.fn(async ({ data }: any) => { created.push(data); return { id: `c${created.length - 1}`, ...data }; }) },
        bugStatusHistory: { create: vi.fn(async () => ({})) },
    };
    return { tx };
});

vi.mock('@/storage/db', () => ({ db: tx }));
vi.mock('@/storage/inTx', () => ({ inTx: async (fn: any) => fn(tx) }));

import { addBugComment } from './bugService';

describe('addBugComment rich content', () => {
    it('stores contentJson next to the marker text and returns it on the comment', async () => {
        const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '复测通过' }] }, { type: 'image', attrs: { src: 'bug-attachment:1' } }] };

        const result = await addBugComment('owner-1', 'bug-1', { userId: 'u1', nickname: 'wfs' }, '复测通过\n\n[[bug-image:1]]', { contentJson: doc });

        expect(tx.created.at(-1)).toMatchObject({ body: '复测通过\n\n[[bug-image:1]]', contentJson: doc });
        expect(result.bug.comments.at(-1)).toMatchObject({ body: '复测通过\n\n[[bug-image:1]]', contentJson: doc });
    });

    it('leaves contentJson unset for plain comments, so they read back as null', async () => {
        const result = await addBugComment('owner-1', 'bug-1', { userId: 'u1', nickname: 'wfs' }, '纯文字');

        expect(tx.created.at(-1)).not.toHaveProperty('contentJson');
        expect(result.bug.comments.at(-1)?.contentJson).toBeNull();
    });
});
