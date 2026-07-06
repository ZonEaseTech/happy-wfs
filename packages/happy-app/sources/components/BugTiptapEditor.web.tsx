import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/core';
import type { LocalImage } from '@/components/ImagePreview';
import { t } from '@/text';
import { Modal } from '@/modal';
import { BUG_IMAGE_LIMITS } from '@/sync/bugTypes';
import {
    getBugTiptapPlainText,
    serializeBugTiptapContent,
    type BugTiptapDoc,
    type BugTiptapNode,
} from '@/sync/bugRichContent';
import type { BugTiptapEditorHandle, BugTiptapEditorProps, BugTiptapEditorSnapshot } from './BugTiptapEditor.types';

const emptyDoc: BugTiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const emptyAttachmentImageUrls: string[] = [];

function injectTiptapStyles() {
    if (typeof document === 'undefined' || document.getElementById('happy-bug-tiptap-style')) return;
    const style = document.createElement('style');
    style.id = 'happy-bug-tiptap-style';
    style.textContent = `
.happy-bug-tiptap-editor {
    min-height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    background: #FFFFFF;
}
.happy-bug-tiptap-editor .tiptap {
    min-height: 360px;
    outline: none;
    color: #16130f;
    font-size: 18px;
    line-height: 29px;
    white-space: pre-wrap;
    background: #FFFFFF;
}
.happy-bug-tiptap-editor.detail .tiptap {
    min-height: 220px;
    padding: 30px;
    box-sizing: border-box;
}
.happy-bug-tiptap-editor.detail.no-inset .tiptap {
    padding: 0;
}
.happy-bug-tiptap-editor .ProseMirror,
.happy-bug-tiptap-editor .ProseMirror-focused {
    outline: none !important;
    border: 0 !important;
    box-shadow: none !important;
}
.happy-bug-tiptap-editor .tiptap p {
    margin: 0;
}
.happy-bug-tiptap-editor .tiptap p.is-editor-empty:first-child::before {
    color: #8A8173;
    opacity: 0.65;
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
}
.happy-bug-tiptap-editor .tiptap img {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    max-height: 360px;
    object-fit: contain;
    border-radius: 12px;
    margin: 8px 0 12px;
    background: transparent;
    cursor: grab;
}
.happy-bug-tiptap-editor .tiptap .ProseMirror-selectednode {
    outline: 3px solid #111;
    outline-offset: 3px;
    cursor: grabbing;
}
`;
    document.head.appendChild(style);
}

async function imageSizeFromUrl(url: string): Promise<{ width: number; height: number }> {
    const image = new window.Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
    });
    return {
        width: image.naturalWidth || 512,
        height: image.naturalHeight || 512,
    };
}

async function localImageFromFile(file: File): Promise<LocalImage> {
    const uri = URL.createObjectURL(file);
    const size = await imageSizeFromUrl(uri).catch(() => ({ width: 512, height: 512 }));
    return {
        uri,
        width: size.width,
        height: size.height,
        mimeType: file.type || 'image/jpeg',
    };
}

function countImageNodes(node: BugTiptapNode | BugTiptapDoc | null | undefined): number {
    if (!node) return 0;
    const self = node.type === 'image' ? 1 : 0;
    return self + (node.content ?? []).reduce((count, child) => count + countImageNodes(child), 0);
}

function snapshotFromEditor(editor: Editor | null, imagesBySrc: Map<string, LocalImage>, attachmentIndexBySrc: Map<string, number>): BugTiptapEditorSnapshot {
    const doc = (editor?.getJSON() as BugTiptapDoc | undefined) ?? emptyDoc;
    const serialized = serializeBugTiptapContent(doc, src => imagesBySrc.get(src), {
        attachmentIndexBySrc,
        newImageIndexOffset: Math.max(0, ...attachmentIndexBySrc.values()),
    });
    return {
        doc,
        contentJson: serialized.contentJson,
        plainText: getBugTiptapPlainText(doc),
        imageCount: countImageNodes(doc),
        description: serialized.description,
        images: serialized.images,
    };
}

