import * as React from 'react';
import { View } from 'react-native';
import { ResourceCenterView } from '@/components/ResourceCenterView';

/** Resource center: keys, their usage, and the device list. */
export default React.memo(function DevicesPage() {
    return (
        <View style={{ flex: 1 }}>
            <ResourceCenterView />
        </View>
    );
});
