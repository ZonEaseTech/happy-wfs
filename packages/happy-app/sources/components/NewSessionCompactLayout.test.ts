import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSessionCompactLayout } from './NewSessionCompactLayout';

const viewport = vi.hoisted(() => ({ width: 1024 }));

vi.mock('react-native', async () => {
    const React = await import('react');
    return {
        View: ({ testID, children, style }: {
            testID?: string;
            children?: React.ReactNode;
            style?: React.CSSProperties;
        }) => React.createElement('div', { 'data-testid': testID, style }, children),
        useWindowDimensions: () => ({ width: viewport.width }),
    };
});

vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: { colors: { surface: '#ffffff' } } }),
}));

function render(extraSlots: Record<string, React.ReactNode> = {}): string {
    return renderToStaticMarkup(React.createElement(NewSessionCompactLayout, {
        machine: 'machine-control',
        profile: 'profile-control',
        sessionType: 'session-mode-control',
        composer: 'composer-control',
        ...extraSlots,
    }));
}

describe('NewSessionCompactLayout', () => {
    beforeEach(() => {
        viewport.width = 1024;
    });

    it('keeps the desktop machine and profile controls in one centered, bounded row', () => {
        const html = render();
        expect(html).toContain('max-width:900px');
        expect(html).toContain('align-self:center');
        expect(html).toContain('flex-direction:row');
        expect(html).toContain('machine-control');
        expect(html).toContain('profile-control');
        expect(html).not.toContain('position:absolute');
    });

    it('stacks machine and profile at the narrow breakpoint without removing controls', () => {
        viewport.width = 700;
        const html = render();
        expect(html).toContain('flex-direction:column');
        expect(html).toContain('gap:12px');
        expect(html).toContain('machine-control');
        expect(html).toContain('profile-control');
        expect(html).toContain('composer-control');
    });

    it('keeps the existing controls in order and the composer immediately after repository settings', () => {
        const html = render({
            banner: 'external-context',
            warnings: 'cli-warning',
            directory: 'directory-control',
            repositories: 'repository-control',
        });
        const ids = [
            'compact-banner',
            'compact-machine-profile-row',
            'compact-warnings',
            'compact-directory',
            'compact-session-mode',
            'compact-repositories',
            'compact-composer',
        ];
        for (let i = 1; i < ids.length; i += 1) {
            expect(html.indexOf(`data-testid="${ids[i]}"`)).toBeGreaterThan(
                html.indexOf(`data-testid="${ids[i - 1]}"`),
            );
        }
        expect(html).toContain('external-context');
        expect(html).toContain('cli-warning');
        expect(html).toContain('directory-control');
        expect(html).toContain('repository-control');
    });

    it('does not reserve empty rows for optional slots', () => {
        const html = render();
        for (const slot of ['banner', 'warnings', 'directory', 'repositories']) {
            expect(html).not.toContain(`data-testid="compact-${slot}"`);
        }
        expect(html).toContain('data-testid="compact-session-mode"');
        expect(html).toContain('data-testid="compact-composer"');
    });
});
