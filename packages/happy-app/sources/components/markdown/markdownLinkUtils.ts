/**
 * Pure utility functions for resolving markdown links to in-app file viewer routes.
 */

import { isPreviewableHtml, isPreviewableImage, isTemporaryFilePath } from '@/utils/fileViewer';

const IMAGE_FILE_REFERENCE_PATTERN = /(?:file:\/\/)?(?:\/[^\s`"'<>()[\]{}]+|(?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)[^\s`"'<>()[\]{}]+)\.(?:png|jpe?g|gif|webp)(?:#[Ll]\d+(?:[Cc]\d+)?|:\d+(?::\d+)?)?/gi;
const LOCAL_FILE_REFERENCE_PATTERN = /(?:file:\/\/)?(?:\/[^\s`"'<>()[\]{}]+|(?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)[^\s`"'<>()[\]{}]+)\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?:#[Ll]\d+(?:[Cc]\d+)?|:\d+(?::\d+)?)?/gi;

export function encodeFilePathForRoute(filePath: string): string {
    const bytes = new TextEncoder().encode(filePath);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function parsePositiveInt(value?: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseLineAndColumn(source?: string): { line?: number; column?: number } {
    if (!source) return {};
    const trimmed = source.trim();
    const lMatch = /^L(\d+)(?:C(\d+))?$/i.exec(trimmed);
    if (lMatch) {
        return {
            line: parsePositiveInt(lMatch[1]),
            column: parsePositiveInt(lMatch[2]),
        };
    }
    const simpleMatch = /^(\d+)(?::(\d+))?$/.exec(trimmed);
    if (simpleMatch) {
        return {
            line: parsePositiveInt(simpleMatch[1]),
            column: parsePositiveInt(simpleMatch[2]),
        };
    }
    return {};
}

export function parseLocalFileReference(rawUrl: string): { filePath: string; line?: number; column?: number } {
    let url = rawUrl.trim();

    if (url.toLowerCase().startsWith('file://')) {
        url = url.slice('file://'.length);
    }

    let hash = '';
    const hashIndex = url.indexOf('#');
    if (hashIndex >= 0) {
        hash = url.slice(hashIndex + 1);
        url = url.slice(0, hashIndex);
    }

    let filePath = url;
    let line: number | undefined;
    let column: number | undefined;

    const fromHash = parseLineAndColumn(hash);
    line = fromHash.line;
    column = fromHash.column;

    if (!line) {
        const withLineMatch = /^(.*):(\d+)(?::(\d+))?$/.exec(filePath);
        if (withLineMatch && !filePath.includes('://')) {
            filePath = withLineMatch[1];
            line = parsePositiveInt(withLineMatch[2]);
            column = parsePositiveInt(withLineMatch[3]);
        }
    }

    try {
        filePath = decodeURIComponent(filePath);
    } catch {
        // Keep raw path when decode fails.
    }

    return { filePath, line, column };
}

export function isLikelyRelativeFilePath(path: string): boolean {
    if (!path || path.startsWith('/') || path.startsWith('#')) return false;
    if (path.includes('://')) return false;
    if (path.startsWith('./') || path.startsWith('../')) return true;
    return path.includes('/');
}

export function normalizeDirectoryPath(path?: string | null): string | null {
    if (!path) return null;
    const trimmed = path.trim();
    if (!trimmed.startsWith('/')) return null;
    if (trimmed === '/') return '/';
    return trimmed.replace(/\/+$/, '');
}

export function isPathInsideDirectory(path: string, directory?: string | null): boolean {
    const normalizedDir = normalizeDirectoryPath(directory);
    if (!normalizedDir) return false;
    if (normalizedDir === '/') return path.startsWith('/');
    return path === normalizedDir || path.startsWith(`${normalizedDir}/`);
}

export function isLikelyAbsoluteFilePath(path: string, context: {
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
}): boolean {
    if (!path.startsWith('/')) return false;
    if (path.startsWith('//')) return false;
    if (isPathInsideDirectory(path, context.sessionWorkingDirectory)) return true;
    if (isPathInsideDirectory(path, context.sessionHomeDirectory)) return true;
    return false;
}

export function joinPosixPath(basePath: string, relativePath: string): string {
    const baseParts = basePath.split('/').filter(Boolean);
    const relativeParts = relativePath.split('/');
    const combined = [...baseParts];

    for (const part of relativeParts) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (combined.length > 0) {
                combined.pop();
            }
            continue;
        }
        combined.push(part);
    }

    return `/${combined.join('/')}`;
}

export function buildSessionFileHref(args: {
    sessionId: string;
    filePath: string;
    line?: number;
    column?: number;
    machineId?: string;
}): string {
    const encodedPath = encodeURIComponent(encodeFilePathForRoute(args.filePath));
    const queryParams = [
        `path=${encodedPath}`,
        isPreviewableHtml(args.filePath) ? 'view=preview' : 'view=file',
    ];
    if (args.line) queryParams.push(`line=${args.line}`);
    if (args.column) queryParams.push(`column=${args.column}`);
    if (args.machineId) queryParams.push(`machineId=${encodeURIComponent(args.machineId)}`);
    return `/session/${args.sessionId}/file?${queryParams.join('&')}`;
}

export function resolveMarkdownImageReference(args: {
    rawText: string;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): { href: string; target?: '_blank' } | null {
    const trimmed = args.rawText.trim();
    if (!trimmed || !args.sessionId) return null;

    const parsed = parseLocalFileReference(trimmed);
    if (!isPreviewableImage(parsed.filePath)) return null;

    return resolveParsedLocalFileReference({
        parsed,
        sessionId: args.sessionId,
        sessionWorkingDirectory: args.sessionWorkingDirectory,
        sessionHomeDirectory: args.sessionHomeDirectory,
        machineId: args.machineId,
    });
}

function resolveParsedLocalFileReference(args: {
    parsed: { filePath: string; line?: number; column?: number };
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): { href: string; target?: '_blank' } | null {
    const { parsed } = args;
    if (!args.sessionId) return null;

    if (parsed.filePath.startsWith('/')) {
        if (isLikelyAbsoluteFilePath(parsed.filePath, {
            sessionWorkingDirectory: args.sessionWorkingDirectory,
            sessionHomeDirectory: args.sessionHomeDirectory,
        })) {
            return {
                href: buildSessionFileHref({
                    sessionId: args.sessionId,
                    filePath: parsed.filePath,
                    line: parsed.line,
                    column: parsed.column,
                }),
            };
        }

        if (args.machineId && isTemporaryFilePath(parsed.filePath)) {
            return {
                href: buildSessionFileHref({
                    sessionId: args.sessionId,
                    filePath: parsed.filePath,
                    line: parsed.line,
                    column: parsed.column,
                    machineId: args.machineId,
                }),
            };
        }

        return null;
    }

    if (args.sessionWorkingDirectory && isLikelyRelativeFilePath(parsed.filePath)) {
        const absolutePath = joinPosixPath(args.sessionWorkingDirectory, parsed.filePath);
        return {
            href: buildSessionFileHref({
                sessionId: args.sessionId,
                filePath: absolutePath,
                line: parsed.line,
                column: parsed.column,
            }),
        };
    }

    return null;
}

export function resolveMarkdownLocalFileReference(args: {
    rawText: string;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): { href: string; target?: '_blank' } | null {
    const trimmed = args.rawText.trim();
    if (!trimmed || !args.sessionId) return null;

    const parsed = parseLocalFileReference(trimmed);
    return resolveParsedLocalFileReference({
        parsed,
        sessionId: args.sessionId,
        sessionWorkingDirectory: args.sessionWorkingDirectory,
        sessionHomeDirectory: args.sessionHomeDirectory,
        machineId: args.machineId,
    });
}

export function splitTextByImageReferences(args: {
    text: string;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): Array<{ text: string; href?: string; target?: '_blank' }> {
    const segments: Array<{ text: string; href?: string; target?: '_blank' }> = [];
    let lastIndex = 0;

    for (const match of args.text.matchAll(IMAGE_FILE_REFERENCE_PATTERN)) {
        const rawText = match[0];
        const index = match.index ?? 0;
        const link = resolveMarkdownImageReference({ ...args, rawText });
        if (!link) continue;

        if (index > lastIndex) {
            segments.push({ text: args.text.slice(lastIndex, index) });
        }
        segments.push({ text: rawText, href: link.href, target: link.target });
        lastIndex = index + rawText.length;
    }

    if (lastIndex < args.text.length) {
        segments.push({ text: args.text.slice(lastIndex) });
    }

    return segments.length > 0 ? segments : [{ text: args.text }];
}

export function splitTextByLocalFileReferences(args: {
    text: string;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): Array<{ text: string; href?: string; target?: '_blank' }> {
    const segments: Array<{ text: string; href?: string; target?: '_blank' }> = [];
    let lastIndex = 0;

    for (const match of args.text.matchAll(LOCAL_FILE_REFERENCE_PATTERN)) {
        const rawText = match[0];
        const index = match.index ?? 0;
        const link = resolveMarkdownLocalFileReference({ ...args, rawText });
        if (!link) continue;

        if (index > lastIndex) {
            segments.push({ text: args.text.slice(lastIndex, index) });
        }
        segments.push({ text: rawText, href: link.href, target: link.target });
        lastIndex = index + rawText.length;
    }

    if (lastIndex < args.text.length) {
        segments.push({ text: args.text.slice(lastIndex) });
    }

    return segments.length > 0 ? segments : [{ text: args.text }];
}

export function resolveMarkdownLink(args: {
    rawUrl: string;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    machineId?: string | null;
}): { href: string; target?: '_blank' } {
    const trimmed = args.rawUrl.trim();
    if (!trimmed) {
        return { href: args.rawUrl };
    }

    const isHttpLike = /^(https?:|mailto:|tel:)/i.test(trimmed);
    if (isHttpLike) {
        return { href: trimmed, target: '_blank' };
    }

    if (trimmed.startsWith('/')) {
        if (args.sessionId) {
            const parsed = parseLocalFileReference(trimmed);
            const localFileLink = resolveParsedLocalFileReference({
                parsed,
                sessionId: args.sessionId,
                sessionWorkingDirectory: args.sessionWorkingDirectory,
                sessionHomeDirectory: args.sessionHomeDirectory,
                machineId: args.machineId,
            });
            if (localFileLink) {
                return localFileLink;
            }
        }
        return { href: trimmed };
    }

    if (args.sessionId && args.sessionWorkingDirectory && isLikelyRelativeFilePath(trimmed)) {
        const parsed = parseLocalFileReference(trimmed);
        const absolutePath = joinPosixPath(args.sessionWorkingDirectory, parsed.filePath);
        return {
            href: buildSessionFileHref({
                sessionId: args.sessionId,
                filePath: absolutePath,
                line: parsed.line,
                column: parsed.column,
            }),
        };
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        return { href: trimmed, target: '_blank' };
    }

    return { href: trimmed };
}
