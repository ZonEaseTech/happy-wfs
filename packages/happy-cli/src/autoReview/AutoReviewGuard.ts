import type { Metadata } from '@/api/types'
import { completionClaimFingerprint, hasCompletionSemantics } from './completionSemantics'
import { formatFollowUpMessage, shouldSendFollowUp, type ReviewResult } from './reviewer'

type GuardMetadata = NonNullable<Metadata['autoReviewGuard']>

type AutoReviewGuardDeps = {
  getMetadata: () => Metadata | null,
  updateGuard: (patch: GuardMetadata) => Promise<void> | void,
  collectAndReview: (completionClaim: string) => Promise<ReviewResult>,
  sendFollowUp: (text: string, fingerprint: string) => Promise<void>,
  isDuplicateFollowUp?: (text: string, fingerprint: string) => Promise<boolean> | boolean,
  sendSimplifyCheck?: () => Promise<void>,
  delayMs?: number,
}

export type ManualAutoReviewGuardRunOptions = {
  enabled?: boolean,
  settings?: Partial<Pick<GuardMetadata, 'delayMs' | 'triggerPhrases' | 'reviewPrompt' | 'followUpTemplate' | 'sendSimplifyOnPass'>>,
  completionClaim?: string,
  messageId?: string,
}

function fingerprintFor(result: ReviewResult): string {
  return result.missing.map((item) => item.trim()).filter(Boolean).join('\n').slice(0, 4000)
}

export class AutoReviewGuard {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private lastClaim = ''
  private lastMessageId = ''
  private readonly sentFollowUpFingerprints = new Set<string>()

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
    const claimFingerprint = completionClaimFingerprint(text)
    if (this.sentFollowUpFingerprints.has(`claim:${claimFingerprint}`)) return
    if (this.inFlight) return

    this.sentFollowUpFingerprints.add(`claim:${claimFingerprint}`)
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

  async runManual(options: ManualAutoReviewGuardRunOptions = {}): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const metadata = this.deps.getMetadata()
    const currentGuard = metadata?.autoReviewGuard ?? { enabled: options.enabled ?? false }
    const messageId = options.messageId || `manual-${Date.now()}`
    const nextGuard: GuardMetadata = {
      ...currentGuard,
      ...options.settings,
      enabled: options.enabled ?? currentGuard.enabled ?? false,
      status: 'waiting',
      updatedAt: Date.now(),
      lastTriggeredMessageId: messageId,
      simplifyPending: false,
    }

    this.lastClaim = options.completionClaim || 'Manual auto review requested'
    this.lastMessageId = messageId
    await this.run({ force: true, guardOverride: nextGuard })
  }

  private async run(options: { force?: boolean; guardOverride?: GuardMetadata } = {}): Promise<void> {
    const metadata = this.deps.getMetadata()
    const guard = options.guardOverride ?? metadata?.autoReviewGuard
    if ((!guard?.enabled && !options.force) || !guard || this.inFlight) return

    this.inFlight = true
    try {
      await this.deps.updateGuard({ ...guard, status: 'reviewing', updatedAt: Date.now() })
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
      const currentGuard = options.guardOverride ?? latestMetadata?.autoReviewGuard ?? guard

      if (shouldSendFollowUp(result) && fingerprint && currentGuard.lastReviewFingerprint !== fingerprint) {
        if (this.sentFollowUpFingerprints.has(fingerprint)) {
          await this.deps.updateGuard({
            ...currentGuard,
            enabled: currentGuard.enabled,
            status: 'needs_follow_up',
            updatedAt: Date.now(),
            lastReviewFingerprint: fingerprint,
            lastSummary: result.summary,
            lastTriggeredMessageId: this.lastMessageId || currentGuard.lastTriggeredMessageId,
            simplifyPending: false,
          })
          return
        }

        const followUpText = formatFollowUpMessage(result, currentGuard.followUpTemplate)
        const nextGuard = {
          ...currentGuard,
          enabled: currentGuard.enabled,
          status: 'needs_follow_up' as const,
          updatedAt: Date.now(),
          lastReviewFingerprint: fingerprint,
          lastSummary: result.summary,
          lastTriggeredMessageId: this.lastMessageId || currentGuard.lastTriggeredMessageId,
          simplifyPending: false,
        }
        try {
          this.sentFollowUpFingerprints.add(fingerprint)
          await this.deps.updateGuard(nextGuard)
          if (await this.deps.isDuplicateFollowUp?.(followUpText, fingerprint)) {
            return
          }
          await this.deps.sendFollowUp(followUpText, fingerprint)
          await this.deps.updateGuard({
            ...nextGuard,
            updatedAt: Date.now(),
          })
        } catch (error) {
          this.sentFollowUpFingerprints.delete(fingerprint)
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
          enabled: currentGuard.enabled,
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
        enabled: currentGuard.enabled,
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
