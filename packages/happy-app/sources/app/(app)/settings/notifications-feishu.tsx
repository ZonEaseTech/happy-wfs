import React from 'react';
import { View, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Text } from '@/components/StyledText';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import {
    getFeishuConfig,
    getFeishuMentionConfig,
    getFeishuUserId,
    putFeishuConfig,
    putFeishuMentionConfig,
    putFeishuUserId,
    testFeishu,
    testFeishuMention,
    type FeishuConfigPublic,
} from '@/sync/apiNotifications';
import { t } from '@/text';

export default function NotificationsFeishuScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();

    const [loading, setLoading] = React.useState(true);
    const [serverState, setServerState] = React.useState<FeishuConfigPublic | null>(null);
    const [url, setUrl] = React.useState('');
    const [secret, setSecret] = React.useState('');
    const [secretEdited, setSecretEdited] = React.useState(false);
    const [enabled, setEnabled] = React.useState(false);
    const [mentionServerState, setMentionServerState] = React.useState<FeishuConfigPublic | null>(null);
    const [mentionUrl, setMentionUrl] = React.useState('');
    const [mentionSecret, setMentionSecret] = React.useState('');
    const [mentionSecretEdited, setMentionSecretEdited] = React.useState(false);
    const [mentionEnabled, setMentionEnabled] = React.useState(false);
    const [serverFeishuUserId, setServerFeishuUserId] = React.useState<string | null>(null);
    const [feishuUserId, setFeishuUserId] = React.useState('');

    React.useEffect(() => {
        let mounted = true;
        Promise.all([
            getFeishuConfig(auth.credentials!),
            getFeishuMentionConfig(auth.credentials!),
            getFeishuUserId(auth.credentials!),
        ])
            .then(([cfg, mentionCfg, userId]) => {
                if (!mounted) return;
                setServerState(cfg);
                setUrl(cfg.url ?? '');
                setEnabled(cfg.enabled);
                setMentionServerState(mentionCfg);
                setMentionUrl(mentionCfg.url ?? '');
                setMentionEnabled(mentionCfg.enabled);
                setServerFeishuUserId(userId);
                setFeishuUserId(userId ?? '');
            })
            .catch(() => { /* leave defaults */ })
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, [auth.credentials]);

    const normalDirty =
        (url || '') !== (serverState?.url ?? '') ||
        enabled !== (serverState?.enabled ?? false) ||
        secretEdited;
    const mentionDirty =
        (mentionUrl || '') !== (mentionServerState?.url ?? '') ||
        mentionEnabled !== (mentionServerState?.enabled ?? false) ||
        mentionSecretEdited;
    const userIdDirty = feishuUserId.trim() !== (serverFeishuUserId ?? '');
    const dirty = normalDirty || mentionDirty || userIdDirty;

    const [saving, save] = useHappyAction(async () => {
        if (normalDirty) {
            await putFeishuConfig(auth.credentials!, {
                url: url.trim() ? url.trim() : null,
                secret: secretEdited ? (secret.trim() ? secret.trim() : null) : undefined,
                enabled,
            });
        }
        if (mentionDirty) {
            await putFeishuMentionConfig(auth.credentials!, {
                url: mentionUrl.trim() ? mentionUrl.trim() : null,
                secret: mentionSecretEdited ? (mentionSecret.trim() ? mentionSecret.trim() : null) : undefined,
                enabled: mentionEnabled,
            });
        }
        if (userIdDirty) {
            await putFeishuUserId(auth.credentials!, feishuUserId.trim() ? feishuUserId.trim() : null);
        }
        const [fresh, freshMention, freshUserId] = await Promise.all([
            getFeishuConfig(auth.credentials!),
            getFeishuMentionConfig(auth.credentials!),
            getFeishuUserId(auth.credentials!),
        ]);
        setServerState(fresh);
        setMentionServerState(freshMention);
        setServerFeishuUserId(freshUserId);
        setFeishuUserId(freshUserId ?? '');
        setSecretEdited(false);
        setSecret('');
        setMentionSecretEdited(false);
        setMentionSecret('');
    });

    const [testing, runTest] = useHappyAction(async () => {
        try {
            await testFeishu(auth.credentials!);
            await Modal.alert(t('settingsFeishu.testSuccessTitle'), t('settingsFeishu.testSuccessMessage'));
            const fresh = await getFeishuConfig(auth.credentials!);
            setServerState(fresh);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await Modal.alert(t('settingsFeishu.testFailedTitle'), msg);
        }
    });

    const [testingMention, runMentionTest] = useHappyAction(async () => {
        try {
            await testFeishuMention(auth.credentials!);
            await Modal.alert(t('settingsFeishu.testSuccessTitle'), t('settingsFeishu.mentionTestSuccessMessage'));
            const fresh = await getFeishuMentionConfig(auth.credentials!);
            setMentionServerState(fresh);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await Modal.alert(t('settingsFeishu.testFailedTitle'), msg);
        }
    });

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t('settingsFeishu.webhookSection')} footer={t('settingsFeishu.footer')}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.urlLabel')}
                    </Text>
                    <TextInput
                        value={url}
                        onChangeText={setUrl}
                        placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                </View>

                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretLabel')}
                    </Text>
                    <TextInput
                        value={secretEdited ? secret : (serverState?.secret_set ? '••••••••' : '')}
                        onChangeText={(v) => { setSecret(v); setSecretEdited(true); }}
                        onFocus={() => { if (!secretEdited) { setSecret(''); setSecretEdited(true); } }}
                        placeholder={t('settingsFeishu.secretPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretHint')}
                    </Text>
                </View>

                <Item
                    title={t('settingsFeishu.enableTitle')}
                    subtitle={t('settingsFeishu.enableSubtitle')}
                    icon={<Ionicons name="notifications-outline" size={29} color="#007AFF" />}
                    rightElement={
                        <Switch
                            value={enabled}
                            onValueChange={setEnabled}
                            disabled={loading || saving}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('settingsFeishu.mentionWebhookSection')} footer={t('settingsFeishu.mentionFooter')}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.urlLabel')}
                    </Text>
                    <TextInput
                        value={mentionUrl}
                        onChangeText={setMentionUrl}
                        placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                </View>

                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretLabel')}
                    </Text>
                    <TextInput
                        value={mentionSecretEdited ? mentionSecret : (mentionServerState?.secret_set ? '••••••••' : '')}
                        onChangeText={(v) => { setMentionSecret(v); setMentionSecretEdited(true); }}
                        onFocus={() => { if (!mentionSecretEdited) { setMentionSecret(''); setMentionSecretEdited(true); } }}
                        placeholder={t('settingsFeishu.secretPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.secretHint')}
                    </Text>
                </View>

                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.userIdLabel')}
                    </Text>
                    <TextInput
                        value={feishuUserId}
                        onChangeText={setFeishuUserId}
                        placeholder={t('settingsFeishu.userIdPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!loading && !saving}
                        style={{
                            fontSize: 15,
                            color: theme.colors.text,
                            paddingVertical: Platform.OS === 'ios' ? 10 : 6,
                        }}
                    />
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('settingsFeishu.userIdHint')}
                    </Text>
                </View>

                <Item
                    title={t('settingsFeishu.mentionEnableTitle')}
                    subtitle={t('settingsFeishu.mentionEnableSubtitle')}
                    icon={<Ionicons name="at-outline" size={29} color="#5856D6" />}
                    rightElement={
                        <Switch
                            value={mentionEnabled}
                            onValueChange={setMentionEnabled}
                            disabled={loading || saving}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup>
                <Item
                    title={t('settingsFeishu.saveTitle')}
                    subtitle={dirty ? t('settingsFeishu.saveDirty') : t('settingsFeishu.saveClean')}
                    icon={<Ionicons name="cloud-upload-outline" size={29} color={dirty ? theme.colors.button.primary.background : theme.colors.textSecondary} />}
                    onPress={dirty && !saving ? save : undefined}
                    disabled={!dirty || saving || loading}
                    loading={saving}
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeishu.testTitle')}
                    subtitle={
                        serverState?.lastTestedAt
                            ? t('settingsFeishu.testSubtitleWithTime', {
                                time: new Date(serverState.lastTestedAt).toLocaleString(),
                            })
                            : t('settingsFeishu.testSubtitle')
                    }
                    icon={<Ionicons name="paper-plane-outline" size={29} color="#FF9500" />}
                    onPress={!testing && !loading ? runTest : undefined}
                    disabled={testing || loading || !serverState?.url}
                    loading={testing}
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeishu.mentionTestTitle')}
                    subtitle={
                        mentionServerState?.lastTestedAt
                            ? t('settingsFeishu.mentionTestSubtitleWithTime', {
                                time: new Date(mentionServerState.lastTestedAt).toLocaleString(),
                            })
                            : t('settingsFeishu.mentionTestSubtitle')
                    }
                    icon={<Ionicons name="paper-plane-outline" size={29} color="#5856D6" />}
                    onPress={!testingMention && !loading ? runMentionTest : undefined}
                    disabled={testingMention || loading || !mentionServerState?.url}
                    loading={testingMention}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
