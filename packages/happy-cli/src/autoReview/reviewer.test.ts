import { describe, expect, it } from 'vitest'
import { buildReviewerPrompt, buildReviewerSpawnArgs, formatFollowUpMessage, parseReviewResult, shouldSendFollowUp } from './reviewer'

describe('parseReviewResult', () => {
  it('parses fenced json', () => {
    const result = parseReviewResult('```json\n{"status":"needs_follow_up","summary":"miss","missing":["补测试"],"evidence":["无测试输出"],"confidence":"high"}\n```')
    expect(result.status).toBe('needs_follow_up')
    expect(result.missing).toEqual(['补测试'])
  })

  it('returns uncertain when output is not json', () => {
    const result = parseReviewResult('not json')
    expect(result.status).toBe('uncertain')
    expect(result.confidence).toBe('low')
  })
})

describe('formatFollowUpMessage', () => {
  it('formats actionable missing items', () => {
    const text = formatFollowUpMessage({
      status: 'needs_follow_up',
      summary: 'miss',
      missing: ['补测试', '补 i18n'],
      evidence: [],
      confidence: 'high',
    })
    expect(text).toContain('自动完成度审查发现以下漏项')
    expect(text).toContain('1. 补测试')
  })
})

describe('shouldSendFollowUp', () => {
  it('only sends high or medium confidence actionable needs_follow_up results', () => {
    expect(shouldSendFollowUp({ status: 'needs_follow_up', summary: 'miss', missing: ['补测试'], evidence: [], confidence: 'medium' })).toBe(true)
    expect(shouldSendFollowUp({ status: 'needs_follow_up', summary: 'miss', missing: ['补测试'], evidence: [], confidence: 'low' })).toBe(false)
    expect(shouldSendFollowUp({ status: 'pass', summary: 'ok', missing: [], evidence: [], confidence: 'high' })).toBe(false)
  })
})

describe('buildReviewerPrompt', () => {
  it('contains strict scope instructions', () => {
    const prompt = buildReviewerPrompt({ issue: 'issue', requirements: 'req', plans: 'plan', transcript: 'chat', git: 'diff', completionClaim: 'done', uiPrototypeReferences: '原型 https://example.com/supervisor/1' })
    expect(prompt).toContain('只审查代码完成度')
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('代码层面')
    expect(prompt).toContain('supervisor/1')
  })
})


describe('buildReviewerSpawnArgs', () => {
  it('uses a read-only sandbox instead of dangerous bypass', () => {
    const args = buildReviewerSpawnArgs('/repo')
    expect(args).toContain('read-only')
    expect(args).toContain('/repo')
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })
})
