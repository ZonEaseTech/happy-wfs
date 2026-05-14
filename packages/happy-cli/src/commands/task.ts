import chalk from 'chalk';
import { resolve } from 'node:path';
import { readCredentials } from '@/persistence';
import { runSessionList, SessionListSession } from '@/mcp/tools/sessionList';
import { runSessionSummary, SessionSummaryInput, SessionSummaryResult } from '@/mcp/tools/sessionSummary';
import { booleanFlag, numberFlag, parseWorkflowArgs, printOrWriteOutput, stringFlag } from './workflowCommon';

function printTaskHelp(): void {
    console.log(`
${chalk.bold('happy task')} - Agent handoff helpers

${chalk.bold('Usage:')}
  happy task brief --session <sessionId> [options]
  happy task brief <sessionId> [options]
  happy task brief --recent [--project <path>] [options]

${chalk.bold('Options:')}
  --session <id>       Happy session ID to summarize
  --recent             Pick the most recent session, optionally filtered by --project
  --project <path>     Project path filter for --recent
  --limit <n>          Raw messages to compact (default: 200)
  --max-turns <n>      Compact turns to include (default: 80)
  --text-limit <n>     Max chars per text block (default: 800)
  --out <path>         Write the brief to a markdown file
  --json               Print machine-readable JSON
  -h, --help           Show this help
`);
}

function collectSessionText(summary: SessionSummaryResult): string {
    const chunks: string[] = [];
    if (summary.storedSummary) chunks.push(summary.storedSummary);
    for (const turn of summary.turns) {
        if (turn.user?.text) chunks.push(turn.user.text);
        for (const text of turn.assistantTexts) chunks.push(text.text);
    }
    return chunks.join('\n');
}

function extractMatchingLines(text: string, patterns: RegExp[], limit: number): string[] {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.replace(/^[-*]\s*/, '').trim();
        if (!trimmed || seen.has(trimmed)) continue;
        if (patterns.some((pattern) => pattern.test(trimmed))) {
            seen.add(trimmed);
            lines.push(trimmed);
        }
        if (lines.length >= limit) break;
    }
    return lines;
}

function bulletList(lines: string[], fallback: string): string {
    if (lines.length === 0) return `- ${fallback}`;
    return lines.map((line) => `- ${line}`).join('\n');
}

function buildBriefMarkdown(summary: SessionSummaryResult, source: 'session' | 'recent'): string {
    const text = collectSessionText(summary);
    const done = extractMatchingLines(text, [/完成|已实现|通过|passed|fixed|implemented|verified/i], 6);
    const blockers = extractMatchingLines(text, [/失败|阻塞|blocked|failed|error|E401|unrelated/i], 6);
    const next = extractMatchingLines(text, [/继续|下一步|TODO|todo|next|publish|发布|验证|verify/i], 6);

    return `# Happy Task Brief

- Source: ${source}
- Session: \`${summary.sessionId}\`
- Active: ${summary.active ? 'yes' : 'no'}
- Agent: ${summary.agent.name ?? '(unknown)'}${summary.agent.model ? ` / ${summary.agent.model}` : ''}
- Machine: ${summary.machine.name ?? summary.machine.id ?? '(unknown)'}
- Path: ${summary.path ?? '(unknown)'}
- Updated: ${new Date(summary.updatedAt).toISOString()}

## Stored Summary

${summary.storedSummary ?? '(none)'}

## Recent Conversation

${summary.summaryText}

## Done / Evidence

${bulletList(done, 'No explicit completion evidence detected in the compact window.')}

## Blockers / Risks

${bulletList(blockers, 'No explicit blocker detected in the compact window.')}

## Suggested Next Actions

${bulletList(next, 'Continue from the latest user request and verify before reporting completion.')}

## Continuation Prompt

Continue session \`${summary.sessionId}\` from this brief. Preserve existing user changes, inspect the repository rules before editing, implement only the requested scope, run focused verification, and summarize changed files plus test results in Chinese.
`;
}

function findRecentSession(sessions: SessionListSession[], projectPath: string | undefined): SessionListSession | undefined {
    if (!projectPath) return sessions[0];
    const resolved = resolve(projectPath);
    return sessions.find((session) => {
        if (!session.path) return false;
        const path = resolve(session.path);
        return path === resolved || path.startsWith(`${resolved}/`) || resolved.startsWith(`${path}/`);
    });
}

export async function handleTaskCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printTaskHelp();
        return;
    }
    if (action !== 'brief') {
        throw new Error(`Unknown task command: ${action}. Use "happy task brief".`);
    }

    const parsed = parseWorkflowArgs(args.slice(1), new Set(['--session', '--project', '--limit', '--max-turns', '--text-limit', '--out']));
    const credentials = await readCredentials();
    if (!credentials) {
        throw new Error('No happy credentials found. Run "happy auth login" first.');
    }

    let sessionId = stringFlag(parsed, '--session') ?? parsed.positionals[0];
    let source: 'session' | 'recent' = 'session';
    if (!sessionId && booleanFlag(parsed, '--recent')) {
        const result = await runSessionList(credentials, { status: 'all', limit: 150 });
        const recent = findRecentSession(result.sessions, stringFlag(parsed, '--project'));
        if (!recent) {
            throw new Error('No matching recent session found.');
        }
        sessionId = recent.sessionId;
        source = 'recent';
    }

    if (!sessionId) {
        throw new Error('Session ID required. Use "happy task brief --session <id>" or "--recent".');
    }

    const input: SessionSummaryInput = {
        sessionId,
        limit: numberFlag(parsed, '--limit'),
        maxTurns: numberFlag(parsed, '--max-turns'),
        textLimit: numberFlag(parsed, '--text-limit'),
        includeTools: true,
    };
    const summary = await runSessionSummary(credentials, input);
    const brief = buildBriefMarkdown(summary, source);

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify({ source, summary, brief }, null, 2));
        return;
    }

    await printOrWriteOutput(brief, stringFlag(parsed, '--out'));
}
