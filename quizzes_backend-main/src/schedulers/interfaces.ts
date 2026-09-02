export type EmailEventPayload = {
  type: string;
  campaignId: string;
  status: "started" | "progress" | "completed" | "failed";
  timestamp: string;
  details?: Record<string, unknown>;
};

export interface AiGenerateMindMapJobData {
  materialId: string;
  courseId: string;
  userId?: string;
  createdBy: string;
  settings?: any;
}
