/**
 * Non-interactive device enrollment.
 *
 * The app mints a token shaped "<lookupId>.<secret>" and stores the account key
 * sealed to a keypair derived from `secret`. Only `lookupId` is sent to the
 * server here, so the server can hand back the sealed blob without ever being
 * able to open it — the same end-to-end property as the QR auth flow, minus the
 * interactive step.
 */

import axios from 'axios';
import { randomBytes } from 'node:crypto';
import { configuration } from '@/configuration';
import { decodeBase64 } from '@/api/encryption';
import { decryptWithEphemeralKey } from '@/ui/auth';
import { writeCredentialsLegacy, writeCredentialsDataKey, readCredentials } from '@/persistence';

export type EnrollResult = {
    alreadyEnrolled: boolean;
};

function parseEnrollToken(raw: string): { lookupId: string; secret: Uint8Array } {
    const trimmed = raw.trim();
    const separator = trimmed.indexOf('.');
    if (separator <= 0 || separator === trimmed.length - 1) {
        throw new Error('Invalid enrollment token format');
    }
    const lookupId = trimmed.slice(0, separator);
    const secret = decodeBase64(trimmed.slice(separator + 1), 'base64url');
    if (secret.length !== 32) {
        throw new Error('Invalid enrollment token secret');
    }
    return { lookupId, secret };
}

export async function enrollDevice(rawToken: string, options: { force?: boolean } = {}): Promise<EnrollResult> {
    const existing = await readCredentials();
    if (existing && !options.force) {
        return { alreadyEnrolled: true };
    }

    const { lookupId, secret } = parseEnrollToken(rawToken);

    let response: { token: string; response: string };
    try {
        const result = await axios.post<{ token: string; response: string }>(
            `${configuration.serverUrl}/v1/devices/enroll`,
            { lookupId },
            { timeout: 30000 }
        );
        response = result.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            const message = (error.response.data as { error?: string })?.error ?? `HTTP ${error.response.status}`;
            throw new Error(`Enrollment failed: ${message}`);
        }
        throw error;
    }

    const sealed = decodeBase64(response.response);
    const opened = decryptWithEphemeralKey(sealed, secret);
    if (!opened) {
        throw new Error('Enrollment failed: could not open the account key with this token');
    }

    if (opened.length === 32) {
        await writeCredentialsLegacy({ secret: opened, token: response.token });
        return { alreadyEnrolled: false };
    }
    if (opened[0] === 0 && opened.length >= 33) {
        await writeCredentialsDataKey({
            publicKey: opened.slice(1, 33),
            machineKey: randomBytes(32),
            token: response.token
        });
        return { alreadyEnrolled: false };
    }
    throw new Error('Enrollment failed: unsupported account key format');
}
