import { beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
const get = vi.fn();

vi.mock('axios', () => ({ default: { patch: (...a: unknown[]) => patch(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/configuration', () => ({ configuration: { serverUrl: 'https://api.test' } }));

const { setBugStatus } = await import('./bugs');

const credentials = { token: 'tok', secret: new Uint8Array() } as never;

describe('setBugStatus', () => {
    beforeEach(() => {
        patch.mockReset().mockResolvedValue({ data: { bug: { displayId: 'BUG-334', status: 'closed' } } });
        // resolveBugId turns "BUG-334" into the internal id by looking it up.
        get.mockReset().mockResolvedValue({ data: { bugs: [{ id: 'internal-334', displayId: 'BUG-334' }] } });
    });

    it('closes a bug referenced the way the user says it', async () => {
        const bug = await setBugStatus(credentials, { bug: 'BUG-334', status: 'closed' });
        expect(patch).toHaveBeenCalledWith(
            'https://api.test/v1/bugs/internal-334/status',
            { status: 'closed' },
            expect.anything(),
        );
        expect(bug.status).toBe('closed');
    });

    it('accepts the other columns too', async () => {
        await setBugStatus(credentials, { bug: '334', status: 'verify' });
        expect(patch.mock.calls[0][1]).toEqual({ status: 'verify' });
    });

    it('marks a failed verification as a return, not a plain status change', async () => {
        await setBugStatus(credentials, { bug: 'BUG-334', status: 'pending', returnToPending: true });
        expect(patch.mock.calls[0][1]).toEqual({ status: 'pending', action: 'return_to_pending' });
    });

    it('omits the action flag when it was not asked for', async () => {
        await setBugStatus(credentials, { bug: 'BUG-334', status: 'pending' });
        expect(patch.mock.calls[0][1]).toEqual({ status: 'pending' });
    });
});
