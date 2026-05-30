import { describe, expect, it, vi } from 'vitest'
import { AutoReviewGuard } from './AutoReviewGuard'
import { hasCompletionSemantics } from './completionSemantics'

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

  it('ignores option prompts and auto review follow-up text that mention completion', () => {
    expect(hasCompletionSemantics('请选一个，别再让审查空转了。\n认可当前完成度：撤销暂存，等我审代码')).toBe(false)
    expect(hasCompletionSemantics('自动完成度审查发现以下漏项，请继续处理：\n1. 补证据')).toBe(false)
    expect(hasCompletionSemantics('下面 4 个口径请你定夺（已标准推荐项），定完我就给完整设计')).toBe(false)
    expect(hasCompletionSemantics('请确认这个方案是否可以')).toBe(false)
  })

  it('recognizes real completion claims with evidence or final handoff', () => {
    expect(hasCompletionSemantics('实现完成，typecheck 通过，请确认')).toBe(true)
    expect(hasCompletionSemantics('已验证，git status 干净，可以提交')).toBe(true)
    expect(hasCompletionSemantics('修复完成')).toBe(true)
  })

  it('treats custom trigger phrases as statement fallback, not substring matching', () => {
    expect(hasCompletionSemantics('当前代码完成度还不够', ['完成'])).toBe(false)
    expect(hasCompletionSemantics('完成', ['完成'])).toBe(true)
    expect(hasCompletionSemantics('构建通过，完成', ['完成'])).toBe(true)
  })

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


  it('does not send duplicate follow-up for the same actionable fingerprint in one guard lifecycle', async () => {
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
    guard.onAgentText('再次完成', 'm2')
    await guard.runNowForTests()

    expect(sendFollowUp).toHaveBeenCalledOnce()
  })


  it('does not send follow-up when an equivalent auto-review message already exists remotely', async () => {
    const sendFollowUp = vi.fn(async (_text: string, _fingerprint: string) => {})
    const guard = new AutoReviewGuard({
      getMetadata: enabledMetadata,
      updateGuard: vi.fn(),
      collectAndReview: vi.fn(async () => ({ status: 'needs_follow_up' as const, summary: 'miss', missing: ['补测试'], evidence: [], confidence: 'high' as const })),
      sendFollowUp,
      isDuplicateFollowUp: vi.fn(async () => true),
      delayMs: 1,
    })

    guard.onAgentText('已完成', 'm1')
    await guard.runNowForTests()

    expect(sendFollowUp).not.toHaveBeenCalled()
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
