function shellQuoteIfNeeded(value: string): string {
    if (/^[A-Za-z0-9_./~:-]+$/.test(value)) {
        return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildCopyToAgentBriefPrompt(params: {
    sessionId: string;
    projectPath: string;
}): string {
    const sessionId = params.sessionId.trim();
    const projectPath = shellQuoteIfNeeded(params.projectPath.trim());
    return `请运行 \`happy task brief --session ${sessionId} --project ${projectPath}\` 为该会话生成接力包，然后基于接力包继续任务。保留已有用户改动，并汇报验证结果。`;
}
