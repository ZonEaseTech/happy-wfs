import { z } from "zod";
import { db } from "@/storage/db";
import { decryptString } from "@/modules/encrypt";
import { Fastify } from "../types";

const GitHubIssueSchema = z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    htmlUrl: z.string(),
    repository: z.string(),
    state: z.string(),
    updatedAt: z.string(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
});

type GitHubSearchIssue = {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    repository_url: string;
    state: string;
    updated_at: string;
    labels?: Array<{ name?: string }>;
    assignees?: Array<{ login?: string }>;
    pull_request?: unknown;
};

function repoNameFromApiUrl(repositoryUrl: string): string {
    const marker = '/repos/';
    const idx = repositoryUrl.indexOf(marker);
    return idx >= 0 ? repositoryUrl.slice(idx + marker.length) : repositoryUrl;
}

export function githubRoutes(app: Fastify) {
    app.get('/v1/github/issues', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                query: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(50).optional(),
            }),
            response: {
                200: z.object({
                    issues: z.array(GitHubIssueSchema),
                }),
                401: z.object({ error: z.string() }),
                500: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const user = await db.account.findUnique({
            where: { id: userId },
            select: {
                githubUserId: true,
                githubUser: { select: { token: true } },
            },
        });

        if (!user?.githubUserId || !user.githubUser?.token) {
            return reply.code(401).send({ error: 'GitHub account is not connected' });
        }

        const token = decryptString(['user', userId, 'github', 'token'], user.githubUser.token);
        const query = request.query.query?.trim() || 'is:issue is:open assignee:@me archived:false';
        const limit = request.query.limit ?? 30;
        const url = new URL('https://api.github.com/search/issues');
        url.searchParams.set('q', query);
        url.searchParams.set('sort', 'updated');
        url.searchParams.set('order', 'desc');
        url.searchParams.set('per_page', String(limit));

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'happy-ai',
            },
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            return reply.code(500).send({
                error: `Failed to fetch GitHub issues: ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
            });
        }

        const data = await response.json() as { items?: GitHubSearchIssue[] };
        const issues = (data.items ?? [])
            .filter((item) => !item.pull_request)
            .map((item) => ({
                id: item.id,
                number: item.number,
                title: item.title,
                body: item.body,
                htmlUrl: item.html_url,
                repository: repoNameFromApiUrl(item.repository_url),
                state: item.state,
                updatedAt: item.updated_at,
                labels: (item.labels ?? []).map((label) => label.name).filter((name): name is string => !!name),
                assignees: (item.assignees ?? []).map((assignee) => assignee.login).filter((login): login is string => !!login),
            }));

        return reply.send({ issues });
    });
}
