import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_TEXT = 120_000
const MAX_DIFF = 80_000
const MAX_PLAN_FILE = 20_000
const MAX_UNTRACKED_FILE = 20_000
const MAX_UNTRACKED_TOTAL = 80_000

export type ReviewMessage = { role: 'user' | 'agent' | 'system', text: string }

export type ReviewContext = {
  issue: string,
  requirements: string,
  plans: string,
  transcript: string,
  git: string,
  completionClaim: string,
  uiPrototypeReferences: string,
  reviewRoots: string[],
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]` : value
}

export function extractMarkdownPlanPaths(text: string): string[] {
  const matches = text.match(/(?:\.\/|\/)?[\w@./~-][^\s`'"，。)\]]*\.md/g) ?? []
  return [...new Set(matches.map((item) => item.replace(/^\.\//, '')))].slice(0, 20)
}

export function extractUserRequirementText(text: string): string {
  const important = /(请|不要|不能|必须|需要|希望|改成|保持|先|后|勿|禁止|require|must|should|do not|don't)/i
  return important.test(text) ? text.trim() : ''
}


export function extractUiPrototypeReferences(text: string): string {
  const lines = text.split('\n')
  const keyword = /(原型|设计稿|设计图|prototype|supervisor|figma|mockup|wireframe|design|ui)/i
  const url = /https?:\/\/[^\s`'"，。)\]]+/ig
  const refs: string[] = []

  for (const line of lines) {
    if (!keyword.test(line)) continue
    const urls = line.match(url) ?? []
    if (urls.length > 0) {
      refs.push(line.trim())
      continue
    }
    refs.push(line.trim())
  }

  return truncate([...new Set(refs.filter(Boolean))].join('\n'), 20_000)
}

export function summarizeMessagesForReview(messages: ReviewMessage[]): string {
  return truncate(messages.map((message) => `[${message.role}] ${message.text.trim()}`).filter((line) => !line.endsWith('] ')).join('\n\n'), MAX_TEXT)
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, timeout: 20_000, maxBuffer: 1_000_000 })
    return `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim()
  } catch (error) {
    return `[git ${args.join(' ')} failed] ${error instanceof Error ? error.message : String(error)}`
  }
}

function isInsideCwd(cwd: string, candidate: string): boolean {
  const relative = path.relative(cwd, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}


function shouldIncludeUntrackedFile(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith('docs/')) return false
  if (relativePath.includes('/node_modules/') || relativePath.startsWith('node_modules/')) return false
  if (relativePath.includes('/dist/') || relativePath.startsWith('dist/')) return false
  if (relativePath.includes('/build/') || relativePath.startsWith('build/')) return false
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|tgz|lock|sqlite|db)$/i.test(relativePath)) return false
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|yml|yaml)$/i.test(relativePath)
}


function expandUntrackedCandidates(cwd: string, relativePath: string): string[] {
  const absolute = path.resolve(cwd, relativePath)
  if (!isInsideCwd(cwd, absolute)) return []
  try {
    const stat = statSync(absolute)
    if (stat.isFile()) return [relativePath]
    if (!stat.isDirectory()) return []
  } catch {
    return []
  }

  const output: string[] = []
  const stack = [relativePath]
  while (stack.length > 0 && output.length < 100) {
    const current = stack.pop()!
    if (current.startsWith('docs/') || current === 'docs') continue
    const currentAbsolute = path.resolve(cwd, current)
    if (!isInsideCwd(cwd, currentAbsolute)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(currentAbsolute)
    } catch {
      continue
    }
    for (const entry of entries) {
      const child = path.join(current, entry)
      const childAbsolute = path.resolve(cwd, child)
      try {
        const childStat = statSync(childAbsolute)
        if (childStat.isDirectory()) stack.push(child)
        else if (childStat.isFile()) output.push(child)
      } catch {
        // Ignore files that disappear while collecting context.
      }
    }
  }
  return output
}

async function readUntrackedFiles(cwd: string, gitStatus: string): Promise<string> {
  const chunks: string[] = []
  let total = 0
  for (const line of gitStatus.split('\n')) {
    if (!line.startsWith('?? ')) continue
    const relativePath = line.slice(3).trim()
    const candidates = expandUntrackedCandidates(cwd, relativePath)
    for (const candidate of candidates) {
      if (!shouldIncludeUntrackedFile(candidate)) continue
      const absolute = path.resolve(cwd, candidate)
      if (!isInsideCwd(cwd, absolute)) continue
      try {
        const stat = statSync(absolute)
        if (!stat.isFile()) continue
        const body = await readFile(absolute, 'utf8')
        const chunk = `## untracked ${candidate}\n${truncate(body, MAX_UNTRACKED_FILE)}`
        if (total + chunk.length > MAX_UNTRACKED_TOTAL) return chunks.join('\n\n')
        chunks.push(chunk)
        total += chunk.length
      } catch {
        // Ignore files that disappear or are not UTF-8 text.
      }
    }
  }
  return chunks.join('\n\n')
}


async function resolveGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 10_000, maxBuffer: 200_000 })
    const root = stdout.trim()
    return root || null
  } catch {
    return null
  }
}

