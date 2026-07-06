import { describe, expect, it } from 'vitest';
import { isSidebarHiddenPath } from './sidebarVisibility';

describe('isSidebarHiddenPath', () => {
    it('hides the sidebar on the shared bug board', () => {
        expect(isSidebarHiddenPath('/bug')).toBe(true);
        expect(isSidebarHiddenPath('/bug/')).toBe(true);
    });

    it('keeps the sidebar everywhere else', () => {
        expect(isSidebarHiddenPath('/')).toBe(false);
        expect(isSidebarHiddenPath('/session/abc')).toBe(false);
        expect(isSidebarHiddenPath('/bugsomething')).toBe(false);
        expect(isSidebarHiddenPath(null)).toBe(false);
        expect(isSidebarHiddenPath(undefined)).toBe(false);
    });
});
