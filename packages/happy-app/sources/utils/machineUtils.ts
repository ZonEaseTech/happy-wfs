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
    return machine.metadata?.deviceMode !== true;
}