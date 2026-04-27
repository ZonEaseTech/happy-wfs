import * as React from 'react';
import { View, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

interface ResizableHandleProps {
    /** Where the handle sits relative to its absolutely-positioned parent column. */
    side: 'left' | 'right';
    /** Current width in px (read-only display). */
    width: number;
    /** Min/max clamp. */
    minWidth: number;
    maxWidth: number;
    /** Live updates while dragging. */
    onResize: (next: number) => void;
    /** Final value on release — persist here. */
    onCommit: (next: number) => void;
}

const HANDLE_THICKNESS = 4;

/**
 * Vertical drag handle for a column. Web-only — renders nothing on native.
 * Place inside the column you want resized; position absolute on `side`.
 */
export const ResizableHandle = React.memo(function ResizableHandle({ side, width, minWidth, maxWidth, onResize, onCommit }: ResizableHandleProps) {
    const { theme } = useUnistyles();
    const [hover, setHover] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const startRef = React.useRef<{ x: number; w: number } | null>(null);

    if (Platform.OS !== 'web') return null;

    const beginDrag = (e: any) => {
        startRef.current = { x: e.clientX ?? 0, w: width };
        setDragging(true);
        e.preventDefault?.();

        const onMove = (ev: MouseEvent) => {
            if (!startRef.current) return;
            const delta = ev.clientX - startRef.current.x;
            // Right-side handle: drag right = wider. Left-side handle: drag right = narrower.
            const next = side === 'right'
                ? startRef.current.w + delta
                : startRef.current.w - delta;
            const clamped = Math.max(minWidth, Math.min(maxWidth, next));
            onResize(clamped);
        };

        const onUp = (ev: MouseEvent) => {
            if (startRef.current) {
                const delta = ev.clientX - startRef.current.x;
                const next = side === 'right'
                    ? startRef.current.w + delta
                    : startRef.current.w - delta;
                const clamped = Math.max(minWidth, Math.min(maxWidth, next));
                onCommit(clamped);
            }
            startRef.current = null;
            setDragging(false);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <View
            {...({ onMouseDown: beginDrag, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } as any)}
            style={[
                {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: HANDLE_THICKNESS,
                    zIndex: 10,
                    backgroundColor: hover || dragging ? theme.colors.button.primary.background : 'transparent',
                    opacity: hover || dragging ? 0.5 : 1,
                },
                side === 'left' ? { left: 0 } : { right: 0 },
                { cursor: "col-resize" } as any,
            ]}
        />
    );
});
