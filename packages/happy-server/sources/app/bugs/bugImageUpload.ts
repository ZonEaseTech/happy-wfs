import { randomKey } from '@/utils/randomKey';
import { processImage } from '@/storage/processImage';
import { s3bucket, s3client, s3public } from '@/storage/files';
import { BUG_IMAGE_LIMITS } from './bugTypes';

export async function uploadBugImage(args: {
    ownerId: string;
    bugId: string;
    imageBuffer: Buffer;
    mimeType: string;
    sizeBytes: number;
}): Promise<{ url: string; path: string; width: number | null; height: number | null; thumbhash: string | null; mimeType: string; sizeBytes: number }> {
    if (args.sizeBytes > BUG_IMAGE_LIMITS.maxSizeBytes) {
        throw Object.assign(new Error('Image is too large'), { statusCode: 400 });
    }
    if (args.mimeType !== 'image/jpeg' && args.mimeType !== 'image/png') {
        throw Object.assign(new Error('Only JPEG and PNG images are supported'), { statusCode: 400 });
    }

    const processed = await processImage(args.imageBuffer);
    const key = randomKey('bug');
    const extension = args.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `public/users/${args.ownerId}/bugs/${args.bugId}/${key}.${extension}`;

    await s3client.putObject(s3bucket, path, args.imageBuffer, args.imageBuffer.length, {
        'Content-Type': args.mimeType,
    });

    return {
        url: `${s3public}/${path}`,
        path,
        width: processed.width,
        height: processed.height,
        thumbhash: processed.thumbhash,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
    };
}
