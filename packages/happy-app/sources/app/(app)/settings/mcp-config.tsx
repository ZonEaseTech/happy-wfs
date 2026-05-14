import * as React from 'react';
import { View, Platform, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { FileViewerModal } from '@/components/FileViewerModal';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useUnistyles } from 'react-native-unistyles';

type ConfigTarget = {
    key: 'claude' | 'codex' | 'gemini';
    title: string;
    subtitle: string;
    fileName: string;
    dirName: string;
    language: string;
    validateJson?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
};

const CONFIG_TARGETS: ConfigTarget[] = [
    {
        key: 'claude',
        title: 'Claude',
        subtitle: '~/.claude/settings.json · mcpServers',
        fileName: '.claude/settings.json',
        dirName: '.claude',
        language: 'JSON',
        validateJson: true,
        icon: 'sparkles-outline',
        color: '#5856D6',
    },
    {
        key: 'codex',
        title: 'Codex',
        subtitle: '~/.codex/config.toml · [mcp_servers.*]',
        fileName: '.codex/config.toml',
        dirName: '.codex',
        language: 'TOML',
        icon: 'code-slash-outline',
        color: '#111111',
    },
    {
        key: 'gemini',
        title: 'Gemini',
        subtitle: '~/.gemini/settings.json · mcpServers',
        fileName: '.gemini/settings.json',
        dirName: '.gemini',
        language: 'JSON',
        validateJson: true,
        icon: 'diamond-outline',
        color: '#AF52DE',
    },
];

export default function MCPConfigScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { theme } = useUnistyles();
    const router = useRouter();
    const allMachines = useAllMachines();
    const { width } = useWindowDimensions();
    const isPC = Platform.OS === 'web' && width >= 768;

    const [showViewer, setShowViewer] = React.useState(false);
    const [viewerPath, setViewerPath] = React.useState<string | undefined>(undefined);
    const [viewerCwd, setViewerCwd] = React.useState<string | undefined>(undefined);

    const onlineMachine = React.useMemo(() => {
        return allMachines.find(isMachineOnline) ?? allMachines[0];
    }, [allMachines]);

    const machineId = onlineMachine?.id;
    const homeDir = onlineMachine?.metadata?.homeDir || '/root';
    const machineDisplay = onlineMachine?.metadata?.displayName || onlineMachine?.metadata?.host || '';
    const isOnline = onlineMachine ? isMachineOnline(onlineMachine) : false;

    const requireOnline = React.useCallback((action: () => void) => {
        if (!machineId) {
            Modal.alert(t('common.error'), t('mcpConfig.noMachine'));
            return;
        }
        if (!isOnline) {
            Modal.alert(t('common.error'), t('mcpConfig.machineOffline'));
            return;
        }
        action();
    }, [machineId, isOnline]);

    const openFile = React.useCallback((target: ConfigTarget) => {
        requireOnline(() => {
            const path = `${homeDir}/${target.fileName}`;
            if (isPC) {
                setViewerPath(path);
                setViewerCwd(`${homeDir}/${target.dirName}`);
                setShowViewer(true);
                return;
            }
            const encodedPath = encodeURIComponent(path);
            const validateJson = target.validateJson ? '&validateJson=1' : '';
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}&language=${target.language}${validateJson}`);
        });
    }, [homeDir, isPC, machineId, requireOnline, router]);

    const browseDir = React.useCallback((target: ConfigTarget) => {
        requireOnline(() => {
            const path = `${homeDir}/${target.dirName}`;
            if (isPC) {
                setViewerPath(undefined);
                setViewerCwd(path);
                setShowViewer(true);
                return;
            }
            const encodedPath = encodeURIComponent(path);
            router.push(`/settings/machine-browser?machineId=${machineId}&path=${encodedPath}`);
        });
    }, [homeDir, isPC, machineId, requireOnline, router]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {!isInDrawer && <Stack.Screen options={{ title: t('mcpConfig.title') }} />}
            <ItemList style={{ paddingTop: 0 }}>
                <ItemGroup
                    title={t('mcpConfig.machineGroup')}
                    footer={machineDisplay
                        ? t('mcpConfig.machineFooter', { machine: machineDisplay, status: isOnline ? t('status.online') : t('status.offline') })
                        : t('mcpConfig.noMachineFooter')}
                >
                    {CONFIG_TARGETS.map((target) => (
                        <Item
                            key={target.key}
                            title={target.title}
                            subtitle={target.subtitle}
                            icon={<Ionicons name={target.icon} size={29} color={target.color === '#111111' && theme.dark ? '#FFFFFF' : target.color} />}
                            onPress={() => openFile(target)}
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t('mcpConfig.browseGroup')} footer={t('mcpConfig.hint')}>
                    {CONFIG_TARGETS.map((target) => (
                        <Item
                            key={target.key}
                            title={t('mcpConfig.browseTarget', { target: target.title })}
                            subtitle={`~/${target.dirName}`}
                            icon={<Ionicons name="folder-open-outline" size={29} color={target.color === '#111111' && theme.dark ? '#FFFFFF' : target.color} />}
                            onPress={() => browseDir(target)}
                        />
                    ))}
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
