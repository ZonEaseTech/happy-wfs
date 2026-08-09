import type { Machine } from '@/sync/storageTypes';

export function isMachineOnline(machine: Machine): boolean {
    // Use the active flag directly, no timeout checks
    return machine.active;
}

/**
 * Machines enrolled with `happy device enroll` expose shell/files/terminal only
 * — their daemon rejects `spawn-happy-session`. Session pickers must filter them
 * out; the device management screen still lists everything.
 */
export function canHostSessions(machine: Machine): boolean {
    // Two sources: the encrypted metadata (set by the CLI) and the plaintext
    // server flag (correctable from the app for machines enrolled before the
    // CLI reported it). Either one marks the machine as device-only.
    return machine.metadata?.deviceMode !== true && machine.isDevice !== true;
}