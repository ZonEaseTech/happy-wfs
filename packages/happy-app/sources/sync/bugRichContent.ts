const BUG_IMAGE_MARKER_RE = /\[\[bug-image:(\d+)\]\]/g;

export type BugEditorTextBlock = {
    id: string;
    type: 'text';
    text: string;
};

export type BugEditorImageBlock<TImage> = {
    id: string;
    type: 'image';
    image: TImage;
};

export type BugEditorBlock<TImage> = BugEditorTextBlock | BugEditorImageBlock<TImage>;

export type BugRichTextBlock = {
    type: 'text';
    text: string;
};

export type BugRichImageBlock<TAttachment> = {
    type: 'image';
    attachment: TAttachment;
    attachmentIndex: number;
};

export type BugRichContentBlock<TAttachment> = BugRichTextBlock | BugRichImageBlock<TAttachment>;

export function makeBugImageMarker(index: number): string {
    return `[[bug-image:${index}]]`;
}

export function stripBugImageMarkers(text: string): string {
    return text
        .replace(BUG_IMAGE_MARKER_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function getBugRichPlainText<TImage>(blocks: BugEditorBlock<TImage>[]): string {
    return blocks
        .filter((block): block is BugEditorTextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();
}

export function serializeBugRichContent<TImage>(blocks: BugEditorBlock<TImage>[]): { description: string; images: TImage[] } {
    const parts: string[] = [];
    const images: TImage[] = [];

    for (const block of blocks) {
        if (block.type === 'text') {
            const text = block.text.trim();
            if (text) parts.push(text);
            continue;
        }
        images.push(block.image);
        parts.push(makeBugImageMarker(images.length));
    }

    return {
        description: parts.join('\n\n').trim(),
        images,
    };
}

export function parseBugRichContent<TAttachment>(description: string, attachments: TAttachment[]): BugRichContentBlock<TAttachment>[] {
    const blocks: BugRichContentBlock<TAttachment>[] = [];
    const usedAttachmentIndexes = new Set<number>();
    let lastIndex = 0;

    for (const match of description.matchAll(BUG_IMAGE_MARKER_RE)) {
        const marker = match[0];
        const markerStart = match.index ?? 0;
        const text = description.slice(lastIndex, markerStart).trim();
        if (text) blocks.push({ type: 'text', text });

        const attachmentIndex = Number(match[1]) - 1;
        const attachment = attachments[attachmentIndex];
        if (attachment) {
            usedAttachmentIndexes.add(attachmentIndex);
            blocks.push({ type: 'image', attachment, attachmentIndex });
        }
        lastIndex = markerStart + marker.length;
    }

    const tail = description.slice(lastIndex).trim();
    if (tail) blocks.push({ type: 'text', text: tail });

    attachments.forEach((attachment, index) => {
        if (!usedAttachmentIndexes.has(index)) {
            blocks.push({ type: 'image', attachment, attachmentIndex: index });
        }
    });

    return blocks;
}

export function insertBugImageAtSelection<TImage>(blocks: BugEditorBlock<TImage>[], input: {
    textBlockId: string;
    selectionStart: number;
    selectionEnd: number;
    image: TImage;
    createTextId: () => string;
    createImageId: () => string;
}): BugEditorBlock<TImage>[] {
    const index = blocks.findIndex(block => block.id === input.textBlockId && block.type === 'text');
    const imageBlock: BugEditorImageBlock<TImage> = {
        id: input.createImageId(),
        type: 'image',
        image: input.image,
    };

    if (index < 0) return [...blocks, imageBlock, { id: input.createTextId(), type: 'text', text: '' }];

    const block = blocks[index] as BugEditorTextBlock;
    const start = Math.max(0, Math.min(input.selectionStart, block.text.length));
    const end = Math.max(start, Math.min(input.selectionEnd, block.text.length));
    const before = block.text.slice(0, start);
    const after = block.text.slice(end);

    return [
        ...blocks.slice(0, index),
        { ...block, text: before },
        imageBlock,
        { id: input.createTextId(), type: 'text', text: after },
        ...blocks.slice(index + 1),
    ];
}
