// Native fallback. The fullscreen Mermaid zoom/pan viewer is web-only.
// Mirrors the FileViewerModal / Terminal pattern (MermaidZoomViewer.web.tsx +
// this null fallback selected by Metro/Expo platform resolver).

export interface MermaidZoomViewerProps {
    svgContent: string;
    onClose: () => void;
}

export function MermaidZoomViewer(_props: MermaidZoomViewerProps): null {
    return null;
}
