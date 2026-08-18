/**
 * Cursor tool names and arguments → the shapes the app renders
 *
 * The app's tool cards are keyed by Claude's tool names and read Claude's
 * argument names, so Cursor's variants have to be translated or they render as
 * anonymous cards with empty fields.
 *
 * Cursor also describes the same call two different ways depending on where it
 * comes from, which is why both paths go through here:
 *
 *   hook payload (approval)  Read   { file_path }
 *   stream event (tool card) read   { path }              ← from `readToolCall`
 *
 * Captured from cursor-agent 2026.08.11.
 */

/** Cursor's name (lowercased) → the name the app has a renderer for. */
const TOOL_NAME_MAP: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    grep: 'Grep',
    glob: 'Glob',
    ls: 'LS',
    list: 'LS',
    // Cursor calls it Shell; the app's card for running commands is Bash.
    shell: 'Bash',
    terminal: 'Bash',
    task: 'Task',
    todowrite: 'TodoWrite',
    websearch: 'WebSearch',
    webfetch: 'WebFetch',
};

export function normalizeCursorToolName(rawName: string): string {
    const mapped = TOOL_NAME_MAP[rawName.toLowerCase()];
    if (mapped) return mapped;
    // Unknown tool: keep Cursor's own name rather than inventing one, but give
    // it a capital so it reads like the others in the list.
    return rawName.charAt(0).toUpperCase() + rawName.slice(1);
}

/**
 * Fills in the argument names the app looks for, keeping the originals. Adding
 * aliases rather than renaming means nothing is lost if a card (or a future
 * reader) wants Cursor's own spelling.
 */
export function normalizeCursorToolInput(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...input };

    // Read/Edit/Write cards read file_path; Grep/Glob read path.
    if (typeof out.path === 'string' && out.file_path === undefined) {
        out.file_path = out.path;
    }
    if (typeof out.file_path === 'string' && out.path === undefined) {
        out.path = out.file_path;
    }
    // Shell reports its directory as workingDirectory.
    if (typeof out.workingDirectory === 'string' && out.cwd === undefined) {
        out.cwd = out.workingDirectory;
    }
    // Edits stream their new content under streamContent.
    if (typeof out.streamContent === 'string' && out.content === undefined) {
        out.content = out.streamContent;
    }

    return out;
}

export function normalizeCursorTool(rawName: string, rawInput: unknown): { name: string; input: Record<string, unknown> } {
    const input = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
    return {
        name: normalizeCursorToolName(rawName),
        input: normalizeCursorToolInput(input),
    };
}
