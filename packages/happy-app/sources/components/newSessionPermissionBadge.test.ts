import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const newSessionSource = readFileSync(resolve(__dirname, '../app/(app)/new/index.tsx'), 'utf8');

describe('new session permission badge', () => {
    it('keeps the AgentInput permission badge selectable while the wizard permission section stays hidden', () => {
        expect(newSessionSource).toContain('const applyManualPermissionMode = React.useCallback((mode: PermissionMode) => {');
        expect(newSessionSource).toContain('setPermissionMode(mode);');
        expect(newSessionSource).toContain('onPermissionModeChange={handlePermissionModeChange}');
        expect(newSessionSource).not.toContain('hidePermissionSettings\n                                modelMode={modelMode}');
        expect(newSessionSource).not.toContain('hidePermissionSettings\n                            modelMode={modelMode}');
        expect(newSessionSource).not.toContain('New sessions always start in YOLO mode');
        expect(newSessionSource).not.toContain('PermissionModeSelector }');
    });
});
