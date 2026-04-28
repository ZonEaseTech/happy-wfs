import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import FilesScreen from '@/app/(app)/session/[id]/files';
import InfoScreen from '@/app/(app)/session/[id]/info';
import BrowserScreen from '@/app/(app)/session/[id]/browser';
import CommitsScreen from '@/app/(app)/session/[id]/commits';
import OrchestratorRunsScreen from '@/app/(app)/orchestrator/index';
import { t } from '@/text';

export type RightPanelType = 'files' | 'info' | 'browser' | 'commits' | 'orchestrator';

export const RIGHT_PANEL_WIDTH = 480;

function getTitle(type: RightPanelType): string {
    switch (type) {
        case 'files': return 'Files';
        case 'info': return 'Info';
        case 'browser': return 'Code';
        case 'commits': return 'Commits';
        case 'orchestrator': return t('settings.orchestratorRuns');
    }
}

export const RightPanel = React.memo(function RightPanel(props: {
    sessionId: string;
    type: RightPanelType;
    onClose: () => void;
    /** Setter so embedded children can swap panel content in place (e.g. Info "代码" / "提交" entries on desktop). */
    onTypeChange?: (type: RightPanelType | null) => void;
}) {
    const { theme } = useUnistyles();
    const supportsBack = props.type === 'browser' || props.type === 'commits';
    return (
        <View style={{
            width: RIGHT_PANEL_WIDTH,
            height: '100%',
            backgroundColor: theme.colors.surface,
            borderLeftWidth: 1,
            borderLeftColor: theme.colors.divider,
        }}>
            <View style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
            }}>
                {supportsBack && props.onTypeChange && (
                    <Pressable
                        onPress={() => props.onTypeChange?.('info')}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 8 })}
                    >
                        <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
                    </Pressable>
                )}
                <Text style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: '600',
                    color: theme.colors.text,
                    ...Typography.default(),
                }}>
                    {getTitle(props.type)}
                </Text>
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
                    <InfoScreen sessionId={props.sessionId} embedded onSelectRepoTab={props.onTypeChange} />
                )}
            </View>
        </View>
    );
});
