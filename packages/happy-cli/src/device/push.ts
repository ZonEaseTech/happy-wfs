/**
 * `happy device push <device> <local> <remote>` — copy a file to a device.
 *
 * Exists because the tunnels these machines are usually reached through are not
 * dependable, and a command channel alone cannot move a file. Piping base64
 * through `happy ssh` is not a substitute: the payload becomes a shell argument
 * and dies on the command-line length limit well before a useful file size.
 *
 * There is no delta transfer here. This ships whole files, so a caller syncing
 * a working tree should tar the changed set and push one archive rather than
 * calling this per file — each call is its own encrypted round trip.
 */

import { readFile, stat } from 'node:fs/promises';
import { io, type Socket } from 'socket.io-client';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { encodeBase64, encrypt, decrypt, decodeBase64 } from '@/api/encryption';
import { resolveDeviceForCommand } from './ssh';

/**
 * writeFile rides one socket.io ack and the server caps a frame at 20MB;
 * base64 plus the encryption envelope runs about 1.4x. Splitting here rather
 * than making the caller do it keeps the chunk size an implementation detail.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

interface WriteFileResponse {
    success: boolean;
    bytesWritten?: number;
    error?: string;
}

export async function pushToDevice(
    credentials: Credentials,
    query: string,
    localPath: string,
    remotePath: string,
): Promise<number> {
    const resolved = await resolveDeviceForCommand(credentials, query);
    if (!resolved) return 1;
    const { device, key, variant } = resolved;

    const info = await stat(localPath).catch(() => null);
    if (!info?.isFile()) {
        console.error(`Not a file: ${localPath}`);
        return 1;
    }
    const contents = await readFile(localPath);

    const socket: Socket = io(configuration.serverUrl, {
        auth: { token: credentials.token, clientType: 'user-scoped' as const },
        path: '/v1/updates',
        transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });

    const writeChunk = async (path: string, chunk: Buffer): Promise<void> => {
        const answer: any = await socket.timeout(120_000).emitWithAck('rpc-call', {
            method: `${device.id}:writeFile`,
            params: encodeBase64(encrypt(key, variant, { path, content: chunk.toString('base64') })),
        });
        if (!answer?.ok) throw new Error(answer?.error || 'writeFile failed');
        const result = decrypt(key, variant, decodeBase64(answer.result)) as WriteFileResponse;
        if (!result?.success) throw new Error(result?.error || 'Device refused the write');
    };

    try {
        if (contents.length <= CHUNK_BYTES) {
            await writeChunk(remotePath, contents);
            console.error(`pushed ${contents.length} bytes to ${device.name}:${remotePath}`);
            return 0;
        }

        // Parts land beside the destination and are joined by the caller's next
        // command, so a partial transfer never leaves a half-written file at
        // the real path.
        const parts = Math.ceil(contents.length / CHUNK_BYTES);
        for (let i = 0; i < parts; i++) {
            await writeChunk(`${remotePath}.part-${i}`, contents.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
            console.error(`  part ${i + 1}/${parts}`);
        }
        console.error(`pushed ${contents.length} bytes to ${device.name}:${remotePath}.part-0..${parts - 1}`);
        console.error(`join with: cat '${remotePath}'.part-* > '${remotePath}' && rm -f '${remotePath}'.part-*`);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    } finally {
        socket.close();
    }
}
