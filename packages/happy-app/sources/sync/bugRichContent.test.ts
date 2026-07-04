import { describe, expect, it } from 'vitest';
import {
    insertBugImageAtSelection,
    parseBugRichContent,
    serializeBugRichContent,
    stripBugImageMarkers,
    type BugEditorBlock,
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
});
