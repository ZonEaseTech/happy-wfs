import { useState, useCallback, useEffect, useRef } from 'react';
import { accessPublicShare, getPublicShareMessages, sendPublicShareMessage } from '@/sync/apiSharing';
import type { PublicShareMessagePage } from '@/sync/apiSharing';
import { decryptDataKeyFromPublicShare } from '@/sync/encryption/publicShareEncryption';
import { AES256Encryption } from '@/sync/encryption/encryptor';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { normalizeRawMessage } from '@/sync/typesRaw';
import type { RawRecord } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { getServerUrl } from '@/sync/serverConfig';
import { PublicShareNotFoundError, ConsentRequiredError, ShareUserProfile } from '@/sync/sharingTypes';
import { Message } from '@/sync/typesMessage';
import { Metadata, MetadataSchema } from '@/sync/storageTypes';
import { randomUUID } from 'expo-crypto';

export type PublicShareState = 'loading' | 'loaded' | 'error' | 'consent-required' | 'not-found';

function minSeq(page: PublicShareMessagePage): number | null {
    if (page.messages.length === 0) {
        return null;
    }
    return Math.min(...page.messages.map((m) => m.seq));
}

async function decryptMessagePage(page: PublicShareMessagePage, decryptor: AES256Encryption): Promise<Message[]> {
    if (page.messages.length === 0) {
        return [];
    }

    // API returns newest first. Reducer expects chronological events, while the list stores newest first.
    const reversed = [...page.messages].reverse();
    const encryptedBytes = reversed.map(m => decodeBase64(m.content.c, 'base64'));
    const decryptedContents = await decryptor.decrypt(encryptedBytes);

    const normalizedMessages = reversed
        .map((m, i) => {
            const content = decryptedContents[i];
            if (!content) return null;
            return normalizeRawMessage(m.id, m.localId, m.createdAt, content);
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

    const result = reducer(createReducer(), normalizedMessages);
    result.messages.sort((a, b) => b.createdAt - a.createdAt);
    return result.messages;
}

export function usePublicShareSession(token: string) {
    const [state, setState] = useState<PublicShareState>('loading');
    const [messages, setMessages] = useState<Message[]>([]);
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [owner, setOwner] = useState<ShareUserProfile | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [allowChat, setAllowChat] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const consentRef = useRef(false);
    const decryptorRef = useRef<AES256Encryption | null>(null);
    const oldestSeqRef = useRef<number | null>(null);
    const loadMoreInFlightRef = useRef(false);

    const load = useCallback(async (withConsent: boolean) => {
        try {
            consentRef.current = withConsent;
            setState('loading');
            setHasMore(false);
            setAllowChat(false);
            oldestSeqRef.current = null;
            decryptorRef.current = null;
            const serverUrl = getServerUrl();
            const consent = consentRef.current || undefined;

            // 1. Access public share to get session info + encrypted data key
            const shareData = await accessPublicShare(serverUrl, token, consent);
            setOwner(shareData.owner);
            setSessionId(shareData.session.id);
            setAllowChat(shareData.allowChat === true);

            // 2. Decrypt data key from token
            const dataKey = await decryptDataKeyFromPublicShare(shareData.encryptedDataKey, token);
            if (!dataKey) {
                setState('error');
                return;
            }

            const decryptor = new AES256Encryption(dataKey);
            decryptorRef.current = decryptor;

            // 3. Decrypt metadata
            if (shareData.session.metadata) {
                try {
                    const metadataBytes = decodeBase64(shareData.session.metadata, 'base64');
                    const [decryptedMetadata] = await decryptor.decrypt([metadataBytes]);
                    if (decryptedMetadata) {
                        const parsed = MetadataSchema.safeParse(decryptedMetadata);
                        if (parsed.success) {
                            setMetadata(parsed.data);
                        }
                    }
                } catch {
                    // Metadata decryption is non-critical
                }
            }

            // 4. Fetch encrypted messages
            const page = await getPublicShareMessages(serverUrl, token, { consent });
            oldestSeqRef.current = minSeq(page);
            setHasMore(page.hasMore);

            // 5. Decrypt and normalize messages
            const pageMessages = await decryptMessagePage(page, decryptor);
            setMessages(pageMessages);
            setState('loaded');
        } catch (e) {
            if (e instanceof PublicShareNotFoundError) {
                setState('not-found');
            } else if (e instanceof ConsentRequiredError) {
                setOwner(e.owner);
                setState('consent-required');
            } else {
                setState('error');
            }
        }
    }, [token]);

    useEffect(() => {
        load(false);
    }, [load]);

    const loadMore = useCallback(async () => {
        if (!hasMore || oldestSeqRef.current === null || loadMoreInFlightRef.current || !decryptorRef.current) {
            return;
        }

        loadMoreInFlightRef.current = true;
        setIsLoadingMore(true);
        try {
            const serverUrl = getServerUrl();
            const page = await getPublicShareMessages(serverUrl, token, {
                consent: consentRef.current || undefined,
                before: oldestSeqRef.current,
            });
            oldestSeqRef.current = minSeq(page) ?? oldestSeqRef.current;
            setHasMore(page.hasMore);

            const olderMessages = await decryptMessagePage(page, decryptorRef.current);
            if (olderMessages.length > 0) {
                setMessages((current) => {
                    const byId = new Map<string, Message>();
                    for (const message of current) byId.set(message.id, message);
                    for (const message of olderMessages) byId.set(message.id, message);
                    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
                });
            }
        } catch {
            // Public share pages are read-only: keep currently loaded messages and allow retry on next scroll.
        } finally {
            loadMoreInFlightRef.current = false;
            setIsLoadingMore(false);
        }
    }, [hasMore, token]);

    const giveConsent = useCallback(() => {
        if (!consentRef.current) {
            consentRef.current = true;
            load(true);
        }
    }, [load]);

    const refreshMessages = useCallback(async () => {
        const decryptor = decryptorRef.current;
        if (!decryptor) {
            return;
        }

        const page = await getPublicShareMessages(getServerUrl(), token, {
            consent: consentRef.current || undefined,
            limit: 50,
        });
        const latestMessages = await decryptMessagePage(page, decryptor);
        const latestMinSeq = minSeq(page);
        if (latestMinSeq !== null) {
            oldestSeqRef.current = oldestSeqRef.current === null
                ? latestMinSeq
                : Math.min(oldestSeqRef.current, latestMinSeq);
        }
        if (page.hasMore) {
            setHasMore(true);
        }
        if (latestMessages.length > 0) {
            setMessages((current) => {
                const byId = new Map<string, Message>();
                for (const message of current) byId.set(message.id, message);
                for (const message of latestMessages) byId.set(message.id, message);
                return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
            });
        }
    }, [token]);

    useEffect(() => {
        if (state !== 'loaded' || !allowChat) {
            return;
        }

        const id = setInterval(() => {
            refreshMessages().catch(() => {
                // Public share polling is best-effort.
            });
        }, 5000);
        return () => clearInterval(id);
    }, [allowChat, refreshMessages, state]);

    const sendMessage = useCallback(async (text: string): Promise<boolean> => {
        const trimmed = text.trim();
        const decryptor = decryptorRef.current;
        if (!trimmed || !allowChat || !decryptor) {
            return false;
        }

        const localId = randomUUID();
        const rawRecord: RawRecord = {
            role: 'user',
            content: {
                type: 'text',
                text: trimmed,
            },
            meta: {
                sentFrom: 'public-share',
                permissionMode: 'default',
            },
        };

        setIsSending(true);
        try {
            const [encrypted] = await decryptor.encrypt([rawRecord]);
            const sent = await sendPublicShareMessage(getServerUrl(), token, {
                content: encodeBase64(encrypted, 'base64'),
                localId,
                consent: consentRef.current || undefined,
            });

            const sentMessage: Message = {
                kind: 'user-text',
                id: sent.id,
                localId: sent.localId ?? localId,
                createdAt: sent.createdAt,
                seq: sent.seq,
                text: trimmed,
                meta: rawRecord.meta,
                sentBy: null,
                sentByName: sent.sentByName,
            };
            setMessages((current) => {
                const byId = new Map<string, Message>();
                for (const message of current) byId.set(message.id, message);
                byId.set(sentMessage.id, sentMessage);
                return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
            });
            setTimeout(() => {
                refreshMessages().catch(() => {
                    // Best-effort refresh for the public chat view.
                });
            }, 1500);
            return true;
        } catch (e) {
            if (e instanceof PublicShareNotFoundError) {
                setState('not-found');
            } else if (e instanceof ConsentRequiredError) {
                setOwner(e.owner);
                setState('consent-required');
            }
            return false;
        } finally {
            setIsSending(false);
        }
    }, [allowChat, refreshMessages, token]);

    return { state, messages, metadata, owner, sessionId, allowChat, isSending, hasMore, isLoadingMore, loadMore, giveConsent, sendMessage };
}
