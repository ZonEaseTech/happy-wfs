import * as React from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Modal } from '@/modal';
import { t } from '@/text';
import { formatFileSize, MAX_CHAT_FILE_BYTES, type LocalFileAttachment } from '@/utils/fileAttachments';

export interface AddFileAttachmentInput {
    blob: Blob;
    name: string;
    size?: number;
    mimeType?: string;
}

function getBlobSize(blob: Blob, fallback?: number): number {
    if (Number.isFinite(fallback)) return fallback as number;
    const size = (blob as { size?: number }).size;
    return Number.isFinite(size) ? size as number : 0;
}

export function useFileAttachments() {
    const [fileAttachments, setFileAttachments] = React.useState<LocalFileAttachment[]>([]);

    const addFiles = React.useCallback(async (files: AddFileAttachmentInput[]) => {
        const accepted: LocalFileAttachment[] = [];
        const rejected: string[] = [];
        for (const file of files) {
            const size = getBlobSize(file.blob, file.size);
            if (size > MAX_CHAT_FILE_BYTES) {
                rejected.push(`${file.name} (${formatFileSize(size)})`);
                continue;
            }
            accepted.push({
                id: randomUUID(),
                name: file.name || 'file',
                size,
                mimeType: file.mimeType,
                blob: file.blob,
            });
        }
        if (accepted.length > 0) {
            setFileAttachments(prev => [...prev, ...accepted]);
        }
        if (rejected.length > 0) {
            Modal.alert(t('common.error'), `单个文件不能超过 100MB：\n${rejected.join('\n')}`);
        }
        return accepted.length;
    }, []);

    const pickFiles = React.useCallback(async () => {
        const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            multiple: true,
            copyToCacheDirectory: true,
            base64: false,
        });
        if (result.canceled) return;
        await addFiles(result.assets.map((asset) => {
            const blob = (asset.file ?? new ExpoFile(asset.uri)) as unknown as Blob;
            return {
                blob,
                name: asset.name,
                size: asset.size,
                mimeType: asset.mimeType,
            };
        }));
    }, [addFiles]);

    const removeFileAttachment = React.useCallback((index: number) => {
        setFileAttachments(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearFileAttachments = React.useCallback(() => {
        setFileAttachments([]);
    }, []);

    return {
        fileAttachments,
        setFileAttachments,
        addFiles,
        pickFiles,
        removeFileAttachment,
        clearFileAttachments,
    };
}
