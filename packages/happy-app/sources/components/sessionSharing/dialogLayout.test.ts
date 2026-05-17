import { describe, expect, it } from 'vitest';
import { shouldUseCenteredSharingDialog } from './dialogLayout';

describe('shouldUseCenteredSharingDialog', () => {
    it('uses centered modal only on wide web screens', () => {
        expect(shouldUseCenteredSharingDialog('web', 1024)).toBe(true);
        expect(shouldUseCenteredSharingDialog('web', 900)).toBe(true);
        expect(shouldUseCenteredSharingDialog('web', 767)).toBe(false);
        expect(shouldUseCenteredSharingDialog('ios', 1200)).toBe(false);
        expect(shouldUseCenteredSharingDialog('android', 1200)).toBe(false);
    });
});
