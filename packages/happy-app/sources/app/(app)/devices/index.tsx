import * as React from 'react';
import { View } from 'react-native';
import { DeviceManagementView } from '@/components/DeviceManagementView';

export default React.memo(function DevicesPage() {
    return (
        <View style={{ flex: 1 }}>
            <DeviceManagementView />
        </View>
    );
});
