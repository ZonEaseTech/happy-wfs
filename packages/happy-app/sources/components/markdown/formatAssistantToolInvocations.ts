const INVOKE_OPEN_RE = /^<invoke\s+name=(['"])([^'"]+)\1[^>]*>\s*$/;
const INVOKE_CLOSE_RE = /^<\/invoke>\s*$/;
const PARAMETER_RE = /<parameter\s+name=(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/parameter>/gi;
const FENCE_RE = /^([`~]{3,})([^`~]*)$/;

type FenceState = {
    char: '`' | '~';
    length: number;
} | null;

function getFenceState(line: string, current: FenceState): FenceState {
    const trimmed = line.trim();
    const match = trimmed.match(FENCE_RE);
    if (!match) return current;

    const marker = match[1];
    const char = marker[0] as '`' | '~';

    if (!current) {
        return { char, length: marker.length };
    }

    if (current.char === char && marker.length >= current.length) {
        return null;
    }

    return current;
}

function decodeXmlText(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseInvokeParameters(blockLines: string[]): Record<string, string> {
    const body = blockLines.join('\n');
    const parameters: Record<string, string> = {};
    for (const match of body.matchAll(PARAMETER_RE)) {
        parameters[match[2]] = decodeXmlText(match[3].trim());
    }
    return parameters;
}

function formatInvokeBlock(name: string, blockLines: string[]): string {
    const parameters = parseInvokeParameters(blockLines);

    if (name === 'TaskUpdate') {
        const taskLabel = parameters.taskId ? ` #${parameters.taskId}` : '';
        const statusLabel = parameters.status ? `：${parameters.status}` : '';
        return `> 系统动作：已更新任务${taskLabel}${statusLabel}`;
    }

    return `> 系统动作：已执行 ${name}`;
}

export function formatAssistantToolInvocations(markdown: string): string {
    const lines = markdown.split('\n');
    const kept: string[] = [];
    let fence: FenceState = null;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const nextFence = getFenceState(line, fence);
        const isFenceLine = nextFence !== fence;
        const invokeOpenMatch = !fence && !isFenceLine ? line.trim().match(INVOKE_OPEN_RE) : null;

        if (invokeOpenMatch) {
            let closeIndex = -1;
            for (let cursor = index + 1; cursor < lines.length; cursor++) {
                if (INVOKE_CLOSE_RE.test(lines[cursor].trim())) {
                    closeIndex = cursor;
                    break;
                }
            }

            if (closeIndex >= 0) {
                kept.push(formatInvokeBlock(invokeOpenMatch[2], lines.slice(index + 1, closeIndex)));
                index = closeIndex;
                continue;
            }
        }

        kept.push(line);
        fence = nextFence;
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
