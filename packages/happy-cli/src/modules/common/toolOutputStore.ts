import { join } from 'node:path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { appendJsonLines, findInJsonArrayFile, findJsonLine } from './jsonlRecordFile';

export interface ToolOutputRecord {
    callId: string;
    toolName: string;
    agent: 'claude' | 'codex' | 'gemini';
    result: unknown;
    timestamp: number;
}

const toolOutputsDir = join(configuration.happyHomeDir, 'tool-outputs');

function getFilePath(sessionId: string): string {
    return join(toolOutputsDir, `${sessionId}.jsonl`);
}

// Written by versions that rewrote one JSON array per save; still read, never written
function getLegacyFilePath(sessionId: string): string {
    return join(toolOutputsDir, `${sessionId}.json`);
}

export function saveToolOutputRecord(sessionId: string, record: ToolOutputRecord): void {
    appendJsonLines(getFilePath(sessionId), [record]).then(
        () => logger.debug(`[ToolOutputStore] Saved output for ${record.toolName} (${record.callId}) in session ${sessionId}`),
        (error) => logger.warn('[ToolOutputStore] Failed to save tool output record:', error)
    );
}

export async function getToolOutputRecord(sessionId: string, callId: string): Promise<ToolOutputRecord | null> {
    try {
        const match = (record: ToolOutputRecord) => record.callId === callId;
        return await findJsonLine(getFilePath(sessionId), JSON.stringify(callId), match)
            ?? await findInJsonArrayFile(getLegacyFilePath(sessionId), match);
    } catch (error) {
        logger.warn('[ToolOutputStore] Failed to get tool output record:', error);
        return null;
    }
}
