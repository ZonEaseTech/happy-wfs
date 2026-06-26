import { apiSocket } from '@/sync/apiSocket';
import { encodeBase64 } from '@/encryption/base64';
import { MAX_CHAT_FILE_BYTES, type LocalFileAttachment, type UploadedSessionFile } from '@/utils/fileAttachments';

const CHUNK_BYTES = 1024 * 1024;
const RPC_TIMEOUT_MS = 60_000;

interface UploadFileResponse {
    success: boolean;
    error?: string;
    relativePath?: string;
    absolutePath?: string;
    bytesWritten?: number;
}

function ensureSuccess(response: UploadFileResponse, fallback: string): UploadFileResponse {
    if (!response.success) {
        throw new Error(response.error || fallback);
    }
    return response;
}

export async function uploadChatFileToCli(
    sessionId: string,
    file: LocalFileAttachment,
): Promise<UploadedSessionFile> {
    if (file.size > MAX_CHAT_FILE_BYTES) {
        throw new Error('File exceeds 100MB limit');
    }

    const basePayload = {
        uploadId: file.id,
        fileName: file.name,
    };

    const init = ensureSuccess(await apiSocket.sessionRPC<UploadFileResponse, typeof basePayload & { fileSize: number }>(
        sessionId,
        'uploadFile.init',
        { ...basePayload, fileSize: file.size },
        RPC_TIMEOUT_MS,
    ), 'Failed to initialize file upload');

    try {
        let offset = 0;
        while (offset < file.size) {
            const next = Math.min(offset + CHUNK_BYTES, file.size);
            const buffer = await file.blob.slice(offset, next).arrayBuffer();
            const chunkBase64 = encodeBase64(new Uint8Array(buffer));
            ensureSuccess(await apiSocket.sessionRPC<UploadFileResponse, typeof basePayload & { chunkBase64: string }>(
                sessionId,
                'uploadFile.chunk',
                { ...basePayload, chunkBase64 },
                RPC_TIMEOUT_MS,
            ), 'Failed to upload file chunk');
            offset = next;
        }

        const complete = ensureSuccess(await apiSocket.sessionRPC<UploadFileResponse, typeof basePayload & { fileSize: number }>(
            sessionId,
            'uploadFile.complete',
            { ...basePayload, fileSize: file.size },
            RPC_TIMEOUT_MS,
        ), 'Failed to complete file upload');

        return {
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
            relativePath: complete.relativePath || init.relativePath || '',
            absolutePath: complete.absolutePath || init.absolutePath || '',
        };
    } catch (error) {
        void apiSocket.sessionRPC<UploadFileResponse, typeof basePayload>(
            sessionId,
            'uploadFile.abort',
            basePayload,
            RPC_TIMEOUT_MS,
        ).catch(() => undefined);
        throw error;
    }
}
