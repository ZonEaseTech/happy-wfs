import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { ReviewContext } from './context'

export const ReviewResultSchema = z.object({
  status: z.enum(['pass', 'needs_follow_up', 'uncertain']),
  summary: z.string(),
  missing: z.array(z.string()),
  evidence: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
})

export type ReviewResult = z.infer<typeof ReviewResultSchema>

export function buildReviewerPrompt(context: ReviewContext): string {
  return `你是代码完成度审查 AI。只审查代码完成度：是否对标明确需求、GitHub Issue、用户补充要求、brainstorming/pma/writing-plans 计划、git diff 与验证证据。不要提出无关重构、泛泛优化、性能/安全深挖，除非任务明确要求。如果上下文包含原型图、原型代码、prototype、supervisor、design、Figma 等引用，只在代码层面额外审查 UI 是否对齐原型：结构、布局、文案、状态、交互和样式 token 是否有明显漏项；不要做截图/浏览器/视觉像素比对。\n\n你必须保持只读：不要修改文件，不要执行会改变工作区/系统状态的命令，不要提交、推送或安装依赖。请只输出 JSON，不要输出 Markdown。格式：{"status":"pass|needs_follow_up|uncertain","summary":"...","missing":["..."],"evidence":["..."],"confidence":"high|medium|low"}\n\n# GitHub Issue\n${context.issue || '(none)'}\n\n# 用户明确要求\n${context.requirements || '(none)'}\n\n# 计划 / checklist\n${context.plans || '(none)'}\n\n# UI 原型 / 设计引用（如有，仅做代码层面 UI 对标审查）\n${context.uiPrototypeReferences || '(none)'}\n\n# Agent 完成声明\n${context.completionClaim || '(none)'}\n\n# 会话摘要\n${context.transcript || '(none)'}\n\n# 代码证据\n${context.git || '(none)'}\n`
}

export function parseReviewResult(output: string): ReviewResult {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = (fenced ?? output).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')

  if (start < 0 || end < start) {
    return { status: 'uncertain', summary: 'Reviewer did not return JSON.', missing: [], evidence: [raw.slice(0, 500)], confidence: 'low' }
  }

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
    return ReviewResultSchema.parse(parsed)
  } catch (error) {
    return {
      status: 'uncertain',
      summary: 'Reviewer returned invalid JSON.',
      missing: [],
      evidence: [error instanceof Error ? error.message : String(error), raw.slice(0, 500)],
      confidence: 'low',
    }
  }
}

export function shouldSendFollowUp(result: ReviewResult): boolean {
  return result.status === 'needs_follow_up' && result.confidence !== 'low' && result.missing.length > 0
}

export function formatFollowUpMessage(result: ReviewResult): string {
  const items = result.missing.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return `自动完成度审查发现以下漏项，请继续处理：\n\n${items}\n\n请补齐后重新验证。\n审查范围：仅对标本任务明确需求、计划和当前代码完成度。`
}

export function buildReviewerSpawnArgs(cwd: string): string[] {
  return ['exec', '--sandbox', 'read-only', '--cd', cwd, '-']
}

export async function runReviewer(args: { cwd: string, prompt: string, timeoutMs?: number }): Promise<ReviewResult> {
  const timeoutMs = args.timeoutMs ?? 120_000
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('codex', buildReviewerSpawnArgs(args.cwd), {
      cwd: args.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Reviewer timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdin?.end(args.prompt)
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout || stderr)
      else reject(new Error(`Reviewer exited with code ${code}: ${stderr.slice(0, 1000)}`))
    })
  })
  return parseReviewResult(output)
}
