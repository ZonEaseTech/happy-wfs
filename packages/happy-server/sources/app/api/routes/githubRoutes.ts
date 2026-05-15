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

const UpdateGitHubIssueStatusBodySchema = z.object({
    repository: z.string().min(1),
    number: z.number().int().positive(),
    projectTitle: z.string().optional(),
    status: z.string().min(1),
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
    parent?: { id?: string | null; number?: number | null; title?: string | null } | null;
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

type GraphQLProjectItemForUpdateNode = {
    id?: string | null;
    project?: { id?: string | null; title?: string | null } | null;
    fieldValues?: {
        nodes?: Array<{
            name?: string | null;
            text?: string | null;
            field?: { name?: string | null } | null;
        } | null> | null;
    } | null;
};

type GraphQLIssueForUpdateNode = Omit<GraphQLIssueNode, "projectItems"> & {
    projectItems?: { nodes?: Array<GraphQLProjectItemForUpdateNode | null> | null } | null;
    subIssues?: { nodes?: Array<GraphQLIssueForUpdateNode | null> | null } | null;
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

const issueProjectItemForUpdateQuery = `
query HappyIssueProjectItemForUpdate($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      databaseId
      number
      title
      body
      url
      state
      updatedAt
      repository { nameWithOwner }
      parent { id number title }
      labels(first: 20) { nodes { name } }
      assignees(first: 20) { nodes { login } }
      projectItems(first: 20) {
        nodes {
          id
          project { id title }
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
      subIssues(first: 50) {
        nodes {
          databaseId
          number
          title
          body
          url
          state
          updatedAt
          repository { nameWithOwner }
          parent { id number title }
          labels(first: 20) { nodes { name } }
          assignees(first: 20) { nodes { login } }
          projectItems(first: 20) {
            nodes {
              id
              project { id title }
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
  }
}
`;

const projectStatusOptionsQuery = `
query HappyProjectStatusOptions($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}
`;

const updateProjectItemStatusMutation = `
mutation HappyUpdateProjectItemStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: { singleSelectOptionId: $optionId }
  }) {
    projectV2Item { id }
  }
}
`;

const clearProjectItemStatusMutation = `
mutation HappyClearProjectItemStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
  }) {
    projectV2Item { id }
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

function extractExactIssueNumber(query: string | undefined): number | null {
    const terms = extractIssueSearchTerms(query);
    if (terms.length !== 1) return null;
    const normalized = terms[0]?.replace(/^#\s*/, '').trim();
    if (!normalized || !/^\d+$/.test(normalized)) return null;
    return Number(normalized);
}

function extractRepoQualifier(query: string | undefined): { owner: string; repo: string } | null {
    const repoTerm = (query ?? '').split(/\s+/).find((term) => /^repo:/i.test(term));
    const value = repoTerm?.replace(/^repo:/i, '').trim();
    if (!value) return null;
    const [owner, repo] = value.split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
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

type GitHubIssueProjectItemForUpdateResponse = {
    data?: {
        repository?: {
            issue?: GraphQLIssueForUpdateNode | null;
        } | null;
    };
    errors?: Array<{ message?: string }>;
};

type GitHubIssueNumberSearchResponse = {
    data?: { search?: { nodes?: Array<GraphQLIssueNode | null> | null } | null };
    errors?: Array<{ message?: string }>;
};

type GitHubProjectStatusOptionsResponse = {
    data?: {
        node?: {
            fields?: {
                nodes?: Array<{
                    id?: string | null;
                    name?: string | null;
                    options?: Array<{ id?: string | null; name?: string | null } | null> | null;
                } | null> | null;
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

async function fetchGitHubIssueByRepositoryNumber(args: {
    token: string;
    owner: string;
    repo: string;
    number: number;
}): Promise<{ ok: true; issue: GitHubIssue | null } | { ok: false; status?: number; error: string }> {
    const result = await fetchGitHubGraphQL<GitHubIssueProjectItemForUpdateResponse>({
        token: args.token,
        query: issueProjectItemForUpdateQuery,
        variables: { owner: args.owner, repo: args.repo, number: args.number },
    });
    if (!result.ok) return result;
    const issue = result.data.data?.repository?.issue;
    return { ok: true, issue: issue ? mapIssueFromProjectItemsForUpdateResponse(issue) : null };
}

async function fetchGitHubIssuesByNumberSearch(args: {
    token: string;
    number: number;
    query?: string;
    limit: number;
}): Promise<{ ok: true; issues: GitHubIssue[] } | { ok: false; status?: number; error: string }> {
    const qualifiers = (args.query ?? '')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => /^-?[a-z][a-z0-9-]*:/i.test(term))
        .filter((term) => !/^assignee:/i.test(term))
        .filter((term) => !/^is:issue$/i.test(term));
    const searchQuery = uniqueStrings(['is:issue', 'archived:false', ...qualifiers, String(args.number)]).join(' ');
    const result = await fetchGitHubGraphQL<GitHubIssueNumberSearchResponse>({
        token: args.token,
        query: issueSearchQuery,
        variables: { query: searchQuery, limit: Math.min(Math.max(args.limit, 10), 50) },
    });
    if (!result.ok) return result;

    const issues = (result.data.data?.search?.nodes ?? [])
        .filter((item): item is GraphQLIssueNode => !!item && item.number === args.number)
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
        })
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, args.limit);

    return { ok: true, issues };
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

function projectItemStatusValues(item: GraphQLProjectItemForUpdateNode): string[] {
    const values = item.fieldValues?.nodes?.filter((value): value is NonNullable<typeof value> => !!value) ?? [];
    return uniqueStrings(values
        .filter((value) => value.field?.name?.toLowerCase() === 'status')
        .map((value) => value.name ?? value.text));
}

function projectItemForStatusUpdate(args: {
    projectItems: GraphQLProjectItemForUpdateNode[];
    projectTitle?: string;
    projectId?: string;
}): GraphQLProjectItemForUpdateNode | undefined {
    if (args.projectId) {
        const exactProject = args.projectItems.find((item) => item.project?.id === args.projectId);
        if (exactProject) return exactProject;
    }

    const projectTitle = args.projectTitle?.trim().toLowerCase();
    if (!projectTitle) return args.projectItems[0];

    return args.projectItems.find((item) => item.project?.title?.trim().toLowerCase() === projectTitle)
        ?? args.projectItems.find((item) => item.project?.title?.trim().toLowerCase().includes(projectTitle));
}

async function setProjectItemStatus(args: {
    token: string;
    projectId: string;
    itemId: string;
    fieldId: string;
    optionId?: string;
}): Promise<{ ok: true } | { ok: false; status?: number; error: string }> {
    if (!args.optionId) {
        const result = await fetchGitHubGraphQL<{
            data?: { clearProjectV2ItemFieldValue?: { projectV2Item?: { id?: string | null } | null } | null };
            errors?: Array<{ message?: string }>;
        }>({
            token: args.token,
            query: clearProjectItemStatusMutation,
            variables: {
                projectId: args.projectId,
                itemId: args.itemId,
                fieldId: args.fieldId,
            },
        });
        if (!result.ok) return result;
        return { ok: true };
    }

    const result = await fetchGitHubGraphQL<{
        data?: { updateProjectV2ItemFieldValue?: { projectV2Item?: { id?: string | null } | null } | null };
        errors?: Array<{ message?: string }>;
    }>({
        token: args.token,
        query: updateProjectItemStatusMutation,
        variables: {
            projectId: args.projectId,
            itemId: args.itemId,
            fieldId: args.fieldId,
            optionId: args.optionId,
        },
    });
    if (!result.ok) return result;
    return { ok: true };
}

function mapIssueForUpdateResponse(
    issue: GraphQLIssueForUpdateNode,
    updatedProjectItemId: string,
    nextStatus: string,
): GitHubIssue {
    const projectItems = issue.projectItems?.nodes?.filter((node): node is GraphQLProjectItemForUpdateNode => !!node) ?? [];
    const projectTitles = uniqueStrings(projectItems.map((node) => node.project?.title));
    const projectStatuses = uniqueStrings(projectItems.flatMap((node) => {
        if (node.id === updatedProjectItemId) return [nextStatus];
        return projectItemStatusValues(node);
    }));

    return mapIssueNode({
        databaseId: issue.databaseId,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        url: issue.url,
        state: issue.state,
        updatedAt: new Date().toISOString(),
        repository: issue.repository,
        labels: issue.labels,
        assignees: issue.assignees,
    }, projectTitles, projectStatuses);
}

function mapIssueFromProjectItemsForUpdateResponse(
    issue: GraphQLIssueForUpdateNode,
): GitHubIssue {
    const projectItems = issue.projectItems?.nodes?.filter((node): node is GraphQLProjectItemForUpdateNode => !!node) ?? [];
    const projectTitles = uniqueStrings(projectItems.map((node) => node.project?.title));
    const projectStatuses = uniqueStrings(projectItems.flatMap(projectItemStatusValues));

    return mapIssueNode({
        databaseId: issue.databaseId,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        url: issue.url,
        state: issue.state,
        updatedAt: issue.updatedAt,
        repository: issue.repository,
        labels: issue.labels,
        assignees: issue.assignees,
    }, projectTitles, projectStatuses);
}

async function syncGitHubIssueOpenStateForProjectStatus(args: {
    token: string;
    owner: string;
    repo: string;
    number: number;
    currentState: string;
    status: string;
}): Promise<{ ok: true } | { ok: false; status?: number; error: string }> {
    const desiredState = args.status.trim().toLowerCase() === 'done' ? 'closed' : 'open';
    if (args.currentState.trim().toLowerCase() === desiredState) {
        return { ok: true };
    }

    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues/${args.number}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${args.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'happy-ai',
        },
        body: JSON.stringify({
            state: desiredState,
            ...(desiredState === 'closed' ? { state_reason: 'completed' } : {}),
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
            ok: false,
            status: response.status,
            error: `GitHub Issue ${desiredState === 'closed' ? 'close' : 'reopen'} failed with ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
        };
    }

    return { ok: true };
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
        const issueNumber = extractExactIssueNumber(request.query.query);

        if (issueNumber !== null) {
            const repoQualifier = extractRepoQualifier(request.query.query);
            let issuesResult: { ok: true; issues: GitHubIssue[] } | { ok: false; status?: number; error: string };

            if (repoQualifier) {
                const singleResult = await fetchGitHubIssueByRepositoryNumber({
                    token,
                    owner: repoQualifier.owner,
                    repo: repoQualifier.repo,
                    number: issueNumber,
                });
                issuesResult = singleResult.ok
                    ? { ok: true, issues: singleResult.issue ? [singleResult.issue] : [] }
                    : singleResult;
            } else {
                issuesResult = await fetchGitHubIssuesByNumberSearch({
                    token,
                    number: issueNumber,
                    query: request.query.query,
                    limit,
                });
            }

            if (!issuesResult.ok) {
                log({ module: 'github-issues', level: 'warn' }, `GitHub issue number lookup failed: ${issuesResult.error}`);
                return reply.send({
                    issues: [],
                    warning: `GitHub Issue #${issueNumber} 暂时读取失败：${issuesResult.error}`,
                });
            }

            const issues = issuesResult.issues
                .filter((issue) => matchesAny(issue.projectTitles, projectFilters))
                .filter((issue) => matchesAny(issue.projectStatuses.length > 0 ? issue.projectStatuses : ['No Status'], statusFilters));
            return reply.send({ issues });
        }

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

    app.post('/v1/github/issues/status', {
        preHandler: app.authenticate,
        schema: {
            body: UpdateGitHubIssueStatusBodySchema,
            response: {
                200: z.object({
                    issue: GitHubIssueSchema,
                    availableStatuses: z.array(z.string()),
                }),
                400: z.object({ error: z.string(), availableStatuses: z.array(z.string()).optional() }),
                401: z.object({ error: z.string() }),
                404: z.object({ error: z.string() }),
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

        const [owner, repo] = request.body.repository.split('/');
        if (!owner || !repo) {
            return reply.code(400).send({ error: 'Invalid repository. Expected owner/name.' });
        }

        const token = decryptString(['user', userId, 'github', 'token'], user.githubUser.token);
        const issueResult = await fetchGitHubGraphQL<GitHubIssueProjectItemForUpdateResponse>({
            token,
            query: issueProjectItemForUpdateQuery,
            variables: { owner, repo, number: request.body.number },
        });
        if (!issueResult.ok) {
            log({ module: 'github-issues', level: 'warn' }, `GitHub issue status lookup failed: ${issueResult.error}`);
            return reply.code(issueResult.status === 404 ? 404 : 400).send({ error: issueResult.error });
        }

        const issue = issueResult.data.data?.repository?.issue;
        if (!issue) {
            return reply.code(404).send({ error: 'GitHub Issue not found' });
        }

        const projectItems = issue.projectItems?.nodes?.filter((node): node is GraphQLProjectItemForUpdateNode => !!node?.id && !!node.project?.id) ?? [];
        if (projectItems.length === 0) {
            return reply.code(400).send({ error: 'This issue is not linked to any GitHub Project item.' });
        }

        const targetItem = projectItemForStatusUpdate({
            projectItems,
            projectTitle: request.body.projectTitle,
        });
        if (!targetItem?.id || !targetItem.project?.id) {
            return reply.code(404).send({ error: `Project item not found${request.body.projectTitle ? ` for ${request.body.projectTitle}` : ''}.` });
        }

        const optionsResult = await fetchGitHubGraphQL<GitHubProjectStatusOptionsResponse>({
            token,
            query: projectStatusOptionsQuery,
            variables: { projectId: targetItem.project.id },
        });
        if (!optionsResult.ok) {
            log({ module: 'github-issues', level: 'warn' }, `GitHub project status options unavailable: ${optionsResult.error}`);
            return reply.code(400).send({ error: optionsResult.error });
        }

        const statusField = (optionsResult.data.data?.node?.fields?.nodes ?? [])
            .find((field) => field?.id && field.name?.trim().toLowerCase() === 'status');
        const availableStatuses = ['No Status', ...uniqueStrings((statusField?.options ?? []).map((option) => option?.name))];
        const targetStatus = request.body.status.trim();
        const wantsNoStatus = targetStatus.toLowerCase() === 'no status';
        const targetOption = wantsNoStatus
            ? null
            : (statusField?.options ?? []).find((option) => option?.id && option.name?.trim().toLowerCase() === targetStatus.toLowerCase());
        if (!statusField?.id || (!wantsNoStatus && !targetOption?.id)) {
            return reply.code(400).send({
                error: `Status option not found: ${targetStatus}`,
                availableStatuses,
            });
        }

        const updateResult = await setProjectItemStatus({
            token,
            projectId: targetItem.project.id,
            itemId: targetItem.id,
            fieldId: statusField.id,
            optionId: targetOption?.id ?? undefined,
        });
        if (!updateResult.ok) {
            log({ module: 'github-issues', level: 'warn' }, `GitHub project status update failed: ${updateResult.error}`);
            return reply.code(400).send({ error: updateResult.error, availableStatuses });
        }

        const nextStatus = wantsNoStatus ? 'No Status' : (targetOption!.name ?? targetStatus);
        const subIssues = issue.subIssues?.nodes?.filter((node): node is GraphQLIssueForUpdateNode => !!node) ?? [];
        for (const subIssue of subIssues) {
            const subIssueProjectItems = subIssue.projectItems?.nodes?.filter((node): node is GraphQLProjectItemForUpdateNode => !!node?.id && !!node.project?.id) ?? [];
            const subIssueTargetItem = projectItemForStatusUpdate({
                projectItems: subIssueProjectItems,
                projectId: targetItem.project.id,
                projectTitle: targetItem.project.title ?? request.body.projectTitle ?? undefined,
            });
            if (!subIssueTargetItem?.id || !subIssueTargetItem.project?.id) {
                log({ module: 'github-issues', level: 'warn' }, `GitHub sub-issue #${subIssue.number} has no matching project item for ${targetItem.project.title ?? targetItem.project.id}`);
                continue;
            }

            const subIssueUpdateResult = await setProjectItemStatus({
                token,
                projectId: subIssueTargetItem.project.id,
                itemId: subIssueTargetItem.id,
                fieldId: statusField.id,
                optionId: targetOption?.id ?? undefined,
            });
            if (!subIssueUpdateResult.ok) {
                log({ module: 'github-issues', level: 'warn' }, `GitHub sub-issue #${subIssue.number} project status update failed: ${subIssueUpdateResult.error}`);
                return reply.code(400).send({
                    error: `Project status updated, but GitHub sub-issue #${subIssue.number} status sync failed: ${subIssueUpdateResult.error}`,
                    availableStatuses,
                });
            }

            const subIssueStateSyncResult = await syncGitHubIssueOpenStateForProjectStatus({
                token,
                owner,
                repo,
                number: subIssue.number,
                currentState: subIssue.state,
                status: nextStatus,
            });
            if (!subIssueStateSyncResult.ok) {
                log({ module: 'github-issues', level: 'warn' }, `GitHub sub-issue #${subIssue.number} state sync failed: ${subIssueStateSyncResult.error}`);
                return reply.code(400).send({
                    error: `Project status updated, but GitHub sub-issue #${subIssue.number} state sync failed: ${subIssueStateSyncResult.error}`,
                    availableStatuses,
                });
            }
        }

        if (issue.parent?.id) {
            const stateSyncResult = await syncGitHubIssueOpenStateForProjectStatus({
                token,
                owner,
                repo,
                number: request.body.number,
                currentState: issue.state,
                status: nextStatus,
            });
            if (!stateSyncResult.ok) {
                log({ module: 'github-issues', level: 'warn' }, `GitHub sub-issue state sync failed: ${stateSyncResult.error}`);
                return reply.code(400).send({
                    error: `Project status updated, but GitHub sub-issue state sync failed: ${stateSyncResult.error}`,
                    availableStatuses,
                });
            }
        }

        const refreshedIssueResult = await fetchGitHubGraphQL<GitHubIssueProjectItemForUpdateResponse>({
            token,
            query: issueProjectItemForUpdateQuery,
            variables: { owner, repo, number: request.body.number },
        });
        const refreshedIssue = refreshedIssueResult.ok ? refreshedIssueResult.data.data?.repository?.issue : null;

        return reply.send({
            issue: refreshedIssue
                ? mapIssueFromProjectItemsForUpdateResponse(refreshedIssue)
                : mapIssueForUpdateResponse(issue, targetItem.id, nextStatus),
            availableStatuses,
        });
    });
}
