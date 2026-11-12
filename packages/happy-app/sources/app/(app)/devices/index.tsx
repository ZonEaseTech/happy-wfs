import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { DeviceManagementView } from '@/components/DeviceManagementView';
import { useDesktopRoute, useDesktopRoutes, useDrawerHeaderRight } from '@/components/desktopRoutes';
import { t } from '@/text';

/** Resource center: a few devices, the keys agents can use, and how they were used. */
export default React.memo(function DevicesPage() {
    const { theme } = useUnistyles();
    const { isInDrawer } = useDesktopRoute();
    const { open } = useDesktopRoutes();
    const addKeyButton = React.useMemo(() => (
        <Pressable
            onPress={() => open('/devices/key-edit', { title: t('resources.newKey') })}
            hitSlop={8}
            accessibilityRole="button"
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
            <Text style={{ fontSize: 15, color: theme.colors.textLink }}>＋ {t('resources.addKey')}</Text>
        </Pressable>
    ), [open, theme]);
    useDrawerHeaderRight(addKeyButton);

    return (
        <View style={{ flex: 1 }}>
            {!isInDrawer && <Stack.Screen options={{ headerRight: () => addKeyButton }} />}
            <DeviceManagementView mode="home" />
        </View>
    );
});
