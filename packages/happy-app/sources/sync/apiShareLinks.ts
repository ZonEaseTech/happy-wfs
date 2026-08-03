import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';

/**
 * Short share links for public HTML previews: the server stores the long
 * public file URL + title behind a short code so shared links stay compact.
 */
export async function createShareLink(
    credentials: AuthCredentials,
    url: string,
    title?: string | null
): Promise<string> {
    const response = await fetch(`${getServerUrl()}/v1/share-links`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url, ...(title?.trim() ? { title: title.trim().slice(0, 200) } : {}) })
    });
    if (!response.ok) {
        throw new Error(`Failed to create share link: ${response.status}`);
    }
    const data = await response.json() as { code: string };
    return data.code;
}

export async function fetchPublicShareLink(code: string): Promise<{ url: string; title: string | null }> {
    const response = await fetch(`${getServerUrl()}/v1/share-links/${encodeURIComponent(code)}`);
    if (!response.ok) {
        throw new Error(`Share link not found: ${response.status}`);
    }
    return await response.json() as { url: string; title: string | null };
}
