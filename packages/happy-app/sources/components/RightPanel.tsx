import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { ResizableHandle } from './ResizableHandle';
import { useResizableColumn } from '@/utils/useResizableColumn';
import FilesScreen from '@/app/(app)/session/[id]/files';
import InfoScreen from '@/app/(app)/session/[id]/info';
import BrowserScreen from '@/app/(app)/session/[id]/browser';
import CommitsScreen from '@/app/(app)/session/[id]/commits';
import OrchestratorRunsScreen from '@/app/(app)/orchestrator/index';
import { t } from '@/text';

export type RightPanelType = 'files' | 'info' | 'browser' | 'commits' | 'orchestrator';

export const RIGHT_PANEL_WIDTH = 480; // legacy default — runtime width comes from useResizableColumn
const MIN_RIGHT_PANEL_WIDTH = 320;
const MAX_RIGHT_PANEL_WIDTH = 720;

/** Setter for the right-side area of the panel header bar. Embedded screens
 *  call useRightPanelHeaderSlot(node) to project content (e.g. files panel
 *  pushes its search input here so it sits at the very top). */
const RightPanelHeaderSlotContext = React.createContext<((node: React.ReactNode) => void) | null>(null);

/** Embedded children: render `node` into the right side of the panel header.
 *  Pass `null` (or pass a memoized stable node) to avoid re-injection thrash. */
export function useRightPanelHeaderSlot(node: React.ReactNode) {
    const setSlot = React.useContext(RightPanelHeaderSlotContext);
    React.useEffect(() => {
        if (!setSlot) return;
        setSlot(node);
        return () => setSlot(null);
    }, [setSlot, node]);
}

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
    const { width, setWidth, commit } = useResizableColumn({
        key: 'right-panel',
        defaultWidth: RIGHT_PANEL_WIDTH,
        minWidth: MIN_RIGHT_PANEL_WIDTH,
        maxWidth: MAX_RIGHT_PANEL_WIDTH,
    });
    const [headerSlot, setHeaderSlot] = React.useState<React.ReactNode>(null);
    // Reset slot when panel type changes — old screen's slot would leak otherwise.
    React.useEffect(() => { setHeaderSlot(null); }, [props.type]);
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
                gap: 12,
            }}>
                {supportsBack && props.onTypeChange && (
                    <Pressable
                        onPress={() => props.onTypeChange?.('info')}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                        <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
                    </Pressable>
                )}
                <Text style={{
                    fontSize: 16,
                    fontWeight: '600',
                    color: theme.colors.text,
                    flexShrink: 0,
                    ...Typography.default(),
                }}>
                    {getTitle(props.type)}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                    {headerSlot}
                </View>
                <Pressable onPress={props.onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <Ionicons name="close" size={22} color={theme.colors.text} />
                </Pressable>
            </View>
            <View style={{ flex: 1 }}>
                <RightPanelHeaderSlotContext.Provider value={setHeaderSlot}>
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
                </RightPanelHeaderSlotContext.Provider>
            </View>
        </View>
    );
});
