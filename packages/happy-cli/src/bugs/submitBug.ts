/**
 * File a bug report on the user's Happy account from inside a session.
 *
 * Bugs live on the server, not in the session, so this posts to the same
 * `/v1/bugs` collection the app's bug board reads — a bug filed from a session
 * shows up there without any extra sync.
 */

import axios from 'axios';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';

export type BugVisibility = 'shared' | 'private';

export interface SubmitBugInput {
    description: string;
    visibility?: BugVisibility;
}

export interface SubmittedBug {
    id: string;
    displayId: string;
    title: string;
    status: string;
    visibility: string;
}

export async function submitBug(credentials: Credentials, input: SubmitBugInput): Promise<SubmittedBug> {
    const response = await axios.post<{ bug: SubmittedBug }>(
        `${configuration.serverUrl}/v1/bugs`,
        {
            description: input.description,
            ...(input.visibility ? { visibility: input.visibility } : {}),
        },
        { headers: { Authorization: `Bearer ${credentials.token}` }, timeout: 15000 },
    );
    return response.data.bug;
}
