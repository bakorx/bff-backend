import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import { IServerAdapter } from "@bull-board/api/typings/app";
import { longQueue, shortQueue } from "@/schedulers";

const bullBoardAdapter = new ExpressAdapter();

bullBoardAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(shortQueue.queue),
    new BullMQAdapter(longQueue.queue),
  ],
  serverAdapter: bullBoardAdapter as unknown as IServerAdapter,
});

export { bullBoardAdapter };
