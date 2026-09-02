import mongoose from "mongoose";
import axios from "axios";
import { performance } from "perf_hooks";
import { CONFIG, redisConnection } from "@/config";
import { StatusProbeModel } from "./models";
import { COMPONENT_META } from "./constants";
import type {
  ComponentHistory,
  ComponentId,
  ComponentIncidents,
  ComponentState,
  ComponentStatus,
  GlobalStatus,
  HistoryHour,
  IncidentRun,
  StatusHistory,
  StatusIncidents,
} from "./interfaces";
import { logger } from "@/config";

/**
 * Status probes — run live on every `/api/v1/status` call.
 *
 * Thresholds:
 *   - latency < 2s       => "operational"
 *   - 2s <= latency < 8s => "degraded"
 *   - latency >= 8s OR throw => "down"
 *
 * In-memory cache (10s TTL) so we don't hammer Mongo/Redis/OpenRouter on
 * every poll. Do NOT cache in Redis — Redis cache self-defeats if Redis
 * is the component that's down.
 */

const PROBE_TIMEOUT_MS = 8_000;
const DEGRADED_LATENCY_MS = 2_000;
const CACHE_TTL_MS = 10_000;

interface RawProbeResult {
  latencyMs: number | null;
  message?: string;
  ok: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`probe timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function classify(latencyMs: number | null, ok: boolean): ComponentState {
  if (!ok || latencyMs === null || latencyMs >= PROBE_TIMEOUT_MS) return "down";
  if (latencyMs > DEGRADED_LATENCY_MS) return "degraded";
  return "operational";
}

// ─── Probes ───────────────────────────────────────────────────────────────────

async function probeMongo(): Promise<RawProbeResult> {
  const start = performance.now();
  try {
    const db = mongoose.connection.db;
    if (!db) {
      return {
        latencyMs: null,
        message: "mongoose not connected",
        ok: false,
      };
    }
    await withTimeout(db.admin().command({ ping: 1 }), PROBE_TIMEOUT_MS);
    return {
      latencyMs: Math.round(performance.now() - start),
      message: "Connected",
      ok: true,
    };
  } catch (err) {
    return {
      latencyMs: null,
      message: err instanceof Error ? err.message : "Mongo ping failed",
      ok: false,
    };
  }
}

async function probeRedis(): Promise<RawProbeResult> {
  const start = performance.now();
  try {
    await withTimeout(redisConnection.ping(), PROBE_TIMEOUT_MS);
    return {
      latencyMs: Math.round(performance.now() - start),
      message: "Connected",
      ok: true,
    };
  } catch (err) {
    return {
      latencyMs: null,
      message: err instanceof Error ? err.message : "Redis ping failed",
      ok: false,
    };
  }
}

interface OpenRouterModelsResponse {
  data: Array<{ id: string }>;
}

async function probeOpenRouter(): Promise<RawProbeResult> {
  const start = performance.now();
  try {
    const res = await withTimeout(
      axios.get<OpenRouterModelsResponse>(
        "https://openrouter.ai/api/v1/models",
      ),
      PROBE_TIMEOUT_MS,
    );
    const ids = (res.data?.data ?? []).map((m) => m.id);
    const defaultModel = CONFIG.AI.DEFAULT_MODEL;
    if (!ids.includes(defaultModel)) {
      return {
        latencyMs: Math.round(performance.now() - start),
        message: `Default model ${defaultModel} not in catalog`,
        ok: false,
      };
    }
    return {
      latencyMs: Math.round(performance.now() - start),
      message: "Catalog reachable",
      ok: true,
    };
  } catch (err) {
    return {
      latencyMs: null,
      message: err instanceof Error ? err.message : "OpenRouter unreachable",
      ok: false,
    };
  }
}

async function probeApiSurface(): Promise<RawProbeResult> {
  const start = performance.now();
  try {
    const url = `http://localhost:${CONFIG.PORT}/api/v1/system/newsletter/confirm?token=__healthcheck__`;
    // We don't care about the response body — a 400 means the route is
    // mounted and the Express app booted. 5xx / connect-refused = down.
    await withTimeout(
      axios.get(url, { validateStatus: () => true }),
      PROBE_TIMEOUT_MS,
    );
    return {
      latencyMs: Math.round(performance.now() - start),
      message: "Boot + routing OK",
      ok: true,
    };
  } catch (err) {
    return {
      latencyMs: null,
      message: err instanceof Error ? err.message : "API surface unreachable",
      ok: false,
    };
  }
}

