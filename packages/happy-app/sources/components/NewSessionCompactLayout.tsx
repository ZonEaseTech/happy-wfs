import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

export interface NewSessionCompactLayoutProps {
    machine: React.ReactNode;
    profile: React.ReactNode;
    warnings?: React.ReactNode;
    directory?: React.ReactNode;
    sessionType: React.ReactNode;
    repositories?: React.ReactNode;
    composer: React.ReactNode;
    banner?: React.ReactNode;
}

/**
 * Presentation only: arrange the existing new-session controls without owning
 * their state, validation, navigation, or session-creation behavior.
 */
export const NewSessionCompactLayout = React.memo(function NewSessionCompactLayout({
    machine,
    profile,
    warnings,
    directory,
    sessionType,
    repositories,
    composer,
    banner,
}: NewSessionCompactLayoutProps) {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const narrow = width <= 700;
    const spacing = narrow ? 12 : 16;

    return (
        <View
            testID="new-session-compact-layout"
            style={{
                width: '100%',
                maxWidth: 900,
                alignSelf: 'center',
                backgroundColor: theme.colors.surface,
                paddingHorizontal: spacing,
                paddingVertical: spacing,
                gap: spacing,
            }}
        >
            {banner ? <View testID="compact-banner">{banner}</View> : null}

            <View
                testID="compact-machine-profile-row"
                style={{
                    flexDirection: narrow ? 'column' : 'row',
                    alignItems: 'stretch',
                    gap: spacing,
                }}
            >
                <View
                    testID="compact-machine"
                    style={{ flex: narrow ? undefined : 1, minWidth: 0 }}
                >
                    {machine}
                </View>
                <View
                    testID="compact-profile"
                    style={{ flex: narrow ? undefined : 1, minWidth: 0 }}
                >
                    {profile}
                </View>
            </View>

            {warnings ? <View testID="compact-warnings">{warnings}</View> : null}
            {directory ? <View testID="compact-directory">{directory}</View> : null}

            <View testID="compact-session-mode">{sessionType}</View>

            {repositories ? <View testID="compact-repositories">{repositories}</View> : null}

            <View testID="compact-composer">{composer}</View>
        </View>
    );
});
