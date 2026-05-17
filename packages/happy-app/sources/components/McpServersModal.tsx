import * as React from 'react';
import { View, Text, Modal as RNModal, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { machineReadFile, machineWriteFile } from '@/sync/ops';
import { parseMcpServers, applyMcpServers, type McpServer } from '@/utils/mcpConfig';
import type { ConfigTarget } from '@/app/(app)/settings/mcpTargets';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { t } from '@/text';

interface McpServersModalProps {
    visible: boolean;
    onClose: () => void;
    machineId: string;
    target: ConfigTarget;
    filePath: string;
    onRequestRawEdit: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';
type ModalView = 'list' | 'form';

export function McpServersModal(props: McpServersModalProps) {
    const { theme } = useUnistyles();
    const [loadState, setLoadState] = React.useState<LoadState>('loading');
    const [errorMessage, setErrorMessage] = React.useState('');
    const [originalContent, setOriginalContent] = React.useState('');
    const [servers, setServers] = React.useState<McpServer[]>([]);
    const [view, setView] = React.useState<ModalView>('list');
    const [editing, setEditing] = React.useState<McpServer | null>(null);
    const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (!props.visible) return;
        setLoadState('loading');
        setView('list');
        (async () => {
            const res = await machineReadFile(props.machineId, props.filePath);
            let content = '';
            if (res.success && typeof res.content === 'string' && res.content.length > 0) {
                const binaryString = atob(res.content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                content = new TextDecoder('utf-8').decode(bytes);
            }
            try {
                setServers(parseMcpServers(content, props.target.key));
                setOriginalContent(content);
                setLoadState('ready');
            } catch (e) {
                setErrorMessage(e instanceof Error ? e.message : String(e));
                setLoadState('error');
            }
        })();
    }, [props.visible, props.machineId, props.filePath, props.target.key]);

    const persist = React.useCallback(async (next: McpServer[]) => {
        setSaving(true);
        try {
            let content: string;
            try {
                content = applyMcpServers(originalContent, next, props.target.key);
            } catch (e) {
                Modal.alert(t('common.error'), e instanceof Error ? e.message : String(e));
                return false;
            }
            const bytes = new TextEncoder().encode(content);
            const base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ''));
            const res = await machineWriteFile(props.machineId, props.filePath, base64);
            if (!res.success) {
                Modal.alert(t('common.error'), res.error || t('mcpManager.saveFailed'));
                return false;
            }
            setOriginalContent(content);
            setServers(next);
            return true;
        } finally {
            setSaving(false);
        }
    }, [originalContent, props.machineId, props.filePath, props.target.key]);

    const handleDelete = React.useCallback(async (index: number) => {
        const ok = await Modal.confirm(t('mcpManager.deleteTitle'), t('mcpManager.deleteMessage', { name: servers[index].name }), {
            confirmText: t('common.delete'), cancelText: t('common.cancel'),
        });
        if (ok) await persist(servers.filter((_, i) => i !== index));
    }, [servers, persist]);

    const handleSubmitForm = React.useCallback(async (server: McpServer) => {
        const next = editingIndex === null
            ? [...servers, server]
            : servers.map((s, i) => (i === editingIndex ? server : s));
        if (await persist(next)) setView('list');
    }, [servers, editingIndex, persist]);

    return (
        <RNModal visible={props.visible} animationType="slide" onRequestClose={props.onClose} transparent={false}>
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <View style={{ flex: 1, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
                        <Pressable onPress={view === 'form' ? () => setView('list') : props.onClose} hitSlop={10}>
                            <Ionicons name={view === 'form' ? 'arrow-back' : 'close'} size={24} color={theme.colors.text} />
                        </Pressable>
                        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: theme.colors.text }}>
                            {view === 'form'
                                ? t(editingIndex === null ? 'mcpManager.addTitle' : 'mcpManager.editTitle')
                                : t('mcpManager.title', { target: props.target.title })}
                        </Text>
                        {view === 'list' && loadState === 'ready' && (
                            <Pressable onPress={() => { setEditing(null); setEditingIndex(null); setView('form'); }} hitSlop={10}>
                                <Ionicons name="add" size={26} color={theme.colors.text} />
                            </Pressable>
                        )}
                    </View>

                    {loadState === 'loading' && <ActivityIndicator style={{ marginTop: 40 }} />}

                    {loadState === 'error' && (
                        <View style={{ padding: 24, gap: 12 }}>
                            <Text style={{ color: theme.colors.text }}>{t('mcpManager.parseError')}</Text>
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{errorMessage}</Text>
                            <Pressable onPress={props.onRequestRawEdit}>
                                <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.openRawFile')}</Text>
                            </Pressable>
                        </View>
                    )}

                    {loadState === 'ready' && view === 'list' && (
                        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                            {servers.length === 0 && (
                                <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 24 }}>
                                    {t('mcpManager.empty')}
                                </Text>
                            )}
                            {servers.map((s, i) => (
                                <View key={s.name + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surfaceHigh }}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: theme.colors.text, fontWeight: '500' }}>{s.name}</Text>
                                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{s.transport}</Text>
                                    </View>
                                    <Pressable onPress={() => { setEditing(s); setEditingIndex(i); setView('form'); }} hitSlop={8}>
                                        <Ionicons name="create-outline" size={20} color={theme.colors.textSecondary} />
                                    </Pressable>
                                    <Pressable onPress={() => handleDelete(i)} hitSlop={8} disabled={saving}>
                                        <Ionicons name="trash-outline" size={20} color={theme.colors.deleteAction} />
                                    </Pressable>
                                </View>
                            ))}
                        </ScrollView>
                    )}

                    {loadState === 'ready' && view === 'form' && (
                        <McpServerForm
                            initial={editing}
                            existingNames={servers.filter((_, i) => i !== editingIndex).map(s => s.name)}
                            saving={saving}
                            onSubmit={handleSubmitForm}
                            onCancel={() => setView('list')}
                        />
                    )}
                </View>
            </View>
        </RNModal>
    );
}

