import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();

vi.mock('axios', () => ({ default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/configuration', () => ({ configuration: { serverUrl: 'https://api.test' } }));
vi.mock('node:fs/promises', () => ({
    stat: vi.fn(async () => ({ size: 1024 })),
    readFile: vi.fn(async () => Buffer.from('png')),
}));

const { commentOnBug, withImageMarkers } = await import('./bugs');

const credentials = { token: 'tok', secret: new Uint8Array() } as never;

describe('withImageMarkers', () => {
    it('keeps markers the text already places and appends the rest in order', () => {
        expect(withImageMarkers('看这里 [[bug-image:2]]', 3)).toBe('看这里 [[bug-image:2]]\n\n[[bug-image:1]]\n\n[[bug-image:3]]');
    });

    it('leaves text alone when there are no images', () => {
        expect(withImageMarkers('  复测通过  ', 0)).toBe('复测通过');
    });

    it('turns an image-only comment into markers', () => {
        expect(withImageMarkers('', 2)).toBe('[[bug-image:1]]\n\n[[bug-image:2]]');
    });
});

describe('commentOnBug', () => {
    beforeEach(() => {
        get.mockReset().mockResolvedValue({ data: { bugs: [{ id: 'internal-406', displayId: 'BUG-406' }] } });
        post.mockReset().mockImplementation(async (url: string) => (
            url.endsWith('/comments')
                ? { data: { bug: { id: 'internal-406', displayId: 'BUG-406', commentCount: 3 }, commentId: 'c-1' } }
                : { data: { bug: {} } }
        ));
    });

    it('posts the comment to the bug the user named', async () => {
        const result = await commentOnBug(credentials, { bug: 'BUG-406', body: '复测通过' });

        expect(post).toHaveBeenCalledWith('https://api.test/v1/bugs/internal-406/comments', { body: '复测通过' }, expect.anything());
        expect(result).toMatchObject({ displayId: 'BUG-406', commentId: 'c-1', commentCount: 3 });
    });

    it('uploads images after the comment, tagged with its id, and marks each one in the body', async () => {
        const result = await commentOnBug(credentials, { bug: '406', body: '复测通过，见截图', images: ['/tmp/a.png', '/tmp/b.png'] });

        expect(post.mock.calls[0][1]).toEqual({ body: '复测通过，见截图\n\n[[bug-image:1]]\n\n[[bug-image:2]]' });
        const uploads = post.mock.calls.slice(1);
        expect(uploads.map((c) => c[0])).toEqual([
            'https://api.test/v1/bugs/internal-406/attachments',
            'https://api.test/v1/bugs/internal-406/attachments',
        ]);
        for (const [, form] of uploads) {
            expect((form as FormData).get('commentId')).toBe('c-1');
        }
        expect(result.attachments).toEqual([{ file: '/tmp/a.png', ok: true }, { file: '/tmp/b.png', ok: true }]);
    });

    it('rejects an empty comment before calling the server', async () => {
        await expect(commentOnBug(credentials, { bug: 'BUG-406', body: '   ' })).rejects.toThrow('nothing to post');
        expect(post).not.toHaveBeenCalled();
    });
});
