import { describe, expect, it } from 'vitest';
import {
    getBugCreateImageCountLabel,
    getBugCreatePreviewTitle,
    getBugCreateRemainingImageSlots,
    isBugCreateSubmitEnabled,
} from './bugReportCreatePresentation';

describe('bug report create presentation', () => {
    it('uses the issue description to build the submit preview title', () => {
        expect(getBugCreatePreviewTitle('  支付成功后订单状态没有刷新，仍然显示待支付  ', '等待填写问题说明'))
            .toBe('支付成功后订单状态没有刷新，仍然显示待支付');
    });

    it('falls back to an empty-state title before the user writes the issue', () => {
        expect(getBugCreatePreviewTitle('   ', '等待填写问题说明')).toBe('等待填写问题说明');
    });

    it('formats and clamps the screenshot counter for the create composer', () => {
        expect(getBugCreateImageCountLabel(4, 10)).toBe('4/10');
        expect(getBugCreateImageCountLabel(12, 10)).toBe('10/10');
        expect(getBugCreateRemainingImageSlots(12, 10)).toBe(0);
    });

    it('requires problem content before enabling submit', () => {
        expect(isBugCreateSubmitEnabled('', false)).toBe(false);
        expect(isBugCreateSubmitEnabled('  ', false)).toBe(false);
        expect(isBugCreateSubmitEnabled('问题说明', true)).toBe(false);
        expect(isBugCreateSubmitEnabled('问题说明', false)).toBe(true);
    });
});
