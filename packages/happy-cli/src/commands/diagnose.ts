import chalk from 'chalk';
import { buildRemoteDiagnoseReport, RemoteDiagnoseInput } from './workflowReports';
import { booleanFlag, parseWorkflowArgs, printOrWriteOutput, stringFlag } from './workflowCommon';

function printDiagnoseHelp(): void {
    console.log(`
${chalk.bold('happy diagnose')} - Diagnosis evidence helpers

${chalk.bold('Usage:')}
  happy diagnose remote --host <host> [options]

${chalk.bold('Options:')}
  --host <host>           SSH host alias or user@host
  --service <name>        Service/container name for docker logs
  --keyword <text>        Keyword to grep in logs
  --since <duration>      Log window, e.g. "2 hours ago" or "2026-05-13 10:00"
  --health-url <url>      Health endpoint to curl on the host
  --out <path>            Write the evidence pack to a markdown file
  --json                  Print machine-readable JSON
  -h, --help              Show this help
`);
}

export async function handleDiagnoseCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printDiagnoseHelp();
        return;
    }
    if (action !== 'remote') {
        throw new Error(`Unknown diagnose command: ${action}. Use "happy diagnose remote".`);
    }

    const parsed = parseWorkflowArgs(args.slice(1), new Set(['--host', '--service', '--keyword', '--since', '--health-url', '--out']));
    if (booleanFlag(parsed, '--help') || booleanFlag(parsed, '-h')) {
        printDiagnoseHelp();
        return;
    }

    const host = stringFlag(parsed, '--host') ?? parsed.positionals[0];
    if (!host) {
        throw new Error('--host is required.');
    }

    const input: RemoteDiagnoseInput = {
        host,
        service: stringFlag(parsed, '--service'),
        keyword: stringFlag(parsed, '--keyword'),
        since: stringFlag(parsed, '--since') ?? '2 hours ago',
        healthUrl: stringFlag(parsed, '--health-url'),
    };
    const report = buildRemoteDiagnoseReport(input);

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify({ ...input, report }, null, 2));
        return;
    }

    await printOrWriteOutput(report, stringFlag(parsed, '--out'));
}
