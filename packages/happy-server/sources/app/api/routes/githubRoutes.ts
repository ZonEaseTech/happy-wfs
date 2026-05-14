import { z } from "zod";
import { db } from "@/storage/db";
import { decryptString } from "@/modules/encrypt";
import { Fastify } from "../types";
import { log } from "@/utils/log";

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

type GraphQLProjectItemNode = {
    content?: GraphQLIssueNode | null;
    fieldValues?: {
        nodes?: Array<{
            name?: string | null;
            text?: string | null;
            field?: { name?: string | null } | null;
        } | null> | null;
    } | null;
};

type GitHubIssue = z.infer<typeof GitHubIssueSchema>;

type GitHubProjectSearchNode = {
    id?: string;
    title?: string | null;
    closed?: boolean | null;
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

const issueSearchQueryWithoutProjects = `
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
      }
    }
  }
}
`;

const projectSearchQuery = `
query HappyIssueInboxProjects($query: String!) {
  viewer {
    projectsV2(first: 20, query: $query) {
      nodes { id title closed }
    }
    organizations(first: 50) {
      nodes {
        login
        projectsV2(first: 20, query: $query) {
          nodes { id title closed }
        }
      }
    }
  }
}
`;

const projectItemsQuery = `
query HappyIssueInboxProjectItems($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      title
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content {
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
            }
          }
          fieldValues(first: 30) {
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
`;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)));
}

