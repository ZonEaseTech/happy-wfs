import { Dimensions, Platform } from 'react-native';
import { getDeviceType } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';

// Calculate max width based on device type
function getMaxWidth(): number {
    const deviceType = getDeviceType();
    
    // For phones, use the max dimension (width or height)
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        const { width, height } = Dimensions.get('window');
        return Math.max(width, height);
    }

    if (isRunningOnMac()) {
        return Number.POSITIVE_INFINITY;
    }

    // For tablets and web, use 1000px so the header tracks the content area
    // (which was widened from 800 -> 1000 in the same commit family).
    return 1000;
}

// Calculate max width based on device type
function getMaxLayoutWidth(): number {
    const deviceType = getDeviceType();
    
    // For phones, use the max dimension (width or height)
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        const { width, height } = Dimensions.get('window');
        return Math.max(width, height);
    }

    if (isRunningOnMac()) {
        return 1400;
    }

    // For tablets and web, use 1000px (widened from 800 on user request to give
    // the chat content area more breathing room on PC web).
    return 1000;
}

export const layout = {
    maxWidth: getMaxLayoutWidth(),
    headerMaxWidth: getMaxWidth()
}