import * as React from 'react';
import { View } from 'react-native';
import { DeviceManagementView } from '@/components/DeviceManagementView';

/** Resource center › every device, with enrollment and MCP shares (the old device page). */
export default React.memo(function AllDevicesPage() {
    return (
        <View style={{ flex: 1 }}>
            <DeviceManagementView mode="all" />
        </View>
    );
});
