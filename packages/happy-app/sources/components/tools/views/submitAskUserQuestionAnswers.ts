import { buildAnswersReplyText } from '../../optionReply';

export type SubmitAskUserQuestionAnswersDeps = {
    sendOrQueueMessage: (sessionId: string, text: string) => Promise<unknown>;
    allow: (sessionId: string, permissionId: string, answers: Record<string, string>) => Promise<void>;
};

export async function submitAskUserQuestionAnswers(
    args: {
        sessionId: string;
        permissionId?: string;
        answers: Record<string, string>;
    },
    deps: SubmitAskUserQuestionAnswersDeps,
): Promise<void> {
    const replyText = buildAnswersReplyText(args.answers);

    // Send a normal user-visible message as the authoritative answer first.
    // The structured permission result is still resolved below so the tool call
    // can continue, but the agent also sees the concrete choice in chat history
    // instead of only a permission/tool receipt.
    await deps.sendOrQueueMessage(args.sessionId, replyText);

    if (args.permissionId) {
        await deps.allow(args.sessionId, args.permissionId, args.answers);
    }
}