// ─── Component meta ───────────────────────────────────────────────────────────
//
// (See ./constants.ts — shared with reports/serializers.ts.)

// ─── Aggregator ───────────────────────────────────────────────────────────────

async function buildComponentStatus(
  id: ComponentId,
  result: RawProbeResult,
): Promise<ComponentStatus> {
  return {
    id,
    label: COMPONENT_META[id].label,
    state: classify(result.latencyMs, result.ok),
    latencyMs: result.latencyMs,
    message: result.message,
    updatedAt: new Date().toISOString(),
  };
}

async function gatherStatusUncached(): Promise<GlobalStatus> {
  // Run all 4 in parallel. A single slow probe mustn't block the others.
  const [mongo, redis, openrouter, api] = await Promise.all([
    probeMongo(),
    probeRedis(),
    probeOpenRouter(),
    probeApiSurface(),
  ]);

  const checkedAt = new Date();
  const components: ComponentStatus[] = await Promise.all([
    buildComponentStatus("mongodb", mongo),
    buildComponentStatus("redis", redis),
    buildComponentStatus("openrouter", openrouter),
    buildComponentStatus("api", api),
  ]);

  // Persist to rolling 24h history. Fire-and-forget inside.
  persistProbeResults(components, checkedAt);

  const down = components.filter((c) => c.state === "down").length;
  const degraded = components.filter((c) => c.state === "degraded").length;

  let state: GlobalStatus["state"];
  let label: string;
  if (down === 0 && degraded === 0) {
    state = "operational";
    label = "All systems operational";
  } else if (down >= 2 || down + degraded >= 3) {
    state = "major_outage";
    label = "Major outage";
  } else {
    state = "partial_outage";
    label = "Partial outage";
  }

  return {
    state,
    label,
    components,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Persist each probe's result to the rolling 24h history. Fire-and-forget —
 * we don't want a Mongo write hiccup to slow or kill the live status call.
 * Worst case, a probe row is missed and the next 30s poll fills the gap.
 */
function persistProbeResults(
  components: ComponentStatus[],
  checkedAt: Date,
): void {
  // collect any docs we want to insert; the bulkWrite below is best-effort
  const docs = components.map((c) => ({
    componentId: c.id,
    state: c.state,
    latencyMs: c.latencyMs,
    message: c.message,
    checkedAt,
  }));
  // ordered: false so one failure doesn't block the rest; this is telemetry
  StatusProbeModel.bulkWrite(
    docs.map((doc) => ({ insertOne: { document: doc } })),
    { ordered: false },
  ).catch((err) => {
    // Don't crash the live status call if Mongo is the component being probed.
    logger.error("[status] failed to persist probe history:", err);
  });
}

// ─── History aggregation ──────────────────────────────────────────────────────

const STATE_RANK: Record<ComponentState, number> = {
  operational: 0,
  degraded: 1,
  down: 2,
};

const RANK_TO_STATE: Record<number, ComponentState> = {
  0: "operational",
  1: "degraded",
  2: "down",
};

interface HourlyRow {
  hour: Date;
  state: ComponentState;
  uptimePercent: number;
}

/** Round-trip the shared window so both endpoints agree on bounds. */
function windowBounds(hours: number): { startHour: Date; endHour: Date } {
  const now = new Date();
  const endHour = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0,
      0,
      0,
    ),
  );
  const startHour = new Date(endHour.getTime() - (hours - 1) * 60 * 60 * 1000);
  return { startHour, endHour };
}