export const BugTiptapEditor = React.forwardRef<BugTiptapEditorHandle, BugTiptapEditorProps>(({
    onChange,
    initialDoc,
    initialContentKey,
    attachmentImageUrls = emptyAttachmentImageUrls,
    onImageDoubleClick,
    variant = 'create',
    contentInset = 'padded',
}, ref) => {
    const imagesBySrcRef = React.useRef(new Map<string, LocalImage>());
    const attachmentIndexBySrc = React.useMemo(
        () => new Map(attachmentImageUrls.map((url, index) => [url, index + 1] as const)),
        [attachmentImageUrls],
    );
    const createdObjectUrlsRef = React.useRef<string[]>([]);
    const editorRef = React.useRef<Editor | null>(null);
    const appliedInitialContentKeyRef = React.useRef<string | undefined>(undefined);
    const onImageDoubleClickRef = React.useRef(onImageDoubleClick);

    const emitSnapshot = React.useCallback((editor: Editor | null) => {
        onChange(snapshotFromEditor(editor, imagesBySrcRef.current, attachmentIndexBySrc));
    }, [attachmentIndexBySrc, onChange]);

    const insertImage = React.useCallback((image: LocalImage) => {
        const editor = editorRef.current;
        if (!editor) return;
        imagesBySrcRef.current.set(image.uri, image);
        if (image.uri.startsWith('blob:')) createdObjectUrlsRef.current.push(image.uri);
        (editor.chain().focus() as any).setImage({ src: image.uri, alt: t('bug.uploadScreenshots') }).run();
        emitSnapshot(editor);
    }, [emitSnapshot]);

    const addFiles = React.useCallback((files: FileList | File[]) => {
        const editor = editorRef.current;
        if (!editor) return false;
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;

        const remaining = BUG_IMAGE_LIMITS.maxImages - countImageNodes(editor.getJSON() as BugTiptapDoc);
        if (remaining <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return true;
        }
        const selectedFiles = imageFiles.slice(0, remaining);
        if (imageFiles.length > remaining) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
        }
        selectedFiles.forEach(file => {
            if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
                Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                return;
            }
            void localImageFromFile(file).then(insertImage);
        });
        return true;
    }, [insertImage]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false,
                blockquote: false,
                codeBlock: false,
                horizontalRule: false,
            }),
            ImageExtension.configure({
                allowBase64: true,
                inline: false,
                HTMLAttributes: { draggable: 'true' },
            }),
            Placeholder.configure({
                placeholder: t('bug.noteStylePlaceholder'),
            }),
        ],
        content: initialDoc ?? emptyDoc,
        editorProps: {
            attributes: {
                'aria-label': t('bug.description'),
            },
            handlePaste: (_view, event) => {
                const files = event.clipboardData?.files;
                if (!files || files.length === 0) return false;
                const handled = addFiles(files);
                if (handled) event.preventDefault();
                return handled;
            },
            handleDrop: (_view, event) => {
                const files = event.dataTransfer?.files;
                if (!files || files.length === 0) return false;
                const handled = addFiles(files);
                if (handled) event.preventDefault();
                return handled;
            },
            handleDOMEvents: {
                dblclick: (_view, event) => {
                    const target = event.target;
                    const image = target instanceof HTMLImageElement
                        ? target
                        : target instanceof HTMLElement
                            ? target.closest('img')
                            : null;
                    if (!image) return false;
                    event.preventDefault();
                    onImageDoubleClickRef.current?.(image.src);
                    return true;
                },
            },
        },
        onCreate: ({ editor: created }) => {
            editorRef.current = created;
            emitSnapshot(created);
        },
        onUpdate: ({ editor: updated }) => {
            emitSnapshot(updated);
        },
    });

    React.useEffect(() => {
        injectTiptapStyles();
    }, []);

    React.useEffect(() => {
        onImageDoubleClickRef.current = onImageDoubleClick;
    }, [onImageDoubleClick]);

    React.useEffect(() => {
        editorRef.current = editor;
        emitSnapshot(editor);
    }, [editor, emitSnapshot]);

    React.useEffect(() => {
        if (!editor || !initialDoc) return;
        const key = initialContentKey ?? 'default';
        if (appliedInitialContentKeyRef.current === key) return;
        appliedInitialContentKeyRef.current = key;
        imagesBySrcRef.current.clear();
        for (const url of createdObjectUrlsRef.current) {
            URL.revokeObjectURL(url);
        }
        createdObjectUrlsRef.current = [];
        editor.commands.setContent(initialDoc, { emitUpdate: false });
        emitSnapshot(editor);
    }, [editor, emitSnapshot, initialContentKey, initialDoc]);

    React.useEffect(() => () => {
        for (const url of createdObjectUrlsRef.current) {
            URL.revokeObjectURL(url);
        }
        createdObjectUrlsRef.current = [];
    }, []);

    React.useImperativeHandle(ref, () => ({
        focus: () => editorRef.current?.commands.focus(),
        insertImages: (images: LocalImage[]) => {
            for (const image of images) insertImage(image);
        },
        getSnapshot: () => snapshotFromEditor(editorRef.current, imagesBySrcRef.current, attachmentIndexBySrc),
    }), [attachmentIndexBySrc, insertImage]);

    return (
        <div className={[
            'happy-bug-tiptap-editor',
            variant === 'detail' ? 'detail' : '',
            variant === 'detail' && contentInset === 'none' ? 'no-inset' : '',
        ].filter(Boolean).join(' ')}>
            <EditorContent editor={editor} />
        </div>
    );
});

BugTiptapEditor.displayName = 'BugTiptapEditor';
