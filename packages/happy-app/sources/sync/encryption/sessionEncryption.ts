import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { RawRecord } from '../typesRaw';
import { ApiMessage } from '../apiTypes';
import { DecryptedMessage, Metadata, MetadataSchema, AgentState, AgentStateSchema } from '../storageTypes';
import { EncryptionCache } from './encryptionCache';
import { Decryptor, Encryptor } from './encryptor';

export class SessionEncryption {
    private sessionId: string;
    private encryptor: Encryptor & Decryptor;
    private cache: EncryptionCache;

    constructor(
        sessionId: string,
        encryptor: Encryptor & Decryptor,
        cache: EncryptionCache
    ) {
        this.sessionId = sessionId;
        this.encryptor = encryptor;
        this.cache = cache;
    }

    /**
     * Batch-first API for decrypting messages
     */
    async decryptMessages(messages: ApiMessage[]): Promise<(DecryptedMessage | null)[]> {
        // Check cache for all messages first
        const results: (DecryptedMessage | null)[] = new Array(messages.length);
        const toDecrypt: { index: number; message: ApiMessage }[] = [];

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (!message) {
                results[i] = null;
                continue;
            }

            // Check cache first
            const cached = this.cache.getCachedMessage(message.id);
            if (cached) {
                results[i] = cached;
            } else if (message.content.t === 'encrypted') {
                toDecrypt.push({ index: i, message });
            } else {
                // Not encrypted or invalid
                results[i] = {
                    id: message.id,
                    seq: message.seq,
                    localId: message.localId ?? null,
                    content: null,
                    createdAt: message.createdAt,
                    sentBy: message.sentBy ?? null,
                    sentByName: message.sentByName ?? null,
                };
                this.cache.setCachedMessage(message.id, results[i]!);
            }
        }

        // Batch decrypt uncached messages
        if (toDecrypt.length > 0) {
            const encrypted = toDecrypt.map(item =>
                decodeBase64(item.message.content.c, 'base64')
            );
            
            const decrypted = await this.encryptor.decrypt(encrypted);

            for (let i = 0; i < toDecrypt.length; i++) {
                const decryptedData = decrypted[i];
                const { message, index } = toDecrypt[i];

                if (decryptedData) {
                    const result: DecryptedMessage = {
                        id: message.id,
                        seq: message.seq,
                        localId: message.localId ?? null,
                        content: decryptedData,
                        createdAt: message.createdAt,
                        sentBy: message.sentBy ?? null,
                        sentByName: message.sentByName ?? null,
                    };
                    this.cache.setCachedMessage(message.id, result);
                    results[index] = result;
                } else {
                    const result: DecryptedMessage = {
                        id: message.id,
                        seq: message.seq,
                        localId: message.localId ?? null,
                        content: null,
                        createdAt: message.createdAt,
                        sentBy: message.sentBy ?? null,
                        sentByName: message.sentByName ?? null,
                    };
                    this.cache.setCachedMessage(message.id, result);
                    results[index] = result;
                }
            }
        }

        return results;
    }

    /**
     * Single message convenience method
     */
    async decryptMessage(message: ApiMessage | null | undefined): Promise<DecryptedMessage | null> {
        if (!message) {
            return null;
        }
        const results = await this.decryptMessages([message]);
        return results[0];
    }

    /**
     * Encrypt a raw record
     */
    async encryptRawRecord(record: RawRecord): Promise<string> {
        const encrypted = await this.encryptor.encrypt([record]);
        return encodeBase64(encrypted[0], 'base64');
    }

    /**
     * Encrypt raw data using session-specific encryption
     */
    async encryptRaw(data: any): Promise<string> {
        const encrypted = await this.encryptor.encrypt([data]);
        return encodeBase64(encrypted[0], 'base64');
    }

    /**
     * Decrypt raw data using session-specific encryption.
     *
     * Backward-compatible wrapper: returns null on every failure path so
     * existing callers (messages, settings, etc.) keep their null-tolerant
     * code paths. For callers that want failure detail (sessionRPC throws
     * a user-visible error), use decryptRawDetailed instead.
     */
    async decryptRaw(encrypted: string): Promise<any | null> {
        const detailed = await this.decryptRawDetailed(encrypted);
        return detailed.ok ? detailed.value : null;
    }

    /**
     * Same as decryptRaw but reports which stage of decryption failed
     * (base64 decode / AES-GCM auth / null result) and how big the payload
     * was. sessionRPC uses this to surface the stage in its thrown Error
     * so the file-viewer modal alert tells the user "decrypt failed at
     * encryptor.decrypt: auth-tag mismatch (payload 601432 chars)" instead
     * of just "undecryptable payload".
     */
    async decryptRawDetailed(encrypted: string): Promise<
        | { ok: true; value: any }
        | { ok: false; stage: 'decodeBase64' | 'encryptor.decrypt' | 'null-result'; error: string; encryptedLen: number }
    > {
        let stage: 'decodeBase64' | 'encryptor.decrypt' | 'null-result' = 'decodeBase64';
        try {
            const encryptedData = decodeBase64(encrypted, 'base64');
            stage = 'encryptor.decrypt';
            const decrypted = await this.encryptor.decrypt([encryptedData]);
            if (decrypted[0] == null) {
                return { ok: false, stage: 'null-result', error: 'decryptor returned null/empty', encryptedLen: encrypted.length };
            }
            return { ok: true, value: decrypted[0] };
        } catch (error) {
            return {
                ok: false,
                stage,
                error: error instanceof Error ? error.message : String(error),
                encryptedLen: encrypted.length,
            };
        }
    }

    /**
     * Encrypt metadata using session-specific encryption
     */
    async encryptMetadata(metadata: Metadata): Promise<string> {
        const encrypted = await this.encryptor.encrypt([metadata]);
        return encodeBase64(encrypted[0], 'base64');
    }

    /**
     * Decrypt metadata using session-specific encryption
     */
    async decryptMetadata(version: number, encrypted: string): Promise<Metadata | null> {
        // Check cache first
        const cached = this.cache.getCachedMetadata(this.sessionId, version);
        if (cached) {
            return cached;
        }

        // Decrypt if not cached
        const encryptedData = decodeBase64(encrypted, 'base64');
        const decrypted = await this.encryptor.decrypt([encryptedData]);
        if (!decrypted[0]) {
            return null;
        }
        const parsed = MetadataSchema.safeParse(decrypted[0]);
        if (!parsed.success) {
            return null;
        }

        // Cache the result
        this.cache.setCachedMetadata(this.sessionId, version, parsed.data);
        return parsed.data;
    }

    /**
     * Encrypt agent state using session-specific encryption
     */
    async encryptAgentState(state: AgentState): Promise<string> {
        const encrypted = await this.encryptor.encrypt([state]);
        return encodeBase64(encrypted[0], 'base64');
    }

    /**
     * Decrypt agent state using session-specific encryption
     */
    async decryptAgentState(version: number, encrypted: string | null | undefined): Promise<AgentState> {
        if (!encrypted) {
            return {};
        }

        // Check cache first
        const cached = this.cache.getCachedAgentState(this.sessionId, version);
        if (cached) {
            return cached;
        }

        // Decrypt if not cached
        const encryptedData = decodeBase64(encrypted, 'base64');
        const decrypted = await this.encryptor.decrypt([encryptedData]);
        if (!decrypted[0]) {
            return {};
        }
        const parsed = AgentStateSchema.safeParse(decrypted[0]);
        if (!parsed.success) {
            return {};
        }

        // Cache the result
        this.cache.setCachedAgentState(this.sessionId, version, parsed.data);
        return parsed.data;
    }
}