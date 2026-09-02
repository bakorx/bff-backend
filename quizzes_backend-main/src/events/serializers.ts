import { z } from "zod";

export const CreateEventSerializer = z.object({
  eventType: z.string().min(1),
  sourceRef: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.coerce.date().optional(),
});
