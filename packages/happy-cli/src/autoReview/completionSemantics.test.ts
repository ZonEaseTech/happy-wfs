import { describe, expect, it } from 'vitest'
import { hasCompletionSemantics, normalizeReviewableAgentText } from './completionSemantics'

describe('hasCompletionSemantics', () => {
  it('matches Chinese completion claims', () => {
    expect(hasCompletionSemantics('已经修复完成，验证通过，请确认。')).toBe(true)
  })

  it('matches English completion claims', () => {
    expect(hasCompletionSemantics('All fixed and ready for review.')).toBe(true)
  })

  it('does not match planning text', () => {
    expect(hasCompletionSemantics('我准备开始修复，先看一下文件。')).toBe(false)
  })
})

describe('normalizeReviewableAgentText', () => {
  it('extracts acp message text', () => {
    expect(normalizeReviewableAgentText({ type: 'message', message: 'done' })).toBe('done')
  })

  it('extracts codex output text', () => {
    expect(normalizeReviewableAgentText({ item: { type: 'message', content: [{ type: 'output_text', text: 'completed' }] } })).toContain('completed')
  })

  it('extracts nested Gemini style parts text without duplicating identical fragments', () => {
    expect(normalizeReviewableAgentText({ data: { parts: [{ text: 'verified' }, { text: 'verified' }] } })).toBe('verified')
  })
})
