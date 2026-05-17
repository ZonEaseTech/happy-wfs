// Web-only fullscreen zoom/pan viewer for Mermaid diagram SVGs.
// Rendered via createPortal into document.body so it sits above everything.
// Supports: wheel zoom (toward cursor), click-drag pan, +/− buttons,
// reset button, close button, Escape key, and backdrop click to close.
// svgContent is produced by the mermaid library (same source as the inline
// render), not raw user input.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Ionicons } from '@expo/vector-icons';

export interface MermaidZoomViewerProps {
    svgContent: string;
    onClose: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.2;

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

export function MermaidZoomViewer({ svgContent, onClose }: MermaidZoomViewerProps): React.ReactElement | null {
    const [scale, setScale] = React.useState(1);
    const [translate, setTranslate] = React.useState({ x: 0, y: 0 });
    const draggingRef = React.useRef(false);
    const lastPointerRef = React.useRef({ x: 0, y: 0 });
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    React.useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    const handleWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;

        setScale(prev => {
            const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
            const next = clamp(prev + delta, MIN_SCALE, MAX_SCALE);
            const ratio = next / prev - 1;
            setTranslate(t => ({
                x: t.x - cursorX * ratio,
                y: t.y - cursorY * ratio,
            }));
            return next;
        });
    }, []);

    const handlePointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        draggingRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - lastPointerRef.current.x;
        const dy = e.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        setTranslate(t => ({ x: t.x + dx, y: t.y + dy }));
    }, []);

    const handlePointerUp = React.useCallback(() => {
        draggingRef.current = false;
    }, []);

    const handleZoomIn = React.useCallback(() => {
        setScale(prev => clamp(prev + ZOOM_STEP, MIN_SCALE, MAX_SCALE));
    }, []);

    const handleZoomOut = React.useCallback(() => {
        setScale(prev => clamp(prev - ZOOM_STEP, MIN_SCALE, MAX_SCALE));
    }, []);

    const handleReset = React.useCallback(() => {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
    }, []);

    const handleBackdropClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    const overlayStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    };

    const diagramContainerStyle: React.CSSProperties = {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        overflow: 'hidden',
    };

    const svgWrapperStyle: React.CSSProperties = {
        transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
        transformOrigin: 'center center',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
    };

    const toolbarStyle: React.CSSProperties = {
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 1,
        backgroundColor: 'rgba(30, 30, 30, 0.85)',
        borderRadius: 10,
        padding: '6px 10px',
        backdropFilter: 'blur(4px)',
    };

    const btnStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        borderRadius: 6,
    };

    const dividerStyle: React.CSSProperties = {
        width: 1,
        height: 20,
        backgroundColor: 'rgba(255,255,255,0.15)',
        margin: '0 2px',
    };

    /* eslint-disable @typescript-eslint/ban-ts-comment */
    const content = (
        // @ts-ignore - Web only
        <div style={overlayStyle} onClick={handleBackdropClick}>
            {/* @ts-ignore - Web only */}
            <div style={toolbarStyle}>
                {/* @ts-ignore - Web only */}
                <button style={btnStyle} onClick={handleZoomIn} title="Zoom in">
                    <Ionicons name="add" size={20} color="#e0e0e0" />
                </button>
                {/* @ts-ignore - Web only */}
                <button style={btnStyle} onClick={handleZoomOut} title="Zoom out">
                    <Ionicons name="remove" size={20} color="#e0e0e0" />
                </button>
                {/* @ts-ignore - Web only */}
                <div style={dividerStyle} />
                {/* @ts-ignore - Web only */}
                <button style={btnStyle} onClick={handleReset} title="Reset view">
                    <Ionicons name="contract-outline" size={20} color="#e0e0e0" />
                </button>
                {/* @ts-ignore - Web only */}
                <div style={dividerStyle} />
                {/* @ts-ignore - Web only */}
                <button style={btnStyle} onClick={onClose} title="Close">
                    <Ionicons name="close" size={20} color="#e0e0e0" />
                </button>
            </div>
            {/* @ts-ignore - Web only */}
            <div
                ref={containerRef}
                style={diagramContainerStyle}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                {/* svgContent is mermaid-generated SVG, not user HTML */}
                {/* @ts-ignore - Web only */}
                <div
                    style={svgWrapperStyle}
                    // nosec - svgContent is produced by the mermaid library render() call
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                />
            </div>
        </div>
    );

    return createPortal(content, document.body);
}
