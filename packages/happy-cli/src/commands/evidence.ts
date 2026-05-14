import chalk from 'chalk';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { configuration } from '@/configuration';
import { EvidenceEntry, EvidenceKind, inferEvidenceKind, renderEvidenceReport } from './workflowReports';
import { booleanFlag, parseWorkflowArgs, printOrWriteOutput, stringFlag } from './workflowCommon';

const EVIDENCE_FILE = `${configuration.happyHomeDir}/evidence/evidence.jsonl`;

function printEvidenceHelp(): void {
    console.log(`
${chalk.bold('happy evidence')} - Collect and render UI/debug evidence

${chalk.bold('Usage:')}
  happy evidence add <path-or-url> [options]
  happy evidence list [options]
  happy evidence report [options]

${chalk.bold('Options:')}
  --title <text>       Human-readable evidence title
  --kind <kind>        image | log | url | file (default: inferred)
  --session <id>       Attach evidence to a Happy session
  --note <text>        Short note shown in reports
  --out <path>         Write report/list markdown to a file
  --json               Print machine-readable JSON
  -h, --help           Show this help
`);
}

function normalizeEvidenceTarget(target: string): string {
    if (/^(https?:|file:)/i.test(target)) return target;
    return resolve(target);
}

async function readEvidenceEntries(): Promise<EvidenceEntry[]> {
    try {
        const content = await readFile(EVIDENCE_FILE, 'utf8');
        return content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as EvidenceEntry);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

function filterEvidenceEntries(entries: EvidenceEntry[], sessionId: string | undefined): EvidenceEntry[] {
    if (!sessionId) return entries;
    return entries.filter((entry) => entry.sessionId === sessionId);
}

async function assertLocalFileExists(target: string): Promise<void> {
    if (/^https?:/i.test(target) || /^file:/i.test(target)) return;
    await access(target, constants.R_OK);
}

function parseKind(kind: string | undefined, target: string): EvidenceKind {
    if (!kind) return inferEvidenceKind(target);
    if (kind === 'image' || kind === 'log' || kind === 'url' || kind === 'file') return kind;
    throw new Error('--kind must be one of: image, log, url, file.');
}

async function addEvidence(args: string[]): Promise<void> {
    const parsed = parseWorkflowArgs(args, new Set(['--title', '--kind', '--session', '--note']));
    const target = parsed.positionals[0];
    if (!target) {
        throw new Error('Evidence target required. Use "happy evidence add <path-or-url>".');
    }

    const normalizedTarget = normalizeEvidenceTarget(target);
    await assertLocalFileExists(normalizedTarget);
    const entry: EvidenceEntry = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        target: normalizedTarget,
        title: stringFlag(parsed, '--title') ?? basename(normalizedTarget),
        kind: parseKind(stringFlag(parsed, '--kind'), normalizedTarget),
        sessionId: stringFlag(parsed, '--session'),
        note: stringFlag(parsed, '--note'),
    };

    await mkdir(dirname(EVIDENCE_FILE), { recursive: true });
    await appendFile(EVIDENCE_FILE, `${JSON.stringify(entry)}\n`, 'utf8');

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify(entry, null, 2));
    } else {
        console.log(`Added evidence ${entry.id}: ${entry.target}`);
    }
}

async function listEvidence(args: string[]): Promise<void> {
    const parsed = parseWorkflowArgs(args, new Set(['--session', '--out']));
    const entries = filterEvidenceEntries(await readEvidenceEntries(), stringFlag(parsed, '--session'));

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify(entries, null, 2));
        return;
    }

    const output = entries.length === 0
        ? 'No evidence recorded.'
        : entries.map((entry) => `- ${entry.createdAt} [${entry.kind}] ${entry.title}: ${entry.target}`).join('\n');
    await printOrWriteOutput(output, stringFlag(parsed, '--out'));
}

async function reportEvidence(args: string[]): Promise<void> {
    const parsed = parseWorkflowArgs(args, new Set(['--session', '--out', '--title']));
    const entries = filterEvidenceEntries(await readEvidenceEntries(), stringFlag(parsed, '--session'));
    const title = stringFlag(parsed, '--title') ?? 'Evidence Report';

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify({ title, entries }, null, 2));
        return;
    }

    await printOrWriteOutput(renderEvidenceReport(entries, title), stringFlag(parsed, '--out'));
}

export async function handleEvidenceCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printEvidenceHelp();
        return;
    }
    if (action === 'add') {
        await addEvidence(args.slice(1));
        return;
    }
    if (action === 'list') {
        await listEvidence(args.slice(1));
        return;
    }
    if (action === 'report') {
        await reportEvidence(args.slice(1));
        return;
    }
    throw new Error(`Unknown evidence command: ${action}. Use add, list, or report.`);
}
