/**
 * One-off repair: restore identity fields (path/host/machineId/claudeSessionId)
 * and a display summary on a session whose metadata was clobbered to a sparse
 * blob. Must run on a machine whose credentials/key-cache can resolve the
 * session's encryption key (typically the machine that owns the session).
 *
 * Usage:
 *   HAPPY_HOME_DIR=~/.happy-ai npx tsx scripts/repair-session-metadata.ts <sessionId> '<fieldsJson>'
 *   fieldsJson: {"path":"...","host":"...","machineId":"...","claudeSessionId":"...","summaryText":"..."}
 */

import axios from 'axios';
import { io } from 'socket.io-client';
import { readCredentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decryptSessionRow } from '@/mcp/sessionDecrypt';
import { encrypt, encodeBase64 } from '@/api/encryption';

const sessionId = process.argv[2];
const fields = JSON.parse(process.argv[3] ?? '{}');
if (!sessionId || !fields.path || !fields.machineId) {
    console.error('usage: repair-session-metadata.ts <sessionId> <fieldsJson with path/machineId>');
    process.exit(1);
}

const credentials = await readCredentials();
if (!credentials) {
    console.error('no credentials');
    process.exit(1);
}

const response = await axios.get<{ sessions: any[] }>(`${configuration.serverUrl}/v1/sessions`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
    timeout: 15000,
});
const raw = response.data.sessions.find((s) => s.id === sessionId);
if (!raw) {
    console.error('session not found in /v1/sessions listing');
    process.exit(1);
}
const decrypted = decryptSessionRow(credentials, raw);
if (!decrypted) {
    console.error('could not resolve session key on this machine');
    process.exit(1);
}
console.log('current metadata:', JSON.stringify(decrypted.metadata));
console.log('metadataVersion:', raw.metadataVersion);

const merged = {
    ...(decrypted.metadata ?? {}),
    path: fields.path,
    host: fields.host,
    machineId: fields.machineId,
    ...(fields.claudeSessionId ? { claudeSessionId: fields.claudeSessionId } : {}),
    ...(fields.summaryText ? { summary: { text: fields.summaryText, updatedAt: Date.now() } } : {}),
};

const socket = io(configuration.serverUrl, {
    auth: { token: credentials.token, clientType: 'session-scoped' as const, sessionId },
    path: '/v1/updates',
    transports: ['websocket'],
});
await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => reject(error));
});
const answer = await socket.timeout(15000).emitWithAck('update-metadata', {
    sid: sessionId,
    expectedVersion: raw.metadataVersion,
    metadata: encodeBase64(encrypt(decrypted.encryptionKey, decrypted.encryptionVariant, merged)),
});
console.log('update answer result:', answer?.result, 'newVersion:', answer?.version);
socket.close();
process.exit(answer?.result === 'success' ? 0 : 2);
