import React from 'react';
import { View } from 'react-native';
import type { LocalImage } from '@/components/ImagePreview';
import type { BugTiptapDoc } from '@/sync/bugRichContent';
import type { BugTiptapEditorHandle, BugTiptapEditorProps, BugTiptapEditorSnapshot } from './BugTiptapEditor.types';

const emptyDoc: BugTiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

const emptySnapshot: BugTiptapEditorSnapshot = {
    doc: emptyDoc,
    contentJson: emptyDoc,
    plainText: '',
    imageCount: 0,
    description: '',
    images: [],
};

export const BugTiptapEditor = React.forwardRef<BugTiptapEditorHandle, BugTiptapEditorProps>(({ onChange }, ref) => {
    React.useEffect(() => {
        onChange(emptySnapshot);
    }, [onChange]);

    React.useImperativeHandle(ref, () => ({
        focus: () => {},
        insertImages: (_images: LocalImage[]) => {},
        getSnapshot: () => emptySnapshot,
    }), []);

    return <View />;
});

BugTiptapEditor.displayName = 'BugTiptapEditor';
