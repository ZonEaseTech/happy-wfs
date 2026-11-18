export interface ClipboardImagePasteEventLike {
    defaultPrevented?: boolean;
    preventDefault: () => void;
    clipboardData?: {
        items?: ArrayLike<{
            type: string;
            getAsFile: () => File | null;
        }> | null;
    } | null;
}

interface HandleImagePasteEventOptions {
    isScreenFocused: boolean;
    canAddMore: boolean;
    supportsImages: boolean;
    onImageFile: (file: File, mimeType: string) => Promise<void> | void;
    /**
     * Where a pasted image goes when it cannot be attached as an image: the agent takes none
     * (Cursor), or the image limit is reached. The file picker and drag-and-drop send it as a
     * file then; a paste used to be dropped without a word.
     */
    onFileAttachment?: (file: File, mimeType: string) => Promise<void> | void;
}

export async function handleImagePasteEvent(
    event: ClipboardImagePasteEventLike,
    options: HandleImagePasteEventOptions,
): Promise<boolean> {
    const { isScreenFocused, canAddMore, supportsImages, onImageFile, onFileAttachment } = options;
    const attach = supportsImages && canAddMore ? onImageFile : onFileAttachment;

    if (!isScreenFocused || !attach || event.defaultPrevented) {
        return false;
    }

    const items = event.clipboardData?.items;
    if (!items) {
        return false;
    }

    for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) {
            continue;
        }

        const file = item.getAsFile();
        if (!file) {
            return false;
        }

        event.preventDefault();
        await attach(file, item.type);
        return true;
    }

    return false;
}
