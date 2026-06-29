/**
 * ActionMenuModal Component
 *
 * A modal wrapper that displays ActionMenu at the bottom of the screen.
 * Similar to iOS ActionSheet behavior.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    Platform,
    TextInput,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { filterActionMenuItems } from './actionMenuSearch';

// On web, stop events from propagating to expo-router's modal overlay
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webEventHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

interface ActionMenuModalProps {
    visible: boolean;
    items: ActionMenuItem[];
    onClose: () => void;
    /** If true, item.onPress will be called after modal is fully closed (for camera/gallery pickers) */
    deferItemPress?: boolean;
    /** Optional title displayed at the top of the menu */
    title?: string;
    /** When true, render a search input below the title; items are filtered by label (case-insensitive). */
    searchable?: boolean;
    /** Placeholder shown in the search input when searchable=true. */
    searchPlaceholder?: string;
}

const ANIMATION_DURATION = 250;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
        ...Platform.select({ web: { pointerEvents: 'auto' as const } }),
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black',
    },
    content: {
        width: '100%',
        alignItems: 'center',
    },
});

export function ActionMenuModal({ visible, items, onClose, deferItemPress, title, searchable, searchPlaceholder }: ActionMenuModalProps) {
    const { theme } = useUnistyles();
    const [searchQuery, setSearchQuery] = useState('');
    // Reset query each time the menu re-opens.
    useEffect(() => {
        if (!visible) setSearchQuery('');
    }, [visible]);
    // Track actual modal visibility (delayed hide for animation)
    const [modalVisible, setModalVisible] = useState(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(100)).current;
    // Store pending action to execute after modal closes
    const pendingActionRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (visible) {
            // Show modal immediately, then animate in
            setModalVisible(true);
            // Reset animations to initial state
            fadeAnim.setValue(0);
            slideAnim.setValue(100);
            // Animate in
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    damping: 20,
                    stiffness: 300,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (modalVisible) {
            // Animate out, then hide modal
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.timing(slideAnim, {
                    toValue: 100,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setModalVisible(false);
                // Execute pending action after modal is fully closed
                if (pendingActionRef.current) {
                    // Add small delay to ensure modal is truly dismissed on iOS
                    setTimeout(() => {
                        pendingActionRef.current?.();
                        pendingActionRef.current = null;
                    }, 50);
                }
            });
        }
    }, [visible]);

    const handleClose = () => {
        onClose();
    };

    // Wrapped items that defer onPress if needed
    const wrappedItems = React.useMemo(() => {
        if (!deferItemPress) return items;
        return items.map(item => ({
            ...item,
            onPress: () => {
                // Store the action to execute after modal closes
                pendingActionRef.current = item.onPress;
            },
        }));
    }, [items, deferItemPress]);

    // Apply the search filter (case-insensitive, label substring).
    const visibleItems = React.useMemo(() => {
        if (!searchable) return wrappedItems;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return wrappedItems;
        return filterActionMenuItems(wrappedItems, q);
    }, [wrappedItems, searchable, searchQuery]);

    const searchHeader = searchable ? (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.divider,
        }}>
            <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={searchPlaceholder ?? '搜索 / Search'}
                placeholderTextColor={theme.colors.textSecondary}
                autoFocus={Platform.OS === 'web'}
                autoCorrect={false}
                autoCapitalize="none"
                style={{
                    flex: 1,
                    fontSize: 14,
                    color: theme.colors.text,
                    ...Typography.default(),
                    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
                }}
            />
        </View>
    ) : undefined;

    if (!modalVisible) {
        return null;
    }

    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="none"
            onRequestClose={handleClose}
        >
            <View style={styles.container} {...webEventHandlers}>
                <TouchableWithoutFeedback onPress={handleClose}>
                    <Animated.View
                        style={[
                            styles.backdrop,
                            {
                                opacity: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 0.5],
                                }),
                            },
                        ]}
                    />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.content,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    <ActionMenu items={visibleItems} onClose={handleClose} title={title} header={searchHeader} />
                </Animated.View>
            </View>
        </Modal>
    );
}
