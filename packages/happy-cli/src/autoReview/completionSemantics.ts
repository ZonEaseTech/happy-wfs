const NON_COMPLETION_PATTERNS = [
  /准备.*完成/,
  /计划.*完成/,
  /需要.*完成/,
  /todo/i,
  /自动完成度审查发现/,
  /审查范围[:：]/,
  /完成度|完成率/,
  /请选择|请选一个|请选择一个|请你定夺|你想打算怎么拆|要我.*吗[？?]?/,
]

const COMPLETION_CLAIM_PATTERNS = [
  /(实现|修复|调整|改动|处理|任务|功能|问题|代码|接口|页面|样式).{0,18}(完成|已完成|完成了)/i,
  /(已|已经).{0,12}(实现|修复|调整|处理|验证|测试|构建|build|typecheck|部署|发布|提交|推送)/i,
  /(验证|测试|typecheck|build|构建|部署|发布|提交|推送).{0,18}(通过|成功|完成|done)/i,
  /可以(提交|归档|合并|merge)/i,
  /ready for review|ready to merge/i,
  /\b(implemented|fixed|verified|completed|done)\b/i,
]

const HANDOFF_PATTERNS = [
  /(请|麻烦).{0,8}(确认|验收|检查|审阅|review)/i,
  /please confirm/i,
]

const COMPLETION_EVIDENCE_PATTERNS = [
  /git (status|diff|log|commit|push)/i,
  /commit\s+[0-9a-f]{7,40}/i,
  /PR|pull request|merge/i,
  /typecheck|build|test|lint|vitest|tsc|pytest|go test|cargo test/i,
  /验证|测试|构建|部署|发布|提交|推送|已生成|已修改|已实现|已修复|改动|变更/i,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseMatchesAsStatement(text: string, phrase: string): boolean {
  const normalizedPhrase = phrase.trim()
  if (!normalizedPhrase) return false
  const boundary = '[\\s，。！？,.!?；;：:\\n]'
  if (new RegExp(`(^|${boundary})${escapeRegExp(normalizedPhrase)}(${boundary}|$)`, 'i').test(text)) {
    return true
  }
  // Chinese trigger phrases are often embedded in a short sentence, e.g.
  // “我处理好了”. Keep this limited to longer custom phrases so generic
  // triggers like “完成” do not reintroduce noisy loops.
  return /[\u4e00-\u9fff]/.test(normalizedPhrase)
    && normalizedPhrase.length >= 3
    && text.length <= 32
    && text.includes(normalizedPhrase)
}


function hasCompletionEvidence(text: string): boolean {
  return COMPLETION_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text))
}

export function normalizeReviewableAgentText(payload: unknown): string {
  const parts: string[] = []
  collectText(payload, parts)
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join('\n').trim()
}

export function completionClaimFingerprint(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[0-9a-f]{7,40}/g, '<hash>')
    .trim()
    .slice(0, 2000)
}

export function hasCompletionSemantics(text: string, customPhrases?: string[]): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (NON_COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized))) return false

  const hasEvidence = hasCompletionEvidence(normalized)
  if (COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  if (HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return hasEvidence || /完成|已验证|已完成|修复|实现|验证|测试|提交|发布|部署|done|fixed|verified|completed/i.test(normalized)
  }

  const phrases = customPhrases?.map((phrase) => phrase.trim()).filter(Boolean) ?? []
  const hasCustomStatement = phrases.some((phrase) => phraseMatchesAsStatement(normalized, phrase))
  if (!hasCustomStatement) return false

  // Custom trigger phrases are a fallback only. Generic phrases like “完成”
  // must appear as a standalone statement and be accompanied by work evidence;
  // otherwise UI prompts such as “请选择完成度” or review messages loop forever.
  return hasEvidence || normalized.length <= 24
}
