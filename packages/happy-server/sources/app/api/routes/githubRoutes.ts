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
    projectStatuses: z.array(z.string()),
    projectTitles: z.array(z.string()),
});

type GraphQLIssueNode = {
    databaseId: number;
    number: number;
    title: string;
    body: string | null;
    url: string;
    state: string;
    updatedAt: string;
    repository: { nameWithOwner: string };
    labels?: { nodes?: Array<{ name?: string } | null> | null };
    assignees?: { nodes?: Array<{ login?: string } | null> | null };
    projectItems?: {
        nodes?: Array<{
            project?: { title?: string | null } | null;
            fieldValues?: {
                nodes?: Array<{
                    name?: string | null;
                    text?: string | null;
                    field?: { name?: string | null } | null;
                } | null> | null;
            } | null;
        } | null> | null;
    } | null;
};

const issueSearchQuery = `
query HappyIssueInbox($query: String!, $limit: Int!) {
  search(type: ISSUE, query: $query, first: $limit) {
    nodes {
      ... on Issue {
        databaseId
        number
        title
        body
        url
        state
        updatedAt
        repository { nameWithOwner }
        labels(first: 20) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        projectItems(first: 20) {
          nodes {
            project { title }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)));
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

        const response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'happy-ai',
            },
            body: JSON.stringify({
                query: issueSearchQuery,
                variables: { query, limit },
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            return reply.code(500).send({
                error: `Failed to fetch GitHub issues: ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
            });
        }

        const data = await response.json() as {
            data?: { search?: { nodes?: Array<GraphQLIssueNode | null> | null } | null };
            errors?: Array<{ message?: string }>;
        };
        if (data.errors?.length) {
            return reply.code(500).send({
                error: `Failed to fetch GitHub issues: ${data.errors.map((e) => e.message).filter(Boolean).join('; ')}`,
            });
        }

        const issues = (data.data?.search?.nodes ?? [])
            .filter((item): item is GraphQLIssueNode => !!item)
            .map((item) => {
                const projectItems = item.projectItems?.nodes?.filter((node): node is NonNullable<typeof node> => !!node) ?? [];
                const projectTitles = uniqueStrings(projectItems.map((node) => node.project?.title));
                const projectStatuses = uniqueStrings(projectItems.flatMap((node) => {
                    const values = node.fieldValues?.nodes?.filter((value): value is NonNullable<typeof value> => !!value) ?? [];
                    return values
                        .filter((value) => value.field?.name?.toLowerCase() === 'status')
                        .map((value) => value.name ?? value.text);
                }));

                return {
                    id: item.databaseId,
                    number: item.number,
                    title: item.title,
                    body: item.body,
                    htmlUrl: item.url,
                    repository: item.repository.nameWithOwner,
                    state: item.state,
                    updatedAt: item.updatedAt,
                    labels: (item.labels?.nodes ?? []).map((label) => label?.name).filter((name): name is string => !!name),
                    assignees: (item.assignees?.nodes ?? []).map((assignee) => assignee?.login).filter((login): login is string => !!login),
                    projectStatuses,
                    projectTitles,
                };
            });

        return reply.send({ issues });
    });
}
