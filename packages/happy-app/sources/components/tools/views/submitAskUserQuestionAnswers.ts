import { buildAnswersReplyText } from '../../optionReply';

export type SubmitAskUserQuestionAnswersDeps = {
    sendMessage: (sessionId: string, text: string) => Promise<unknown>;
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
    // Use the direct send path instead of the pending queue: selecting a structured
    // answer is already an explicit confirmation and should not require the user
    // to press the pending-queue send button again. The structured permission
    // result is still resolved below so the tool call can continue.
    await deps.sendMessage(args.sessionId, replyText);

    if (args.permissionId) {
        await deps.allow(args.sessionId, args.permissionId, args.answers);
    }
}
