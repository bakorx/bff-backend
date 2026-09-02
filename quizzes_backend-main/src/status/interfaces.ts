/**
 * Public status payload types.
 *
 * v1 = live status only. We don't persist components or incidents to Mongo —
 * the four probes run on demand and the aggregator derives a global state.
 * See services.ts for the thresholds and cache.
 */

export type ComponentState = "operational" | "degraded" | "down";

export type ComponentId = "mongodb" | "redis" | "openrouter" | "api";

/**
 * Result of a single probe. `latencyMs` is null when the probe never
 * resolved (timeout / thrown) — used by the FE to render "no response".
 */
export interface ComponentStatus {
  id: ComponentId;
  label: string;
  state: ComponentState;
  latencyMs: number | null;
  message?: string;
  updatedAt: string;
}

export type GlobalState = "operational" | "partial_outage" | "major_outage";

export interface GlobalStatus {
  state: GlobalState;
  label: string;
  components: ComponentStatus[];
  generatedAt: string;
}

/**
 * One slice of a component's history. `state` is the worst state observed
 * during that hour — operational < degraded < down. `uptimePercent` is the
 * share of probes in that hour that returned "operational".
 */
export interface HistoryHour {
  hourStart: string; // ISO, anchored to the start of the hour
  state: ComponentState;
  uptimePercent: number;
}

export interface ComponentHistory {
  id: ComponentId;
  label: string;
  hours: HistoryHour[];
  /** Share of the 24h window that was "operational". 0..100. */
  uptimePercent24h: number;
}

export interface StatusHistory {
  hours: number; // window size — always 24 in v1
  slotCount: number; // == hours
  startedAt: string; // ISO of the oldest slot
  endedAt: string; // ISO of the newest slot (= now)
  components: ComponentHistory[];
}

/**
 * A contiguous run of identical state observed for a single component.
 * Built from the same hourly buckets used by the timeline but compressed
 * into "this state, for these hours". Operational runs are typically
 * elided by the consumer — the FE only renders the non-operational ones.
 */
export interface IncidentRun {
  state: Exclude<ComponentState, "operational">; // only "degraded" | "down"
  startedAt: string; // ISO of first hour in the run
  endedAt: string; // ISO of last hour in the run (== startedAt if 1 hour)
  hourCount: number; // length of the run in hour-buckets
  uptimePercent: number; // worst hour's uptime, 0..100
  isOngoing: boolean; // true if last hour == current hour and state != operational
}

export interface ComponentIncidents {
  id: ComponentId;
  label: string;
  windowHours: number; // 24
  hasActiveIncident: boolean;
  incidents: IncidentRun[];
}

export interface StatusIncidents {
  hours: number;
  startedAt: string;
  endedAt: string;
  components: ComponentIncidents[];
}
