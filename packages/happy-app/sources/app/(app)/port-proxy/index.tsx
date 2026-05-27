import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { PortProxyView } from '@/components/PortProxyView';

export default React.memo(function PortProxyPage() {
    const { theme } = useUnistyles();
    const router = useRouter();

    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen
                options={{
                    headerRight: () => (
                        <Pressable onPress={() => router.push('/port-proxy/add')} hitSlop={15}>
                            <Ionicons name="add-outline" size={24} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />
            <PortProxyView />
        </View>
    );
});
