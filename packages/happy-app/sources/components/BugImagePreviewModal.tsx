import React from 'react';
import { Modal as NativeModal, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import {
    BUG_PREVIEW_MIN_ZOOM,
    clampBugPreviewPan,
    clampBugPreviewZoom,
    getBugPreviewWheelZoomDirection,
    getNextBugPreviewZoom,
    getToggledBugPreviewZoom,
    resetBugPreviewZoomState,
    shouldEnableBugPreviewZoom,
    type BugPreviewImage,
    type BugPreviewZoomState,
} from './bugImagePreview';

export function BugImagePreviewModal({
    images,
    initialIndex,
    visible,
    onClose,
}: {
    images: BugPreviewImage[];
    initialIndex: number;
    visible: boolean;
    onClose: () => void;
}) {
    const styles = stylesheet;
    const windowSize = useWindowDimensions();
    const zoomEnabled = shouldEnableBugPreviewZoom(Platform.OS);
    const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
    const [zoomState, setZoomState] = React.useState<BugPreviewZoomState>(() => resetBugPreviewZoomState());
    const zoomStateRef = React.useRef(zoomState);
    const panStartRef = React.useRef({ translateX: 0, translateY: 0 });
    const lastPressAtRef = React.useRef(0);
    const stageWidth = Math.max(1, windowSize.width - 36);
    const stageHeight = Math.max(1, windowSize.height - 104);

    React.useEffect(() => {
        if (!visible) return;
        setCurrentIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
    }, [images.length, initialIndex, visible]);

    React.useEffect(() => {
        zoomStateRef.current = zoomState;
    }, [zoomState]);

    React.useEffect(() => {
        if (!visible) return;
        setZoomState(resetBugPreviewZoomState());
    }, [currentIndex, visible]);

    const setZoomScale = React.useCallback((scale: number) => {
        if (!zoomEnabled) return;
        setZoomState((state) => {
            const nextScale = clampBugPreviewZoom(scale);
            if (nextScale <= BUG_PREVIEW_MIN_ZOOM) return resetBugPreviewZoomState();
            return {
                scale: nextScale,
                translateX: clampBugPreviewPan(state.translateX, nextScale, stageWidth),
                translateY: clampBugPreviewPan(state.translateY, nextScale, stageHeight),
            };
        });
    }, [stageHeight, stageWidth, zoomEnabled]);

    React.useEffect(() => {
        if (!visible || !zoomEnabled || typeof document === 'undefined') return;
        const handleWheelEvent = (event: WheelEvent) => {
            event.preventDefault();
            const direction = getBugPreviewWheelZoomDirection(event.deltaY);
            if (direction === 0) return;
            setZoomScale(getNextBugPreviewZoom(zoomStateRef.current.scale, direction));
        };
        document.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => document.removeEventListener('wheel', handleWheelEvent);
    }, [setZoomScale, visible, zoomEnabled]);

    const handleImagePress = () => {
        if (!zoomEnabled) return;
        const now = Date.now();
        if (now - lastPressAtRef.current <= 280) {
            const nextScale = getToggledBugPreviewZoom(zoomStateRef.current.scale);
            setZoomState(nextScale <= BUG_PREVIEW_MIN_ZOOM
                ? resetBugPreviewZoomState()
                : { scale: nextScale, translateX: 0, translateY: 0 });
            lastPressAtRef.current = 0;
            return;
        }
        lastPressAtRef.current = now;
    };

    const panResponder = React.useMemo(
        () => PanResponder.create({
            onMoveShouldSetPanResponder: (_event, gestureState) => zoomEnabled
                && zoomStateRef.current.scale > BUG_PREVIEW_MIN_ZOOM
                && (Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3),
            onPanResponderGrant: () => {
                panStartRef.current = {
                    translateX: zoomStateRef.current.translateX,
                    translateY: zoomStateRef.current.translateY,
                };
            },
            onPanResponderMove: (_event, gestureState) => {
                const scale = zoomStateRef.current.scale;
                if (scale <= BUG_PREVIEW_MIN_ZOOM) return;
                setZoomState({
                    scale,
                    translateX: clampBugPreviewPan(panStartRef.current.translateX + gestureState.dx, scale, stageWidth),
                    translateY: clampBugPreviewPan(panStartRef.current.translateY + gestureState.dy, scale, stageHeight),
                });
            },
        }),
        [stageHeight, stageWidth, zoomEnabled],
    );

    const showPrevious = () => {
        setCurrentIndex(index => (index <= 0 ? images.length - 1 : index - 1));
    };
    const showNext = () => {
        setCurrentIndex(index => (index >= images.length - 1 ? 0 : index + 1));
    };

    if (!visible || images.length === 0) return null;

    const currentImage = images[currentIndex] ?? images[0];
    const canNavigate = images.length > 1;
    const scaleDisplay = `${Math.round(zoomState.scale * 100)}%`;
    const imagePanHandlers = zoomEnabled ? panResponder.panHandlers : {};
    const imageTransform = zoomEnabled ? [
        { translateX: zoomState.translateX },
        { translateY: zoomState.translateY },
        { scale: zoomState.scale },
    ] : [];
    const webImageStyle: React.CSSProperties = {
        width: stageWidth,
        height: stageHeight,
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        transform: zoomEnabled
            ? `translate(${zoomState.translateX}px, ${zoomState.translateY}px) scale(${zoomState.scale})`
            : undefined,
        userSelect: 'none',
        pointerEvents: 'none',
    };

    return (
        <NativeModal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.header}>
                    <View style={styles.headerSpacer} />
                    <Text style={styles.counter}>{currentIndex + 1} / {images.length}{zoomEnabled ? ` · ${scaleDisplay}` : ''}</Text>
                    <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
                        <Ionicons name="close" size={30} color="#FFFFFF" />
                    </Pressable>
                </View>
                <View style={styles.stage}>
                    {canNavigate && (
                        <Pressable style={[styles.navButton, styles.navLeft]} onPress={showPrevious} hitSlop={12}>
                            <Ionicons name="chevron-back" size={34} color="#FFFFFF" />
                        </Pressable>
                    )}
                    <Pressable
                        style={styles.imageGestureLayer}
                        onPress={handleImagePress}
                        {...imagePanHandlers}
                    >
                        {Platform.OS === 'web' ? (
                            <img
                                src={currentImage.uri}
                                alt=""
                                draggable={false}
                                style={webImageStyle}
                            />
                        ) : (
                            <Image
                                source={{ uri: currentImage.uri }}
                                style={[
                                    styles.image,
                                    {
                                        width: stageWidth,
                                        height: stageHeight,
                                        transform: imageTransform,
                                    },
                                ]}
                                contentFit="contain"
                            />
                        )}
                    </Pressable>
                    {canNavigate && (
                        <Pressable style={[styles.navButton, styles.navRight]} onPress={showNext} hitSlop={12}>
                            <Ionicons name="chevron-forward" size={34} color="#FFFFFF" />
                        </Pressable>
                    )}
                </View>
            </View>
        </NativeModal>
    );
}

const stylesheet = StyleSheet.create(() => ({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.96)',
    },
    header: {
        height: 72,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerSpacer: {
        width: 44,
        height: 44,
    },
    counter: {
        color: '#FFFFFF',
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    closeButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.14)',
    },
    stage: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 18,
        paddingBottom: 16,
    },
    imageGestureLayer: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    image: {},
    navButton: {
        position: 'absolute',
        zIndex: 2,
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.16)',
    },
    navLeft: {
        left: 18,
    },
    navRight: {
        right: 18,
    },
}));
