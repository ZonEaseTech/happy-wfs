import * as React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';

export interface MonacoEditorProps {
    value: string;
    onChange?: (v: string) => void;
    path: string;
    readOnly?: boolean;
    theme?: 'vs-dark' | 'vs';
    height?: number | string;
    /** Web-only escape hatch for the monaco editor instance — ignored on native. */
    onMount?: (editor: unknown) => void;
    /** Web-only font size override — ignored on native fallback. */
    fontSize?: number;
}

export function MonacoEditor({ value, height }: MonacoEditorProps) {
    return (
        <ScrollView style={[styles.container, typeof height === 'number' ? { height } : undefined]}>
            <Text style={styles.text} selectable>
                {value}
            </Text>
        </ScrollView>
    );
}

// Keep the API symmetric with MonacoEditor.web.tsx so consumers can `import { inferLanguage }`
// without platform-specific guards. Native has no Monaco, so we don't need real inference.
export function inferLanguage(_path: string): string {
    return 'plaintext';
}

export default MonacoEditor;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1e1e1e',
        padding: 12,
    },
    text: {
        color: '#d4d4d4',
        fontFamily: 'Menlo',
        fontSize: 12,
    },
});
