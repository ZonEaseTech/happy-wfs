/**
 * File, edit and delete bug reports on the user's Happy account from inside a
 * session.
 *
 * Bugs live on the server, not in the session, so these post to the same
 * `/v1/bugs` collection the app's bug board reads — a bug filed from a session
 * shows up there without any extra sync.
 *
 * Agents get told about bugs the way a person says them ("BUG-236"), never by
 * the internal cuid, so every operation takes a reference and resolves it
 * first.
 */

import axios from 'axios';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';

/**
 * Mirrors BUG_IMAGE_LIMITS on the server. The upload endpoint enforces the size
 * and the format, but nothing there caps the count — the app does that in its
 * own picker — so a session has to hold that line itself.
 */
const MAX_BUG_IMAGES = 10;
const MAX_BUG_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
};

export type BugVisibility = 'shared' | 'private';

export interface SubmitBugInput {
    description: string;
    visibility?: BugVisibility;
    images?: string[];
}

export interface AttachmentOutcome {
    file: string;
    ok: boolean;
    error?: string;
}

export interface EditBugInput {
    bug: string;
    description?: string;
    images?: string[];
}

export interface SubmittedBug {
    id: string;
    displayId: string;
    title: string;
    status: string;
    visibility: string;
    attachmentCount?: number;
    commentCount?: number;
    createdByNickname?: string | null;
    lastActivityAt?: number;
}

export type BugStatus = 'pending' | 'in_progress' | 'verify' | 'closed';

export interface ListBugsInput {
    status?: BugStatus;
    query?: string;
    limit?: number;
}

export interface BugAttachment {
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: number;
}

export interface BugComment {
    body: string;
    authorNickname: string | null;
    createdAt: number;
    attachments: BugAttachment[];
}

export interface BugHistoryEntry {
    action: string;
    fromStatus: string | null;
    toStatus: string;
    actorNickname: string | null;
    note: string | null;
    createdAt: number;
}

export interface BugDetail extends SubmittedBug {
    description: string;
    sessionId: string | null;
    attachments: BugAttachment[];
    comments: BugComment[];
    statusHistory: BugHistoryEntry[];
}

function authHeaders(credentials: Credentials) {
    return { headers: { Authorization: `Bearer ${credentials.token}` }, timeout: 15000 };
}

/**
 * Turn what the user said into the id the API wants.
 *
 * `BUG-236`, `#236` and `236` all mean the same bug board entry; anything else
 * is assumed to already be an internal id. The list query is a substring match
 * over titles and descriptions too, so the display id is compared exactly here
 * — otherwise a bug that merely mentions "BUG-236" could win.
 */
export async function listBugs(
    credentials: Credentials,
    input: ListBugsInput = {},
): Promise<{ bugs: SubmittedBug[]; pendingCount: number }> {
    const response = await axios.get<{ bugs: SubmittedBug[]; pendingCount: number }>(
        `${configuration.serverUrl}/v1/bugs`,
        {
            params: {
                ...(input.status ? { status: input.status } : {}),
                ...(input.query ? { query: input.query } : {}),
                limit: input.limit ?? 50,
            },
            ...authHeaders(credentials),
        },
    );
    return response.data;
}

export async function getBug(credentials: Credentials, reference: string): Promise<BugDetail> {
    const bugId = await resolveBugId(credentials, reference);
    const response = await axios.get<{ bug: BugDetail }>(
        `${configuration.serverUrl}/v1/bugs/${bugId}`,
        authHeaders(credentials),
    );
    return response.data.bug;
}

