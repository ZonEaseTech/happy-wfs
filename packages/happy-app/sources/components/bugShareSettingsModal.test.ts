import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modalPath = resolve(__dirname, './BugShareSettingsModal.tsx');
const sessionsPath = resolve(__dirname, './SessionsList.tsx');
const apiPath = resolve(__dirname, '../sync/apiBugs.ts');

describe('BugShareSettingsModal', () => {
    it('opens with the current share password and exposes copy buttons for url and password', () => {
        const modalSource = readFileSync(modalPath, 'utf8');
        const sessionsSource = readFileSync(sessionsPath, 'utf8');
        const apiSource = readFileSync(apiPath, 'utf8');

        expect(apiSource).toContain('accessCode: string');
        expect(sessionsSource).toContain('currentAccessCode');
        expect(modalSource).toContain('currentAccessCode');
        expect(modalSource).toContain("React.useState(currentAccessCode || '')");
        expect(modalSource).toContain('copy(url)');
        expect(modalSource).toContain('copy(customCode.trim())');
        expect(modalSource).toContain("name=\"copy-outline\"");
    });

    it('only fills the input when generating a random password locally', () => {
        const modalSource = readFileSync(modalPath, 'utf8');

        expect(modalSource).toContain('generateLocalAccessCode');
        expect(modalSource).toContain('setCustomCode(generateLocalAccessCode())');
        expect(modalSource).not.toContain('onPress={() => rotate(false)}');
    });
});
