/**
 * Tiny module-level handoff for "send a memory back to the session prompt"
 * navigation. The /memory page calls setPendingMemoryInjection on tap, then
 * router.back(). The session view consumes it via useFocusEffect and appends
 * the text to the input field. Module-level state (not zustand) keeps it
 * transient across the back navigation without persisting to disk or polluting
 * the global store with one-shot UI plumbing.
 */
let pending: string | null = null;

export function setPendingMemoryInjection(value: string): void {
    pending = value;
}

export function consumePendingMemoryInjection(): string | null {
    const v = pending;
    pending = null;
    return v;
}
