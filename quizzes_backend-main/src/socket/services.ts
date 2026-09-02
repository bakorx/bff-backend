import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { maskId } from "@/utils";
import { redisConnection, logger, CONFIG } from "@/config";
import { authenticateSocket, CorsOption } from "@/middlewares";
import { StudyRoom } from "@/study_rooms";

let io: SocketIOServer;

export function initSocket(httpServer: HTTPServer): SocketIOServer {
  const socketPath = CONFIG.SOCKET_PATH || "/socket.io";
  io = new SocketIOServer(httpServer, {
    path: socketPath,
    cors: {
      origin: CorsOption.origin as any,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["polling", "websocket"],
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const user = socket.data.user as any;

    // Join personal room — all user-specific events go here
    socket.join(`user:${user.id}`);

    // Allow joining campaign rooms — for admins watching a dispatch
    socket.on("join:campaign", (campaignId: string) => {
      socket.join(`campaign:${campaignId}`);
    });

    socket.on("leave:campaign", (campaignId: string) => {
      socket.leave(`campaign:${campaignId}`);
    });

    // Allow joining quiz generation rooms — user watching Z work
    socket.on("join:quiz_generation", (personalQuizId: string) => {
      socket.join(`quiz_generation:${personalQuizId}`);
    });

    socket.on("leave:quiz_generation", (personalQuizId: string) => {
      socket.leave(`quiz_generation:${personalQuizId}`);
    });

    // Allow joining app session rooms — for Z streaming events
    socket.on("join:app_session", (sessionId: string) => {
      socket.join(`app:${sessionId}`);
    });

    socket.on("leave:app_session", (sessionId: string) => {
      socket.leave(`app:${sessionId}`);
    });

    socket.on("join:timetable_sync", (studentId: string) => {
      const cleanId = String(studentId || "").trim().replace(/\D/g, "");
      if (!cleanId) return;
      socket.join(`timetable:${cleanId}`);
      logger.info(
        `[socket] Socket joined timetable room: timetable:${maskId(cleanId)}`,
      );
    });

    socket.on("leave:timetable_sync", (studentId: string) => {
      const cleanId = String(studentId || "").trim().replace(/\D/g, "");
      if (!cleanId) return;
      socket.leave(`timetable:${cleanId}`);
    });

    socket.on("disconnect", () => {
      logger.info(`[socket] disconnected: ${maskId(user.id)}`);
    });

    socket.on("join:study_room", async (roomCode: string) => {
      try {
        const normalizedCode = String(roomCode || "").toUpperCase();
        if (!normalizedCode) return;
        const room = await StudyRoom.findOne({ roomCode: normalizedCode })
          .select("roomCode participants")
          .lean();
        if (!room) return;
        socket.join(`study_room:${room.roomCode}`);
        io.to(`study_room:${room.roomCode}`).emit("study_room:presence", {
          roomCode: room.roomCode,
          participants: room.participants?.filter((p: any) => !p.leftAt) || [],
        });
      } catch (error) {
        logger.error("[socket] join:study_room failed:", error);
      }
    });

    socket.on("leave:study_room", (roomCode: string) => {
      const normalizedCode = String(roomCode || "").toUpperCase();
      if (!normalizedCode) return;
      socket.leave(`study_room:${normalizedCode}`);
    });

    // Chat persistence is handled exclusively by the HTTP POST /study-rooms/:code/messages
    // endpoint (services.postMessage). The socket event is relay-only: it re-broadcasts
    // messages that have already been saved so that all room members see them in real-time.
    // This prevents duplicate DB writes when both paths are active.
    socket.on(
      "study_room:chat:relay",
      async (payload: {
        roomCode: string;
        message: Record<string, unknown>;
      }) => {
        try {
          const roomCode = String(payload?.roomCode || "").toUpperCase();
          if (!roomCode || !payload?.message) return;
          io.to(`study_room:${roomCode}`).emit("study_room:chat:new", {
            roomCode,
            message: payload.message,
          });
        } catch (error) {
          logger.error("[socket] study_room:chat:relay failed:", error);
        }
      },
    );

    socket.on(
      "study_room:typing",
      (payload: {
        roomCode: string;
        isTyping: boolean;
        displayName?: string;
      }) => {
        try {
          const roomCode = String(payload?.roomCode || "").toUpperCase();
          if (!roomCode) return;
          const senderName = user.isGuest
            ? payload?.displayName || user.guestName || "Guest"
            : payload?.displayName || "Member";
          socket.to(`study_room:${roomCode}`).emit("study_room:typing", {
            roomCode,
            senderName,
            isTyping: Boolean(payload?.isTyping),
          });
        } catch (error) {
          logger.error("[socket] study_room:typing failed:", error);
        }
      },
    );

    socket.on(
      "study_room:timer:update",
      async (payload: { roomCode: string; timer: Record<string, unknown> }) => {
        try {
          if (user.isGuest) return;
          const roomCode = String(payload?.roomCode || "").toUpperCase();
          if (!roomCode) return;
          const room = await StudyRoom.findOne({ roomCode });
          if (!room) return;
          const isAllowed = room.participants.some(
            (p: any) =>
              p.userId?.toString() === user.id &&
              !p.leftAt &&
              (p.role === "moderator" || p.role === "host"),
          );
          const isHostOwner = room.hostId?.toString?.() === user.id;
          if (!isAllowed && !isHostOwner) return;
          if (payload?.timer && typeof payload.timer === "object") {
            const allowed = [
              "isRunning",
              "startedAt",
              "remainingSeconds",
              "durationSeconds",
            ] as const;
            const patch: Record<string, unknown> = {};
            for (const field of allowed) {
              if (field in (payload.timer as Record<string, unknown>)) {
                patch[field] = (payload.timer as Record<string, unknown>)[
                  field
                ];
              }
            }
            room.timer = { ...(room.timer as any), ...patch };
            await room.save();
          }
          io.to(`study_room:${roomCode}`).emit("study_room:timer:state", {
            roomCode,
            timer: room.timer,
          });
        } catch (error) {
          logger.error("[socket] study_room:timer:update failed:", error);
        }
      },
    );

    logger.info(`[socket] connected: ${maskId(user.id)}`);
  });

  io.engine.on("connection_error", (error: any) => {
    logger.error("[socket] engine connection_error", {
      code: error?.code,
      message: error?.message,
      context: error?.context?.name || "unknown",
    });
  });

  // Bridge Redis worker signals → socket rooms (for standalone workers that
  // cannot access in-memory Socket.io; they publish to Redis instead)
  const redisSub = redisConnection.duplicate();
  redisSub.subscribe(
    "app:worker:signals",
    "email:events",
    "notification:events",
    (err) => {
      if (err) logger.error("[socket] Redis subscribe error:", err);
    },
  );
  redisSub.on("message", (channel: string, message: string) => {
    try {
      const data = JSON.parse(message) as Record<string, any>;

      if (channel === "email:events") {
        if (data.campaignId) {
          io.to(`campaign:${data.campaignId}`).emit(data.type || "email:event", data);
        }
        return;
      }

      if (channel === "notification:events") {
        if (data.userId) {
          io.to(`user:${data.userId}`).emit(data.type || "notification:event", data);
        }
        return;
      }

      const { sessionId, userId, __isSocketSignal, __room, __event, payload } = data;

      if (__isSocketSignal && __room && __event) {
        // Modern routing using specific room and event
        const eventPayload = payload !== undefined ? payload : data;
        io.to(__room).emit(__event, eventPayload);
      } else {
        // Fallback routing based on sessionId/userId
        if (sessionId) {
          io.to(`app:${sessionId}`).emit("app:signal", data);
        }
        if (userId) {
          io.to(`user:${userId}`).emit("app:signal", data);
        }
      }
    } catch (err) {
      logger.error("[socket] Redis bridge parse error:", err);
    }
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io)
    throw new Error("Socket.io not initialized — call initSocket() first");
  return io;
}