function splitFilterValues(value: string | undefined): string[] {
    return (value ?? '')
        .split(/[\n,，]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function matchesAny(values: string[], filters: string[]): boolean {
    if (filters.length === 0) return true;
    const haystack = values.join('\n').toLowerCase();
    return filters.some((filter) => haystack.includes(filter));
}

function extractIssueSearchTerms(query: string | undefined): string[] {
    return (query ?? '')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        // Remove GitHub search qualifiers such as is:issue, is:open,
        // assignee:@me, archived:false, repo:owner/name, etc. When ProjectV2
        // filters are present, the project itself is the source of truth.
        .filter((term) => !/^-?[a-z][a-z0-9-]*:/i.test(term));
}

function issueMatchesSearchTerms(issue: GitHubIssue, terms: string[]): boolean {
    if (terms.length === 0) return true;
    const haystack = [
        issue.repository,
        `#${issue.number}`,
        String(issue.number),
        issue.title,
        issue.body ?? '',
        ...issue.labels,
        ...issue.projectStatuses,
        ...issue.projectTitles,
    ].join('\n').toLowerCase();
    return terms.every((term) => {
        const normalized = term.replace(/^#\s*/, '').toLowerCase();
        if (/^\d+$/.test(normalized)) {
            return issue.number === Number(normalized);
        }
        return haystack.includes(normalized);
    });
}

type GitHubGraphQLIssuesResponse = {
    data?: { search?: { nodes?: Array<GraphQLIssueNode | null> | null } | null };
    errors?: Array<{ message?: string }>;
};

type GitHubProjectSearchResponse = {
    data?: {
        viewer?: {
            projectsV2?: { nodes?: Array<GitHubProjectSearchNode | null> | null } | null;
            organizations?: {
                nodes?: Array<{
                    login?: string | null;
                    projectsV2?: { nodes?: Array<GitHubProjectSearchNode | null> | null } | null;
                } | null> | null;
            } | null;
        } | null;
    };
    errors?: Array<{ message?: string }>;
};

type GitHubProjectItemsResponse = {
    data?: {
        node?: {
            title?: string | null;
            items?: {
                pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
                nodes?: Array<GraphQLProjectItemNode | null> | null;
            } | null;
        } | null;
    };
    errors?: Array<{ message?: string }>;
};

async function fetchGitHubGraphQL<T>(args: {
    token: string;
    query: string;
    variables: Record<string, unknown>;
}): Promise<{ ok: true; data: T } | { ok: false; status?: number; error: string }> {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${args.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'happy-ai',
        },
        body: JSON.stringify({
            query: args.query,
            variables: args.variables,
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
            ok: false,
            status: response.status,
            error: `GitHub responded with ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
        };
    }

    const data = await response.json() as T & { errors?: Array<{ message?: string }> };
    if (data.errors?.length) {
        return {
            ok: false,
            error: data.errors.map((e) => e.message).filter(Boolean).join('; ') || 'GitHub GraphQL query failed',
        };
    }

    return { ok: true, data };
}

async function fetchGitHubIssueSearch(args: {
    token: string;
    query: string;
    limit: number;
    includeProjects: boolean;
}): Promise<{ ok: true; data: GitHubGraphQLIssuesResponse } | { ok: false; status?: number; error: string }> {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${args.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'happy-ai',
        },
        body: JSON.stringify({
            query: args.includeProjects ? issueSearchQuery : issueSearchQueryWithoutProjects,
            variables: { query: args.query, limit: args.limit },
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
            ok: false,
            status: response.status,
            error: `GitHub responded with ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
        };
    }

    const data = await response.json() as GitHubGraphQLIssuesResponse;
    if (data.errors?.length) {
        return {
            ok: false,
            error: data.errors.map((e) => e.message).filter(Boolean).join('; ') || 'GitHub GraphQL query failed',
        };
    }

    return { ok: true, data };
}

function mapIssueNode(item: GraphQLIssueNode, projectTitles: string[], projectStatuses: string[]): GitHubIssue {
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
}

async function fetchGitHubProjectIssues(args: {
    token: string;
    projectFilters: string[];
    statusFilters: string[];
    limit: number;
}): Promise<{ ok: true; issues: GitHubIssue[] } | { ok: false; status?: number; error: string }> {
    const projectsById = new Map<string, { id: string; title: string }>();

    for (const projectFilter of args.projectFilters) {
        const result = await fetchGitHubGraphQL<GitHubProjectSearchResponse>({
            token: args.token,
            query: projectSearchQuery,
            variables: { query: projectFilter },
        });
        if (!result.ok) return result;

        const viewerProjects = result.data.data?.viewer?.projectsV2?.nodes ?? [];
        const orgProjects = (result.data.data?.viewer?.organizations?.nodes ?? [])
            .flatMap((org) => org?.projectsV2?.nodes ?? []);
        const matchingActiveProjects = [...viewerProjects, ...orgProjects]
            .filter((project): project is GitHubProjectSearchNode => !!project?.id && !!project.title?.trim() && project.closed !== true)
            .filter((project) => project.title!.trim().toLowerCase().includes(projectFilter));
        const exactMatches = matchingActiveProjects.filter((project) => project.title!.trim().toLowerCase() === projectFilter);
        const selectedProjects = exactMatches.length > 0 ? exactMatches : matchingActiveProjects;
        for (const project of selectedProjects) {
            const id = project?.id;
            const title = project?.title?.trim();
            if (!id || !title) continue;
            projectsById.set(id, { id, title });
        }
    }

    if (projectsById.size === 0) {
        return { ok: true, issues: [] };
    }

    const issuesByKey = new Map<string, GitHubIssue>();
    for (const project of projectsById.values()) {
        let after: string | null | undefined;
        let page = 0;
        let hasNextPage = true;
        do {
            const result = await fetchGitHubGraphQL<GitHubProjectItemsResponse>({
                token: args.token,
                query: projectItemsQuery,
                variables: { projectId: project.id, after },
            });
            if (!result.ok) return result;

            const items = result.data.data?.node?.items;
            for (const item of items?.nodes ?? []) {
                if (!item) continue;
                const issue = item?.content;
                if (!issue?.databaseId || issue.state !== 'OPEN') continue;
                const values = item.fieldValues?.nodes?.filter((value): value is NonNullable<typeof value> => !!value) ?? [];
                const projectStatuses = uniqueStrings(values
                    .filter((value) => value.field?.name?.toLowerCase() === 'status')
                    .map((value) => value.name ?? value.text));
                const statusValues = projectStatuses.length > 0 ? projectStatuses : ['No Status'];
                if (!matchesAny(statusValues, args.statusFilters)) continue;

                const key = `${issue.repository.nameWithOwner}#${issue.number}`;
                const existing = issuesByKey.get(key);
                if (existing) {
                    existing.projectTitles = uniqueStrings([...existing.projectTitles, project.title]);
                    existing.projectStatuses = uniqueStrings([...existing.projectStatuses, ...projectStatuses]);
                } else {
                    issuesByKey.set(key, mapIssueNode(issue, [project.title], projectStatuses));
                }
            }

            after = items?.pageInfo?.endCursor;
            hasNextPage = !!items?.pageInfo?.hasNextPage;
            page += 1;
            if (issuesByKey.size >= args.limit && args.statusFilters.length === 0) break;
        } while (hasNextPage && after && page < 10);
    }

    const issues = Array.from(issuesByKey.values())
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, args.limit);

    return { ok: true, issues };
}

export function githubRoutes(app: Fastify) {
    app.get('/v1/github/issues', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                query: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(100).optional(),
                projects: z.string().optional(),
                statuses: z.string().optional(),
            }),
            response: {
                200: z.object({
                    issues: z.array(GitHubIssueSchema),
                    warning: z.string().optional(),
                }),
                401: z.object({ error: z.string() }),
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
        const query = request.query.query?.trim() || 'is:issue is:open archived:false';
        const limit = request.query.limit ?? 30;
        const projectFilters = splitFilterValues(request.query.projects);
        const statusFilters = splitFilterValues(request.query.statuses);

        if (projectFilters.length > 0) {
            const result = await fetchGitHubProjectIssues({ token, projectFilters, statusFilters, limit });
            if (result.ok) {
                const searchTerms = extractIssueSearchTerms(request.query.query);
                const issues = result.issues.filter((issue) => issueMatchesSearchTerms(issue, searchTerms));
                return reply.send({ issues });
            }
            log({ module: 'github-issues', level: 'warn' }, `GitHub project issues unavailable: ${result.error}`);
            return reply.send({
                issues: [],
                warning: `GitHub Project 读取失败：${result.error}`,
            });
        }

        let result = await fetchGitHubIssueSearch({ token, query, limit, includeProjects: true });
        if (!result.ok) {
            log({ module: 'github-issues', level: 'warn' }, `GitHub issues project fields unavailable, retrying without project fields: ${result.error}`);
            result = await fetchGitHubIssueSearch({ token, query, limit, includeProjects: false });
        }

        if (!result.ok) {
            log({ module: 'github-issues', level: 'warn' }, `GitHub issues unavailable, returning empty inbox: ${result.error}`);
            return reply.send({
                issues: [],
                warning: `GitHub Issues 暂时读取失败：${result.error}`,
            });
        }

        let issues = (result.data.data?.search?.nodes ?? [])
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

                return mapIssueNode(item, projectTitles, projectStatuses);
            });
        if (projectFilters.length > 0) {
            issues = issues.filter((issue) => matchesAny(issue.projectTitles, projectFilters));
        }
        if (statusFilters.length > 0) {
            issues = issues.filter((issue) => matchesAny(issue.projectStatuses.length > 0 ? issue.projectStatuses : ['No Status'], statusFilters));
        }

        return reply.send({ issues });
    });
}
