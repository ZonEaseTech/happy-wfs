export function buildOptionReplyText(optionTitle: string): string {
    return `我的选择是：${optionTitle}`;
}

/**
 * Format AskUserQuestion answers (header -> chosen value) as an explicit reply
 * message. Used as a fallback when the structured permission channel is
 * unavailable (no tool.permission.id) so the user's submission still reaches
 * the agent instead of being silently dropped.
 */
export function buildAnswersReplyText(answers: Record<string, string>): string {
    const entries = Object.entries(answers);
    if (entries.length === 1) {
        return buildOptionReplyText(entries[0][1]);
    }
    const lines = entries.map(([header, value]) => `- ${header}：${value}`);
    return `我的选择是：\n${lines.join('\n')}`;
}
