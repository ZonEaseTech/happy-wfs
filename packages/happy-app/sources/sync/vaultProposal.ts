import { VAULT_KIND_PRESETS, VaultDeleteKeyInputSchema, VaultSaveKeyInputSchema, vaultKeyDevices, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { VAULT_FIELD_LABELS, vaultAutoSlug } from './vaultRules';

/**
 * An agent's `save_key` / `delete_key` call (see happy-wire VaultSaveKeyInputSchema) turned into
 * what the user is asked to confirm. Nothing here writes: the card shows the result and saves
 * `key` once the user fills in `missing` and taps.
 */
export type VaultProposal =
    | { action: 'add'; key: VaultKey; missing: string[] }
    | { action: 'edit'; key: VaultKey; previous: VaultKey; missing: string[] }
    | { action: 'delete'; previous: VaultKey }
    /** The key the call names is not in the resource center (any more). */
    | { action: 'gone'; name: string }
    | { action: 'invalid'; problem: VaultProposalProblem };

export type VaultProposalProblem =
    | { kind: 'input' | 'name' | 'slugInvalid' | 'login' | 'devices' }
    | { kind: 'slugTaken'; slug: string }
    | { kind: 'device'; name: string };

export type VaultProposalTool = 'save_key' | 'delete_key';

/** `mcp__happy__save_key` (Claude) or `mcp:happy:save_key` → the tool, for the two key tools only. */
export function vaultProposalTool(toolName: string): VaultProposalTool | null {
    const name = toolName.replace(/^mcp(__|:)happy\1/, '');
    return name === 'save_key' || name === 'delete_key' ? name : null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const invalid = (problem: VaultProposalProblem): VaultProposal => ({ action: 'invalid', problem });

/** Agents name keys by their name in commands, sometimes by their display name. */
function findKey(keys: VaultKey[], ref: string): VaultKey | undefined {
    const wanted = ref.trim().toLowerCase();
    return keys.find((key) => key.slug === wanted) ?? keys.find((key) => key.name.toLowerCase() === wanted);
}

/**
 * `devices` are the ones a key can go to; a new key goes to the online ones unless the call
 * names some, like the add form. The `id` of a new key is left empty for the caller to assign.
 */
export function buildVaultProposal(tool: VaultProposalTool, input: unknown, keys: VaultKey[], devices: Array<{ id: string; name: string; online: boolean }>): VaultProposal {
    if (tool === 'delete_key') {
        const parsed = VaultDeleteKeyInputSchema.safeParse(input);
        if (!parsed.success) return invalid({ kind: 'input' });
        const previous = findKey(keys, parsed.data.key);
        return previous ? { action: 'delete', previous } : { action: 'gone', name: parsed.data.key };
    }

    const parsed = VaultSaveKeyInputSchema.safeParse(input);
    if (!parsed.success) return invalid({ kind: 'input' });
    const draft = parsed.data;
    const previous = draft.key ? findKey(keys, draft.key) ?? null : null;
    if (draft.key && !previous) return { action: 'gone', name: draft.key };

    const kind: VaultKeyKind = previous?.kind ?? draft.kind ?? (draft.ssh ? 'ssh' : 'custom');
    const name = draft.name?.trim() || previous?.name;
    if (!name) return invalid({ kind: 'name' });
    const others = keys.filter((key) => key.id !== previous?.id);
    const slug = draft.slug?.trim().toLowerCase() || previous?.slug || vaultAutoSlug(name, kind, others.map((key) => key.slug));
    if (!SLUG.test(slug)) return invalid({ kind: 'slugInvalid' });
    if (others.some((key) => key.slug === slug)) return invalid({ kind: 'slugTaken', slug });

    const machineIds: string[] = [];
    for (const ref of draft.devices ?? []) {
        const device = devices.find((candidate) => candidate.id === ref) ?? devices.find((candidate) => candidate.name.toLowerCase() === ref.trim().toLowerCase());
        if (!device) return invalid({ kind: 'device', name: ref });
        if (!machineIds.includes(device.id)) machineIds.push(device.id);
    }
    if (!draft.devices) machineIds.push(...(previous ? vaultKeyDevices(previous) : devices.filter((device) => device.online).map((device) => device.id)));
    if (machineIds.length === 0) return invalid({ kind: 'devices' });

    // Variables: the key's own (a new one starts from its type's), minus the dropped ones, then
    // the listed ones added or replaced. A value left out keeps the current one.
    const preset = VAULT_KIND_PRESETS[kind];
    let env = (previous?.env ?? (kind === 'custom' ? [] : preset.env.map((v) => ({ ...v, value: '' }))))
        .filter((v) => !draft.removeEnv?.includes(v.name));
    for (const v of draft.env ?? []) {
        if (!VARIABLE.test(v.name)) return invalid({ kind: 'input' });
        const current = env.find((other) => other.name === v.name);
        const next = { name: v.name, value: v.value?.trim() ?? current?.value ?? '', secret: v.secret ?? current?.secret ?? true };
        env = current ? env.map((other) => (other === current ? next : other)) : [...env, next];
    }
    // Optional values left empty are not injected at all, as in the add form.
    env = env.filter((v) => v.value || !VAULT_FIELD_LABELS[v.name]?.optional);
    if (kind === 'custom' && env.length === 0) return invalid({ kind: 'input' });

    let ssh = previous?.ssh ?? null;
    if (draft.ssh) {
        if (kind !== 'ssh') return invalid({ kind: 'input' });
        const auth = draft.ssh.auth ?? ssh?.auth ?? 'password';
        ssh = {
            host: draft.ssh.host.trim(),
            user: draft.ssh.user.trim(),
            port: draft.ssh.port ?? ssh?.port ?? 22,
            auth,
            // A new login without its secret is filled in on the card; switching between password and key needs a new one.
            secret: draft.ssh.secret ?? (ssh && ssh.auth === auth ? ssh.secret : ''),
            viaMachineId: machineIds[0],
        };
    }
    if (kind === 'ssh' && (!ssh || !ssh.host || !ssh.user || ssh.port < 1 || ssh.port > 65535)) return invalid({ kind: 'login' });

    const key: VaultKey = {
        v: 1,
        id: previous?.id ?? '',
        slug,
        kind,
        name,
        env,
        ssh: ssh && { ...ssh, viaMachineId: machineIds[0] },
        allow: draft.allow?.map((rule) => rule.trim()).filter(Boolean) ?? previous?.allow ?? [...preset.allow],
        deny: draft.deny?.map((rule) => rule.trim()).filter(Boolean) ?? previous?.deny ?? [...preset.deny],
        scope: previous?.scope ?? [],
        machineIds,
        updatedAt: previous?.updatedAt ?? 0,
    };
    const missing = [...env.filter((v) => !v.value).map((v) => v.name), ...(ssh && !ssh.secret ? ['ssh'] : [])];
    return previous ? { action: 'edit', key, previous, missing } : { action: 'add', key, missing };
}

/** Whether saving `next` would change nothing the user can see (which device is listed first aside). */
export function vaultKeyUnchanged(next: VaultKey, previous: VaultKey): boolean {
    const shape = (key: VaultKey) => JSON.stringify({
        name: key.name, slug: key.slug, env: key.env, allow: key.allow, deny: key.deny, scope: key.scope,
        ssh: key.ssh && { ...key.ssh, viaMachineId: null },
        devices: [...vaultKeyDevices(key)].sort(),
    });
    return shape(next) === shape(previous);
}