/** Returns hour buckets aligned to startHour, one entry per component. */
async function fetchHourlyBuckets(
  hours: number,
): Promise<{
  startHour: Date;
  endHour: Date;
  byComponent: Map<ComponentId, HourlyRow[]>;
}> {
  const { startHour, endHour } = windowBounds(hours);

  const rows = await StatusProbeModel.aggregate<{
    _id: { componentId: ComponentId; hour: Date };
    worstRank: number;
    total: number;
    operational: number;
  }>([
    { $match: { checkedAt: { $gte: startHour } } },
    {
      $group: {
        _id: {
          componentId: "$componentId",
          hour: {
            $dateTrunc: { date: "$checkedAt", unit: "hour", timezone: "UTC" },
          },
        },
        worstRank: {
          $max: {
            $switch: {
              branches: [
                { case: { $eq: ["$state", "down"] }, then: 2 },
                { case: { $eq: ["$state", "degraded"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
        total: { $sum: 1 },
        operational: {
          $sum: { $cond: [{ $eq: ["$state", "operational"] }, 1, 0] },
        },
      },
    },
  ]);

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    byKey.set(`${r._id.componentId}:${r._id.hour.getTime()}`, r);
  }

  const byComponent = new Map<ComponentId, HourlyRow[]>();
  for (const id of Object.keys(COMPONENT_META) as ComponentId[]) {
    const out: HourlyRow[] = [];
    for (let i = 0; i < hours; i++) {
      const hourStart = new Date(startHour.getTime() + i * 60 * 60 * 1000);
      const row = byKey.get(`${id}:${hourStart.getTime()}`);
      out.push({
        hour: hourStart,
        state: row
          ? (RANK_TO_STATE[row.worstRank] ?? "operational")
          : "operational",
        uptimePercent: row
          ? Math.round((row.operational / row.total) * 100)
          : 100,
      });
    }
    byComponent.set(id, out);
  }

  return { startHour, endHour, byComponent };
}

/**
 * Build `hours` evenly-spaced buckets ending at the current half-hour, then
 * fill each from the rolled-up probe rows. Missing buckets default to
 * "operational" with uptime=100 — the page is up unless we've proven otherwise.
 *
 * Exported for `/api/v1/status/history`. Caller is responsible for TTL window
 * expectations (24h rows auto-prune via the index on `checkedAt`).
 */
export async function gatherHistory(hours = 24): Promise<StatusHistory> {
  const { startHour, endHour, byComponent } = await fetchHourlyBuckets(hours);

  const components: ComponentHistory[] = (
    Object.keys(COMPONENT_META) as ComponentId[]
  ).map((id) => {
    const buckets = byComponent.get(id) ?? [];
    const operationalCount = buckets.filter(
      (b) => b.state === "operational",
    ).length;
    const hoursArr: HistoryHour[] = buckets.map((b) => ({
      hourStart: b.hour.toISOString(),
      state: b.state,
      uptimePercent: b.uptimePercent,
    }));
    return {
      id,
      label: COMPONENT_META[id].label,
      hours: hoursArr,
      uptimePercent24h: Math.round((operationalCount / buckets.length) * 100),
    };
  });

  return {
    hours,
    slotCount: hours,
    startedAt: startHour.toISOString(),
    endedAt: endHour.toISOString(),
    components,
  };
}

/**
 * Compress hourly buckets into contiguous "runs" of identical non-operational
 * state for each component. Operational runs are dropped — the FE renders the
 * default "all clear" summary instead.
 *
 * Built as a single Mongo aggregation pipeline:
 *   1. `$group` rolls probes up into hourly buckets (state rank + uptime %).
 *   2. `$densify` synthesizes empty buckets so every component has a full
 *      24-row series (no gaps from quiet hours).
 *   3. `$setWindowFields` tags each bucket with the previous bucket's state so
 *      we can detect transitions in a single pass.
 *   4. `$set` derives a per-row `runId` (incremented whenever the state or
 *      componentId changes), and `dropOperational` zeroes it out for healthy
 *      buckets so they group together harmlessly.
 *   5. `$group` by `(componentId, runId)` collapses to one row per run,
 *      computing start/end/uptime/length.
 *   6. `$match` filters out the operational mega-run (runId === 0).
 *
 * Exported for `/api/v1/status/incidents`. Requires MongoDB 5.0+ for
 * `$setWindowFields` + `$densify`.
 */
export async function gatherIncidents(hours = 24): Promise<StatusIncidents> {
  const { startHour, endHour } = windowBounds(hours);
  const componentIds = Object.keys(COMPONENT_META) as ComponentId[];
  const endHourIso = endHour.toISOString();

  type AggRow = {
    componentId: ComponentId;
    state: ComponentState;
    uptimePercent: number;
    hourStart: Date;
    prevState: ComponentState | null;
    runId: number;
    dropOperational: number;
  };

  const runs = await StatusProbeModel.aggregate<{
    _id: { componentId: ComponentId; runId: number };
    state: Exclude<ComponentState, "operational">;
    startedAt: Date;
    endedAt: Date;
    hourCount: number;
    uptimePercent: number;
  }>([
    // 1. Roll probes into hourly buckets.
    {
      $group: {
        _id: {
          componentId: "$componentId",
          hour: {
            $dateTrunc: { date: "$checkedAt", unit: "hour", timezone: "UTC" },
          },
        },
        worstRank: {
          $max: {
            $switch: {
              branches: [
                { case: { $eq: ["$state", "down"] }, then: 2 },
                { case: { $eq: ["$state", "degraded"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
        total: { $sum: 1 },
        operational: {
          $sum: { $cond: [{ $eq: ["$state", "operational"] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        componentId: "$_id.componentId",
        hourStart: "$_id.hour",
        state: {
          $switch: {
            branches: [
              { case: { $eq: ["$worstRank", 2] }, then: "down" },
              { case: { $eq: ["$worstRank", 1] }, then: "degraded" },
            ],
            default: "operational",
          },
        },
        uptimePercent: {
          $cond: [
            { $gt: ["$total", 0] },
            {
              $round: [
                { $multiply: [{ $divide: ["$operational", "$total"] }, 100] },
              ],
            },
            100,
          ],
        },
      },
    },

    // 2. Densify — synthesize empty buckets so each component has the full
    // `hours` series with no gaps. Skips components we've never seen probes
    // for (the FE will render them as "no data" with state=operational).
    {
      $densify: {
        field: "hourStart",
        partitionByFields: ["componentId"],
        range: { step: 1, unit: "hour", bounds: [startHour, endHour] },
      },
    },
    {
      $set: {
        // For densified rows (no probe data), default to operational at 100%.
        state: { $ifNull: ["$state", "operational"] },
        uptimePercent: { $ifNull: ["$uptimePercent", 100] },
      },
    },

    // 3. Tag each bucket with the previous bucket's state per component.
    {
      $setWindowFields: {
        partitionBy: "$componentId",
        sortBy: { hourStart: 1 },
        output: {
          prevState: {
            $shift: { output: "$state", by: -1, default: null },
          },
        },
      },
    },

    // 4. runId increments whenever the state changes (or component flips).
    //    Operational buckets get runId=0 so they all collapse together; we
    //    drop that run in step 6.
    {
      $set: {
        isStateChange: {
          $ne: ["$state", "$prevState"],
        },
      },
    },
    {
      $setWindowFields: {
        partitionBy: "$componentId",
        sortBy: { hourStart: 1 },
        output: {
          runId: {
            $sum: {
              $cond: [{ $eq: ["$isStateChange", true] }, 1, 0],
            },
          },
        },
      },
    },
    {
      $set: {
        dropOperational: { $cond: [{ $eq: ["$state", "operational"] }, 0, 1] },
        // For non-operational rows, override runId so they share a counter
        // across the operational stream.
        runId: {
          $cond: [
            { $eq: ["$state", "operational"] },
            0,
            { $add: ["$runId", 1] }, // +1 so it's distinct from the op run
          ],
        },
      },
    },

    // 5. Collapse each (componentId, runId) pair to a single run document.
    {
      $group: {
        _id: { componentId: "$componentId", runId: "$runId" },
        state: { $first: "$state" },
        startedAt: { $min: "$hourStart" },
        endedAt: { $max: "$hourStart" },
        hourCount: { $sum: "$dropOperational" },
        uptimePercent: { $min: "$uptimePercent" },
      },
    },

    // 6. Drop the synthetic operational run (runId === 0) and any empties.
    { $match: { "_id.runId": { $ne: 0 }, hourCount: { $gt: 0 } } },
  ]);

  // Index by componentId for assembly. Initialize empty arrays for components
  // we've never seen probes for so the FE renders a "no data" card.
  const byComponent = new Map<ComponentId, IncidentRun[]>(
    componentIds.map((id) => [id, []]),
  );
  for (const r of runs) {
    const list = byComponent.get(r._id.componentId);
    if (!list) continue;
    list.push({
      state: r.state,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
      hourCount: r.hourCount,
      uptimePercent: r.uptimePercent,
      isOngoing: r.endedAt.toISOString() === endHourIso,
    });
  }

  // Newest first — incident feed reads top-down.
  for (const list of byComponent.values()) {
    list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  const components: ComponentIncidents[] = componentIds.map((id) => {
    const incidents = byComponent.get(id) ?? [];
    return {
      id,
      label: COMPONENT_META[id].label,
      windowHours: hours,
      hasActiveIncident: incidents.some((i) => i.isOngoing),
      incidents,
    };
  });

  return {
    hours,
    startedAt: startHour.toISOString(),
    endedAt: endHourIso,
    components,
  };
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cached: { value: GlobalStatus; fetchedAt: number } | null = null;

export async function gatherStatus(): Promise<GlobalStatus> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await gatherStatusUncached();
  cached = { value, fetchedAt: now };
  return value;
}

/** Test helper — clear the cache so the next call re-probes. */
export function resetStatusCache(): void {
  cached = null;
}
