import { StudySession } from "../models";
import { runInTransaction } from "@/utils";
import { isValidObjectId } from "mongoose";
import publisher from "@/socket/publishers";
import { AgentPhase } from "../interfaces";

export async function setInterrupt(
  sessionId: string,
  userId: string,
  instruction: string,
): Promise<void> {
  if (!isValidObjectId(sessionId))
    throw new Error(`Invalid sessionId: ${sessionId}`);
  await runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");
    session.interruptState = {
      interruptedAt: new Date(),
      interruptReason: "user_steer",
      resumeFrom: session.currentPhase as AgentPhase,
      pendingInstruction: instruction,
    };
    session.currentPhase = "interrupted";
    await session.save({ session: txSession });
  });
  publisher.appInterrupted(sessionId, userId, instruction);
}
