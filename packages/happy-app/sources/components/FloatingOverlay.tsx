import * as React from 'react';
import { Platform } from 'react-native';
import Animated from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.OS === 'web' ? 0 : 0.5,
        borderColor: theme.colors.modal.border,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3.84,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
    },
}));

interface FloatingOverlayProps {
    children: React.ReactNode;
    maxHeight?: number;
    showScrollIndicator?: boolean;
    keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
    scrollViewRef?: React.Ref<Animated.ScrollView>;
    onScroll?: (offsetY: number) => void;
}

export const FloatingOverlay = React.memo((props: FloatingOverlayProps) => {
    const styles = stylesheet;
    const { 
        children, 
        maxHeight = 240, 
        showScrollIndicator = false, 
        keyboardShouldPersistTaps = 'handled',
        scrollViewRef,
        onScroll,
    } = props;

    return (
        <Animated.View style={[styles.container, { maxHeight }]}>
            <Animated.ScrollView
                ref={scrollViewRef}
                style={{ maxHeight }}
                onScroll={onScroll ? (e) => onScroll(e.nativeEvent.contentOffset.y) : undefined}
                scrollEventThrottle={onScroll ? 16 : undefined}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                showsVerticalScrollIndicator={showScrollIndicator}
            >
                {children}
            </Animated.ScrollView>
        </Animated.View>
    );
});