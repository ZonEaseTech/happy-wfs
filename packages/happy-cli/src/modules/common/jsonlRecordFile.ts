/**
 * Append-only JSON Lines files for per-session records (tool outputs, diffs).
 *
 * Saving used to read the whole JSON array, push one record and rewrite the
 * file synchronously. A long Codex session grows that file to hundreds of MB,
 * so every tool call blocked the event loop for seconds: heartbeats stopped
 * going out and the server marked the session inactive. Appending one line
 * keeps each save proportional to the record, and writing asynchronously keeps
 * slow disks off the main thread.
 */

import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

// Appends to one file run one after another: a large record is written in
// several chunks, and two appends in flight at once could interleave them.
const pendingAppends = new Map<string, Promise<void>>();

export async function appendJsonLines(filePath: string, records: unknown[]): Promise<void> {
    // Serialize now, before any await: callers keep the objects and may change them later
    const data = records.map((record) => `${JSON.stringify(record)}\n`).join('');

    const previous = pendingAppends.get(filePath) ?? Promise.resolve();
    const current = previous.then(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, data, 'utf-8');
    });

    // The queue itself never rejects, so one failed append does not fail the ones after it
    const settled = current.catch(() => {});
    pendingAppends.set(filePath, settled);
    void settled.then(() => {
        if (pendingAppends.get(filePath) === settled) pendingAppends.delete(filePath);
    });

    return current;
}

/**
 * Returns the first record in a JSON Lines file that matches, after appends
 * already queued for the file have landed. Lines that do not contain `needle`
 * are skipped without parsing.
 */
export async function findJsonLine<T>(
    filePath: string,
    needle: string,
    match: (record: T) => boolean
): Promise<T | null> {
    await pendingAppends.get(filePath);
    if (!existsSync(filePath)) return null;

    const fileStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    try {
        for await (const line of rl) {
            if (!line.includes(needle)) continue;
            try {
                const record = JSON.parse(line) as T;
                if (match(record)) return record;
            } catch {
                // A line cut short by a crash mid-append; skip it
            }
        }
        return null;
    } finally {
        rl.close();
        fileStream.destroy();
    }
}

/** Files written before the switch to JSON Lines hold one JSON array. */
export async function findInJsonArrayFile<T>(
    filePath: string,
    match: (record: T) => boolean
): Promise<T | null> {
    if (!existsSync(filePath)) return null;

    const records: T[] = JSON.parse(await readFile(filePath, 'utf-8'));
    return records.find(match) ?? null;
}
