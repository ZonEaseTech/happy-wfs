import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { View } from 'react-native';
import { Drawer } from 'expo-router/drawer';
import { useIsTablet } from '@/utils/responsive';
import { SidebarView } from './SidebarView';
import { ResizableHandle } from './ResizableHandle';
import { useResizableColumn } from '@/utils/useResizableColumn';

const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 300;

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    const showPermanentDrawer = auth.isAuthenticated && isTablet;

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
        <Drawer
            screenOptions={drawerNavigationOptions}
            drawerContent={showPermanentDrawer ? drawerContent : undefined}
        />
    );
});
