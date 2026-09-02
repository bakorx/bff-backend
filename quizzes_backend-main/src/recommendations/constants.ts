export const RECOMMENDATION_WEIGHTS = {
  // Content-based
  topicAffinityMatch: 0.35, // how well content tags match user's topic affinities
  followedTopicBonus: 0.2, // extra boost for content matching an explicitly followed topic
  weakAreaRemedial: 0.25, // boost for content that directly targets a user's weak area
  progressionBonus: 0.15, // "next logical step" bonus after recently completed content

  // Collaborative
  peerPopularity: 0.2, // how popular this content is among same-university peers
  peerSimilarity: 0.15, // other users with similar profiles engaged with this

  // Penalties
  abandonedPenalty: -0.3, // user previously abandoned this content
  lowScorePenalty: -0.15, // user scored <40 % on a related quiz

  // External resources
  qualityScore: 0.4, // platform quality signal (e.g. Coursera rating)
  tagOverlap: 0.35, // overlap between resource tags and user affinities
  recencyBonus: 0.15, // resource published within the last 90 days
  provenBonus: 0.1, // high save/bookmark rate on the platform
} as const;
