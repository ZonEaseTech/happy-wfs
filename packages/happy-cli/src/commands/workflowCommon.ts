import { writeFile } from 'node:fs/promises';

export interface ParsedWorkflowArgs {
    positionals: string[];
    flags: Map<string, string | true>;
}

export function parseWorkflowArgs(args: string[], valueFlags: Set<string>): ParsedWorkflowArgs {
    const positionals: string[] = [];
    const flags = new Map<string, string | true>();

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('-') || arg === '-') {
            positionals.push(arg);
            continue;
        }

        const equalIndex = arg.indexOf('=');
        const flag = equalIndex === -1 ? arg : arg.slice(0, equalIndex);
        if (equalIndex !== -1) {
            flags.set(flag, arg.slice(equalIndex + 1));
            continue;
        }

        if (valueFlags.has(flag)) {
            const value = args[++i];
            if (!value || value.startsWith('--')) {
                throw new Error(`${flag} requires a value.`);
            }
            flags.set(flag, value);
        } else {
            flags.set(flag, true);
        }
    }

    return { positionals, flags };
}

export function stringFlag(parsed: ParsedWorkflowArgs, flag: string): string | undefined {
    const value = parsed.flags.get(flag);
    if (value === undefined || value === true) return undefined;
    return value;
}

export function numberFlag(parsed: ParsedWorkflowArgs, flag: string): number | undefined {
    const value = stringFlag(parsed, flag);
    if (value === undefined) return undefined;
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue)) {
        throw new Error(`${flag} must be an integer.`);
    }
    return parsedValue;
}

export function booleanFlag(parsed: ParsedWorkflowArgs, flag: string): boolean {
    return parsed.flags.get(flag) === true;
}

export async function printOrWriteOutput(content: string, outputPath: string | undefined): Promise<void> {
    if (outputPath) {
        await writeFile(outputPath, content, 'utf8');
        console.log(outputPath);
    } else {
        console.log(content);
    }
}

export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
