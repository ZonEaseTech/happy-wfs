import chalk from 'chalk';
import { readCredentials } from '@/persistence';
import { runSessionSummary, SessionSummaryInput } from '@/mcp/tools/sessionSummary';

function printSessionHelp(): void {
    console.log(`
${chalk.bold('happy session')} - Read Happy sessions

${chalk.bold('Usage:')}
  happy session summary <sessionId> [options]
  happy session summarize <sessionId> [options]

${chalk.bold('Options:')}
  --limit <n>              Raw messages to compact (1-500, default 200)
  --before-seq <n>         Page backwards: messages with seq < n
  --after-seq <n>          Page forwards: messages with seq > n
  --max-turns <n>          Compact turns to print (1-200, default 80)
  --text-limit <n>         Max chars per text block (80-4000, default 800)
  --max-tools <n>          Max tool names per turn (0-50, default 12)
  --no-tools               Hide tool-use names
  --json                   Print full JSON instead of markdown
  -h, --help               Show this help
`);
}

function readNumberFlag(flag: string, value: string | undefined): number {
    if (!value || value.startsWith('-')) {
        throw new Error(`${flag} requires a number value.`);
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new Error(`${flag} must be an integer.`);
    }
    return parsed;
}

export async function handleSessionCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printSessionHelp();
        return;
    }

    if (action !== 'summary' && action !== 'summarize') {
        throw new Error(`Unknown session command: ${action}. Use "happy session summary <sessionId>".`);
    }

    const sessionId = args[1];
    if (!sessionId || sessionId.startsWith('-')) {
        throw new Error('Session ID required. Use "happy session summary <sessionId>".');
    }

    const input: SessionSummaryInput = { sessionId };
    let printJson = false;

    for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--limit') {
            input.limit = readNumberFlag(arg, args[++i]);
        } else if (arg === '--before-seq') {
            input.beforeSeq = readNumberFlag(arg, args[++i]);
        } else if (arg === '--after-seq') {
            input.afterSeq = readNumberFlag(arg, args[++i]);
        } else if (arg === '--max-turns') {
            input.maxTurns = readNumberFlag(arg, args[++i]);
        } else if (arg === '--text-limit') {
            input.textLimit = readNumberFlag(arg, args[++i]);
        } else if (arg === '--max-tools') {
            input.maxToolsPerTurn = readNumberFlag(arg, args[++i]);
        } else if (arg === '--no-tools') {
            input.includeTools = false;
        } else if (arg === '--json') {
            printJson = true;
        } else if (arg === '-h' || arg === '--help') {
            printSessionHelp();
            return;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    const credentials = await readCredentials();
    if (!credentials) {
        throw new Error('No happy credentials found. Run "happy auth login" first.');
    }

    const result = await runSessionSummary(credentials, input);
    if (printJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(result.summaryText);
        if (result.messageWindow.hasMore) {
            console.log('');
            console.log(chalk.gray(`More messages available. Continue with --before-seq ${result.messageWindow.nextBeforeSeq}`));
        }
    }
}
