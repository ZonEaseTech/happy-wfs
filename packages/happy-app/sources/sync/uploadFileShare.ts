import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { base64ToUint8Array } from '@/utils/fileViewerDownload';

export interface PublicFileShareUploadResult {
    url: string;
    path: string;
    fileName: string;
    mimeType: string;
    size: number;
}

export interface UploadPublicFileShareInput {
    base64: string;
    fileName: string;
    mimeType: string;
    token: string;
    apiUrl: string;
}

export async function uploadPublicFileShare(input: UploadPublicFileShareInput): Promise<PublicFileShareUploadResult> {
    const formData = new FormData();
    let tempFile: File | null = null;

    try {
        if (Platform.OS === 'web') {
            const bytes = base64ToUint8Array(input.base64);
            const arrayBuffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(arrayBuffer).set(bytes);
            formData.append('file', new Blob([arrayBuffer], { type: input.mimeType }), input.fileName);
        } else {
            tempFile = new File(Paths.cache, `share-${Date.now()}-${input.fileName}`);
            tempFile.create({ overwrite: true, intermediates: true });
            tempFile.write(input.base64, { encoding: 'base64' });
            formData.append('file', {
                uri: tempFile.uri,
                name: input.fileName,
                type: input.mimeType,
            } as any);
        }
        formData.append('fileName', input.fileName);

        const response = await fetch(`${input.apiUrl}/v1/file-shares`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${input.token}`,
            },
            body: formData,
        });

        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
            throw new Error(result?.error || `File share upload failed: ${response.status}`);
        }

        return result.data as PublicFileShareUploadResult;
    } finally {
        if (tempFile) {
            try {
                tempFile.delete();
            } catch {
                // ignore cleanup errors
            }
        }
    }
}
