import { describe, expect, it } from 'vitest';
import { filterActionMenuItems } from './actionMenuSearch';

describe('filterActionMenuItems', () => {
    const items = [
        { label: 'develop' },
        { label: 'feature/brand-purchase-stock-reservation-sync' },
        { label: 'backup/is-wrap-before-v24-merge' },
        { label: 'feature/another-branch' },
    ];

    it('keeps all items when the query is empty', () => {
        expect(filterActionMenuItems(items, '')).toBe(items);
        expect(filterActionMenuItems(items, '   ')).toBe(items);
    });

    it('filters items by label ignoring case and surrounding spaces', () => {
        expect(filterActionMenuItems(items, ' BRAND ')).toEqual([
            { label: 'feature/brand-purchase-stock-reservation-sync' },
        ]);
    });

    it('preserves the original order for matching branches', () => {
        expect(filterActionMenuItems(items, 'feature')).toEqual([
            { label: 'feature/brand-purchase-stock-reservation-sync' },
            { label: 'feature/another-branch' },
        ]);
    });
});
