import chalk from 'chalk';
import { buildGithubTakeoverReport, GithubTakeoverInput } from './workflowReports';
import { booleanFlag, parseWorkflowArgs, printOrWriteOutput, stringFlag } from './workflowCommon';

function printGithubHelp(): void {
    console.log(`
${chalk.bold('happy github')} - GitHub workflow helpers

${chalk.bold('Usage:')}
  happy github takeover <issue-or-pr-url-or-number> [options]

${chalk.bold('Options:')}
  --repo <owner/name>      Repository when target is not a full URL
  --mode <auto|pr|issue>   Target type hint (default: auto)
  --out <path>             Write the prompt/checklist to a markdown file
  --json                   Print machine-readable JSON
  -h, --help               Show this help
`);
}

export async function handleGithubCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printGithubHelp();
        return;
    }
    if (action !== 'takeover') {
        throw new Error(`Unknown github command: ${action}. Use "happy github takeover".`);
    }

    const parsed = parseWorkflowArgs(args.slice(1), new Set(['--repo', '--mode', '--out']));
    if (booleanFlag(parsed, '--help') || booleanFlag(parsed, '-h')) {
        printGithubHelp();
        return;
    }

    const target = parsed.positionals[0];
    if (!target) {
        throw new Error('Target required. Use "happy github takeover <issue-or-pr-url-or-number>".');
    }

    const mode = stringFlag(parsed, '--mode') ?? 'auto';
    if (mode !== 'auto' && mode !== 'pr' && mode !== 'issue') {
        throw new Error('--mode must be one of: auto, pr, issue.');
    }

    const input: GithubTakeoverInput = {
        target,
        repo: stringFlag(parsed, '--repo'),
        mode,
    };
    const report = buildGithubTakeoverReport(input);

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify({ ...input, report }, null, 2));
        return;
    }

    await printOrWriteOutput(report, stringFlag(parsed, '--out'));
}
