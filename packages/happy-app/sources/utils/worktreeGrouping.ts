import type { Metadata } from '@/sync/storageTypes';

type GroupingMetadata = Pick<Metadata, 'path' | 'homeDir' | 'worktreeBasePath' | 'worktreeBranchName' | 'workspaceRepos' | 'workspacePath'>;

const parentDir = (path: string) => {
    const trimmed = path.replace(/\/+$/, '');
    return trimmed.replace(/\/[^/]+$/, '') || trimmed;
};

function commonParentDir(paths: string[]): string | null {
    const split = paths.map(p => p.replace(/\/+$/, '').split('/'));
    const common: string[] = [];
    for (let i = 0; i < split[0].length; i++) {
        const part = split[0][i];
        if (split.some(s => s[i] !== part)) break;
        common.push(part);
    }
    const joined = common.join('/');
    return joined && joined !== '/' ? joined : null;
}

/**
 * Sidebar group path for a session when "merge worktree groups" is on.
 *
 * Only sessions Happy created on a new branch are merged: they live under
 * ~/.happy/ and record their source repo, so they join that repo's group
 * (a multi-repo workspace joins the repos' common parent, e.g. ttpos-flutter
 * + ttpos-server-go → /workspace/ttpos). Every other session keeps its own
 * path — merging those by parent directory lumped unrelated projects such as
 * /workspace/happy-wfs and /workspace/AVTools into one group.
 */
export function getMergedGroupPath(metadata: Partial<GroupingMetadata> | null | undefined): string {
    const ownPath = metadata?.path || '';
    if (metadata?.worktreeBasePath) return metadata.worktreeBasePath;

    const basePaths = [...new Set((metadata?.workspaceRepos ?? []).map(r => r.basePath).filter(Boolean))];
    if (basePaths.length === 1) return basePaths[0];
    if (basePaths.length > 1) return commonParentDir(basePaths) ?? basePaths[0];

    // Worktrees from CLIs too old to record the source repo still sit under
    // ~/.happy/ (e.g. ~/.happy/workspaces/vk-*); their parent is the best key.
    const home = metadata?.homeDir?.replace(/\/+$/, '');
    if (home && ownPath.startsWith(`${home}/.happy/`)) return parentDir(ownPath);

    return ownPath;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Branch that tells merged worktree sessions apart, or null when there is
 * nothing worth showing. Happy names a workspace's default branch after its
 * random directory (keen-island-nkw7, happy/keen-island-nkw7); that says
 * nothing about the task, so only a real task branch (feature/bug-412-…) is
 * returned. The `feature/` prefix is dropped to keep the row short.
 */
export function getWorktreeBranchLabel(metadata: Partial<GroupingMetadata> | null | undefined): string | null {
    const branches = metadata?.worktreeBranchName
        ? [metadata.worktreeBranchName]
        : [...new Set((metadata?.workspaceRepos ?? []).map(r => r.branchName).filter(Boolean))];
    if (branches.length === 0) return null;

    // A default branch is the workspace directory's name, sometimes behind a
    // `happy/` prefix, so it shows up inside the session's own paths.
    const paths = squash([metadata?.workspacePath, metadata?.path, ...(metadata?.workspaceRepos ?? []).map(r => r.path)].filter(Boolean).join('/'));
    const isDefault = (b: string) => { const name = squash(b.replace(/^happy\//, '')); return name.length > 0 && paths.includes(name); };
    const branch = branches.find(b => !isDefault(b));
    return branch ? branch.replace(/^feature\//, '') : null;
}
