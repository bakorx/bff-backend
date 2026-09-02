import { publishers } from "@/socket";

export interface Signal {
  type: string;
  sessionId: string;
  userId: string;
  payload: unknown;
  timestamp?: Date;
}

export type SignalEmitter = (signal: Signal) => void;

/**
 * Socket emitter used by background workers.
 * Redirects to the Socket.io publisher which handles Redis-orchestrated
 * delivery to connected Socket.io clients.
 */
export function buildSocketEmitter(sessionId: string, userId: string): SignalEmitter {
  return (signal: Signal) => {
    publishers.appSignal(sessionId, userId, {
      type: signal.type,
      payload: signal.payload,
      timestamp: signal.timestamp ?? new Date(),
    });
  };
}
