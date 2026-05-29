import { describe, expect, it, vi } from 'vitest'
import { AutoReviewGuard } from './AutoReviewGuard'

const enabledMetadata = () => ({
  path: '/repo',
  host: 'h',
  homeDir: '',
  happyHomeDir: '',
  happyLibDir: '',
  happyToolsDir: '',
  autoReviewGuard: { enabled: true },
})

describe('AutoReviewGuard', () => {
  it('does not trigger when disabled', () => {
    const run = vi.fn()
    const guard = new AutoReviewGuard({
      getMetadata: () => ({ ...enabledMetadata(), autoReviewGuard: { enabled: false } }),
      updateGuard: vi.fn(),
      collectAndReview: run,
      sendFollowUp: vi.fn(),
      delayMs: 1,
    })

    guard.onAgentText('完成了', 'm1')

    expect(run).not.toHaveBeenCalled()
  })

  it('can be manually triggered even when automatic listening is disabled', async () => {
    const collectAndReview = vi.fn(async () => ({ status: 'pass' as const, summary: 'ok', missing: [], evidence: [], confidence: 'high' as const }))
    const updateGuard = vi.fn()
    const guard = new AutoReviewGuard({
      getMetadata: () => ({ ...enabledMetadata(), autoReviewGuard: { enabled: false } }),
      updateGuard,
      collectAndReview,
      sendFollowUp: vi.fn(),
      delayMs: 1,
    })

    await guard.runManual({
      enabled: false,
      settings: {
        reviewPrompt: 'manual prompt',
        followUpTemplate: 'manual follow up',
        sendSimplifyOnPass: false,
      },
      completionClaim: 'manual review requested',
      messageId: 'manual-1',
    })

    expect(collectAndReview).toHaveBeenCalledWith('manual review requested')
    expect(updateGuard).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      status: 'reviewing',
      reviewPrompt: 'manual prompt',
      followUpTemplate: 'manual follow up',
      sendSimplifyOnPass: false,
    }))
    expect(updateGuard).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      status: 'passed',
      lastTriggeredMessageId: 'manual-1',
    }))
  })

  it('schedules when enabled and text has completion semantics', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => ({ status: 'pass' as const, summary: 'ok', missing: [], evidence: [], confidence: 'high' as const }))
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard: vi.fn(),
      collectAndReview: run,
      sendFollowUp: vi.fn(),
      delayMs: 10,
    })

    guard.onAgentText('修复完成，验证通过', 'm1')
    await vi.advanceTimersByTimeAsync(11)

    expect(run).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })



  it('reviews first, then sends /simplify after a passing review', async () => {
    const sendSimplifyCheck = vi.fn(async () => {})
    const collectAndReview = vi.fn(async () => ({ status: 'pass' as const, summary: 'ok', missing: [], evidence: [], confidence: 'high' as const }))
    const updateGuard = vi.fn()
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard,
      collectAndReview,
      sendFollowUp: vi.fn(),
      sendSimplifyCheck,
      delayMs: 1,
    })

    guard.onAgentText('已完成，请确认', 'm1')
    await guard.runNowForTests()

    expect(collectAndReview).toHaveBeenCalledOnce()
    expect(sendSimplifyCheck).toHaveBeenCalledOnce()
    expect(updateGuard).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'passed',
      simplifyPending: true,
      lastSimplifySourceMessageId: 'm1',
    }))
  })

  it('does not re-review the first agent response after an auto /simplify', () => {
    const updateGuard = vi.fn()
    const collectAndReview = vi.fn(async () => ({ status: 'pass' as const, summary: 'ok', missing: [], evidence: [], confidence: 'high' as const }))
    const guard = new AutoReviewGuard({
      getMetadata: () => ({ ...enabledMetadata(), autoReviewGuard: { enabled: true, simplifyPending: true, status: 'passed' } }),
      updateGuard,
      collectAndReview,
      sendFollowUp: vi.fn(),
      sendSimplifyCheck: vi.fn(),
      delayMs: 1,
    })

    guard.onAgentText('simplify 检查完成，验证通过', 'm2')

    expect(collectAndReview).not.toHaveBeenCalled()
    expect(updateGuard).toHaveBeenCalledWith(expect.objectContaining({ simplifyPending: false, status: 'passed' }))
  })

  it('sends follow-up only for new actionable review fingerprint', async () => {
    const sendFollowUp = vi.fn(async (_text: string, _fingerprint: string) => {})
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard: vi.fn(),
      collectAndReview: vi.fn(async () => ({ status: 'needs_follow_up' as const, summary: 'miss', missing: ['补测试'], evidence: [], confidence: 'high' as const })),
      sendFollowUp,
      delayMs: 1,
    })

    guard.onAgentText('已完成', 'm1')
    await guard.runNowForTests()

    expect(sendFollowUp).toHaveBeenCalledOnce()
    expect(sendFollowUp.mock.calls[0][0]).toContain('补测试')
  })



  it('marks uncertain when follow-up send fails', async () => {
    const updateGuard = vi.fn()
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard,
      collectAndReview: vi.fn(async () => ({ status: 'needs_follow_up' as const, summary: 'miss', missing: ['补测试'], evidence: [], confidence: 'high' as const })),
      sendFollowUp: vi.fn(async () => { throw new Error('send failed') }),
      delayMs: 1,
    })

    guard.onAgentText('已完成', 'm1')
    await guard.runNowForTests()

    expect(updateGuard).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'uncertain',
      lastSummary: expect.stringContaining('send failed'),
    }))
  })

  it('marks uncertain when the reviewer throws', async () => {
    vi.useFakeTimers()
    const updateGuard = vi.fn()
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard,
      collectAndReview: vi.fn(async () => { throw new Error('reviewer unavailable') }),
      sendFollowUp: vi.fn(),
      delayMs: 10,
    })

    guard.onAgentText('修复完成，验证通过', 'm1')
    await vi.advanceTimersByTimeAsync(11)

    expect(updateGuard).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'uncertain',
      lastSummary: expect.stringContaining('reviewer unavailable'),
    }))
    vi.useRealTimers()
  })
})
