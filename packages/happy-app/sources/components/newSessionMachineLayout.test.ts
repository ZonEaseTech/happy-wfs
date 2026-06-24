import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const newSessionSource = readFileSync(resolve(__dirname, '../app/(app)/new/index.tsx'), 'utf8');

describe('new session machine selector layout', () => {
    it('uses the top machine status strip as the machine dropdown and removes the numbered machine section', () => {
        expect(newSessionSource).toContain('machineMenuVisible');
        expect(newSessionSource).toContain('setMachineMenuVisible(true)');
        expect(newSessionSource).toContain('name="chevron-down"');
        expect(newSessionSource).not.toContain('Section 2: Machine Selection');
        expect(newSessionSource).not.toContain('>{t(\'wizard.step2Title\')}</Text>');
        expect(newSessionSource).toContain('{t(\'wizard.step3Title\')}</Text>');
        expect(newSessionSource).toContain('>2.</Text>');
        expect(newSessionSource).toContain('>3.</Text>');
    });
});
