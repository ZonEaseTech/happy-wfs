import * as React from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector, MouseButton } from 'react-native-gesture-handler';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { Session } from '@/sync/storageTypes';

/**
 * Lets the list around the rows stop scrolling while one is dragged in the
 * native app — the scroll view would otherwise move along with the finger.
 * SessionsList provides it; anywhere else it is a no-op. Not used on web.
 */
export const SessionListScrollLockContext = React.createContext<(locked: boolean) => void>(() => { });

const PressGuardContext = React.createContext<() => boolean>(() => false);

/**
 * True while a row is being dragged and for a moment after. On web the
 * release that ends a drag still reaches the row as a press, which would
 * open the session that was just moved.
 */
export function useSortableRowPressGuard(): () => boolean {
    return React.useContext(PressGuardContext);
}

// Compact row (45) plus its divider; used until a row has been measured.
const ESTIMATED_ROW_HEIGHT = 46;
// Kept across mounts so a list that comes back (switching tabs) lays its rows
// out right on the first frame instead of overlapping them for one.
const heightCache = new Map<string, number>();
// A mouse starts a drag just by moving; a finger has to hold first, so
// scrolling the list and swiping a row keep working.
const dragWithMouse = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && !!window.matchMedia?.('(pointer: fine)').matches;

function offsetOf(order: string[], heights: Record<string, number>, id: string): number {
    'worklet';
    let y = 0;
    for (const other of order) {
        if (other === id) break;
        y += heights[other] ?? ESTIMATED_ROW_HEIGHT;
    }
    return y;
}

/** Index `id` belongs at with its centre at `centerY`: the number of other rows whose midpoint lies above that. */
function slotAt(order: string[], heights: Record<string, number>, id: string, centerY: number): number {
    'worklet';
    let y = 0;
    let slot = 0;
    for (const other of order) {
        if (other === id) continue;
        const height = heights[other] ?? ESTIMATED_ROW_HEIGHT;
        if (centerY > y + height / 2) slot++;
        y += height;
    }
    return slot;
}

type DragState = {
    order: SharedValue<string[]>;
    heights: SharedValue<Record<string, number>>;
    dragging: SharedValue<string | null>;
    dragY: SharedValue<number>;
    startY: SharedValue<number>;
    startOrder: SharedValue<string[]>;
};

/**
 * One sidebar group's rows, reorderable by dragging within the group: long
 * press then drag on touch screens, plain drag with a mouse. Rows sit at
 * absolute offsets driven by shared values, so the rows a drag passes slide
 * aside on the UI thread and nothing re-renders until the drop, when
 * `onReorder` gets the new order. Until the parent passes that order back the
 * rows keep showing it, so the drop never flashes the old one.
 */
