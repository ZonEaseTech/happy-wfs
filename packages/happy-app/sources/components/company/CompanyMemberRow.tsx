import React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Avatar } from '@/components/Avatar';
import { Item } from '@/components/Item';
import { t } from '@/text';
import type { CompanyMember } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from './companyRole';

function getMemberName(member: CompanyMember) {
    return [member.profile.firstName, member.profile.lastName].filter(Boolean).join(' ') || member.profile.username || member.profile.id;
}

export function CompanyMemberRow({ member, onPress }: { member: CompanyMember; onPress?: () => void }) {
    const avatar = member.profile.avatar;
    return (
        <Item
            title={getMemberName(member)}
            subtitle={member.profile.username ? `@${member.profile.username}` : member.profile.id}
            leftElement={<Avatar id={member.accountId} size={40} imageUrl={avatar?.url || avatar?.path} thumbhash={avatar?.thumbhash} />}
            rightElement={<View style={styles.badge}><Text style={styles.badgeText}>{t(getCompanyRoleLabelKey(member.role))}</Text></View>}
            onPress={onPress}
            showChevron={!!onPress}
            iconContainerStyle={{ marginRight: 20 }}
        />
    );
}

const styles = StyleSheet.create((theme) => ({
    badge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    badgeText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
}));
