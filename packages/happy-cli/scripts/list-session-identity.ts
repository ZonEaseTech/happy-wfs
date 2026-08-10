/**
 * Read-only triage: which sessions are missing the identity fields the app
 * needs to render a title? A session without path/host/machineId shows up as
 * "未知", and the cause differs depending on whether it was born that way or
 * lost them later — so print creation and update times alongside.
 *
 * Usage: npx tsx scripts/list-session-identity.ts [limit]
 */

import axios from 'axios';
import { readCredentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decryptSessionRow } from '@/mcp/sessionDecrypt';

const limit = Number(process.argv[2] ?? 25);

const credentials = await readCredentials();
if (!credentials) {
    console.error('no credentials');
    process.exit(1);
}

const response = await axios.get<{ sessions: any[] }>(`${configuration.serverUrl}/v1/sessions`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
    timeout: 20000,
});

const rows = response.data.sessions
    .slice()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

const stamp = (value: number | undefined) => (value ? new Date(value).toISOString().slice(5, 19).replace('T', ' ') : '?');

for (const row of rows) {
    const decrypted = decryptSessionRow(credentials, row);
    const metadata: any = decrypted?.metadata ?? null;
    const identity = metadata
        ? [metadata.path, metadata.host, metadata.machineId].filter(Boolean).length
        : -1;
    const state = identity === -1 ? 'UNDECRYPTABLE' : identity === 0 ? '>>> NO IDENTITY' : `${identity}/3`;
    const keys = metadata ? Object.keys(metadata).length : 0;
    console.log(
        [
            row.id.slice(0, 10),
            state.padEnd(15),
            `keys=${String(keys).padEnd(3)}`,
            `created=${stamp(row.createdAt)}`,
            `updated=${stamp(row.updatedAt)}`,
            `v=${row.metadataVersion}`,
            (metadata?.summary?.text ?? metadata?.path ?? '').toString().slice(0, 40),
        ].join('  '),
    );
}