async function resolveReviewRoots(cwd: string, repoPaths: string[] = []): Promise<string[]> {
  const candidates = [...repoPaths, cwd]
    .map((item) => item.trim())
    .filter(Boolean)
  const roots: string[] = []
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const root = await resolveGitRoot(candidate)
    if (root && !roots.includes(root)) roots.push(root)
  }
  return roots
}

async function collectGitEvidenceForRoot(cwd: string): Promise<string> {
  const gitStatus = await runGit(cwd, ['status', '--short'])
  const gitStat = await runGit(cwd, ['diff', '--stat'])
  const gitNames = await runGit(cwd, ['diff', '--name-only'])
  const gitDiff = truncate(await runGit(cwd, ['diff', '--', '.']), MAX_DIFF)
  const stagedStat = await runGit(cwd, ['diff', '--cached', '--stat'])
  const stagedNames = await runGit(cwd, ['diff', '--cached', '--name-only'])
  const stagedDiff = truncate(await runGit(cwd, ['diff', '--cached', '--', '.']), MAX_DIFF)
  const untrackedFiles = await readUntrackedFiles(cwd, gitStatus)

  return `# Repository: ${cwd}

## git status --short
${gitStatus}

## git diff --stat
${gitStat}

## git diff --name-only
${gitNames}

## git diff
${gitDiff}

## git diff --cached --stat
${stagedStat}

## git diff --cached --name-only
${stagedNames}

## git diff --cached
${stagedDiff}

## untracked source files
${untrackedFiles || '(none)'}`
}

async function readPlanFiles(cwd: string, paths: string[]): Promise<string> {
  const root = path.resolve(cwd)
  const chunks: string[] = []

  for (const candidate of paths) {
    const absolute = path.resolve(root, candidate)
    if (!isInsideCwd(root, absolute)) continue
    if (!existsSync(absolute)) continue
    const body = await readFile(absolute, 'utf8')
    chunks.push(`## ${candidate}\n\n${truncate(body, MAX_PLAN_FILE)}`)
  }

  return chunks.join('\n\n')
}

export async function buildReviewContext(args: {
  cwd: string,
  messages: ReviewMessage[],
  issueText: string,
  completionClaim: string,
  repoPaths?: string[],
}): Promise<ReviewContext> {
  const transcript = summarizeMessagesForReview(args.messages)
  const requirements = args.messages
    .filter((message) => message.role === 'user')
    .map((message) => extractUserRequirementText(message.text))
    .filter(Boolean)
    .join('\n\n')
  const uiPrototypeReferences = extractUiPrototypeReferences([args.issueText, transcript].filter(Boolean).join('\n'))
  const planPaths = extractMarkdownPlanPaths(transcript)
  const planFiles = await readPlanFiles(args.cwd, planPaths)
  const reviewRoots = await resolveReviewRoots(args.cwd, args.repoPaths)
  const gitEvidence = reviewRoots.length > 0
    ? (await Promise.all(reviewRoots.map((root) => collectGitEvidenceForRoot(root)))).join('\n\n---\n\n')
    : `# Repository discovery failed\n\nNo git repository was found from session cwd or workspace repo metadata. Session cwd: ${args.cwd}`
  const planExcerpt = transcript.match(/(?:brainstorming|pma|writing-plans|实施计划|设计草案)[\s\S]{0,20000}/i)?.[0] ?? ''

  return {
    issue: args.issueText,
    requirements: truncate(requirements, MAX_TEXT),
    plans: truncate([planFiles, planExcerpt].filter(Boolean).join('\n\n'), MAX_TEXT),
    transcript,
    git: gitEvidence,
    completionClaim: args.completionClaim,
    uiPrototypeReferences,
    reviewRoots,
  }
}
