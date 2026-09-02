import type { IEvent } from "@/events";

// ---------------------------------------------------------------------------
// Rule-based fact generation — no LLM. Used for the free tier (§7: "free →
// rule-based facts only") and as the fallback when a paid tier exceeds its
// daily LLM extraction budget (§7: "fall back to rule-based facts only —
// no error, no degradation visible to the user").
//
// This is a starter rule set derived from the actual payload shapes emitted
// by the #25 controller hooks (score, correctCount, passed, etc.) — not
// every event type carries enough structure for a deterministic rule yet.
// Expandable as more event types get richer payloads.
// ---------------------------------------------------------------------------

export interface RuleBasedFact {
  fact: string;
  tags: string[];
  confidence: number;
}

const MAX_FREE_TIER_FACTS = 2;

export function generateRuleBasedFacts(
  events: IEvent[],
  maxFacts = MAX_FREE_TIER_FACTS,
): RuleBasedFact[] {
  const facts: RuleBasedFact[] = [];

  const gradedQuizzes = events.filter((e) => e.eventType === "quiz:private_graded");
  for (const ev of gradedQuizzes) {
    const score = Number((ev.payload as any)?.score);
    if (!Number.isFinite(score)) continue;
    if (score < 50) {
      facts.push({
        fact: `Scored ${score}% on a recent quiz — needs review`,
        tags: ["weak_area"],
        confidence: 0.6,
      });
    } else if (score >= 90) {
      facts.push({
        fact: `Scored ${score}% on a recent quiz — strong performance`,
        tags: ["strength"],
        confidence: 0.6,
      });
    }
  }

  const abandoned = events.filter((e) => e.eventType === "session:abandoned");
  if (abandoned.length >= 2) {
    facts.push({
      fact: `Abandoned ${abandoned.length} study sessions in the last day`,
      tags: ["disengagement"],
      confidence: 0.5,
    });
  }

  const failedVerifications = events.filter(
    (e) =>
      e.eventType === "session:verification_completed" &&
      (e.payload as any)?.passed === false,
  );
  if (failedVerifications.length > 0) {
    facts.push({
      fact: `Failed ${failedVerifications.length} verification check(s) recently`,
      tags: ["weak_area"],
      confidence: 0.6,
    });
  }

  return facts.slice(0, maxFacts);
}
