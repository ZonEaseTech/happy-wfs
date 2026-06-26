import { apiSocket } from '@/sync/apiSocket';
import { encodeBase64 } from '@/encryption/base64';
import {
    CHAT_FILE_UPLOAD_ROOT,
    MAX_CHAT_FILE_BYTES,
    buildChatUploadRelativePath,
    type LocalFileAttachment,
    type UploadedSessionFile,
} from '@/utils/fileAttachments';

const CHUNK_BYTES = 1024 * 1024;
const RPC_TIMEOUT_MS = 60_000;
const LEGACY_WRITE_FILE_MAX_BYTES = 10 * 1024 * 1024;

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

function isRpcUnavailable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /RPC method not available|Method not found/i.test(message);
}

async function createDirectoryIfNeeded(sessionId: string, path: string): Promise<void> {
    const response = await apiSocket.sessionRPC<{ success: boolean; error?: string }, { path: string }>(
        sessionId,
        'createDirectory',
        { path },
        RPC_TIMEOUT_MS,
    );
    if (!response.success && !/exists/i.test(response.error || '')) {
        throw new Error(response.error || `Failed to create directory: ${path}`);
    }
}

async function uploadViaLegacyWriteFile(
    sessionId: string,
    file: LocalFileAttachment,
): Promise<UploadedSessionFile> {
    if (file.size > LEGACY_WRITE_FILE_MAX_BYTES) {
        throw new Error('CLI file upload is unavailable. Please update happy CLI and restart daemon.');
    }

    const relativePath = buildChatUploadRelativePath(file.id, file.name);
    const uploadDir = relativePath.split('/').slice(0, -1).join('/');

    await createDirectoryIfNeeded(sessionId, '.happy-ai');
    await createDirectoryIfNeeded(sessionId, CHAT_FILE_UPLOAD_ROOT);
    await createDirectoryIfNeeded(sessionId, uploadDir);

    const content = encodeBase64(new Uint8Array(await file.blob.arrayBuffer()));
    const response = ensureSuccess(await apiSocket.sessionRPC<UploadFileResponse, { path: string; content: string }>(
        sessionId,
        'writeFile',
        { path: relativePath, content },
        RPC_TIMEOUT_MS,
    ), 'Failed to write uploaded file');

    return {
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        relativePath,
        absolutePath: response.absolutePath || relativePath,
    };
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

    let init: UploadFileResponse;
    try {
        init = ensureSuccess(await apiSocket.sessionRPC<UploadFileResponse, typeof basePayload & { fileSize: number }>(
            sessionId,
            'uploadFile.init',
            { ...basePayload, fileSize: file.size },
            RPC_TIMEOUT_MS,
        ), 'Failed to initialize file upload');
    } catch (error) {
        if (isRpcUnavailable(error)) {
            return uploadViaLegacyWriteFile(sessionId, file);
        }
        throw error;
    }

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
