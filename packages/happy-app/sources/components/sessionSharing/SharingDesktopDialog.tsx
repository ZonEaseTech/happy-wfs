import * as React from 'react';
import { Modal as RNModal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { shouldUseCenteredSharingDialog } from './dialogLayout';

export function useSharingDesktopDialog() {
    const { width } = useWindowDimensions();
    const [visible, setVisible] = React.useState(false);
    const isDesktop = shouldUseCenteredSharingDialog(Platform.OS, width);

    const present = React.useCallback(() => setVisible(true), []);
    const dismiss = React.useCallback(() => setVisible(false), []);

    return { isDesktop, visible, present, dismiss };
}

interface SharingDesktopDialogProps {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    maxWidth?: number;
    maxHeight?: number | `${number}%`;
}

export function SharingDesktopDialog({
    visible,
    onClose,
    children,
    maxWidth = 560,
    maxHeight = '82%',
}: SharingDesktopDialogProps) {
    const { theme } = useUnistyles();

    return (
        <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable
                onPress={onClose}
                style={{
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                }}
            >
                <Pressable
                    onPress={(e) => e.stopPropagation?.()}
                    style={{
                        width: '100%',
                        maxWidth,
                        maxHeight,
                        backgroundColor: theme.colors.groupped.background,
                        borderRadius: 16,
                        overflow: 'hidden',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 12 },
                        shadowOpacity: 0.22,
                        shadowRadius: 28,
                        elevation: 24,
                    }}
                >
                    {children}
                </Pressable>
            </Pressable>
        </RNModal>
    );
}