const TRANSPORTS: McpServer['transport'][] = ['stdio', 'http', 'sse'];

function toPairs(map?: Record<string, string>): Array<[string, string]> {
    return map ? Object.entries(map) : [];
}
function fromPairs(pairs: Array<[string, string]>): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [k, v] of pairs) if (k.trim()) out[k.trim()] = v;
    return Object.keys(out).length ? out : undefined;
}

function McpServerForm(props: {
    initial: McpServer | null;
    existingNames: string[];
    saving: boolean;
    onSubmit: (s: McpServer) => void;
    onCancel: () => void;
}) {
    const { theme } = useUnistyles();
    const [name, setName] = React.useState(props.initial?.name ?? '');
    const [transport, setTransport] = React.useState<McpServer['transport']>(props.initial?.transport ?? 'stdio');
    const [command, setCommand] = React.useState(props.initial?.command ?? '');
    const [args, setArgs] = React.useState<string[]>(props.initial?.args ?? []);
    const [envPairs, setEnvPairs] = React.useState(toPairs(props.initial?.env));
    const [url, setUrl] = React.useState(props.initial?.url ?? '');
    const [headerPairs, setHeaderPairs] = React.useState(toPairs(props.initial?.headers));

    const nameError = !name.trim()
        ? t('mcpManager.errNameRequired')
        : props.existingNames.includes(name.trim())
            ? t('mcpManager.errNameDuplicate')
            : '';
    const fieldError = transport === 'stdio'
        ? (!command.trim() ? t('mcpManager.errCommandRequired') : '')
        : (!url.trim() ? t('mcpManager.errUrlRequired') : '');
    const canSave = !nameError && !fieldError && !props.saving;

    const submit = () => {
        if (!canSave) return;
        const server: McpServer = {
            name: name.trim(),
            transport,
            extras: props.initial?.extras,
            ...(transport === 'stdio'
                ? { command: command.trim(), args: args.filter(a => a.length > 0), env: fromPairs(envPairs) }
                : { url: url.trim(), headers: fromPairs(headerPairs) }),
        };
        props.onSubmit(server);
    };

    const input = { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 10, color: theme.colors.text } as const;
    const label = { color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 } as const;

    return (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={label}>{t('mcpManager.fieldName')}</Text>
            <TextInput value={name} onChangeText={setName} autoCapitalize="none" style={input} placeholder="my-server" placeholderTextColor={theme.colors.textSecondary} />
            {!!nameError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{nameError}</Text>}

            <Text style={label}>{t('mcpManager.fieldTransport')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                {TRANSPORTS.map(tr => (
                    <Pressable key={tr} onPress={() => setTransport(tr)}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: transport === tr ? theme.colors.radio.active : theme.colors.surfaceHigh }}>
                        <Text style={{ color: transport === tr ? theme.colors.button.primary.tint : theme.colors.text }}>{tr}</Text>
                    </Pressable>
                ))}
            </View>

            {transport === 'stdio' ? (
                <>
                    <Text style={label}>{t('mcpManager.fieldCommand')}</Text>
                    <TextInput value={command} onChangeText={setCommand} autoCapitalize="none" style={input} placeholder="npx" placeholderTextColor={theme.colors.textSecondary} />
                    {!!fieldError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{fieldError}</Text>}
                    <KeyList title={t('mcpManager.fieldArgs')} values={args} onChange={setArgs} />
                    <PairList title={t('mcpManager.fieldEnv')} pairs={envPairs} onChange={setEnvPairs} />
                </>
            ) : (
                <>
                    <Text style={label}>{t('mcpManager.fieldUrl')}</Text>
                    <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" style={input} placeholder="https://example.com/mcp" placeholderTextColor={theme.colors.textSecondary} />
                    {!!fieldError && <Text style={{ color: theme.colors.deleteAction, fontSize: 12 }}>{fieldError}</Text>}
                    <PairList title={t('mcpManager.fieldHeaders')} pairs={headerPairs} onChange={setHeaderPairs} />
                </>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <Pressable onPress={props.onCancel} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.text }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={submit} disabled={!canSave}
                    style={{ flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', opacity: canSave ? 1 : 0.5, backgroundColor: theme.colors.button.primary.background }}>
                    <Text style={{ color: theme.colors.button.primary.tint }}>{t('common.save')}</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
}

/** Editable list of single string values (args). */
function KeyList(props: { title: string; values: string[]; onChange: (v: string[]) => void }) {
    const { theme } = useUnistyles();
    return (
        <>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 }}>{props.title}</Text>
            {props.values.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <TextInput value={v} autoCapitalize="none"
                        onChangeText={(text) => props.onChange(props.values.map((x, j) => (j === i ? text : x)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <Pressable onPress={() => props.onChange(props.values.filter((_, j) => j !== i))} hitSlop={8}>
                        <Ionicons name="remove-circle-outline" size={22} color={theme.colors.deleteAction} />
                    </Pressable>
                </View>
            ))}
            <Pressable onPress={() => props.onChange([...props.values, ''])}>
                <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.addRow')}</Text>
            </Pressable>
        </>
    );
}

/** Editable list of key/value pairs (env, headers). */
function PairList(props: { title: string; pairs: Array<[string, string]>; onChange: (p: Array<[string, string]>) => void }) {
    const { theme } = useUnistyles();
    return (
        <>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12, marginBottom: 4 }}>{props.title}</Text>
            {props.pairs.map(([k, v], i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <TextInput value={k} placeholder="KEY" autoCapitalize="none" placeholderTextColor={theme.colors.textSecondary}
                        onChangeText={(text) => props.onChange(props.pairs.map((p, j) => (j === i ? [text, p[1]] : p)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <TextInput value={v} placeholder="value" autoCapitalize="none" placeholderTextColor={theme.colors.textSecondary}
                        onChangeText={(text) => props.onChange(props.pairs.map((p, j) => (j === i ? [p[0], text] : p)))}
                        style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, padding: 8, color: theme.colors.text }} />
                    <Pressable onPress={() => props.onChange(props.pairs.filter((_, j) => j !== i))} hitSlop={8}>
                        <Ionicons name="remove-circle-outline" size={22} color={theme.colors.deleteAction} />
                    </Pressable>
                </View>
            ))}
            <Pressable onPress={() => props.onChange([...props.pairs, ['', '']])}>
                <Text style={{ color: theme.colors.radio.active }}>{t('mcpManager.addRow')}</Text>
            </Pressable>
        </>
    );
}
