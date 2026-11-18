import { describe, expect, it, vi } from 'vitest';
import type { ClipboardImagePasteEventLike } from '@/utils/imagePaste';
import { handleImagePasteEvent } from '@/utils/imagePaste';

const createEvent = (
    items: Array<{ type: string; file: File | null }>,
    defaultPrevented = false,
): ClipboardImagePasteEventLike & { preventDefault: ReturnType<typeof vi.fn> } => {
    const preventDefault = vi.fn();

    return {
        defaultPrevented,
        preventDefault,
        clipboardData: {
            items: items.map(item => ({
                type: item.type,
                getAsFile: () => item.file,
            })),
        },
    };
};

describe('handleImagePasteEvent', () => {
    it('ignores paste when current screen is not focused', async () => {
        const onImageFile = vi.fn();
        const event = createEvent([
            { type: 'image/png', file: { name: 'x.png' } as File },
        ]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: false,
            canAddMore: true,
            supportsImages: true,
            onImageFile,
        });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onImageFile).not.toHaveBeenCalled();
    });

    it('handles first pasted image when screen is focused', async () => {
        const onImageFile = vi.fn();
        const imageFile = { name: 'test.png' } as File;
        const event = createEvent([
            { type: 'text/plain', file: null },
            { type: 'image/png', file: imageFile },
        ]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: true,
            supportsImages: true,
            onImageFile,
        });

        expect(handled).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(onImageFile).toHaveBeenCalledWith(imageFile, 'image/png');
    });

    it('ignores paste when event is already prevented', async () => {
        const onImageFile = vi.fn();
        const event = createEvent([
            { type: 'image/png', file: { name: 'x.png' } as File },
        ], true);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: true,
            supportsImages: true,
            onImageFile,
        });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onImageFile).not.toHaveBeenCalled();
    });

    it('sends the pasted image as a file when the agent takes no images', async () => {
        const onImageFile = vi.fn();
        const onFileAttachment = vi.fn();
        const imageFile = { name: 'image.png' } as File;
        const event = createEvent([{ type: 'image/png', file: imageFile }]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: true,
            supportsImages: false,
            onImageFile,
            onFileAttachment,
        });

        expect(handled).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(onFileAttachment).toHaveBeenCalledWith(imageFile, 'image/png');
        expect(onImageFile).not.toHaveBeenCalled();
    });

    it('sends the pasted image as a file once the image limit is reached', async () => {
        const onImageFile = vi.fn();
        const onFileAttachment = vi.fn();
        const imageFile = { name: 'image.png' } as File;
        const event = createEvent([{ type: 'image/png', file: imageFile }]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: false,
            supportsImages: true,
            onImageFile,
            onFileAttachment,
        });

        expect(handled).toBe(true);
        expect(onFileAttachment).toHaveBeenCalledWith(imageFile, 'image/png');
        expect(onImageFile).not.toHaveBeenCalled();
    });

    it('leaves the paste alone where images are refused and nothing takes files', async () => {
        const onImageFile = vi.fn();
        const event = createEvent([{ type: 'image/png', file: { name: 'x.png' } as File }]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: true,
            supportsImages: false,
            onImageFile,
        });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onImageFile).not.toHaveBeenCalled();
    });

    it('leaves pasted text alone when the agent takes no images', async () => {
        const onFileAttachment = vi.fn();
        const event = createEvent([{ type: 'text/plain', file: null }]);

        const handled = await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: true,
            supportsImages: false,
            onImageFile: vi.fn(),
            onFileAttachment,
        });

        expect(handled).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onFileAttachment).not.toHaveBeenCalled();
    });
});
