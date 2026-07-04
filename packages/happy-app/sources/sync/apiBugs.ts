import { Platform } from 'react-native';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { LocalImage } from '@/components/ImagePreview';
import { HappyError } from '@/utils/errors';
import { getServerUrl } from './serverConfig';
import type { BugReportDetail, BugReportSummary, BugStatus, BugVisibility } from './bugTypes';

export class BugShareExpiredError extends Error {
    constructor() {
        super('bug_share_expired');
        this.name = 'BugShareExpiredError';
    }
}

type JsonObject = Record<string, unknown>;

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
    };
}

function publicHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

async function parseError(response: Response): Promise<never> {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 401 && body?.error === 'bug_share_expired') {
        throw new BugShareExpiredError();
    }
    throw new HappyError(body?.error || `Request failed: ${response.status}`, false);
}

async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) await parseError(response);
    return await response.json() as T;
}

function bugFromResponse(data: { bug: BugReportDetail } | BugReportDetail): BugReportDetail {
    return 'bug' in data ? data.bug : data;
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>) {
    const url = new URL(`${getServerUrl()}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
}

async function uploadImage(url: string, image: LocalImage, headers: Record<string, string>, commentId?: string): Promise<BugReportDetail> {
    const formData = new FormData();
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    const filename = `bug.${extension}`;

    if (Platform.OS === 'web') {
        const response = await fetch(image.uri);
        const blob = await response.blob();
        formData.append('file', blob, filename);
    } else {
        formData.append('file', {
            uri: image.uri,
            name: filename,
            type: image.mimeType,
        } as any);
    }
    if (commentId) formData.append('commentId', commentId);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
    });
    return bugFromResponse(await readJson<{ bug: BugReportDetail }>(response));
}

export async function listBugs(credentials: AuthCredentials, options?: { status?: BugStatus; query?: string; limit?: number }): Promise<{ bugs: BugReportSummary[]; pendingCount: number }> {
    const response = await fetch(buildUrl('/v1/bugs', options), { method: 'GET', headers: authHeaders(credentials) });
    return await readJson(response);
}

export async function createBug(credentials: AuthCredentials, input: { description: string; visibility?: BugVisibility }): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bugs`, { method: 'POST', headers: authHeaders(credentials), body: JSON.stringify(input) });
    return bugFromResponse(await readJson(response));
}

export async function getBug(credentials: AuthCredentials, bugId: string): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}`, { method: 'GET', headers: authHeaders(credentials) });
    return bugFromResponse(await readJson(response));
}

export async function deleteBug(credentials: AuthCredentials, bugId: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}`, { method: 'DELETE', headers: authHeaders(credentials) });
    await readJson<{ ok: boolean }>(response);
}

export async function addBugComment(credentials: AuthCredentials, bugId: string, body: string): Promise<{ bug: BugReportDetail; commentId: string }> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}/comments`, { method: 'POST', headers: authHeaders(credentials), body: JSON.stringify({ body }) });
    return await readJson(response);
}

export async function changeBugStatus(credentials: AuthCredentials, bugId: string, input: { status: BugStatus; action?: 'return_to_pending' }): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}/status`, { method: 'PATCH', headers: authHeaders(credentials), body: JSON.stringify(input) });
    return bugFromResponse(await readJson(response));
}

export async function uploadBugAttachment(credentials: AuthCredentials, bugId: string, image: LocalImage, commentId?: string): Promise<BugReportDetail> {
    return await uploadImage(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}/attachments`, image, { Authorization: `Bearer ${credentials.token}` }, commentId);
}

export async function getBugShareConfig(credentials: AuthCredentials): Promise<{ enabled: boolean; accessCode: string; version: number; url: string; createdAt: number; updatedAt: number } | null> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/share-config`, { method: 'GET', headers: authHeaders(credentials) });
    const data = await readJson<{ shareConfig: { enabled: boolean; accessCode: string; version: number; url: string; createdAt: number; updatedAt: number } | null }>(response);
    return data.shareConfig;
}

export async function createOrRotateBugShareConfig(credentials: AuthCredentials, input?: { accessCode?: string }): Promise<{ accessCode: string; url: string; version: number }> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/share-config`, { method: 'POST', headers: authHeaders(credentials), body: JSON.stringify(input ?? {}) });
    return await readJson(response);
}

export async function linkBugSession(credentials: AuthCredentials, bugId: string, sessionId: string): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bugs/${encodeURIComponent(bugId)}/start-session`, { method: 'POST', headers: authHeaders(credentials), body: JSON.stringify({ sessionId }) });
    return bugFromResponse(await readJson(response));
}

export async function loginBugShare(accessCode: string, nickname: string): Promise<{ token: string; nickname: string }> {
    const response = await fetch(`${getServerUrl()}/v1/bug-share/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode, nickname }) });
    return await readJson(response);
}

export async function listPublicBugs(token: string, options?: { status?: BugStatus; query?: string; limit?: number }): Promise<{ bugs: BugReportSummary[]; pendingCount: number }> {
    const response = await fetch(buildUrl('/v1/bug-share/bugs', options), { method: 'GET', headers: publicHeaders(token) });
    return await readJson(response);
}

export async function createPublicBug(token: string, input: { description: string }): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bug-share/bugs`, { method: 'POST', headers: publicHeaders(token), body: JSON.stringify(input) });
    return bugFromResponse(await readJson(response));
}

export async function getPublicBug(token: string, bugId: string): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bug-share/bugs/${encodeURIComponent(bugId)}`, { method: 'GET', headers: publicHeaders(token) });
    return bugFromResponse(await readJson(response));
}

export async function addPublicBugComment(token: string, bugId: string, body: string): Promise<{ bug: BugReportDetail; commentId: string }> {
    const response = await fetch(`${getServerUrl()}/v1/bug-share/bugs/${encodeURIComponent(bugId)}/comments`, { method: 'POST', headers: publicHeaders(token), body: JSON.stringify({ body }) });
    return await readJson(response);
}

export async function changePublicBugStatus(token: string, bugId: string, input: { status: BugStatus; action?: 'return_to_pending' }): Promise<BugReportDetail> {
    const response = await fetch(`${getServerUrl()}/v1/bug-share/bugs/${encodeURIComponent(bugId)}/status`, { method: 'PATCH', headers: publicHeaders(token), body: JSON.stringify(input) });
    return bugFromResponse(await readJson(response));
}

export async function uploadPublicBugAttachment(token: string, bugId: string, image: LocalImage, commentId?: string): Promise<BugReportDetail> {
    return await uploadImage(`${getServerUrl()}/v1/bug-share/bugs/${encodeURIComponent(bugId)}/attachments`, image, { Authorization: `Bearer ${token}` }, commentId);
}

export type BugApiJson = JsonObject;
