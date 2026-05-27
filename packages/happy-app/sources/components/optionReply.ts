export function buildOptionReplyText(optionTitle: string): string {
    return `我的选择是：${optionTitle}`;
}

/**
 * Format AskUserQuestion answers (header -> chosen value) as an explicit reply
 * message. The question header is always included, even for a single answer,
 * so the agent can tell which structured question the choice belongs to.
 */
export function buildAnswersReplyText(answers: Record<string, string>): string {
    const entries = Object.entries(answers);
    const lines = entries.map(([header, value]) => `- ${header}：${value}`);
    return `我的选择是：\n${lines.join('\n')}`;
}
