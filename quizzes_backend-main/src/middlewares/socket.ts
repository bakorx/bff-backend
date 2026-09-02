import { Socket } from "socket.io";
import { JwtPayload } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import { ENV } from "@/config/env";
import { JWTPayload } from "./interfaces";


/**
 * Expects JWT token in socket handshake.
 */
export async function authenticateSocket(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const raw = socket.handshake.auth?.token as string | undefined;
    if (!raw) {
      const guestId = socket.handshake.auth?.guestId as string | undefined;
      const guestName = socket.handshake.auth?.guestName as string | undefined;
      if (guestId && guestName) {
        socket.data.user = {
          id: guestId,
          role: "student",
          isBanned: false,
          isSubscribed: false,
          isGuest: true,
          guestName,
        };
        return next();
      }
      socket.data.user = {
        id: `anon_${socket.id}`,
        role: "guest",
        isBanned: false,
        isSubscribed: false,
        isGuest: true,
      };
      return next();
    }

    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    const decoded = jwt.verify(token, ENV.ACCESS_TOKEN_SECRET) as JWTPayload;

    socket.data.user = {
      id: decoded.id,
      role: decoded.role,
      isBanned: decoded.isBanned,
      isSubscribed: decoded.isSubscribed,
      isGuest: false,
    };

    next();
  } catch (err: any) {
    next(new Error("Invalid or expired authentication token"));
  }
}
