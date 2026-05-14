import chalk from 'chalk';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { booleanFlag, parseWorkflowArgs, stringFlag } from './workflowCommon';

type GuardPackage = 'happy-cli' | 'happy-app' | 'happy-server';
type StepStatus = 'passed' | 'failed' | 'skipped';

interface GuardStep {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    optional?: boolean;
}

interface GuardStepResult {
    name: string;
    status: StepStatus;
    exitCode: number | null;
}

const CLI_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function printReleaseHelp(): void {
    console.log(`
${chalk.bold('happy release')} - Verify before publishing

${chalk.bold('Usage:')}
  happy release guard [options]

${chalk.bold('Options:')}
  --package <name>     happy-cli | happy-app | happy-server (default: happy-cli)
  --publish <target>   none | npm (default: none)
  --yes                Actually publish after all checks pass
  --dry-run            Alias for the default safe mode; never publishes
  --full               For happy-cli, run the full test suite instead of focused command tests
  --json               Print final machine-readable result
  -h, --help           Show this help

${chalk.bold('Safety:')}
  Publishing never happens unless both --publish npm and --yes are present.
`);
}

function commandName(command: string): string {
    if (process.platform !== 'win32') return command;
    if (command === 'yarn') return 'yarn.cmd';
    if (command === 'npm') return 'npm.cmd';
    if (command === 'npx') return 'npx.cmd';
    return command;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function findWorkspaceRoot(start: string): Promise<string | null> {
    let current = resolve(start);
    while (true) {
        if (await pathExists(join(current, 'packages', 'happy-cli', 'package.json'))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

function parseGuardPackage(value: string | undefined): GuardPackage {
    if (!value || value === 'happy-cli') return 'happy-cli';
    if (value === 'happy-app' || value === 'happy-server') return value;
    throw new Error('--package must be one of: happy-cli, happy-app, happy-server.');
}

async function packageDirectory(packageName: GuardPackage): Promise<string> {
    if (packageName === 'happy-cli') return CLI_PACKAGE_ROOT;
    const workspaceRoot = await findWorkspaceRoot(process.cwd()) ?? await findWorkspaceRoot(CLI_PACKAGE_ROOT);
    if (!workspaceRoot) {
        throw new Error(`Cannot find monorepo root for ${packageName}. Run this from the Happy AI repository checkout.`);
    }
    return join(workspaceRoot, 'packages', packageName);
}

async function runGuardStep(step: GuardStep): Promise<GuardStepResult> {
    if (step.optional && !(await pathExists(step.cwd))) {
        console.log(chalk.yellow(`↷ ${step.name} skipped: ${step.cwd} not found`));
        return { name: step.name, status: 'skipped', exitCode: null };
    }

    console.log(chalk.cyan(`\n▶ ${step.name}`));
    console.log(chalk.gray(`  ${step.command} ${step.args.join(' ')}`));

    const exitCode = await new Promise<number>((resolvePromise) => {
        const child = spawn(commandName(step.command), step.args, {
            cwd: step.cwd,
            stdio: 'inherit',
            env: process.env,
        });
        child.on('close', (code) => resolvePromise(code ?? 1));
        child.on('error', () => resolvePromise(1));
    });

    return { name: step.name, status: exitCode === 0 ? 'passed' : 'failed', exitCode };
}

function guardSteps(packageName: GuardPackage, packageDir: string, full: boolean, includePublishDryRun: boolean): GuardStep[] {
    const publishDryRun: GuardStep[] = includePublishDryRun
        ? [{ name: 'npm publish dry-run', command: 'npm', args: ['publish', '--dry-run', '--registry=https://registry.npmjs.org'], cwd: packageDir }]
        : [];

    if (packageName === 'happy-cli') {
        const testStep = full
            ? { name: 'Full test suite', command: 'yarn', args: ['test'], cwd: packageDir }
            : { name: 'Focused workflow tests', command: 'npx', args: ['vitest', 'run', 'src/commands/workflowReports.test.ts'], cwd: packageDir };
        return [
            { name: 'Typecheck', command: 'yarn', args: ['typecheck'], cwd: packageDir },
            testStep,
            { name: 'Build', command: 'yarn', args: ['build'], cwd: packageDir },
            ...publishDryRun,
        ];
    }

    if (packageName === 'happy-app') {
        return [
            { name: 'Typecheck', command: 'yarn', args: ['typecheck'], cwd: packageDir },
            { name: 'Parse changelog', command: 'npx', args: ['tsx', 'sources/scripts/parseChangelog.ts'], cwd: packageDir },
        ];
    }

    return [
        { name: 'Build', command: 'yarn', args: ['build'], cwd: packageDir },
    ];
}

export async function handleReleaseCommand(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === '-h' || action === '--help') {
        printReleaseHelp();
        return;
    }
    if (action !== 'guard') {
        throw new Error(`Unknown release command: ${action}. Use "happy release guard".`);
    }

    const parsed = parseWorkflowArgs(args.slice(1), new Set(['--package', '--publish']));
    const packageName = parseGuardPackage(stringFlag(parsed, '--package'));
    const publishTarget = stringFlag(parsed, '--publish') ?? 'none';
    const dryRunOnly = booleanFlag(parsed, '--dry-run');
    if (publishTarget !== 'none' && publishTarget !== 'npm') {
        throw new Error('--publish must be one of: none, npm.');
    }

    const packageDir = await packageDirectory(packageName);
    const includePublishDryRun = packageName === 'happy-cli' || publishTarget === 'npm';
    const steps = guardSteps(packageName, packageDir, booleanFlag(parsed, '--full'), includePublishDryRun);
    const results: GuardStepResult[] = [];

    for (const step of steps) {
        const result = await runGuardStep(step);
        results.push(result);
        if (result.status === 'failed') {
            console.error(chalk.red(`\n✗ Release guard failed at: ${result.name}`));
            if (booleanFlag(parsed, '--json')) {
                console.log(JSON.stringify({ packageName, packageDir, publishTarget, dryRunOnly, results, ok: false }, null, 2));
            }
            process.exit(1);
        }
    }

    if (publishTarget === 'npm' && packageName !== 'happy-cli') {
        throw new Error('npm publish is currently supported only for happy-cli.');
    }

    if (publishTarget === 'npm' && !dryRunOnly) {
        if (!booleanFlag(parsed, '--yes')) {
            console.log(chalk.yellow('\n✓ Checks passed. Skipping publish because --yes was not provided.'));
            console.log(chalk.gray('  To publish: happy release guard --package happy-cli --publish npm --yes'));
        } else {
            const publishResult = await runGuardStep({
                name: 'npm publish',
                command: 'npm',
                args: ['publish', '--registry=https://registry.npmjs.org'],
                cwd: packageDir,
            });
            results.push(publishResult);
            if (publishResult.status === 'failed') process.exit(1);
        }
    } else {
        const reason = dryRunOnly ? 'Dry-run mode; no publish requested.' : 'No publish requested.';
        console.log(chalk.green(`\n✓ Release guard passed. ${reason}`));
    }

    if (booleanFlag(parsed, '--json')) {
        console.log(JSON.stringify({ packageName, packageDir, publishTarget, dryRunOnly, results, ok: true }, null, 2));
    }
}
