import type { Metadata } from '@/api/types'
import { hasCompletionSemantics } from './completionSemantics'
import { formatFollowUpMessage, shouldSendFollowUp, type ReviewResult } from './reviewer'

type GuardMetadata = NonNullable<Metadata['autoReviewGuard']>

type AutoReviewGuardDeps = {
  getMetadata: () => Metadata | null,
  updateGuard: (patch: GuardMetadata) => Promise<void> | void,
  collectAndReview: (completionClaim: string) => Promise<ReviewResult>,
  sendFollowUp: (text: string, fingerprint: string) => Promise<void>,
  sendSimplifyCheck?: () => Promise<void>,
  delayMs?: number,
}

function fingerprintFor(result: ReviewResult): string {
  return result.missing.map((item) => item.trim()).filter(Boolean).join('\n').slice(0, 4000)
}

export class AutoReviewGuard {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private lastClaim = ''
  private lastMessageId = ''

  constructor(private readonly deps: AutoReviewGuardDeps) {}

  onAgentText(text: string, messageId: string): void {
    const metadata = this.deps.getMetadata()
    if (!metadata?.autoReviewGuard?.enabled) return
    if (metadata.autoReviewGuard.simplifyPending) {
      void this.deps.updateGuard({
        ...metadata.autoReviewGuard,
        enabled: true,
        status: metadata.autoReviewGuard.status ?? 'passed',
        updatedAt: Date.now(),
        simplifyPending: false,
      })
      return
    }
    if (!hasCompletionSemantics(text, metadata.autoReviewGuard.triggerPhrases)) return
    if (metadata.autoReviewGuard.lastTriggeredMessageId === messageId) return
    if (this.inFlight) return

    this.lastClaim = text
    this.lastMessageId = messageId
    if (this.timer) clearTimeout(this.timer)
    void this.deps.updateGuard({
      ...metadata.autoReviewGuard,
      enabled: true,
      status: 'waiting',
      updatedAt: Date.now(),
      lastTriggeredMessageId: messageId,
    })
    this.timer = setTimeout(() => void this.run(), metadata.autoReviewGuard.delayMs ?? this.deps.delayMs ?? 5_000)
  }

  async runNowForTests(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.run()
  }

  private async run(): Promise<void> {
    const metadata = this.deps.getMetadata()
    if (!metadata?.autoReviewGuard?.enabled || this.inFlight) return

    this.inFlight = true
    try {
      await this.deps.updateGuard({ ...metadata.autoReviewGuard, status: 'reviewing', updatedAt: Date.now() })
      let result: ReviewResult
      try {
        result = await this.deps.collectAndReview(this.lastClaim)
      } catch (error) {
        result = {
          status: 'uncertain',
          summary: `Auto review failed: ${error instanceof Error ? error.message : String(error)}`,
          missing: [],
          evidence: [],
          confidence: 'low',
        }
      }
      const fingerprint = fingerprintFor(result)
      const latestMetadata = this.deps.getMetadata()
      const currentGuard = latestMetadata?.autoReviewGuard ?? metadata.autoReviewGuard

      if (shouldSendFollowUp(result) && currentGuard.lastReviewFingerprint !== fingerprint) {
        try {
          await this.deps.sendFollowUp(formatFollowUpMessage(result, currentGuard.followUpTemplate), fingerprint)
          await this.deps.updateGuard({
            ...currentGuard,
            enabled: true,
            status: 'needs_follow_up',
            updatedAt: Date.now(),
            lastReviewFingerprint: fingerprint,
            lastSummary: result.summary,
            lastTriggeredMessageId: this.lastMessageId || currentGuard.lastTriggeredMessageId,
            simplifyPending: false,
          })
        } catch (error) {
          await this.markUncertainAfterFailure(currentGuard, error, fingerprint)
        }
        return
      }

      try {
        const passed = result.status === 'pass'
        let simplifyPending = false
        if (passed && currentGuard.sendSimplifyOnPass !== false && this.deps.sendSimplifyCheck) {
          await this.deps.sendSimplifyCheck()
          simplifyPending = true
        }
        await this.deps.updateGuard({
          ...currentGuard,
          enabled: true,
          status: passed ? 'passed' : 'uncertain',
          updatedAt: Date.now(),
          lastReviewFingerprint: fingerprint || currentGuard.lastReviewFingerprint,
          lastSummary: result.summary,
          lastTriggeredMessageId: this.lastMessageId || currentGuard.lastTriggeredMessageId,
          simplifyPending,
          lastSimplifySourceMessageId: simplifyPending ? (this.lastMessageId || currentGuard.lastTriggeredMessageId) : currentGuard.lastSimplifySourceMessageId,
        })
      } catch (error) {
        await this.markUncertainAfterFailure(currentGuard, error, fingerprint)
      }
    } finally {
      this.inFlight = false
      this.timer = null
    }
  }

  private async markUncertainAfterFailure(currentGuard: GuardMetadata, error: unknown, fingerprint: string): Promise<void> {
    try {
      await this.deps.updateGuard({
        ...currentGuard,
        enabled: true,
        status: 'uncertain',
        updatedAt: Date.now(),
        lastReviewFingerprint: fingerprint || currentGuard.lastReviewFingerprint,
        lastSummary: `Auto review action failed: ${error instanceof Error ? error.message : String(error)}`,
        lastTriggeredMessageId: this.lastMessageId || currentGuard.lastTriggeredMessageId,
        simplifyPending: false,
      })
    } catch {
      // If metadata write-back also fails, avoid surfacing an unhandled rejection.
    }
  }
}
