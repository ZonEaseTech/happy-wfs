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



  it('sends /simplify before reviewing the first completion claim', async () => {
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

    expect(sendSimplifyCheck).toHaveBeenCalledOnce()
    expect(collectAndReview).not.toHaveBeenCalled()
    expect(updateGuard).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'waiting',
      simplifyPending: true,
      lastSimplifySourceMessageId: 'm1',
    }))
  })

  it('reviews the next completion claim after /simplify is pending', async () => {
    const sendSimplifyCheck = vi.fn(async () => {})
    const collectAndReview = vi.fn(async () => ({ status: 'pass' as const, summary: 'ok', missing: [], evidence: [], confidence: 'high' as const }))
    const guard = new AutoReviewGuard({
      getMetadata: () => ({ ...enabledMetadata(), autoReviewGuard: { enabled: true, simplifyPending: true } }),
      updateGuard: vi.fn(),
      collectAndReview,
      sendFollowUp: vi.fn(),
      sendSimplifyCheck,
      delayMs: 1,
    })

    guard.onAgentText('simplify 检查完成，验证通过', 'm2')
    await guard.runNowForTests()

    expect(sendSimplifyCheck).not.toHaveBeenCalled()
    expect(collectAndReview).toHaveBeenCalledOnce()
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
