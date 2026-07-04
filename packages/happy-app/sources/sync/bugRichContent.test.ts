import { describe, expect, it } from 'vitest';
import {
    bugRichContentToTiptapDoc,
    bugTiptapDocWithAttachmentUrls,
    getBugTiptapPlainText,
    insertBugImageAtSelection,
    parseBugRichContent,
    serializeBugTiptapContent,
    serializeBugRichContent,
    stripBugImageMarkers,
    type BugEditorBlock,
    type BugTiptapDoc,
} from './bugRichContent';

describe('bug rich content', () => {
    it('serializes text and images in display order using stable markers', () => {
        const blocks: BugEditorBlock<string>[] = [
            { id: 't1', type: 'text', text: '第一段说明' },
            { id: 'i1', type: 'image', image: 'image-a' },
            { id: 't2', type: 'text', text: '第二段说明' },
            { id: 'i2', type: 'image', image: 'image-b' },
        ];

        const result = serializeBugRichContent(blocks);

        expect(result.description).toBe('第一段说明\n\n[[bug-image:1]]\n\n第二段说明\n\n[[bug-image:2]]');
        expect(result.images).toEqual(['image-a', 'image-b']);
    });

    it('strips image markers before generating readable text such as titles', () => {
        expect(stripBugImageMarkers('支付失败\n\n[[bug-image:1]]\n\n补充说明')).toBe('支付失败\n\n补充说明');
    });

    it('parses marker-based descriptions back into text and image blocks', () => {
        const attachments = [{ id: 'a1' }, { id: 'a2' }];

        const blocks = parseBugRichContent('第一段\n\n[[bug-image:1]]\n\n第二段\n\n[[bug-image:2]]', attachments);

        expect(blocks).toEqual([
            { type: 'text', text: '第一段' },
            { type: 'image', attachment: { id: 'a1' }, attachmentIndex: 0 },
            { type: 'text', text: '第二段' },
            { type: 'image', attachment: { id: 'a2' }, attachmentIndex: 1 },
        ]);
    });

    it('keeps legacy attachments after plain text when no markers exist', () => {
        const attachments = [{ id: 'a1' }];

        const blocks = parseBugRichContent('旧问题说明', attachments);

        expect(blocks).toEqual([
            { type: 'text', text: '旧问题说明' },
            { type: 'image', attachment: { id: 'a1' }, attachmentIndex: 0 },
        ]);
    });

    it('inserts an image at the current text selection and splits the text block', () => {
        const blocks: BugEditorBlock<string>[] = [
            { id: 't1', type: 'text', text: '第一行文字第二行文字' },
        ];

        const next = insertBugImageAtSelection(blocks, {
            textBlockId: 't1',
            selectionStart: 4,
            selectionEnd: 4,
            image: 'image-a',
            createTextId: () => 't2',
            createImageId: () => 'i1',
        });

        expect(next).toEqual([
            { id: 't1', type: 'text', text: '第一行文' },
            { id: 'i1', type: 'image', image: 'image-a' },
            { id: 't2', type: 'text', text: '字第二行文字' },
        ]);
    });

    it('converts marker-based descriptions into a Tiptap document in display order', () => {
        const attachments = [{ id: 'a1', url: 'https://example.test/a.png' }];

        const doc = bugRichContentToTiptapDoc('第一段\n\n[[bug-image:1]]\n\n第二段', attachments);

        expect(doc).toEqual({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
                { type: 'image', attrs: { src: 'https://example.test/a.png', alt: 'bug image 1', title: null } },
                { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
            ],
        });
    });

    it('serializes a Tiptap document back into marker descriptions and local images', () => {
        const doc: BugTiptapDoc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '第一段说明' }] },
                { type: 'image', attrs: { src: 'blob://image-a', alt: null, title: null } },
                { type: 'paragraph', content: [{ type: 'text', text: '第二段说明' }] },
            ],
        };

        const result = serializeBugTiptapContent(doc, src => src === 'blob://image-a' ? 'image-a' : undefined);

        expect(result).toEqual({
            description: '第一段说明\n\n[[bug-image:1]]\n\n第二段说明',
            contentJson: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '第一段说明' }] },
                    { type: 'image', attrs: { src: 'bug-attachment:1', alt: null, title: null } },
                    { type: 'paragraph', content: [{ type: 'text', text: '第二段说明' }] },
                ],
            },
            images: ['image-a'],
        });
    });

    it('serializes edited Tiptap content while preserving existing attachment placeholders and offsetting new images', () => {
        const doc: BugTiptapDoc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '已有截图之前' }] },
                { type: 'image', attrs: { src: 'https://example.test/existing.png', alt: null, title: null } },
                { type: 'paragraph', content: [{ type: 'text', text: '新增截图之前' }] },
                { type: 'image', attrs: { src: 'blob://new-image', alt: null, title: null } },
            ],
        };

        const result = serializeBugTiptapContent(
            doc,
            src => src === 'blob://new-image' ? 'new-image' : undefined,
            {
                attachmentIndexBySrc: new Map([['https://example.test/existing.png', 1]]),
                newImageIndexOffset: 1,
            },
        );

        expect(result).toEqual({
            description: '已有截图之前\n\n[[bug-image:1]]\n\n新增截图之前\n\n[[bug-image:2]]',
            contentJson: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '已有截图之前' }] },
                    { type: 'image', attrs: { src: 'bug-attachment:1', alt: null, title: null } },
                    { type: 'paragraph', content: [{ type: 'text', text: '新增截图之前' }] },
                    { type: 'image', attrs: { src: 'bug-attachment:2', alt: null, title: null } },
                ],
            },
            images: ['new-image'],
        });
    });

    it('maps persisted Tiptap attachment placeholders to uploaded attachment urls', () => {
        const doc: BugTiptapDoc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
                { type: 'image', attrs: { src: 'bug-attachment:1', alt: null, title: null } },
            ],
        };
        const attachments = [{ url: 'https://example.test/uploaded.png' }];

        expect(bugTiptapDocWithAttachmentUrls(doc, attachments)).toEqual({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
                { type: 'image', attrs: { src: 'https://example.test/uploaded.png', alt: null, title: null } },
            ],
        });
    });

    it('extracts readable plain text from a Tiptap document while ignoring images', () => {
        const doc: BugTiptapDoc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '支付失败' }] },
                { type: 'image', attrs: { src: 'blob://image-a' } },
                { type: 'paragraph', content: [{ type: 'text', text: '刷新后恢复' }] },
            ],
        };

        expect(getBugTiptapPlainText(doc)).toBe('支付失败\n刷新后恢复');
    });
});
