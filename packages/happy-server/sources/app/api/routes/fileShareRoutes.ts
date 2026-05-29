import { Fastify } from "../types";
import { s3bucket, s3client, getPublicUrl } from "@/storage/files";
import { randomKey } from "@/utils/randomKey";
import { buildPublicFileSharePath, sanitizePublicFileName } from "@/app/fileShare/publicFileShare";

function contentDispositionAttachment(fileName: string): string {
    const asciiFallback = fileName.replace(/[\\"\r\n]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'file';
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileShareRoutes(app: Fastify) {
    app.post('/v1/file-shares', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const accountId = request.userId;
        let fileBuffer: Buffer | null = null;
        let fileMimeType = 'application/octet-stream';
        let fileName = 'file';

        for await (const part of request.parts()) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                fileMimeType = part.mimetype || fileMimeType;
                fileName = sanitizePublicFileName(part.filename || fileName);
            } else if (part.type === 'field' && part.fieldname === 'fileName' && typeof part.value === 'string') {
                fileName = sanitizePublicFileName(part.value);
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        const shareKey = randomKey('file', 20);
        const objectPath = buildPublicFileSharePath(accountId, shareKey, fileName);
        await s3client.putObject(s3bucket, objectPath, fileBuffer, fileBuffer.length, {
            'Content-Type': fileMimeType,
            'Content-Disposition': contentDispositionAttachment(fileName),
        });

        return reply.send({
            success: true,
            data: {
                url: getPublicUrl(objectPath),
                path: objectPath,
                fileName,
                mimeType: fileMimeType,
                size: fileBuffer.length,
            },
        });
    });
}
