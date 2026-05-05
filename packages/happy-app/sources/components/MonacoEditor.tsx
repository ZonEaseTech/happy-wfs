import * as React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';

export interface MonacoEditorProps {
    value: string;
    onChange?: (v: string) => void;
    path: string;
    readOnly?: boolean;
    theme?: 'vs-dark' | 'vs';
    height?: number | string;
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
