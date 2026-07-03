import { describe, expect, it } from 'vitest';

import { getMachineDisplayName } from './machineDisplay';

describe('getMachineDisplayName', () => {
    it('uses the host as the primary machine name when no custom display name exists', () => {
        expect(getMachineDisplayName({
            id: '5db3c505-b478-4091-8198-b4b01e61bb30',
            metadata: { host: 'wfs' },
        })).toBe('wfs');
    });

    it('does not show a UUID-like display name when a host is available', () => {
        expect(getMachineDisplayName({
            id: '5db3c505-b478-4091-8198-b4b01e61bb30',
            metadata: {
                displayName: '5db3c505-b478-4091-8198-b4b01e61bb30',
                host: 'wfs',
            },
        })).toBe('wfs');
    });
});
