import type { LocalImage } from '@/components/ImagePreview';
import type { BugTiptapDoc } from '@/sync/bugRichContent';

export type BugTiptapEditorSnapshot = {
    doc: BugTiptapDoc;
    contentJson: BugTiptapDoc;
    plainText: string;
    imageCount: number;
    description: string;
    images: LocalImage[];
};

export type BugTiptapEditorHandle = {
    focus: () => void;
    insertImages: (images: LocalImage[]) => void;
    getSnapshot: () => BugTiptapEditorSnapshot;
};

export type BugTiptapEditorProps = {
    onChange: (snapshot: BugTiptapEditorSnapshot) => void;
    initialDoc?: BugTiptapDoc;
    initialContentKey?: string;
    attachmentImageUrls?: string[];
    onImageDoubleClick?: (src: string) => void;
    variant?: 'create' | 'detail';
    contentInset?: 'padded' | 'none';
};
