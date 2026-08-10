/**
 * The cache lets a command skip the device listing, which is the largest single
 * piece of its latency. Getting the match wrong is worse than not trying: the
 * command fails against a dead id, then pays for the listing anyway.
 *
 * Re-enrolling a machine is what makes this real — it gets a fresh id while the
 * old entry keeps the same name, so two ids answer to one name until something
 * prunes the loser.
 */

import { describe, expect, it } from 'vitest';
import { pickCachedDeviceId } from './ssh';

const names = {
    'aaaa-1': 'mac mini',
    'bbbb-2': 'mac pro',
    'cccc-3': '198',
};

describe('pickCachedDeviceId', () => {
    it('takes an exact id straight through', () => {
        expect(pickCachedDeviceId(names, 'bbbb-2')).toBe('bbbb-2');
    });

    it('matches a name exactly, then by prefix, then anywhere', () => {
        expect(pickCachedDeviceId(names, 'mac pro')).toBe('bbbb-2');
        expect(pickCachedDeviceId(names, 'MAC PRO')).toBe('bbbb-2');
        expect(pickCachedDeviceId(names, '198')).toBe('cccc-3');
        expect(pickCachedDeviceId(names, 'mini')).toBe('aaaa-1');
    });

    it('refuses a prefix that fits two devices', () => {
        // "mac" is both of them; guessing would be a coin flip.
        expect(pickCachedDeviceId(names, 'mac')).toBeNull();
    });

    it('refuses a name left behind by a re-enrolled machine', () => {
        const stale = { ...names, 'dddd-4': 'mac mini' };
        expect(pickCachedDeviceId(stale, 'mac mini')).toBeNull();
    });

    it('still resolves the survivor once the stale entry is pruned', () => {
        expect(pickCachedDeviceId(names, 'mac mini')).toBe('aaaa-1');
    });

    it('prefers an exact name over a longer one that merely contains it', () => {
        const overlapping = { 'aaaa-1': 'web', 'bbbb-2': 'web-staging' };
        expect(pickCachedDeviceId(overlapping, 'web')).toBe('aaaa-1');
    });

    it('returns null for an unknown device rather than the closest guess', () => {
        expect(pickCachedDeviceId(names, 'nothing like this')).toBeNull();
        expect(pickCachedDeviceId({}, 'mac mini')).toBeNull();
    });
});
