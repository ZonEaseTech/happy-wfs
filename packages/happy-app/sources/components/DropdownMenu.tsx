import * as React from 'react';
import { View, Pressable, Modal as RNModal, Platform, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { ActionMenuItem } from '@/components/ActionMenu';

interface DropdownMenuProps {
    /** Element the menu anchors to. Menu opens just below the anchor's bottom edge. */
    anchorRef: React.RefObject<View | null>;
    visible: boolean;
    items: ActionMenuItem[];
    onClose: () => void;
    /** Min width of the menu in px; will widen to anchor width when larger. */
    minWidth?: number;
}

/**
 * Compact desktop-style dropdown menu anchored to a trigger element.
 * Click outside / ESC dismisses. Renders nothing on native — caller should
 * fall back to the bottom-sheet ActionMenuModal there.
 */
export const DropdownMenu = React.memo(({ anchorRef, visible, items, onClose, minWidth = 180 }: DropdownMenuProps) => {
    const { theme } = useUnistyles();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const [anchor, setAnchor] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);

    React.useEffect(() => {
        if (!visible || Platform.OS !== 'web') return;
        const el = anchorRef.current;
        if (!el || typeof (el as any).measureInWindow !== 'function') return;
        (el as any).measureInWindow((x: number, y: number, w: number, h: number) => {
            setAnchor({ x, y, width: w, height: h });
        });
    }, [visible, anchorRef, windowWidth, windowHeight]);

    if (Platform.OS !== 'web') return null;
    if (!visible) return null;

    const menuWidth = Math.max(minWidth, anchor?.width ?? 0);
    // Anchor the menu's right edge to the trigger's right edge so it grows leftward
    // when wider than the trigger — typical for "..." menus on the top-right of a card.
    const right = anchor ? Math.max(8, windowWidth - (anchor.x + anchor.width)) : 8;
    const top = anchor ? anchor.y + anchor.height + 4 : 48;

    return (
        <RNModal visible transparent animationType="fade" onRequestClose={onClose}>
            <Pressable
                onPress={onClose}
                style={{ flex: 1, backgroundColor: 'transparent' }}
            >
                <Pressable
                    onPress={(e) => e.stopPropagation?.()}
                    style={{
                        position: 'absolute',
                        top,
                        right,
                        minWidth: menuWidth,
                        backgroundColor: theme.colors.surface,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: 0.18,
                        shadowRadius: 18,
                        elevation: 12,
                        paddingVertical: 4,
                    }}
                >
                    {items.map((item, idx) => (
                        <Pressable
                            key={idx}
                            onPress={() => {
                                onClose();
                                // Defer to next tick so the modal unmounts before any
                                // follow-up modal (Alert/prompt) opens — avoids the
                                // "modal-on-modal" flicker on web.
                                setTimeout(() => item.onPress?.(), 0);
                            }}
                            style={({ pressed }) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 9,
                                backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                            })}
                        >
                            <Text style={{
                                fontSize: 13,
                                color: item.destructive ? theme.colors.textDestructive : theme.colors.text,
                                ...Typography.default(item.destructive ? 'semiBold' : undefined),
                            }}>
                                {item.label}
                            </Text>
                        </Pressable>
                    ))}
                </Pressable>
            </Pressable>
        </RNModal>
    );
});

DropdownMenu.displayName = 'DropdownMenu';
