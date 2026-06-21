import { describe, expect, it } from 'vitest';
import { buildGithubTakeoverReport, buildRemoteDiagnoseReport, inferEvidenceKind, renderEvidenceReport } from './workflowReports';

describe('workflowReports', () => {
    it('renders a GitHub takeover prompt with target and repo', () => {
        const report = buildGithubTakeoverReport({
            target: '#123',
            repo: 'ZonEaseTech/happy-wfs',
            mode: 'pr',
        });

        expect(report).toContain('GitHub Task Takeover');
        expect(report).toContain('ZonEaseTech/happy-wfs');
        expect(report).toContain('Copy-Paste Agent Prompt');
    });

    it('renders a read-only remote diagnosis evidence pack', () => {
        const report = buildRemoteDiagnoseReport({
            host: 'mac-mini',
            service: 'happy-server',
            keyword: 'EADDRINUSE',
            since: '2 hours ago',
            healthUrl: 'http://127.0.0.1:8090/health',
        });

        expect(report).toContain('Remote Diagnosis Evidence Pack');
        expect(report).toContain('ssh "$HOST"');
        expect(report).toContain('docker logs');
        expect(report).toContain('EADDRINUSE');
    });

    it('infers evidence kind from target', () => {
        expect(inferEvidenceKind('/tmp/screen.png')).toBe('image');
        expect(inferEvidenceKind('/tmp/app.log')).toBe('log');
        expect(inferEvidenceKind('https://example.com')).toBe('url');
        expect(inferEvidenceKind('/tmp/archive.bin')).toBe('file');
    });

    it('renders image evidence with a file preview link', () => {
        const report = renderEvidenceReport([
            {
                id: 'ev-1',
                createdAt: '2026-05-13T00:00:00.000Z',
                target: '/tmp/223-inventory-alert-detail-5554.png',
                title: 'Inventory alert detail',
                kind: 'image',
                sessionId: 'session-1',
            },
        ]);

        expect(report).toContain('![Inventory alert detail](file:///tmp/223-inventory-alert-detail-5554.png)');
        expect(report).toContain('session=session-1');
    });
});
