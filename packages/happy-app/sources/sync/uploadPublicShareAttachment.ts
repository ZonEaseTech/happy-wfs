import { Platform } from 'react-native';
import type { LocalImage } from '@/components/ImagePreview';
import type { ImageContent } from './typesRaw';
import { formatFileSize, type LocalFileAttachment } from '@/utils/fileAttachments';

export interface PublicShareUploadedFile {
    url: string;
    path: string;
    fileName: string;
    mimeType?: string;
    size: number;
}

function appendConsent(url: URL, consent?: boolean) {
    if (consent) {
        url.searchParams.set('consent', 'true');
    }
}

export async function uploadPublicShareImage(
    serverUrl: string,
    token: string,
    image: LocalImage,
    consent?: boolean,
): Promise<ImageContent> {
    const formData = new FormData();
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    const filename = `image.${extension}`;

    if (Platform.OS === 'web') {
        const response = await fetch(image.uri);
        const blob = await response.blob();
        formData.append('file', blob, filename);
    } else {
        formData.append('file', {
            uri: image.uri,
            name: filename,
            type: image.mimeType,
        } as any);
    }

    const url = new URL(`${serverUrl}/v1/public-share/${token}/upload-image`);
    appendConsent(url, consent);

    const response = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload image failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'Upload image failed');
    }

    return {
        type: 'image',
        url: result.data.url,
        width: result.data.width,
        height: result.data.height,
        mimeType: result.data.mimeType,
        thumbhash: result.data.thumbhash,
    };
}

export async function uploadPublicShareFile(
    serverUrl: string,
    token: string,
    file: LocalFileAttachment,
    consent?: boolean,
): Promise<PublicShareUploadedFile> {
    const formData = new FormData();
    if (Platform.OS === 'web') {
        formData.append('file', file.blob, file.name);
    } else {
        const nativeFile = file.blob as unknown as { uri?: string };
        formData.append('file', {
            uri: nativeFile.uri,
            name: file.name,
            type: file.mimeType || 'application/octet-stream',
        } as any);
    }
    formData.append('fileName', file.name);

    const url = new URL(`${serverUrl}/v1/public-share/${token}/upload-file`);
    appendConsent(url, consent);

    const response = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload file failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'Upload file failed');
    }

    return result.data;
}

export function buildPublicShareUploadedFilesText(files: PublicShareUploadedFile[]): string {
    if (files.length === 0) return '';
    const lines = files.map((file) => `- ${file.url} (${file.fileName}, ${formatFileSize(file.size)})`);
    return `\n\n我上传了以下文件，请通过 Happy 链接下载后分析：\n${lines.join('\n')}`;
}
