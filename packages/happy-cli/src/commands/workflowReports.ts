import { basename, extname } from 'node:path';

export type EvidenceKind = 'image' | 'log' | 'url' | 'file';

export interface EvidenceEntry {
    id: string;
    createdAt: string;
    target: string;
    title: string;
    kind: EvidenceKind;
    sessionId?: string;
    note?: string;
}

export interface GithubTakeoverInput {
    target: string;
    repo?: string;
    mode?: 'pr' | 'issue' | 'auto';
}

export interface RemoteDiagnoseInput {
    host: string;
    service?: string;
    keyword?: string;
    since: string;
    healthUrl?: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const LOG_EXTENSIONS = new Set(['.log', '.txt', '.jsonl']);

function bashQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function inferEvidenceKind(target: string): EvidenceKind {
    if (/^https?:\/\//i.test(target)) return 'url';
    const extension = extname(target).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) return 'image';
    if (LOG_EXTENSIONS.has(extension)) return 'log';
    return 'file';
}

export function buildGithubTakeoverReport(input: GithubTakeoverInput): string {
    const targetLabel = input.target || '(issue-or-pr)';
    const repoLine = input.repo ? `- Repository: \`${input.repo}\`` : '- Repository: infer from URL or current checkout';
    const modeLine = input.mode && input.mode !== 'auto' ? `- Mode: ${input.mode}` : '- Mode: auto-detect PR vs issue';

    return `# GitHub Task Takeover

- Target: \`${targetLabel}\`
${repoLine}
${modeLine}

## Execution Checklist

1. Read repository instructions first: \`AGENTS.md\`, \`CLAUDE.md\`, and scoped rules.
2. Fetch the PR/issue body, comments, unresolved review threads, changed files, and CI status.
3. Summarize the requested outcome, blockers, and acceptance criteria before editing.
4. Claim or create the local task/plan record if the repository uses PMA.
5. Preserve existing user/agent changes; do not reset or overwrite unrelated files.
6. Implement the smallest safe patch.
7. Run focused verification and then the package-required typecheck/build/test command.
8. Report changed files, verification results, and any remaining blockers.

## Copy-Paste Agent Prompt

Take over GitHub work for \`${targetLabel}\`${input.repo ? ` in \`${input.repo}\`` : ''}.

- Inspect repository instructions before editing.
- Read PR/issue metadata, comments, unresolved review threads, changed files, and CI.
- Identify exactly what must be fixed.
- Implement the minimal patch without touching unrelated user changes.
- Run focused tests plus the repository-required verification.
- Return a concise Chinese summary with changed files and verification evidence.
`;
}

export function buildRemoteDiagnoseReport(input: RemoteDiagnoseInput): string {
    const serviceClause = input.service ? `SERVICE=${bashQuote(input.service)}` : `SERVICE=${bashQuote('<service-name>')}`;
    const keywordClause = input.keyword ? `KEYWORD=${bashQuote(input.keyword)}` : `KEYWORD=${bashQuote('<error-keyword>')}`;
    const healthUrl = input.healthUrl ?? 'http://127.0.0.1:8090/health';

    return `# Remote Diagnosis Evidence Pack

- Host: \`${input.host}\`
- Since: \`${input.since}\`
- Service: \`${input.service ?? '(optional)'}\`
- Keyword: \`${input.keyword ?? '(optional)'}\`
- Health URL: \`${healthUrl}\`

Run these commands manually after confirming the target host. They are read-only evidence commands.

\`\`\`bash
HOST=${bashQuote(input.host)}
${serviceClause}
${keywordClause}
SINCE=${bashQuote(input.since)}

ssh "$HOST" 'hostname; date; uptime; df -h; free -m'
ssh "$HOST" 'systemctl --failed --no-pager || true'
ssh "$HOST" 'docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}" || true'
ssh "$HOST" "curl -fsS ${healthUrl} || true"
ssh "$HOST" "journalctl --since \\"$SINCE\\" -p warning..alert --no-pager | tail -200 || true"
ssh "$HOST" "docker logs --since \\"$SINCE\\" \\"$SERVICE\\" 2>&1 | tail -300 || true"
ssh "$HOST" "grep -RIn --exclude-dir=node_modules --exclude-dir=.git \\"$KEYWORD\\" /tmp /var/log 2>/dev/null | tail -100 || true"
\`\`\`

## Evidence To Return

- Exact failing request or user-visible symptom.
- Health check output.
- Last 200 warning/error journal lines.
- Last 300 service log lines.
- Any screenshot or UI evidence path, added with \`happy evidence add <path>\`.
`;
}

export function renderEvidenceReport(entries: EvidenceEntry[], title = 'Evidence Report'): string {
    const lines = [`# ${title}`, '', `Total evidence: ${entries.length}`, ''];

    for (const entry of entries) {
        const session = entry.sessionId ? ` session=${entry.sessionId}` : '';
        lines.push(`## ${entry.title}`);
        lines.push('');
        lines.push(`- ID: \`${entry.id}\``);
        lines.push(`- Created: ${entry.createdAt}`);
        lines.push(`- Kind: ${entry.kind}${session}`);
        lines.push(`- Target: \`${entry.target}\``);
        if (entry.note) lines.push(`- Note: ${entry.note}`);
        if (entry.kind === 'image') {
            const label = entry.title || basename(entry.target);
            const imageTarget = entry.target.startsWith('/') ? `file://${entry.target}` : entry.target;
            lines.push('');
            lines.push(`![${label}](${imageTarget})`);
        }
        lines.push('');
    }

    return lines.join('\n').trimEnd();
}
