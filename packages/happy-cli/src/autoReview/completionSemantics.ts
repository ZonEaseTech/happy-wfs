const COMPLETION_PATTERNS = [
  /(^|[\s，。！？,.!?])已完成([\s，。！？,.!?]|$)/i,
  /修复完成/i,
  /验证通过/i,
  /已验证/i,
  /请确认/i,
  /可以提交/i,
  /可以归档/i,
  /待确认/i,
  /\bdone\b/i,
  /\bcompleted\b/i,
  /\bfixed\b/i,
  /\bverified\b/i,
  /ready for review/i,
  /ready to merge/i,
  /please confirm/i,
]

const NON_COMPLETION_PATTERNS = [
  /准备.*完成/,
  /计划.*完成/,
  /需要.*完成/,
  /todo/i,
]

function collectText(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output)
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'text' || key === 'message' || key === 'output_text' || key === 'content') {
      collectText(child, output)
      continue
    }
    if (key === 'data' || key === 'item' || key === 'parts') collectText(child, output)
  }
}

export function normalizeReviewableAgentText(payload: unknown): string {
  const parts: string[] = []
  collectText(payload, parts)
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join('\n').trim()
}

export function hasCompletionSemantics(text: string, customPhrases?: string[]): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (NON_COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  const phrases = customPhrases?.map((phrase) => phrase.trim()).filter(Boolean) ?? []
  if (phrases.some((phrase) => normalized.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()))) return true
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized))
}
