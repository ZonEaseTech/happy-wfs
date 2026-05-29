import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const execFileAsync = promisify(execFile)

import { buildReviewContext, extractMarkdownPlanPaths, extractUiPrototypeReferences, extractUserRequirementText, summarizeMessagesForReview } from './context'

describe('extractMarkdownPlanPaths', () => {
  it('finds plan markdown paths from text', () => {
    expect(extractMarkdownPlanPaths('Plan saved to docs/plan/issue-228.md and docs/superpowers/plans/x.md')).toEqual([
      'docs/plan/issue-228.md',
      'docs/superpowers/plans/x.md',
    ])
  })
})

describe('extractUserRequirementText', () => {
  it('keeps explicit user constraints', () => {
    const result = extractUserRequirementText('请勿提交任何代码，让我检查通过再说。')
    expect(result).toContain('请勿提交任何代码')
  })
})



describe('extractUiPrototypeReferences', () => {
  it('keeps prototype and design links for code-level UI review', () => {
    const refs = extractUiPrototypeReferences('原型：https://example.com/supervisor/123\n普通链接：https://example.com/api\nprototype code: https://example.com/design/src')
    expect(refs).toContain('supervisor/123')
    expect(refs).toContain('design/src')
    expect(refs).not.toContain('/api')
  })
})

describe('summarizeMessagesForReview', () => {
  it('keeps user and agent text in order', () => {
    const result = summarizeMessagesForReview([
      { role: 'user', text: '需求 A' },
      { role: 'agent', text: '完成 A' },
    ])
    expect(result).toContain('[user] 需求 A')
    expect(result).toContain('[agent] 完成 A')
  })
})

describe('buildReviewContext', () => {


  it('adds UI prototype references to review context', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-ui-'))
    try {
      const context = await buildReviewContext({
        cwd,
        messages: [{ role: 'user', text: '请认真阅读原型地址 https://example.com/supervisor/abc 并保证样式一致' }],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.uiPrototypeReferences).toContain('supervisor/abc')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('does not read markdown paths outside cwd', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-outside-'))
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-repo-'))
    try {
      const outsideFile = path.join(outside, 'secret.md')
      await writeFile(outsideFile, 'secret-plan')
      const context = await buildReviewContext({
        cwd,
        messages: [{ role: 'agent', text: `Plan saved to ${outsideFile}` }],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.plans).not.toContain('secret-plan')
    } finally {
      await rm(outside, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })




  it('uses workspace repo metadata when session cwd is not a git repository', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-non-git-cwd-'))
    const repo = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-workspace-repo-'))
    try {
      await execFileAsync('git', ['init'], { cwd: repo })
      await writeFile(path.join(repo, 'changed.ts'), 'export const changed = true\n')
      const context = await buildReviewContext({
        cwd,
        repoPaths: [repo],
        messages: [],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.reviewRoots).toEqual([repo])
      expect(context.git).toContain(`# Repository: ${repo}`)
      expect(context.git).toContain('changed.ts')
      expect(context.git).not.toContain('Repository discovery failed')
    } finally {
      await rm(cwd, { recursive: true, force: true })
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('includes staged diff evidence', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-git-'))
    try {
      await execFileAsync('git', ['init'], { cwd })
      await writeFile(path.join(cwd, 'staged.txt'), 'hello staged\n')
      await execFileAsync('git', ['add', 'staged.txt'], { cwd })
      const context = await buildReviewContext({
        cwd,
        messages: [],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.git).toContain('## git diff --cached')
      expect(context.git).toContain('staged.txt')
      expect(context.git).toContain('hello staged')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })



  it('includes untracked non-doc source file contents', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-untracked-'))
    try {
      await execFileAsync('git', ['init'], { cwd })
      await mkdir(path.join(cwd, 'src'), { recursive: true })
      await mkdir(path.join(cwd, 'docs'), { recursive: true })
      await writeFile(path.join(cwd, 'src', 'new-feature.ts'), 'export const newFeature = true\n')
      await writeFile(path.join(cwd, 'docs', 'plan.md'), 'do-not-include-doc-plan\n')
      const context = await buildReviewContext({
        cwd,
        messages: [],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.git).toContain('## untracked source files')
      expect(context.git).toContain('src/new-feature.ts')
      expect(context.git).toContain('newFeature')
      expect(context.git).not.toContain('do-not-include-doc-plan')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('reads markdown paths inside cwd', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'happy-auto-review-repo-'))
    try {
      await writeFile(path.join(cwd, 'plan.md'), 'inside-plan')
      const context = await buildReviewContext({
        cwd,
        messages: [{ role: 'agent', text: 'Plan saved to plan.md' }],
        issueText: '',
        completionClaim: 'done',
      })
      expect(context.plans).toContain('inside-plan')
      await expect(readFile(path.join(cwd, 'plan.md'), 'utf8')).resolves.toBe('inside-plan')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
