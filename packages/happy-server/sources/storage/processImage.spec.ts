import sharp from 'sharp';
import { processImage } from './processImage';
import { describe, it } from 'vitest';

describe('processImage', () => {
    it('should resize image', async () => {
        let img = await sharp({
            create: {
                width: 200,
                height: 100,
                channels: 3,
                background: '#ff0000',
            },
        }).jpeg().toBuffer();
        await processImage(img);
    });
});
