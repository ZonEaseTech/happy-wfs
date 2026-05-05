import * as React from 'react';
import { View, Platform, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { Modal } from '@/modal';
import { t } from '@/text';
import { FileViewerModal } from '@/components/FileViewerModal';

/**
 * Entry page for editing user-level Claude config files on a machine.
 * Lists three actions, all anchored to the user's $HOME on the selected machine:
 *  - settings.json (hooks, permissions, env, ...)
 *  - CLAUDE.md (user-level prompt prepended to every project)
 *  - Browse ~/.claude (skills/, commands/, agents/, ...)
 *
 * Picks the first online machine automatically. If none is online, surfaces a hint.
 */
export default function ClaudeConfigScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { theme } = useUnistyles();
    const router = useRouter();
    const allMachines = useAllMachines();
    const { width } = useWindowDimensions();
    // PC mode = desktop web. Mobile / native still navigates to the dedicated
    // /settings/machine-edit route so it gets the platform-native editor UX.
    const isPC = Platform.OS === 'web' && width >= 768;

    const [showViewer, setShowViewer] = React.useState(false);
    // When `viewerPath` points to a file -> opens that file. When it points
    // to a directory (e.g. ~/.claude for "Browse"), `viewerCwd` carries the
    // root and `viewerPath` stays undefined so the modal shows tree-only.
    const [viewerPath, setViewerPath] = React.useState<string | undefined>(undefined);
    const [viewerCwd, setViewerCwd] = React.useState<string | undefined>(undefined);

    const openInModal = React.useCallback((path: string, asDirectory = false) => {
        if (asDirectory) {
            setViewerPath(undefined);
            setViewerCwd(path);
        } else {
            setViewerPath(path);
            // Anchor the tree at the file's parent for context.
            const parent = path.substring(0, path.lastIndexOf('/')) || path;
            setViewerCwd(parent);
        }
        setShowViewer(true);
    }, []);

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
            if (isPC) { openInModal(path); return; }
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=JSON&validateJson=1`);
        });
    }, [requireOnline, router, machineId, homeDir, isPC, openInModal]);

    const handleEditClaudeMd = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude/CLAUDE.md`;
            if (isPC) { openInModal(path); return; }
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=Markdown`);
        });
    }, [requireOnline, router, machineId, homeDir, isPC, openInModal]);

    const handleEditAgentsMd = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude/AGENTS.md`;
            if (isPC) { openInModal(path); return; }
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=Markdown`);
        });
    }, [requireOnline, router, machineId, homeDir, isPC, openInModal]);

    const handleBrowse = React.useCallback(() => {
        requireOnline(() => {
            const path = `${homeDir}/.claude`;
            if (isPC) { openInModal(path, true); return; }
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-browser?machineId=${machineId}&path=${encodedPath}`);
        });
    }, [requireOnline, router, machineId, homeDir, isPC, openInModal]);

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
                        title={t('claudeConfig.agentsMd')}
                        subtitle={t('claudeConfig.agentsMdSubtitle')}
                        icon={<Ionicons name="people-outline" size={29} color="#5856D6" />}
                        onPress={handleEditAgentsMd}
                    />
                    <Item
                        title={t('claudeConfig.browse')}
                        subtitle={t('claudeConfig.browseSubtitle')}
                        icon={<Ionicons name="folder-open-outline" size={29} color="#FF9500" />}
                        onPress={handleBrowse}
                    />
                </ItemGroup>
            </ItemList>
            {machineId && (
                <FileViewerModal
                    visible={showViewer}
                    onClose={() => setShowViewer(false)}
                    machineId={machineId}
                    initialFilePath={viewerPath}
                    initialCwd={viewerCwd}
                />
            )}
        </View>
    );
}