export async function resolveBugId(credentials: Credentials, reference: string): Promise<string> {
    const trimmed = reference.trim();
    const displayNumber = trimmed.replace(/^#/, '').match(/^(?:bug-)?(\d+)$/i)?.[1];
    if (!displayNumber) {
        return trimmed;
    }
    const displayId = `BUG-${displayNumber}`;
    const response = await axios.get<{ bugs: SubmittedBug[] }>(
        `${configuration.serverUrl}/v1/bugs`,
        { params: { query: displayId, limit: 200 }, ...authHeaders(credentials) },
    );
    const match = response.data.bugs.find((bug) => bug.displayId === displayId);
    if (!match) {
        throw new Error(`${displayId} not found on the bug board`);
    }
    return match.id;
}

/**
 * Attach one local image file to a bug.
 *
 * The server only takes JPEG and PNG, so the extension decides the type rather
 * than sniffing the bytes — a mislabelled file is rejected upstream anyway.
 */
export async function attachBugImage(credentials: Credentials, bugId: string, filePath: string): Promise<void> {
    const mimeType = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()];
    if (!mimeType) {
        throw new Error('only .jpg, .jpeg and .png are supported');
    }
    const { size } = await stat(filePath);
    if (size > MAX_BUG_IMAGE_BYTES) {
        throw new Error(`image is ${Math.round(size / 1024 / 1024)}MB, over the 20MB limit`);
    }
    const form = new FormData();
    form.append('file', new Blob([await readFile(filePath)], { type: mimeType }), basename(filePath));
    await axios.post(`${configuration.serverUrl}/v1/bugs/${bugId}/attachments`, form, authHeaders(credentials));
}

/**
 * Attach a batch of images, reporting per file instead of throwing.
 *
 * The bug is already on the board by the time this runs, so a bad image is
 * reported rather than thrown — losing the whole report over one unreadable
 * screenshot would be worse than filing it without that screenshot.
 */
async function attachImages(
    credentials: Credentials,
    bugId: string,
    images: string[],
    alreadyAttached: number,
): Promise<AttachmentOutcome[]> {
    const room = Math.max(MAX_BUG_IMAGES - alreadyAttached, 0);
    const attachments: AttachmentOutcome[] = [];
    for (const file of images.slice(0, room)) {
        await attachBugImage(credentials, bugId, file)
            .then(() => attachments.push({ file, ok: true }))
            .catch((error) => attachments.push({ file, ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    for (const file of images.slice(room)) {
        attachments.push({ file, ok: false, error: `skipped — a bug takes at most ${MAX_BUG_IMAGES} images` });
    }
    return attachments;
}

export async function submitBug(
    credentials: Credentials,
    input: SubmitBugInput,
): Promise<SubmittedBug & { attachments?: AttachmentOutcome[] }> {
    const response = await axios.post<{ bug: SubmittedBug }>(
        `${configuration.serverUrl}/v1/bugs`,
        {
            description: input.description,
            ...(input.visibility ? { visibility: input.visibility } : {}),
        },
        authHeaders(credentials),
    );
    const bug = response.data.bug;
    const images = input.images ?? [];
    if (!images.length) {
        return bug;
    }
    return { ...bug, attachments: await attachImages(credentials, bug.id, images, 0) };
}

/**
 * Rewrite a bug's description, add screenshots to it, or both.
 *
 * Images add to what is already there rather than replacing it, so the existing
 * count has to be read back before deciding how many more will fit.
 */
export async function editBug(
    credentials: Credentials,
    input: EditBugInput,
): Promise<SubmittedBug & { attachments?: AttachmentOutcome[] }> {
    const images = input.images ?? [];
    if (!input.description && !images.length) {
        throw new Error('nothing to change — pass a description, images, or both');
    }
    const bugId = await resolveBugId(credentials, input.bug);
    const bug = input.description
        ? (await axios.patch<{ bug: SubmittedBug }>(
            `${configuration.serverUrl}/v1/bugs/${bugId}/content`,
            { description: input.description },
            authHeaders(credentials),
        )).data.bug
        : (await axios.get<{ bug: SubmittedBug }>(
            `${configuration.serverUrl}/v1/bugs/${bugId}`,
            authHeaders(credentials),
        )).data.bug;
    if (!images.length) {
        return bug;
    }
    return { ...bug, attachments: await attachImages(credentials, bugId, images, bug.attachmentCount ?? 0) };
}

export async function deleteBug(credentials: Credentials, reference: string): Promise<{ id: string }> {
    const bugId = await resolveBugId(credentials, reference);
    await axios.delete(`${configuration.serverUrl}/v1/bugs/${bugId}`, authHeaders(credentials));
    return { id: bugId };
}
