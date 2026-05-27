import * as privacyKit from 'privacy-kit';
import type { Bytes } from 'privacy-kit';

type HeaderValue = string | string[] | number | undefined;
type HeadersLike = Record<string, HeaderValue>;
type FilteredRequestHeaders = Record<string, string>;
type FilteredResponseHeaders = Record<string, string | string[]>;

function toPrivacyBytes(bytes: Uint8Array): Bytes {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy as Bytes;
}

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

const REQUEST_BLOCKED_HEADERS = new Set([
    ...HOP_BY_HOP_HEADERS,
    'host',
    'content-length',
]);

const RESPONSE_BLOCKED_HEADERS = new Set([
    ...HOP_BY_HOP_HEADERS,
    'host',
    'content-length',
]);

function headerValueToString(value: HeaderValue): string {
    if (Array.isArray(value)) {
        return value.join(', ');
    }

    return String(value);
}

function blockedHeadersFor(headers: HeadersLike, baseBlockedHeaders: Set<string>): Set<string> {
    const blockedHeaders = new Set(baseBlockedHeaders);

    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() !== 'connection' || value === undefined) {
            continue;
        }

        for (const connectionHeader of headerValueToString(value).split(',')) {
            const headerName = connectionHeader.trim().toLowerCase();
            if (headerName.length > 0) {
                blockedHeaders.add(headerName);
            }
        }
    }

    return blockedHeaders;
}

function filterRequestHeaders(headers: HeadersLike, blockedHeaders: Set<string>): FilteredRequestHeaders {
    const filtered: FilteredRequestHeaders = {};

    for (const [name, value] of Object.entries(headers)) {
        const normalizedName = name.toLowerCase();
        if (blockedHeaders.has(normalizedName) || value === undefined) {
            continue;
        }

        filtered[normalizedName] = headerValueToString(value);
    }

    return filtered;
}

function filterResponseHeaders(headers: HeadersLike, blockedHeaders: Set<string>): FilteredResponseHeaders {
    const filtered: FilteredResponseHeaders = {};

    for (const [name, value] of Object.entries(headers)) {
        const normalizedName = name.toLowerCase();
        if (blockedHeaders.has(normalizedName) || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            filtered[normalizedName] = value;
            continue;
        }

        filtered[normalizedName] = headerValueToString(value);
    }

    return filtered;
}

export function filterProxyRequestHeaders(headers: HeadersLike): FilteredRequestHeaders {
    return filterRequestHeaders(headers, blockedHeadersFor(headers, REQUEST_BLOCKED_HEADERS));
}

export function filterProxyResponseHeaders(headers: HeadersLike): FilteredResponseHeaders {
    return filterResponseHeaders(headers, blockedHeadersFor(headers, RESPONSE_BLOCKED_HEADERS));
}

export function toBase64Body(body: string | Uint8Array | undefined): string {
    if (body === undefined) {
        return '';
    }

    if (typeof body === 'string') {
        return privacyKit.encodeBase64(privacyKit.encodeUTF8(body));
    }

    return privacyKit.encodeBase64(toPrivacyBytes(body));
}

export function fromBase64Body(bodyBase64: string): Uint8Array {
    if (bodyBase64 === '') {
        return new Uint8Array();
    }

    return privacyKit.decodeBase64(bodyBase64);
}
