import { AuthCredentials } from '@/auth/tokenStorage';
import { HappyError } from '@/utils/errors';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export interface GitHubOAuthParams {
    url: string;
}

export interface GitHubProfile {
    id: number;
    login: string;
    name: string;
    avatar_url: string;
    email?: string;
}

export interface AccountProfile {
    id: string;
    timestamp: number;
    github: GitHubProfile | null;
}

export interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body: string | null;
    htmlUrl: string;
    repository: string;
    state: string;
    updatedAt: string;
    labels: string[];
    assignees: string[];
    projectStatuses: string[];
    projectTitles: string[];
}

/**
 * Get GitHub OAuth parameters from the server
 */
export async function getGitHubOAuthParams(credentials: AuthCredentials, callback?: string): Promise<GitHubOAuthParams> {
    const API_ENDPOINT = getServerUrl();

    // Don't use backoff — OAuth configuration errors (400) are permanent and should fail immediately.
    // Retrying would cause infinite loops when GITHUB_CLIENT_ID/GITHUB_REDIRECT_URL are not set on the server.
    const url = new URL(`${API_ENDPOINT}/v1/connect/github/params`);
    if (callback) {
        url.searchParams.set('callback', callback);
    }
    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        if (response.status === 400) {
            const error = await response.json();
            throw new HappyError(error.error || 'GitHub OAuth not configured', false);
        }
        throw new HappyError(`Failed to get GitHub OAuth params: ${response.status}`, false);
    }

    const data = await response.json() as GitHubOAuthParams;
    return data;
}

/**
 * Get account profile including GitHub connection status
 */
export async function getAccountProfile(credentials: AuthCredentials): Promise<AccountProfile> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/account/profile`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get account profile: ${response.status}`);
        }

        const data = await response.json() as AccountProfile;
        return data;
    });
}

/**
 * Disconnect GitHub account from the user's profile
 */
export async function disconnectGitHub(credentials: AuthCredentials): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/connect/github`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                const error = await response.json();
                throw new Error(error.error || 'GitHub account not connected');
            }
            throw new Error(`Failed to disconnect GitHub: ${response.status}`);
        }

        const data = await response.json() as { success: true };
        if (!data.success) {
            throw new Error('Failed to disconnect GitHub account');
        }
    });
}

export async function listGitHubIssues(credentials: AuthCredentials, options?: { query?: string; limit?: number }): Promise<GitHubIssue[]> {
    const API_ENDPOINT = getServerUrl();
    const url = new URL(`${API_ENDPOINT}/v1/github/issues`);
    if (options?.query) url.searchParams.set('query', options.query);
    if (options?.limit) url.searchParams.set('limit', String(options.limit));

    // Do not use the global infinite backoff here. GitHub OAuth scope/API
    // failures are usually permanent until the user reconnects, and retrying
    // floods the console plus the API.
    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new HappyError(error?.error || `Failed to get GitHub issues: ${response.status}`, false);
    }

    const data = await response.json() as { issues: GitHubIssue[] };
    return data.issues;
}
