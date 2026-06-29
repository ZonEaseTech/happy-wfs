import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const newSessionSource = readFileSync(resolve(__dirname, '../app/(app)/new/index.tsx'), 'utf8');

describe('new session profile dropdown', () => {
    it('uses one selected AI config card with a searchable dropdown instead of rendering all profiles inline', () => {
        expect(newSessionSource).toContain('profileMenuVisible');
        expect(newSessionSource).toContain('profileMenuItems');
        expect(newSessionSource).toContain('setProfileMenuVisible(true)');
        const profileModalCount = (newSessionSource.match(/visible=\{profileMenuVisible\}/g) || []).length;
        expect(profileModalCount).toBe(2);
        expect(newSessionSource).not.toContain('{profiles.map((profile) => {');
        expect(newSessionSource).not.toContain('{DEFAULT_PROFILES.map((profileDisplay) => {');
        expect(newSessionSource).not.toContain('wizard.showMoreProfiles');
    });
});
