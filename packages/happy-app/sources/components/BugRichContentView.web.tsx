import React from 'react';
import { Text } from 'react-native';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import { StyleSheet } from 'react-native-unistyles';
import type { BugAttachment } from '@/sync/bugTypes';
import { bugRichContentToTiptapDoc, bugTiptapDocWithAttachmentUrls, parseBugRichContent, type BugTiptapDoc } from '@/sync/bugRichContent';

function injectReadonlyStyles() {
    if (typeof document === 'undefined' || document.getElementById('happy-bug-tiptap-readonly-style')) return;
    const style = document.createElement('style');
    style.id = 'happy-bug-tiptap-readonly-style';
    style.textContent = `
.happy-bug-tiptap-readonly .tiptap {
    outline: none;
    color: #16130f;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 26px;
}
.happy-bug-tiptap-readonly.note .tiptap {
    font-size: 18px;
    line-height: 29px;
}
.happy-bug-tiptap-readonly.compact .tiptap {
    font-size: 14px;
    line-height: 22px;
}
.happy-bug-tiptap-readonly .tiptap p {
    margin: 0 0 14px;
    white-space: pre-wrap;
}
.happy-bug-tiptap-readonly .tiptap img {
    display: block;
    width: 100%;
    max-height: 360px;
    object-fit: contain;
    border-radius: 16px;
    margin: 12px 0 18px;
    background: #F1ECE2;
}
.happy-bug-tiptap-readonly.clickable .tiptap img {
    cursor: zoom-in;
}
.happy-bug-tiptap-readonly.compact .tiptap img {
    max-height: 220px;
    border-radius: 12px;
}
`;
    document.head.appendChild(style);
}

export function BugRichContentView({
    description,
    contentJson,
    attachments,
    emptyText = '-',
    compact = false,
    noteStyle = false,
    onImagePress,
}: {
    description: string;
    contentJson?: BugTiptapDoc | null;
    attachments: BugAttachment[];
    emptyText?: string;
    compact?: boolean;
    noteStyle?: boolean;
    onImagePress?: (attachment: BugAttachment) => void;
}) {
    const styles = stylesheet;
    const blocks = React.useMemo(() => parseBugRichContent(description, attachments), [attachments, description]);
    const attachmentByUrl = React.useMemo(
        () => new Map(attachments.map(attachment => [attachment.url, attachment])),
        [attachments],
    );
    const doc = React.useMemo(
        () => contentJson ? bugTiptapDocWithAttachmentUrls(contentJson, attachments) : bugRichContentToTiptapDoc(description, attachments),
        [attachments, contentJson, description],
    );
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
            }),
        ],
        content: doc,
        editable: false,
        editorProps: {
            attributes: {
                'aria-label': 'Bug content',
            },
        },
    });

    React.useEffect(() => {
        injectReadonlyStyles();
    }, []);

    React.useEffect(() => {
        editor?.commands.setContent(doc, { emitUpdate: false });
    }, [doc, editor]);

    const handleImageClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!onImagePress) return;
        const target = event.target as HTMLElement | null;
        if (!target || target.tagName !== 'IMG') return;
        const image = target as HTMLImageElement;
        const attachment = attachmentByUrl.get(image.getAttribute('src') ?? '') ?? attachmentByUrl.get(image.src);
        if (attachment) onImagePress(attachment);
    }, [attachmentByUrl, onImagePress]);

    if (blocks.length === 0 && !contentJson?.content?.length) {
        return <Text style={styles.muted}>{emptyText}</Text>;
    }

    return (
        <div className={[
            'happy-bug-tiptap-readonly',
            compact ? 'compact' : '',
            noteStyle ? 'note' : '',
            onImagePress ? 'clickable' : '',
        ].filter(Boolean).join(' ')}
        onClick={handleImageClick}>
            <EditorContent editor={editor} />
        </div>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    muted: {
        color: theme.colors.textSecondary,
    },
}));
