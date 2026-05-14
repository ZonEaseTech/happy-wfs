import * as React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../../tools/ToolSectionView';
import { ToolInputView } from '@/components/KeyValueView';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { resolveMarkdownImageReference } from '@/components/markdown/markdownLinkUtils';

export const ViewImageToolView = React.memo<ToolViewProps>(({ tool, metadata, sessionId }) => {
    const router = useRouter();
    const imagePath = typeof tool.input?.path === 'string' ? tool.input.path : '';
    const imageLink = React.useMemo(() => {
        if (!imagePath) return null;
        return resolveMarkdownImageReference({
            rawText: imagePath,
            sessionId,
            sessionWorkingDirectory: metadata?.path,
            sessionHomeDirectory: metadata?.homeDir,
            machineId: metadata?.machineId,
        });
    }, [imagePath, metadata?.homeDir, metadata?.machineId, metadata?.path, sessionId]);

    const openImage = React.useCallback(() => {
        if (!imageLink?.href) return;
        router.push(imageLink.href as never);
    }, [imageLink?.href, router]);

    if (!imagePath || !imageLink) {
        return (
            <ToolSectionView title={t('toolView.input')}>
                <ToolInputView input={tool.input} toolName={tool.name} />
            </ToolSectionView>
        );
    }

    return (
        <ToolSectionView title={t('toolView.input')}>
            <View style={styles.container}>
                <TouchableOpacity style={styles.row} onPress={openImage} activeOpacity={0.65}>
                    <Text style={styles.key} numberOfLines={1}>path</Text>
                    <Text style={styles.linkValue} selectable>{imagePath}</Text>
                </TouchableOpacity>
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 6,
        overflow: 'hidden',
    },
    row: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    key: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.mono('semiBold'),
    },
    linkValue: {
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textLink,
        textDecorationLine: 'underline',
        ...Typography.mono(),
    },
}));
