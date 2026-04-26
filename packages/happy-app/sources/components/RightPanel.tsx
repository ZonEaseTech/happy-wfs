import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import FilesScreen from '@/app/(app)/session/[id]/files';
import InfoScreen from '@/app/(app)/session/[id]/info';
import BrowserScreen from '@/app/(app)/session/[id]/browser';

export type RightPanelType = 'files' | 'info' | 'browser';

export const RIGHT_PANEL_WIDTH = 480;

const TITLES: Record<RightPanelType, string> = {
    files: 'Files',
    info: 'Info',
    browser: 'Code',
};

export const RightPanel = React.memo(function RightPanel(props: {
    sessionId: string;
    type: RightPanelType;
    onClose: () => void;
}) {
    const { theme } = useUnistyles();
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
                <Text style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: '600',
                    color: theme.colors.text,
                    ...Typography.default(),
                }}>
                    {TITLES[props.type]}
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
                ) : (
                    <InfoScreen sessionId={props.sessionId} embedded />
                )}
            </View>
        </View>
    );
});
