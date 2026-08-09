import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { View } from 'react-native';
import { Drawer } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { useIsTablet } from '@/utils/responsive';
import { SidebarView } from './SidebarView';
import { ResizableHandle } from './ResizableHandle';
import { useResizableColumn } from '@/utils/useResizableColumn';
import { isSidebarHiddenPath } from './sidebarVisibility';
import { TerminalPanel } from './Terminal';
import { closeTerminalPanel, useTerminalPanelState } from './terminalPanelStore';

const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 300;

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    const pathname = usePathname();
    const showPermanentDrawer = auth.isAuthenticated && isTablet && !isSidebarHiddenPath(pathname);

    // Persisted width (web/desktop only); native falls back to default.
    const { width: sidebarWidth, setWidth, commit } = useResizableColumn({
        key: 'sidebar',
        defaultWidth: DEFAULT_SIDEBAR_WIDTH,
        minWidth: MIN_SIDEBAR_WIDTH,
        maxWidth: MAX_SIDEBAR_WIDTH,
    });

    const drawerNavigationOptions = React.useMemo(() => {
        if (!showPermanentDrawer) {
            return {
                lazy: false,
                headerShown: false,
                drawerType: 'front' as const,
                swipeEnabled: false,
                drawerStyle: {
                    width: 0,
                    display: 'none' as const,
                },
            };
        }
        return {
            lazy: false,
            headerShown: false,
            drawerType: 'permanent' as const,
            drawerStyle: {
                backgroundColor: 'white',
                // Keep the drawer edge as a thin divider only. A wide border
                // becomes real layout width and creates a blank strip between
                // the sidebar and the main content/terminal.
                borderRightWidth: 1,
                borderRightColor: '#E5E7EB',
                width: sidebarWidth,
            },
            swipeEnabled: false,
            drawerActiveTintColor: 'transparent',
            drawerInactiveTintColor: 'transparent',
            drawerItemStyle: { display: 'none' as const },
            drawerLabelStyle: { display: 'none' as const },
        };
    }, [showPermanentDrawer, sidebarWidth]);

    const drawerContent = React.useCallback(
        () => (
            <View style={{ flex: 1 }}>
                <SidebarView />
                <ResizableHandle
                    side="right"
                    width={sidebarWidth}
                    minWidth={MIN_SIDEBAR_WIDTH}
                    maxWidth={MAX_SIDEBAR_WIDTH}
                    onResize={setWidth}
                    onCommit={commit}
                />
            </View>
        ),
        [sidebarWidth, setWidth, commit],
    );

    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Drawer
                    screenOptions={drawerNavigationOptions}
                    drawerContent={showPermanentDrawer ? drawerContent : undefined}
                />
            </View>
            <GlobalTerminalHost />
        </View>
    );
});

/**
 * Mounted beside the navigator so an open terminal survives route changes
 * (chat → devices → settings); only the middle column swaps.
 */
const GlobalTerminalHost = React.memo(() => {
    const terminal = useTerminalPanelState();
    if (!terminal.targetId) return null;
    return (
        <TerminalPanel
            visible={terminal.visible}
            onClose={closeTerminalPanel}
            sessionId={terminal.targetId}
            cwd={terminal.cwd}
            isMachineScope={terminal.isMachineScope}
            openRequestKey={terminal.openRequestKey}
        />
    );
});
