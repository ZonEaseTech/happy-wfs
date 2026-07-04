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

export type BugTiptapNode = {
    type: string;
    text?: string;
    attrs?: Record<string, any>;
    content?: BugTiptapNode[];
};

export type BugTiptapDoc = {
    type: 'doc';
    content?: BugTiptapNode[];
};

export type SerializeBugTiptapContentOptions = {
    attachmentIndexBySrc?: Map<string, number>;
    newImageIndexOffset?: number;
};

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

function textNode(text: string): BugTiptapNode {
    return { type: 'text', text };
}

function paragraphNode(text: string): BugTiptapNode {
    return text ? { type: 'paragraph', content: [textNode(text)] } : { type: 'paragraph' };
}

function nodePlainText(node: BugTiptapNode): string {
    if (node.type === 'text') return node.text ?? '';
    if (!node.content?.length) return '';
    return node.content.map(nodePlainText).join('');
}

export function getBugTiptapPlainText(doc: BugTiptapDoc | null | undefined): string {
    if (!doc?.content?.length) return '';
    return doc.content
        .filter(node => node.type !== 'image')
        .map(nodePlainText)
        .map(text => text.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

export function bugRichContentToTiptapDoc<TAttachment extends { url: string }>(
    description: string,
    attachments: TAttachment[],
): BugTiptapDoc {
    const blocks = parseBugRichContent(description, attachments);
    const content: BugTiptapNode[] = [];

    for (const block of blocks) {
        if (block.type === 'text') {
            const paragraphs = block.text
                .split(/\n{2,}/)
                .map(text => text.trim())
                .filter(Boolean);
            content.push(...paragraphs.map(paragraphNode));
            continue;
        }
        content.push({
            type: 'image',
            attrs: {
                src: block.attachment.url,
                alt: `bug image ${block.attachmentIndex + 1}`,
                title: null,
            },
        });
    }

    return { type: 'doc', content: content.length > 0 ? content : [paragraphNode('')] };
}

export function serializeBugTiptapContent<TImage>(
    doc: BugTiptapDoc,
    resolveImage: (src: string) => TImage | undefined,
    options: SerializeBugTiptapContentOptions = {},
): { description: string; contentJson: BugTiptapDoc; images: TImage[] } {
    const parts: string[] = [];
    const images: TImage[] = [];
    const content: BugTiptapNode[] = [];
    const newImageIndexOffset = options.newImageIndexOffset ?? 0;

    for (const node of doc.content ?? []) {
        if (node.type === 'image') {
            const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
            const existingPlaceholderIndex = src ? bugAttachmentPlaceholderIndex(src) : null;
            const existingAttachmentIndex = src ? options.attachmentIndexBySrc?.get(src) : undefined;
            const preservedIndex = existingPlaceholderIndex == null ? existingAttachmentIndex : existingPlaceholderIndex + 1;
            if (preservedIndex != null) {
                parts.push(makeBugImageMarker(preservedIndex));
                content.push({
                    ...node,
                    attrs: {
                        ...(node.attrs ?? {}),
                        src: makeBugAttachmentPlaceholder(preservedIndex),
                    },
                });
                continue;
            }

            const image = src ? resolveImage(src) : undefined;
            if (image) {
                images.push(image);
                const markerIndex = newImageIndexOffset + images.length;
                parts.push(makeBugImageMarker(markerIndex));
                content.push({
                    ...node,
                    attrs: {
                        ...(node.attrs ?? {}),
                        src: makeBugAttachmentPlaceholder(markerIndex),
                    },
                });
            } else {
                content.push(node);
            }
            continue;
        }
        const text = nodePlainText(node).trim();
        if (text) parts.push(text);
        content.push(node);
    }

    return {
        description: parts.join('\n\n').trim(),
        contentJson: { type: 'doc', content },
        images,
    };
}

export function makeBugAttachmentPlaceholder(index: number): string {
    return `bug-attachment:${index}`;
}

function bugAttachmentPlaceholderIndex(src: string): number | null {
    const match = /^bug-attachment:(\d+)$/.exec(src);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    return Number.isInteger(index) && index >= 0 ? index : null;
}

export function bugTiptapDocWithAttachmentUrls<TAttachment extends { url: string }>(
    doc: BugTiptapDoc | null | undefined,
    attachments: TAttachment[],
): BugTiptapDoc {
    const mapNode = (node: BugTiptapNode): BugTiptapNode => {
        if (node.type === 'image') {
            const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
            const attachmentIndex = bugAttachmentPlaceholderIndex(src);
            const attachmentUrl = attachmentIndex == null ? undefined : attachments[attachmentIndex]?.url;
            if (!attachmentUrl) return { ...node, content: node.content?.map(mapNode) };
            return {
                ...node,
                attrs: {
                    ...(node.attrs ?? {}),
                    src: attachmentUrl,
                },
                content: node.content?.map(mapNode),
            };
        }
        return {
            ...node,
            content: node.content?.map(mapNode),
        };
    };

    return {
        type: 'doc',
        content: (doc?.content?.length ? doc.content : [paragraphNode('')]).map(mapNode),
    };
}

export function bugTiptapDocToRichContent<TAttachment extends { url: string }>(
    doc: BugTiptapDoc | null | undefined,
    attachments: TAttachment[],
): BugRichContentBlock<TAttachment>[] {
    const blocks: BugRichContentBlock<TAttachment>[] = [];
    for (const node of doc?.content ?? []) {
        if (node.type === 'image') {
            const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
            const placeholderIndex = bugAttachmentPlaceholderIndex(src);
            const urlIndex = placeholderIndex == null ? attachments.findIndex(attachment => attachment.url === src) : placeholderIndex;
            const attachment = urlIndex >= 0 ? attachments[urlIndex] : undefined;
            if (attachment) blocks.push({ type: 'image', attachment, attachmentIndex: urlIndex });
            continue;
        }
        const text = nodePlainText(node).trim();
        if (text) blocks.push({ type: 'text', text });
    }
    return blocks;
}
