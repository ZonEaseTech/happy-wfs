import * as React from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDesktopRoute, registerDesktopRoute } from '@/components/desktopRoutes';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { Modal } from '@/modal';
import { t } from '@/text';

/**
 * Entry page for editing user-level Claude config files on a machine.
 * Lists three actions, all anchored to the user's $HOME on the selected machine:
 *  - settings.json (hooks, permissions, env, ...)
 *  - CLAUDE.md (user-level prompt prepended to every project)
 *  - Browse ~/.claude (skills/, commands/, agents/, ...)
 *
 * Picks the first online machine automatically. If none is online, surfaces a hint.
 */
registerDesktopRoute('/settings/claude-config', () => import('./claude-config'));

export default function ClaudeConfigScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { theme } = useUnistyles();
    const router = useRouter();
    const allMachines = useAllMachines();

    const onlineMachine = React.useMemo(() => {
        return allMachines.find(isMachineOnline) ?? allMachines[0];
    }, [allMachines]);

    const machineId = onlineMachine?.id;
    const homeDir = onlineMachine?.metadata?.homeDir || '/root';
    const machineDisplay = onlineMachine?.metadata?.displayName || onlineMachine?.metadata?.host || '';
    const isOnline = onlineMachine ? isMachineOnline(onlineMachine) : false;

    const requireOnline = React.useCallback((action: () => void) => {
        if (!machineId) {
            Modal.alert(t('common.error'), t('claudeConfig.noMachine'));
            return;
        }
        if (!isOnline) {
            Modal.alert(t('common.error'), t('claudeConfig.machineOffline'));
            return;
        }
        action();
    }, [machineId, isOnline]);

    const handleEditSettings = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude/settings.json`;
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=JSON&validateJson=1`);
        });
    }, [requireOnline, router, machineId, homeDir]);

    const handleEditClaudeMd = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude/CLAUDE.md`;
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=Markdown`);
        });
    }, [requireOnline, router, machineId, homeDir]);

    const handleBrowse = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude`;
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-browser?machineId=${machineId}&path=${encodedPath}`);
        });
    }, [requireOnline, router, machineId, homeDir]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {!isInDrawer && <Stack.Screen options={{ title: t('claudeConfig.title') }} />}
            <ItemList style={{ paddingTop: 0 }}>
                <ItemGroup
                    title={t('claudeConfig.machineGroup')}
                    footer={machineDisplay
                        ? t('claudeConfig.machineFooter', { machine: machineDisplay, status: isOnline ? t('status.online') : t('status.offline') })
                        : t('claudeConfig.noMachineFooter')}
                >
                    <Item
                        title={t('claudeConfig.settingsJson')}
                        subtitle={t('claudeConfig.settingsJsonSubtitle')}
                        icon={<Ionicons name="cog-outline" size={29} color="#007AFF" />}
                        onPress={handleEditSettings}
                    />
                    <Item
                        title={t('claudeConfig.claudeMd')}
                        subtitle={t('claudeConfig.claudeMdSubtitle')}
                        icon={<Ionicons name="document-text-outline" size={29} color="#34C759" />}
                        onPress={handleEditClaudeMd}
                    />
                    <Item
                        title={t('claudeConfig.browse')}
                        subtitle={t('claudeConfig.browseSubtitle')}
                        icon={<Ionicons name="folder-open-outline" size={29} color="#FF9500" />}
                        onPress={handleBrowse}
                    />
                </ItemGroup>
            </ItemList>
        </View>
    );
}
