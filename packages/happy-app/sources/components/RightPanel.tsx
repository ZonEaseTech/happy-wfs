import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { ResizableHandle } from './ResizableHandle';
import { useResizableColumn } from '@/utils/useResizableColumn';
import { Typography } from '@/constants/Typography';
import FilesScreen from '@/app/(app)/session/[id]/files';
import InfoScreen from '@/app/(app)/session/[id]/info';
import BrowserScreen from '@/app/(app)/session/[id]/browser';
import CommitsScreen from '@/app/(app)/session/[id]/commits';
import OrchestratorRunsScreen from '@/app/(app)/orchestrator/index';
import { t } from '@/text';

export type RightPanelType = 'files' | 'info' | 'browser' | 'commits' | 'orchestrator';

export const RIGHT_PANEL_WIDTH = 480; // legacy export — callers use the hook now

const MIN_RIGHT_PANEL_WIDTH = 320;
const MAX_RIGHT_PANEL_WIDTH = 720;

export const RightPanel = React.memo(function RightPanel(props: {
    sessionId: string;
    type: RightPanelType;
    onClose: () => void;
    /** Optional: when provided, the in-panel shortcuts switch the panel
     * type instead of pushing a full-screen route. */
    onSwitchType?: (next: RightPanelType) => void;
}) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { width, setWidth, commit } = useResizableColumn({
        key: 'right-panel',
        defaultWidth: RIGHT_PANEL_WIDTH,
        minWidth: MIN_RIGHT_PANEL_WIDTH,
        maxWidth: MAX_RIGHT_PANEL_WIDTH,
    });
    return (
        <View style={{
            width,
            height: '100%',
            backgroundColor: theme.colors.surface,
            borderLeftWidth: 1,
            borderLeftColor: theme.colors.divider,
        }}>
            <ResizableHandle
                side="left"
                width={width}
                minWidth={MIN_RIGHT_PANEL_WIDTH}
                maxWidth={MAX_RIGHT_PANEL_WIDTH}
                onResize={setWidth}
                onCommit={commit}
            />
            <View style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
            }}>
                <Text style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: '600',
                    color: theme.colors.text,
                    ...Typography.default(),
                }}>
                    {props.type === 'files' ? 'Files'
                        : props.type === 'info' ? 'Info'
                        : props.type === 'browser' ? 'Code'
                        : props.type === 'commits' ? 'Commits'
                        : t('settings.orchestratorRuns')}
                </Text>
                <Pressable
                    onPress={() => {
                        // Prefer in-panel switching when SessionView wired a setter,
                        // so the chat column on the left isn't covered. Fall back to
                        // a full-screen route push when used outside that context.
                        if (props.onSwitchType) {
                            props.onSwitchType(props.type === 'commits' ? 'files' : 'commits');
                        } else {
                            router.push(`/session/${props.sessionId}/commits`);
                        }
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Commits"
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 14 })}
                >
                    <Octicons
                        name="git-commit"
                        size={20}
                        color={props.type === 'commits' ? theme.colors.button.primary.background : theme.colors.text}
                    />
                </Pressable>
                <Pressable onPress={props.onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <Ionicons name="close" size={22} color={theme.colors.text} />
                </Pressable>
            </View>
            <View style={{ flex: 1 }}>
                {props.type === 'files' ? (
                    <FilesScreen sessionId={props.sessionId} embedded />
                ) : props.type === 'browser' ? (
                    <BrowserScreen sessionId={props.sessionId} embedded />
                ) : props.type === 'commits' ? (
                    <CommitsScreen sessionId={props.sessionId} embedded />
                ) : props.type === 'orchestrator' ? (
                    <OrchestratorRunsScreen sessionId={props.sessionId} embedded />
                ) : (
                    <InfoScreen sessionId={props.sessionId} embedded />
                )}
            </View>
        </View>
    );
});
