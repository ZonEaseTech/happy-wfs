export const GITHUB_PROJECT_RECONNECT_TITLE = 'GitHub Project 权限不足';

export const GITHUB_PROJECT_RECONNECT_MESSAGE = '当前 GitHub 授权缺少 project 权限，无法修改 Project 状态。请到 设置 → 账户 重新连接 GitHub，授权 project 权限后再重试。';

export function isGitHubProjectPermissionError(message: string | undefined | null): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return normalized.includes('updateprojectv2itemfieldvalue')
        || normalized.includes('insufficient_scopes')
        || normalized.includes('required scopes')
        || normalized.includes("['project']")
        || normalized.includes('read:project')
        || (normalized.includes('project') && normalized.includes('scope'));
}
