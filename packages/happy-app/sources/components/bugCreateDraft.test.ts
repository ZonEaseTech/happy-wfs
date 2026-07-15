import { describe, expect, it } from 'vitest';
import { buildBugCreateDraftDoc } from './bugCreateDraft';
import type { BugTiptapDoc } from '@/sync/bugRichContent';

describe('buildBugCreateDraftDoc', () => {
    const textNode = { type: 'paragraph', content: [{ type: 'text', text: '输入到一半的内容' }] };
    const imageNode = { type: 'image', attrs: { src: 'blob:http://localhost/dead-after-reload' } };

    it('keeps text and drops image nodes whose blob URLs die across reloads', () => {
        const doc = { type: 'doc', content: [textNode, imageNode, textNode] } as BugTiptapDoc;
        expect(buildBugCreateDraftDoc(doc, '输入到一半的内容')).toEqual({
            type: 'doc',
            content: [textNode, textNode],
        });
    });

    it('returns null for empty text so cleared editors clear the draft', () => {
        expect(buildBugCreateDraftDoc({ type: 'doc', content: [textNode] } as BugTiptapDoc, '   ')).toBeNull();
        expect(buildBugCreateDraftDoc(null, '有文字')).toBeNull();
        expect(buildBugCreateDraftDoc({ type: 'doc', content: [imageNode] } as BugTiptapDoc, '有文字')).toBeNull();
    });
});
