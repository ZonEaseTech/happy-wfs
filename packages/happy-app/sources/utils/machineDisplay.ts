const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MachineDisplayInput = {
    id?: string | null;
    metadata?: {
        displayName?: string | null;
        host?: string | null;
    } | null;
} | null | undefined;

function clean(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

function isUuidLike(value: string): boolean {
    return UUID_LIKE_RE.test(value);
}

function shortenMachineId(id: string): string {
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

export function getMachineDisplayName(machine: MachineDisplayInput): string {
    const displayName = clean(machine?.metadata?.displayName);
    const host = clean(machine?.metadata?.host);

    if (displayName && !isUuidLike(displayName)) {
        return displayName;
    }

    if (host) {
        return host;
    }

    const id = clean(machine?.id);
    if (id) {
        return isUuidLike(id) ? shortenMachineId(id) : id;
    }

    if (displayName) {
        return shortenMachineId(displayName);
    }

    return 'Machine';
}
