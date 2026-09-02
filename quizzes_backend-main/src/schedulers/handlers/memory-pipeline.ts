import { longQueue } from "../queues";
import { runMemoryPipelineCron } from "@/recommendations";
import { logger } from "@/config";

// ---------------------------------------------------------------------------
// Memory write pipeline job handler (#26). See src/recommendations/
// memory-pipeline.ts for the actual pipeline logic — this is just the
// queue registration, matching the existing handler-file convention.
// ---------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[Memory Pipeline Handler] Registering queue handlers...");
  longQueue.register("memory:pipeline_run", async () => {
    await runMemoryPipelineCron();
  });
}
