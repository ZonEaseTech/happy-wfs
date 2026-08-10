import { Dimensions, Platform } from 'react-native';
import { getDeviceType } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';

/**
 * Above this viewport width the content column widens from 1000 to 1200.
 *
 * Sized off the sidebar: a laptop display leaves ~1200pt beside it, so a 1200
 * column runs edge to edge there with no breathing room — the reason 1200 has
 * to stay off MacBook-class screens. 1800 keeps every built-in Mac display
 * (16" is 1728pt) on the narrower column and starts the wider one at the 1920pt
 * external monitors that actually have the room.
 */
const WIDE_VIEWPORT_MIN_WIDTH = 1800;

/** Content column for tablets and web, chosen by how much room the viewport has. */
function responsiveContentWidth(): number {
    return Dimensions.get('window').width >= WIDE_VIEWPORT_MIN_WIDTH ? 1200 : 1000;
}

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

    // Header tracks the content area, so it uses the same responsive width.
    return responsiveContentWidth();
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

    return responsiveContentWidth();
}

export const layout = {
    maxWidth: getMaxLayoutWidth(),
    headerMaxWidth: getMaxWidth()
}