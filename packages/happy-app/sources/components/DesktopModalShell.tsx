import * as React from 'react';
import { View, Pressable, Platform, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';

interface DesktopModalShellProps {
    /** Title shown in the card header. Falls back to no header when omitted. */
    title?: string;
    /** Override the default close action (router.back()). */
    onClose?: () => void;
    /** When true, the screen renders as a route push instead of a modal even
     *  on PC. Use this to opt the screen out (e.g. when embedded or busy). */
    disabled?: boolean;
    children: React.ReactNode;
}

/**
 * On web ≥ 1024px, wraps a fullscreen route in a centered card overlay so the
 * caller's screen (chat) stays visible behind. On native or narrow screens,
 * renders children as-is — the existing Stack-based fullscreen flow stays.
 *
 * The wrapper sets Stack.Screen options to hide the native header and make
 * the route content background transparent, so callers don't need to change
 * their existing per-route headerTitle / headerBackTitle settings — those just
 * become no-ops in modal mode.
 */
export function DesktopModalShell({ title, onClose, disabled, children }: DesktopModalShellProps) {
    const { width } = useWindowDimensions();
    const router = useRouter();
    const { theme } = useUnistyles();
    const isPCModal = !disabled && Platform.OS === 'web' && width >= 1024;
    const handleClose = onClose ?? (() => router.back());

    if (!isPCModal) return <>{children}</>;

    return (
        <>
            <Pressable
                onPress={handleClose}
                style={{
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 24,
                }}
            >
                <Pressable
                    onPress={(e: any) => e.stopPropagation?.()}
                    style={{
                        width: '100%',
                        height: '100%',
                        maxWidth: 1100,
                        maxHeight: 880,
                        backgroundColor: theme.colors.surface,
                        borderRadius: 14,
                        overflow: 'hidden',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 12 },
                        shadowOpacity: 0.25,
                        shadowRadius: 30,
                        elevation: 24,
                    }}
                >
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                        gap: 12,
                    }}>
                        <Text
                            style={{ flex: 1, fontSize: 15, color: theme.colors.text, ...Typography.default('semiBold') }}
                            numberOfLines={1}
                        >
                            {title ?? ''}
                        </Text>
                        <Pressable onPress={handleClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                            <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <View style={{ flex: 1 }}>{children}</View>
                </Pressable>
            </Pressable>
            {/* Stack.Screen rendered LAST so its options call setOptions after
                any children that may also have <Stack.Screen options={...}> —
                react-navigation honors the most recent setOptions call. */}
            <Stack.Screen
                options={{
                    headerShown: false,
                    contentStyle: { backgroundColor: 'transparent' },
                    animation: 'fade',
                }}
            />
        </>
    );
}
