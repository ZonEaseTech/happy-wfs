import * as React from 'react';
import { View, TextInput, Pressable, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';

/**
 * Edit the user-level worktree branch prefix used when creating new worktrees
 * from the new-session wizard. e.g. "vk/" → real branch "vk/clever-ocean".
 */
export default function WorktreeConfigScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [stored, setStored] = useLocalSettingMutable('worktreeBranchPrefix');
    const [value, setValue] = React.useState(stored ?? '');

    React.useEffect(() => {
        setValue(stored ?? '');
    }, [stored]);

    const handleSave = React.useCallback(() => {
        setStored(value.trim());
        router.back();
    }, [value, setStored, router]);

    const examplePreview = React.useMemo(() => {
        const trimmed = value.trim();
        return `${trimmed}clever-ocean`;
    }, [value]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            <Stack.Screen
                options={{
                    title: t('worktreeConfig.title'),
                    headerRight: () => (
                        <Pressable
                            onPress={handleSave}
                            style={{ paddingHorizontal: 12, paddingVertical: 4 }}
                        >
                            <Text style={{
                                color: theme.colors.button.primary.background,
                                fontSize: 16,
                                fontWeight: '600',
                                ...Typography.default('semiBold'),
                            }}>
                                {t('worktreeConfig.save')}
                            </Text>
                        </Pressable>
                    ),
                }}
            />
            <ItemList style={{ paddingTop: 0 }}>
                <ItemGroup
                    title={t('worktreeConfig.title')}
                    footer={t('worktreeConfig.description')}
                >
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                        <TextInput
                            value={value}
                            onChangeText={setValue}
                            placeholder={t('worktreeConfig.placeholder')}
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                            style={{
                                fontSize: 16,
                                color: theme.colors.text,
                                paddingVertical: 8,
                                paddingHorizontal: 12,
                                borderWidth: Platform.select({ ios: 0.33, default: 1 }),
                                borderColor: theme.colors.divider,
                                borderRadius: 8,
                                backgroundColor: theme.colors.surfaceHigh,
                                ...Typography.mono(),
                            }}
                        />
                    </View>
                </ItemGroup>

                <ItemGroup title={t('worktreeConfig.previewTitle')}>
                    <View style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                    }}>
                        <Ionicons
                            name="git-branch-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                            style={{ marginRight: 8 }}
                        />
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.text,
                            ...Typography.mono(),
                        }}>
                            {examplePreview}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        </View>
    );
}
