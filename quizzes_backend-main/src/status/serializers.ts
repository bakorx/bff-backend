import type { GlobalStatus } from "./interfaces";

/**
 * Atlassian / statuspage.io-compatible public feed shape.
 *
 * External monitors (UptimeRobot, BetterUptime, StatusGator) parse this
 * schema. We diverge only in the indicator enum (`none|minor|major`) —
 * no `critical` because v1 has no severity levels beyond the 3 global
 * states.
 */
export interface AtlassianPage {
  id: string;
  name: string;
  url: string;
  time_zone: string;
}

export interface AtlassianIndicator {
  indicator: "none" | "minor" | "major";
  description: string;
}

export interface AtlassianComponent {
  id: string;
  name: string;
  status: "operational" | "degraded" | "down";
  updated_at: string;
}

export interface AtlassianFeed {
  page: AtlassianPage;
  status: AtlassianIndicator;
  components: AtlassianComponent[];
}

export function toAtlassianShape(
  payload: GlobalStatus,
  pageUrl: string,
): AtlassianFeed {
  return {
    page: {
      id: "qz",
      name: "Qz Status",
      url: pageUrl,
      time_zone: "Etc/UTC",
    },
    status: {
      indicator:
        payload.state === "operational"
          ? "none"
          : payload.state === "partial_outage"
            ? "minor"
            : "major",
      description: payload.label,
    },
    components: payload.components.map((c) => ({
      id: c.id,
      name: c.label,
      status: c.state,
      updated_at: c.updatedAt,
    })),
  };
}