export function SortableSessionRows({ sessions, enabled, onReorder, renderRow }: {
    sessions: Session[];
    enabled: boolean;
    onReorder: (orderedIds: string[], movedId: string) => void;
    renderRow: (session: Session, index: number) => React.ReactNode;
}) {
    const ids = React.useMemo(() => sessions.map((session) => session.id), [sessions]);
    const [heights, setHeights] = React.useState<Record<string, number>>(() => {
        const known: Record<string, number> = {};
        for (const id of ids) {
            const height = heightCache.get(id);
            if (height !== undefined) known[id] = height;
        }
        return known;
    });
    const heightsRef = React.useRef(heights);
    const order = useSharedValue(ids);
    const sharedHeights = useSharedValue(heights);
    const dragging = useSharedValue<string | null>(null);
    const dragY = useSharedValue(0);
    const startY = useSharedValue(0);
    const startOrder = useSharedValue<string[]>(ids);
    const drag = React.useMemo<DragState>(
        () => ({ order, heights: sharedHeights, dragging, dragY, startY, startOrder }),
        [order, sharedHeights, dragging, dragY, startY, startOrder],
    );
    const setScrollLocked = React.useContext(SessionListScrollLockContext);
    const draggingRef = React.useRef(false);
    const dragEndedAt = React.useRef(0);
    const latestIds = React.useRef(ids);
    latestIds.current = ids;
    // Read through a ref: rebuilding a row's gesture mid-drag — any session
    // update re-renders the group — would cancel the drag in progress.
    const onReorderRef = React.useRef(onReorder);
    onReorderRef.current = onReorder;

    // Touch in a browser: rows keep `touch-action: pan-y` so a plain swipe
    // still scrolls the list — which also lets the browser start scrolling as
    // soon as a held row begins to move, cancelling the drag. While a drag is
    // on, its touchmoves are swallowed instead.
    React.useEffect(() => {
        if (Platform.OS !== 'web' || dragWithMouse || typeof document === 'undefined') return;
        const holdStill = (event: TouchEvent) => {
            if (dragging.value !== null) event.preventDefault();
        };
        document.addEventListener('touchmove', holdStill, { passive: false });
        return () => document.removeEventListener('touchmove', holdStill);
    }, [dragging]);

    // Take the parent's order whenever it changes, unless a drag owns the rows.
    const idsKey = ids.join('\n');
    React.useEffect(() => {
        if (!draggingRef.current) order.value = latestIds.current;
    }, [idsKey, order]);

    const onRowLayout = React.useCallback((id: string, height: number) => {
        heightCache.set(id, height);
        if (heightsRef.current[id] === height) return;
        heightsRef.current = { ...heightsRef.current, [id]: height };
        sharedHeights.value = heightsRef.current;
        setHeights(heightsRef.current);
    }, [sharedHeights]);

    const onDragStart = React.useCallback(() => {
        draggingRef.current = true;
        // Native only. A web list already stops scrolling through the touchmove
        // guard above, and disabling it means switching its overflow to hidden
        // mid-touch — iOS Safari then cancels the touch, ending the drag.
        if (Platform.OS !== 'web') {
            setScrollLocked(true);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
    }, [setScrollLocked]);

    const onDragEnd = React.useCallback((finalOrder: string[], movedId: string, changed: boolean) => {
        draggingRef.current = false;
        dragEndedAt.current = Date.now();
        if (Platform.OS !== 'web') setScrollLocked(false);
        if (changed) {
            onReorderRef.current(finalOrder, movedId);
        } else {
            // Sessions may have come or gone while the drag held the rows.
            order.value = latestIds.current;
        }
    }, [order, setScrollLocked]);

    const pressGuard = React.useCallback(
        () => draggingRef.current || Date.now() - dragEndedAt.current < 400,
        [],
    );

    const totalHeight = ids.reduce((sum, id) => sum + (heights[id] ?? ESTIMATED_ROW_HEIGHT), 0);

    return (
        <PressGuardContext.Provider value={pressGuard}>
            <View style={{ height: totalHeight }}>
                {sessions.map((session, index) => (
                    <SortableRow
                        key={session.id}
                        id={session.id}
                        enabled={enabled}
                        drag={drag}
                        onLayout={onRowLayout}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                    >
                        {renderRow(session, index)}
                    </SortableRow>
                ))}
            </View>
        </PressGuardContext.Provider>
    );
}

function SortableRow({ id, enabled, drag, onLayout, onDragStart, onDragEnd, children }: {
    id: string;
    enabled: boolean;
    drag: DragState;
    onLayout: (id: string, height: number) => void;
    onDragStart: () => void;
    onDragEnd: (finalOrder: string[], movedId: string, changed: boolean) => void;
    children: React.ReactNode;
}) {
    const { order, heights, dragging, dragY, startY, startOrder } = drag;

    const gesture = React.useMemo(() => {
        const settle = () => {
            'worklet';
            dragY.value = withTiming(offsetOf(order.value, heights.value, id), { duration: 120 }, () => {
                const changed = order.value.join('\n') !== startOrder.value.join('\n');
                dragging.value = null;
                runOnJS(onDragEnd)(order.value, id, changed);
            });
        };
        const pan = Gesture.Pan()
            .enabled(enabled)
            .onStart(() => {
                startOrder.value = order.value;
                startY.value = offsetOf(order.value, heights.value, id);
                dragY.value = startY.value;
                dragging.value = id;
                runOnJS(onDragStart)();
            })
            .onUpdate((event) => {
                if (dragging.value !== id) return;
                const height = heights.value[id] ?? ESTIMATED_ROW_HEIGHT;
                let total = 0;
                for (const other of order.value) total += heights.value[other] ?? ESTIMATED_ROW_HEIGHT;
                // Stays inside its own group: other groups are other cards.
                const y = Math.min(Math.max(startY.value + event.translationY, 0), Math.max(0, total - height));
                dragY.value = y;
                const slot = slotAt(order.value, heights.value, id, y + height / 2);
                if (slot !== order.value.indexOf(id)) {
                    const next = order.value.filter((other) => other !== id);
                    next.splice(slot, 0, id);
                    order.value = next;
                }
            })
            // Ended or cancelled alike: when the system takes the touch away
            // mid-drag, the row stays where it had got to rather than
            // snapping back.
            .onEnd(() => {
                if (dragging.value === id) settle();
            });
        return dragWithMouse
            ? pan.mouseButton(MouseButton.LEFT).activeOffsetY([-4, 4])
            : pan.activateAfterLongPress(350);
    }, [enabled, id, order, heights, dragging, dragY, startY, startOrder, onDragStart, onDragEnd]);

    const style = useAnimatedStyle(() => {
        const lifted = dragging.value === id;
        const y = lifted ? dragY.value : offsetOf(order.value, heights.value, id);
        return {
            zIndex: lifted ? 1 : 0,
            elevation: lifted ? 6 : 0,
            shadowOpacity: withTiming(lifted ? 0.2 : 0, { duration: 120 }),
            transform: [
                // Rows a drag passes slide aside; at rest they go straight to
                // their offset, so first layout and re-sorts don't animate.
                { translateY: lifted || dragging.value === null ? y : withTiming(y, { duration: 150 }) },
                { scale: withTiming(lifted ? 1.02 : 1, { duration: 120 }) },
            ],
        };
    });

    return (
        // Touch on web keeps native vertical scrolling over the rows; a drag
        // there starts only from a long press that hasn't moved yet (see the
        // touchmove guard in SortableSessionRows).
        <GestureDetector gesture={gesture} touchAction={dragWithMouse ? undefined : 'pan-y'}>
            <Animated.View
                onLayout={(event) => onLayout(id, event.nativeEvent.layout.height)}
                style={[rowStyle, style]}
            >
                {children}
            </Animated.View>
        </GestureDetector>
    );
}

const rowStyle = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
};
