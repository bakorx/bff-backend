import { Types, ClientSession } from "mongoose";
import { runInTransaction } from "@/utils";
import { Notification, User } from "@/users";
import { CONFIG } from "@/config";
import {
  StudyRoom,
  StudyRoomInvite,
  StudyRoomMessage,
  StudyRoomPointsLedger,
} from "./models";
import { emit } from "@/socket/publishers";
import { shortQueue } from "@/schedulers";
import { services as emailServices } from "@/email";
import { nanoid } from "nanoid";

const INVITE_TTL_HOURS = 72;
const INVITE_RATE_LIMIT_PER_HOUR = 40;
const JOIN_POINTS = 5;
const TIMER_COMPLETE_POINTS = 10;
const CHAT_COOLDOWN_MS = 1200;
const TASK_COMPLETE_COOLDOWN_MS = 1500;
const GAME_ANSWER_COOLDOWN_MS = 900;
const MEDIA_POST_COOLDOWN_MS = 5000;
const MILESTONE_POINT_STEPS = [25, 50, 100, 150, 250];
const MILESTONE_CYCLE_STEPS = [3, 5, 10, 15];
const ALLOWED_MEDIA_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "open.spotify.com",
  "spotify.com",
  "www.spotify.com",
];

const lastMessageByActor = new Map<string, number>();
const lastTaskCompleteByActor = new Map<string, number>();
const lastGameAnswerByActor = new Map<string, number>();
const lastMediaPostByActor = new Map<string, number>();
const READY_CHECK_MS = 30 * 1000;
export const ROUND_MS = 30 * 1000;
export const REVEAL_MS = 10 * 1000;
const AI_GAME_ALLOWED_TIERS = new Set(["cruising", "locked_in"]);
const WORD_BANK = [
  "ALGORITHM",
  "FUNCTION",
  "VARIABLE",
  "DATABASE",
  "SOCKET",
  "PROMISE",
  "COMPILER",
];

const QA_BANK = [
  {
    question: "Which data structure uses FIFO order?",
    options: ["Stack", "Queue", "Tree", "Graph"],
    correctOption: 1,
  },
  {
    question: "Which keyword creates a constant in JavaScript?",
    options: ["var", "let", "const", "static"],
    correctOption: 2,
  },
];

const roomUrlFromCode = (roomCode: string, token?: string): string => {
  const base = CONFIG.FRONTEND_URL || "http://localhost:3000";
  const url = new URL("/study-rooms/join", base);
  url.searchParams.set("code", roomCode);
  if (token) url.searchParams.set("inviteToken", token);
  return url.toString();
};

const ensureInviteQuota = (room: any): void => {
  const now = Date.now();
  const startedAt = new Date(room.inviteRateWindow?.startedAt || now).getTime();
  if (now - startedAt > 60 * 60 * 1000) {
    room.inviteRateWindow = { startedAt: new Date(now), count: 0 };
  }
  if ((room.inviteRateWindow?.count || 0) >= INVITE_RATE_LIMIT_PER_HOUR) {
    throw new Error("Invite rate limit reached for this room");
  }
};

const isParticipant = (room: any, userId?: string, guestId?: string): boolean => {
  return room.participants.some((p: any) => {
    if (userId && p.userId?.toString() === userId && !p.leftAt) return true;
    if (guestId && p.guestId === guestId && !p.leftAt) return true;
    return false;
  });
};

const getLeaderboard = (room: any) =>
  [...room.participants]
    .filter((p: any) => !p.leftAt)
    .sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    .map((p: any) => ({
      userId: p.userId?.toString() ?? undefined,
      guestId: p.guestId ?? undefined,
      displayName: p.displayName,
      role: p.role,
      points: p.points || 0,
      avatarConfig: p.avatarConfig,
    }));

export const emitRoomEvent = (roomCode: string, event: string, payload: Record<string, unknown>) => {
  emit(`study_room:${roomCode}`, event, payload);
};

const canManageRoom = (room: any, userId?: string): boolean => {
  if (!userId) return false;
  if (room.hostId?.toString?.() === userId) return true;
  return room.participants.some(
    (p: any) =>
      p.userId?.toString() === userId &&
      !p.leftAt &&
      (p.role === "moderator" || p.role === "host"),
  );
};

const findActor = (room: any, userId?: string, guestId?: string) =>
  room.participants.find((p: any) => {
    if (userId && p.userId?.toString() === userId && !p.leftAt) return true;
    if (guestId && p.guestId === guestId && !p.leftAt) return true;
    return false;
  });

const xpToLevel = (xp: number): number => Math.max(1, Math.floor(xp / 100) + 1);

const COOLDOWN_MAP_TTL_MS = 10 * 60 * 1000; // evict entries older than 10 minutes

const consumeActionCooldown = (
  store: Map<string, number>,
  actorKey: string,
  cooldownMs: number,
  errorMessage: string,
): void => {
  const now = Date.now();

  // Evict stale entries to prevent unbounded map growth
  for (const [key, ts] of store) {
    if (now - ts > COOLDOWN_MAP_TTL_MS) store.delete(key);
  }

  const lastAt = store.get(actorKey) || 0;
  if (now - lastAt < cooldownMs) {
    throw new Error(errorMessage);
  }
  store.set(actorKey, now);
};

const parseAndValidateMediaUrl = (rawUrl: string): { normalizedUrl: string; kind: "youtube" | "spotify" | "link" } => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid media URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) media URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_MEDIA_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("Only YouTube and Spotify URLs are allowed");
  }
  const kind = hostname.includes("spotify")
    ? "spotify"
    : hostname.includes("youtu")
      ? "youtube"
      : "link";
  return { normalizedUrl: parsed.toString(), kind };
};

const appendRoomEventLog = (
  room: any,
  event: {
    action: string;
    actorUserId?: any;
    actorDisplayName?: string;
    targetUserId?: any;
    targetDisplayName?: string;
    metadata?: Record<string, unknown>;
  },
): void => {
  const entry = {
    id: nanoid(12),
    action: event.action,
    actorUserId: event.actorUserId,
    actorDisplayName: event.actorDisplayName,
    targetUserId: event.targetUserId,
    targetDisplayName: event.targetDisplayName,
    metadata: event.metadata,
    createdAt: new Date(),
  };
  room.eventLogs = room.eventLogs || [];
  room.eventLogs.push(entry);
  if (room.eventLogs.length > 300) {
    room.eventLogs = room.eventLogs.slice(-300);
  }
};

export const toMaskedWord = (word: string, guessedLetters: string[]): string =>
  word
    .split("")
    .map((letter) => (guessedLetters.includes(letter) ? letter : "_"))
    .join(" ");

const chooseWord = (seed?: string): string => {
  if (!seed) return WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
  const idx = Math.abs(seed.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % WORD_BANK.length;
  return WORD_BANK[idx];
};

const chooseQa = (seed?: string) => {
  if (!seed) return QA_BANK[Math.floor(Math.random() * QA_BANK.length)];
  const idx = Math.abs(seed.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % QA_BANK.length;
  return QA_BANK[idx];
};

const awardPoints = async (params: {
  room: any;
  amount: number;
  reason:
    | "join"
    | "timer_complete"
    | "task_complete"
    | "game_win"
    | "qa_correct"
    | "game_wrong_penalty"
    | "moderator_adjustment";
  actor: any;
  metadata?: Record<string, unknown>;
  session?: ClientSession;
}) => {
  const { room, amount, reason, actor, metadata, session } = params;
  const prevPoints = actor.points || 0;
  const prevXp = actor.xp || 0;
  const prevLevel = actor.level || 1;
  actor.points = Math.max(0, prevPoints + amount);
  actor.xp = Math.max(0, prevXp + amount);
  const nextLevel = xpToLevel(actor.xp || 0);
  actor.level = nextLevel;

  await StudyRoomPointsLedger.create(
    [{
      roomId: room._id,
      userId: actor.userId,
      guestId: actor.guestId,
      displayName: actor.displayName,
      amount,
      reason,
      metadata,
    }],
    session ? { session } : {},
  );

  emitRoomEvent(room.roomCode, "study_room:xp:changed", {
    roomCode: room.roomCode,
    actorId: actor.userId?.toString() || actor.guestId,
    displayName: actor.displayName,
    delta: actor.xp - prevXp,
    xp: actor.xp,
    points: actor.points,
    previousPoints: prevPoints,
    previousLevel: prevLevel,
    level: nextLevel,
    reason,
  });

  if (nextLevel > prevLevel) {
    const milestone = {
      id: nanoid(10),
      type: "level_up",
      userId: actor.userId,
      guestId: actor.guestId,
      displayName: actor.displayName,
      value: nextLevel,
      createdAt: new Date(),
    };
    room.milestones.push(milestone);
    emitRoomEvent(room.roomCode, "study_room:milestone", { roomCode: room.roomCode, milestone });
  }

  if (MILESTONE_POINT_STEPS.includes(actor.points || 0)) {
    const milestone = {
      id: nanoid(10),
      type: "points_milestone",
      userId: actor.userId,
      guestId: actor.guestId,
      displayName: actor.displayName,
      value: actor.points,
      createdAt: new Date(),
    };
    room.milestones.push(milestone);
    emitRoomEvent(room.roomCode, "study_room:milestone", { roomCode: room.roomCode, milestone });
  }
};

export const createRoom = async (params: {
  hostId: string;
  hostName: string;
  title: string;
  topic?: string;
  visibility: "open" | "closed";
  maxParticipants: number;
  timerMinutes: number;
}) => {
  return runInTransaction(async (session) => {
    const room = await StudyRoom.create(
      [
        {
          title: params.title,
          topic: params.topic,
          hostId: new Types.ObjectId(params.hostId),
          visibility: params.visibility,
          maxParticipants: params.maxParticipants,
          participants: [
            {
              userId: new Types.ObjectId(params.hostId),
              displayName: params.hostName,
              role: "host",
              points: JOIN_POINTS,
              xp: JOIN_POINTS,
              level: 1,
              completedCycles: 0,
            },
          ],
          timer: {
            isRunning: false,
            durationSeconds: params.timerMinutes * 60,
            remainingSeconds: params.timerMinutes * 60,
            cycle: 0,
            checkInOpen: false,
          },
          featureFlags: {
            tasksEnabled: true,
            gamesEnabled: true,
            mediaEnabled: true,
            avatarsEnabled: true,
          },
          tasks: [],
          cycleCheckIns: [],
          mediaPosts: [],
          milestones: [],
        },
      ],
      { session },
    );
    return room[0];
  });
};

export const listRoomsForUser = async (userId?: string) => {
  const baseQuery = { status: "active" as const };
  const query = userId
    ? {
        ...baseQuery,
        $or: [
          { visibility: "open" as const },
          { "participants.userId": new Types.ObjectId(userId) },
        ],
      }
    : { ...baseQuery, visibility: "open" as const };
  return StudyRoom.find(query).sort({ createdAt: -1 }).limit(100).lean();
};

export const getRoomByCode = async (roomCode: string) => {
  const room = await StudyRoom.findOne({ roomCode: roomCode.toUpperCase() }).lean();
  if (!room) throw new Error("Study room not found");
  const messages = await StudyRoomMessage.find({ roomId: room._id })
    .sort({ createdAt: -1 })
    .limit(80)
    .lean();
  return { room, messages: messages.reverse(), leaderboard: getLeaderboard(room) };
};

export const inviteByUsername = async (params: {
  roomCode: string;
  hostId: string;
  username: string;
}) => {
  const roomCode = params.roomCode.toUpperCase();
  const user = await User.findOne({ username: params.username }).lean();
  if (!user) throw new Error("User with this username was not found");

  const result = await runInTransaction(async (session) => {
    const room = await StudyRoom.findOne({ roomCode }).session(session);
    if (!room) throw new Error("Study room not found");
    if (!canManageRoom(room, params.hostId)) throw new Error("Only host or moderator can invite");
    ensureInviteQuota(room);

    const existing = await StudyRoomInvite.findOne({
      roomId: room._id,
      userId: user._id,
      status: "pending",
    }).session(session);
    if (existing) return existing;

    const invite = await StudyRoomInvite.create(
      [
        {
          roomId: room._id,
          invitedBy: new Types.ObjectId(params.hostId),
          inviteType: "username",
          userId: user._id,
          username: user.username.toLowerCase(),
          email: user.email,
          expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
        },
      ],
      { session },
    );

    await Notification.create(
      [
        {
          userId: user._id,
          title: "Study room invite",
          body: `You were invited to join ${room.title}`,
          type: "system_update",
          metadata: {
            roomCode: room.roomCode,
            inviteToken: invite[0].token,
          },
        },
      ],
      { session },
    );

    room.inviteRateWindow.count += 1;
    await room.save({ session });
    return invite[0];
  });

  const campaign = await emailServices.sendTransactional({
    campaignType: "system_update",
    recipient: {
      recipientId: user._id,
      email: user.email,
      name: user.name,
    },
    subject: "You are invited to a study room",
    markdownBody: `You have been invited to join **${roomCode}**.\n\nClick below to join your study room.`,
  });

  await shortQueue.enqueue("email:transactional:send", {
    campaignId: String((campaign as any)._id),
    recipientId: String(user._id),
    email: user.email,
    templateVariables: {
      appUrl: roomUrlFromCode(roomCode, result.token),
      ctaLabel: "Join room",
    },
  });

  return result;
};

export const inviteByEmail = async (params: {
  roomCode: string;
  hostId: string;
  email: string;
}) => {
  const roomCode = params.roomCode.toUpperCase();
  const normalizedEmail = params.email.trim().toLowerCase();
  const targetUser = await User.findOne({ email: normalizedEmail }).lean();

  const result = await runInTransaction(async (session) => {
    const room = await StudyRoom.findOne({ roomCode }).session(session);
    if (!room) throw new Error("Study room not found");
    if (!canManageRoom(room, params.hostId)) throw new Error("Only host or moderator can invite");
    ensureInviteQuota(room);

    const existing = await StudyRoomInvite.findOne({
      roomId: room._id,
      email: normalizedEmail,
      status: "pending",
    }).session(session);
    if (existing) return existing;

    const invite = await StudyRoomInvite.create(
      [
        {
          roomId: room._id,
          invitedBy: new Types.ObjectId(params.hostId),
          inviteType: "email",
          userId: targetUser?._id,
          email: normalizedEmail,
          expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
        },
      ],
      { session },
    );

    room.inviteRateWindow.count += 1;
    await room.save({ session });
    return invite[0];
  });

  const recipientId = targetUser?._id || new Types.ObjectId();
  const campaign = await emailServices.sendTransactional({
    campaignType: "system_update",
    recipient: {
      recipientId,
      email: normalizedEmail,
      name: targetUser?.name,
    },
    subject: "You are invited to a study room",
    markdownBody: `You have been invited to join **${roomCode}**.\n\nClick below to join your study room.`,
  });

  await shortQueue.enqueue("email:transactional:send", {
    campaignId: String((campaign as any)._id),
    recipientId: String(recipientId),
    email: normalizedEmail,
    templateVariables: {
      appUrl: roomUrlFromCode(roomCode, result.token),
      ctaLabel: "Join room",
    },
  });

  return result;
};

export const joinRoom = async (params: {
  roomCode: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  inviteToken?: string;
  guestName?: string;
  guestId?: string;
}) => {
  const roomCode = params.roomCode.toUpperCase();
  const room = await StudyRoom.findOne({ roomCode });
  if (!room) throw new Error("Study room not found");
  if (room.status !== "active") throw new Error("Study room has ended");
  if (room.isLocked) throw new Error("Study room is locked by host");
  if (room.participants.filter((p) => !p.leftAt).length >= room.maxParticipants) {
    throw new Error("Study room is full");
  }

  const isOwner = !!params.userId && room.hostId.toString() === params.userId;
  const invite = params.inviteToken
    ? await StudyRoomInvite.findOne({
        roomId: room._id,
        token: params.inviteToken,
        status: "pending",
      })
    : null;

  if (room.visibility === "closed" && !isOwner) {
    if (params.userId) {
      const directInvite = await StudyRoomInvite.findOne({
        roomId: room._id,
        userId: new Types.ObjectId(params.userId),
        status: "pending",
      });
      if (!directInvite && !invite) {
        throw new Error("This room is invite-only");
      }
    } else if (!invite) {
      throw new Error("This room is invite-only");
    }
  }

  const actorGuestId = params.userId ? undefined : params.guestId || `guest_${Date.now()}`;
  if (isParticipant(room, params.userId, actorGuestId)) {
    return room.toObject();
  }

  const displayName = params.userId
    ? params.userName || "Member"
    : params.guestName || "Guest";

  room.participants.push({
    userId: params.userId ? new Types.ObjectId(params.userId) : undefined,
    guestId: actorGuestId,
    displayName,
    email: params.userEmail,
    role: isOwner ? "host" : params.userId ? "member" : "guest",
    joinedAt: new Date(),
    points: JOIN_POINTS,
    xp: JOIN_POINTS,
    level: 1,
    completedCycles: 0,
    lastActiveAt: new Date(),
  } as any);

  const joinedActor = findActor(room, params.userId, actorGuestId);
  if (joinedActor) {
    await awardPoints({
      room,
      amount: 0,
      reason: "join",
      actor: joinedActor,
      metadata: { roomCode },
    });
  }

  await room.save();

  if (invite) {
    invite.status = "accepted";
    invite.acceptedAt = new Date();
    await invite.save();
  }

  emitRoomEvent(roomCode, "study_room:presence", {
    roomCode,
    participants: room.participants.filter((p) => !p.leftAt),
    leaderboard: getLeaderboard(room),
  });

  return room.toObject();
};

export const postMessage = async (params: {
  roomCode: string;
  content: string;
  userId?: string;
  userName?: string;
  guestId?: string;
  guestName?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");

  const actorKey = params.userId || params.guestId || "anonymous";
  const now = Date.now();
  const lastAt = lastMessageByActor.get(actorKey) || 0;
  if (now - lastAt < CHAT_COOLDOWN_MS) {
    throw new Error("Please wait before sending another message");
  }
  lastMessageByActor.set(actorKey, now);

  if (!isParticipant(room, params.userId, params.guestId)) {
    throw new Error("Join the room before sending messages");
  }

  const senderName = params.userId ? params.userName || "Member" : params.guestName || "Guest";
  const message = await runInTransaction(async (session) => {
    const created = await StudyRoomMessage.create(
      [
        {
          roomId: room._id,
          senderUserId: params.userId ? new Types.ObjectId(params.userId) : undefined,
          senderGuestId: params.guestId,
          senderName,
          content: params.content.trim(),
        },
      ],
      { session },
    );
    return created[0];
  });

  emitRoomEvent(room.roomCode, "study_room:chat:new", {
    roomCode: room.roomCode,
    message,
  });

  return message;
};

export const updateTimer = async (params: {
  roomCode: string;
  actorId: string;
  action: "start" | "pause" | "reset" | "tickComplete";
  durationSeconds?: number;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) {
    throw new Error("Only host or moderator can control timer");
  }

  const timer = room.timer as any;
  if (params.action === "start") {
    timer.isRunning = true;
    timer.startedAt = new Date();
    timer.checkInOpen = false;
    timer.checkInDeadlineAt = undefined;
    if (params.durationSeconds) {
      timer.durationSeconds = params.durationSeconds;
      timer.remainingSeconds = params.durationSeconds;
    }
  } else if (params.action === "pause") {
    if (timer.isRunning && timer.startedAt) {
      const elapsed = Math.floor(
        (Date.now() - new Date(timer.startedAt).getTime()) / 1000,
      );
      timer.remainingSeconds = Math.max(0, timer.remainingSeconds - elapsed);
    }
    timer.isRunning = false;
    timer.startedAt = undefined;
  } else if (params.action === "reset") {
    timer.isRunning = false;
    timer.startedAt = undefined;
    timer.remainingSeconds = timer.durationSeconds;
    timer.checkInOpen = false;
    timer.checkInDeadlineAt = undefined;
  } else if (params.action === "tickComplete") {
    if (timer.isRunning && timer.startedAt) {
      const elapsed = Math.floor(
        (Date.now() - new Date(timer.startedAt).getTime()) / 1000,
      );
      timer.remainingSeconds = Math.max(0, timer.remainingSeconds - elapsed);
    }
    timer.isRunning = false;
    timer.startedAt = undefined;
    timer.cycle = (timer.cycle || 0) + 1;
    timer.remainingSeconds = timer.durationSeconds;
    timer.checkInOpen = true;
    timer.checkInDeadlineAt = new Date(Date.now() + 2 * 60 * 1000);

    // Award every active participant for completing the cycle
    const activeParticipants = room.participants.filter((p: any) => !p.leftAt);
    for (const participant of activeParticipants) {
      await awardPoints({
        room,
        amount: TIMER_COMPLETE_POINTS,
        reason: "timer_complete",
        actor: participant,
        metadata: { cycle: timer.cycle },
      });
    }

    if (MILESTONE_CYCLE_STEPS.includes(timer.cycle || 0)) {
      const cycleMilestone = {
        id: nanoid(10),
        type: "cycles_milestone" as const,
        userId: undefined,
        guestId: undefined,
        displayName: "Room",
        value: timer.cycle,
        createdAt: new Date(),
      };
      room.milestones.push(cycleMilestone);
      emitRoomEvent(room.roomCode, "study_room:milestone", {
        roomCode: room.roomCode,
        milestone: cycleMilestone,
      });
    }
  }

  await room.save();
  const leaderboard = getLeaderboard(room);
  emitRoomEvent(room.roomCode, "study_room:timer:state", {
    roomCode: room.roomCode,
    timer: room.timer,
    leaderboard,
  });
  return { timer: room.timer, leaderboard };
};

export const setRoomLock = async (roomCode: string, actorId: string, isLocked: boolean) => {
  const room = await StudyRoom.findOne({ roomCode: roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, actorId)) throw new Error("Only host or moderator can lock/unlock room");
  room.isLocked = isLocked;
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:locked", { roomCode: room.roomCode, isLocked });
  return room;
};

export const endRoom = async (roomCode: string, actorId: string) => {
  const room = await StudyRoom.findOne({ roomCode: roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, actorId)) throw new Error("Only host or moderator can end room");
  room.status = "ended";
  room.timer.isRunning = false;
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:ended", { roomCode: room.roomCode });
  return room;
};

export const revokeInvite = async (roomCode: string, actorId: string, inviteId: string) => {
  const room = await StudyRoom.findOne({ roomCode: roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, actorId)) throw new Error("Only host or moderator can revoke invites");
  const invite = await StudyRoomInvite.findOne({ _id: inviteId, roomId: room._id });
  if (!invite) throw new Error("Invite not found");
  invite.status = "revoked";
  invite.revokedAt = new Date();
  await invite.save();
  emitRoomEvent(room.roomCode, "study_room:invite:revoked", {
    roomCode: room.roomCode,
    inviteId,
  });
  return invite;
};

export const updateMemberRole = async (params: {
  roomCode: string;
  actorId: string;
  memberUserId: string;
  role: "moderator" | "member";
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (room.hostId.toString() !== params.actorId) {
    throw new Error("Only host can delegate moderator role");
  }
  const member = room.participants.find(
    (p) => p.userId?.toString() === params.memberUserId && !p.leftAt,
  );
  if (!member) throw new Error("Member not found in room");
  if (member.role === "guest" || member.role === "host") {
    throw new Error("Role cannot be updated for this participant");
  }
  member.role = params.role;
  const actor = findActor(room, params.actorId, undefined);
  appendRoomEventLog(room, {
    action: "member_role_updated",
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName,
    targetUserId: member.userId,
    targetDisplayName: member.displayName,
    metadata: { role: params.role },
  });
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:presence", {
    roomCode: room.roomCode,
    participants: room.participants.filter((p) => !p.leftAt),
    leaderboard: getLeaderboard(room),
  });
  return member;
};

export const submitCycleCheckIn = async (params: {
  roomCode: string;
  userId?: string;
  guestId?: string;
  displayName?: string;
  status: "completed" | "partial" | "not_done";
  note?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!room.timer?.checkInOpen) throw new Error("Cycle check-in is closed");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  const cycle = room.timer.cycle || 0;
  const existing = room.cycleCheckIns.find(
    (entry: any) =>
      entry.cycle === cycle &&
      ((params.userId && entry.userId?.toString() === params.userId) ||
        (params.guestId && entry.guestId === params.guestId)),
  );
  if (existing) {
    existing.status = params.status;
    existing.note = params.note;
    existing.submittedAt = new Date();
  } else {
    room.cycleCheckIns.push({
      cycle,
      userId: actor.userId,
      guestId: actor.guestId,
      displayName: actor.displayName || params.displayName || "Member",
      status: params.status,
      note: params.note,
      submittedAt: new Date(),
    } as any);
  }
  if (params.status === "completed") {
    actor.completedCycles = (actor.completedCycles || 0) + 1;
  }
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:checkin:new", {
    roomCode: room.roomCode,
    cycle,
    checkIns: room.cycleCheckIns.filter((entry: any) => entry.cycle === cycle),
  });
  return room.cycleCheckIns.filter((entry: any) => entry.cycle === cycle);
};

export const updateAvatar = async (params: {
  roomCode: string;
  userId?: string;
  guestId?: string;
  avatarConfig: Record<string, unknown>;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  actor.avatarConfig = params.avatarConfig;
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:presence", {
    roomCode: room.roomCode,
    participants: room.participants.filter((p) => !p.leftAt),
    leaderboard: getLeaderboard(room),
  });
  return actor;
};

export const createTask = async (params: {
  roomCode: string;
  actorId: string;
  title: string;
  description?: string;
  points: number;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can create tasks");
  const task = {
    id: nanoid(10),
    title: params.title.trim(),
    description: params.description?.trim(),
    points: params.points,
    createdByUserId: new Types.ObjectId(params.actorId),
    createdAt: new Date(),
    completedBy: [],
  };
  room.tasks.push(task as any);
  const actor = findActor(room, params.actorId, undefined);
  appendRoomEventLog(room, {
    action: "task_created",
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName,
    metadata: { taskId: task.id, points: params.points },
  });
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:task:new", { roomCode: room.roomCode, task });
  return task;
};

export const completeTask = async (params: {
  roomCode: string;
  taskId: string;
  userId?: string;
  guestId?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  const actorKey = params.userId || params.guestId || "anonymous";
  consumeActionCooldown(
    lastTaskCompleteByActor,
    actorKey,
    TASK_COMPLETE_COOLDOWN_MS,
    "Please wait before completing another task",
  );
  const task = room.tasks.find((item: any) => item.id === params.taskId);
  if (!task) throw new Error("Task not found");
  const alreadyCompleted = task.completedBy.some(
    (entry: any) =>
      (params.userId && entry.userId?.toString() === params.userId) ||
      (params.guestId && entry.guestId === params.guestId),
  );
  if (alreadyCompleted) throw new Error("Task already completed");
  task.completedBy.push({
    userId: actor.userId,
    guestId: actor.guestId,
    completedAt: new Date(),
  });
  appendRoomEventLog(room, {
    action: "task_completed",
    actorUserId: actor.userId,
    actorDisplayName: actor.displayName,
    metadata: { taskId: task.id, points: task.points },
  });
  await runInTransaction(async (session) => {
    await awardPoints({
      room,
      amount: task.points,
      reason: "task_complete",
      actor,
      metadata: { taskId: task.id },
      session,
    });
    await room.save({ session });
  });
  emitRoomEvent(room.roomCode, "study_room:task:completed", {
    roomCode: room.roomCode,
    taskId: task.id,
    by: actor.displayName,
    leaderboard: getLeaderboard(room),
  });
  return task;
};

export const postMedia = async (params: {
  roomCode: string;
  actorId: string;
  url: string;
  title?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can post media");
  const actor = findActor(room, params.actorId, undefined);
  if (!actor) throw new Error("Actor not in room");
  consumeActionCooldown(
    lastMediaPostByActor,
    params.actorId,
    MEDIA_POST_COOLDOWN_MS,
    "Please wait before posting another media URL",
  );
  const { normalizedUrl, kind } = parseAndValidateMediaUrl(params.url);
  const media = {
    id: nanoid(10),
    kind,
    url: normalizedUrl,
    title: params.title?.trim(),
    postedByUserId: actor.userId,
    postedByName: actor.displayName,
    createdAt: new Date(),
  };
  room.mediaPosts.push(media as any);
  room.sharedMedia = {
    currentUrl: media.url,
    kind: media.kind,
    status: "paused",
    currentTime: 0,
    updatedByUserId: actor.userId,
    updatedByName: actor.displayName,
    updatedAt: new Date(),
  } as any;
  appendRoomEventLog(room, {
    action: "media_posted",
    actorUserId: actor.userId,
    actorDisplayName: actor.displayName,
    metadata: { mediaId: media.id, kind },
  });
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:media:new", { roomCode: room.roomCode, media });
  emitRoomEvent(room.roomCode, "study_room:media:shared_updated", {
    roomCode: room.roomCode,
    sharedMedia: room.sharedMedia,
  });
  return media;
};

export const syncMediaState = async (params: {
  roomCode: string;
  actorId: string;
  status: "playing" | "paused";
  currentTime: number;
}) => {
  const room = await StudyRoom.findOne({
    roomCode: params.roomCode.toUpperCase(),
  });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) {
    throw new Error("Only host or moderators can sync media state");
  }

  const actor = findActor(room, params.actorId, undefined);

  room.sharedMedia = {
    ...room.sharedMedia,
    status: params.status,
    currentTime: params.currentTime,
    updatedByUserId: actor?.userId,
    updatedByName: actor?.displayName,
    updatedAt: new Date(),
  } as any;

  await room.save();

  emitRoomEvent(room.roomCode, "study_room:media:sync", {
    roomCode: room.roomCode,
    status: params.status,
    currentTime: params.currentTime,
    updatedAt: room.sharedMedia?.updatedAt,
  });

  return room.sharedMedia;
};

export const openGameReadyCheck = async (params: {
  roomCode: string;
  actorId: string;
  minReadyCount?: number;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can start ready check");
  room.readyState = {
    isOpen: true,
    startedByUserId: new Types.ObjectId(params.actorId),
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + READY_CHECK_MS),
    minReadyCount: Math.max(2, params.minReadyCount || 2),
    readyParticipants: [],
  } as any;
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:game:ready_opened", {
    roomCode: room.roomCode,
    readyState: room.readyState,
  });
  return room.readyState;
};

export const toggleGameReady = async (params: {
  roomCode: string;
  userId?: string;
  guestId?: string;
  displayName?: string;
  ready: boolean;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!room.readyState?.isOpen) throw new Error("Ready check is not open");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  const withoutActor = room.readyState.readyParticipants.filter(
    (entry: any) =>
      !((params.userId && entry.userId?.toString() === params.userId) || (params.guestId && entry.guestId === params.guestId)),
  );
  room.readyState.readyParticipants = withoutActor as any;
  if (params.ready) {
    room.readyState.readyParticipants.push({
      userId: actor.userId,
      guestId: actor.guestId,
      displayName: actor.displayName || params.displayName || "Member",
      readyAt: new Date(),
    } as any);
  }
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:game:ready_updated", {
    roomCode: room.roomCode,
    readyState: room.readyState,
  });
  return room.readyState;
};

export const updateMediaPreference = async (params: {
  roomCode: string;
  userId?: string;
  guestId?: string;
  mode: "follow_host" | "personal";
  personalMediaUrl?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  actor.mediaMode = params.mode;
  actor.personalMediaUrl = params.mode === "personal" ? params.personalMediaUrl?.trim() : undefined;
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:media:mode_changed", {
    roomCode: room.roomCode,
    actorId: actor.userId?.toString() || actor.guestId,
    mode: actor.mediaMode,
    personalMediaUrl: actor.personalMediaUrl,
  });
  return {
    mode: actor.mediaMode,
    personalMediaUrl: actor.personalMediaUrl,
  };
};

export const generateAiGame = async (params: {
  roomCode: string;
  actorId: string;
  type: "word_guess" | "qa";
  topic?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can generate games");

  const user = await User.findById(params.actorId).select("planTier isSubscribed role").lean();
  const tier = String((user as any)?.planTier || "");
  const subscribed = Boolean((user as any)?.isSubscribed);
  const role = String((user as any)?.role || "");

  const isStaff = role === "super_admin" || role === "moderator";
  if (!isStaff && (!subscribed || !AI_GAME_ALLOWED_TIERS.has(tier))) {
    throw new Error("AI game generation requires a higher plan tier");
  }

  room.activeGame = {
    type: params.type,
    source: "ai",
    topic: params.topic?.trim(),
    status: "generating",
    isActive: false,
    startedByUserId: new Types.ObjectId(params.actorId),
    startedAt: new Date(),
  } as any;

  await room.save();

  shortQueue.enqueue("study_room:game:generate", {
    roomCode: room.roomCode,
    actorId: params.actorId,
    type: params.type,
    topic: params.topic,
  });

  emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
    roomCode: room.roomCode,
    game: room.activeGame,
  });

  return room.activeGame;
};

export const startGame = async (params: {
  roomCode: string;
  actorId: string;
  type?: "word_guess" | "qa";
  prompt?: string;
  answer?: string;
  source?: "manual" | "ai";
  topic?: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can start games");

  const actor = findActor(room, params.actorId, undefined);

  let type = params.type;
  let prompt = params.prompt?.trim();
  let answer = params.answer?.trim().toUpperCase();
  let source = params.source || "manual";
  let topic = params.topic?.trim();
  let options: string[] = [];
  let correctOption: number | undefined;

  // Pattern A: Start from Draft (Ready state)
  if (!prompt && room.activeGame?.status === "ready") {
    type = room.activeGame.type;
    prompt = room.activeGame.prompt;
    answer = room.activeGame.answer;
    source = room.activeGame.source || "ai";
    topic = room.activeGame.topic;
    options = room.activeGame.options || [];
    correctOption = room.activeGame.correctOption;
  } else {
    // Pattern B: New Manual Game
    if (!type || !prompt) throw new Error("Game type and prompt are required");

    if (!room.readyState?.isOpen) {
      throw new Error("Start a ready check before starting the game");
    }
    const readyCount = room.readyState.readyParticipants?.length || 0;
    if (readyCount < (room.readyState.minReadyCount || 2)) {
      throw new Error("Not enough ready participants");
    }

    if (source === "ai") {
      const user = await User.findById(params.actorId).select("planTier isSubscribed role").lean();
      const tier = String((user as any)?.planTier || "");
      const subscribed = Boolean((user as any)?.isSubscribed);
      const role = String((user as any)?.role || "");

      const isStaff = role === "super_admin" || role === "moderator";
      if (!isStaff && (!subscribed || !AI_GAME_ALLOWED_TIERS.has(tier))) {
        throw new Error("AI game generation requires a higher plan tier");
      }
      
      // Fallback to static bank if somehow called directly with source: ai
      if (type === "word_guess") {
        answer = chooseWord(topic || prompt);
        prompt = `AI Word Guess (${topic || "General"})`;
      } else {
        const qa = chooseQa(topic || prompt);
        prompt = qa.question;
        options = qa.options;
        correctOption = qa.correctOption;
        answer = String(qa.correctOption);
      }
    }
  }

  room.activeGame = {
    type,
    source,
    topic,
    status: "running",
    prompt,
    answer,
    options,
    correctOption,
    guessedLetters: [],
    wrongLetters: [],
    maskedWord: type === "word_guess" && answer ? toMaskedWord(answer, []) : undefined,
    responses: [],
    roundEndsAt: new Date(Date.now() + ROUND_MS),
    revealEndsAt: undefined,
    nextRoundStartsAt: undefined,
    startedByUserId: new Types.ObjectId(params.actorId),
    startedAt: new Date(),
    isActive: true,
  } as any;

  if (room.readyState) {
    room.readyState.isOpen = false;
    room.readyState.readyParticipants = [] as any;
  }

  appendRoomEventLog(room, {
    action: "game_started",
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName,
    metadata: { type, source },
  });

  await room.save();

  // Enqueue round expiry for Q&A so reveal fires even if not all players answer
  if (type === "qa") {
    const expireJobId = `qa:expire:${room.roomCode}:${Date.now()}`;
    shortQueue.enqueue(
      "study_room:qa:round_expire",
      { roomCode: room.roomCode },
      1,
      expireJobId,
      ROUND_MS,
    );
  }

  emitRoomEvent(room.roomCode, "study_room:game:started", {
    roomCode: room.roomCode,
    game: room.activeGame,
  });

  emitRoomEvent(room.roomCode, "study_room:game:ready_closed", {
    roomCode: room.roomCode,
    reason: "game_started",
  });

  return room.activeGame;
};

/**
 * Ends a Q&A round — sets status to "reveal" and broadcasts results.
 * Idempotent: no-ops if game is already revealed or not a Q&A game.
 * Called by submitGameAnswer (all-answered path) and study_room:qa:round_expire job.
 */
export const endQaRound = async (roomCode: string): Promise<void> => {
  const room = await StudyRoom.findOne({ roomCode: roomCode.toUpperCase() });
  if (!room) return;
  const activeGame = room.activeGame;
  if (!activeGame || !activeGame.isActive || activeGame.type !== "qa") return;

  const optionCount = activeGame.options?.length || 0;
  const totalResponses = activeGame.responses?.length || 0;
  const percentages = Array.from({ length: optionCount }).map((_, idx) => {
    const picks = (activeGame.responses || []).filter((e: any) => e.optionIndex === idx).length;
    return totalResponses > 0 ? Math.round((picks / totalResponses) * 100) : 0;
  });

  activeGame.status = "reveal";
  activeGame.revealEndsAt = new Date(Date.now() + REVEAL_MS);
  activeGame.nextRoundStartsAt = new Date(Date.now() + REVEAL_MS);
  activeGame.isActive = false;

  await room.save();

  emitRoomEvent(room.roomCode, "study_room:game:reveal", {
    roomCode: room.roomCode,
    correctOption: activeGame.correctOption,
    percentages,
    revealEndsAt: activeGame.revealEndsAt,
    nextRoundStartsAt: activeGame.nextRoundStartsAt,
    leaderboard: getLeaderboard(room),
  });
};

export const submitGameAnswer = async (params: {
  roomCode: string;
  userId?: string;
  guestId?: string;
  answer: string;
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!room.activeGame?.isActive) throw new Error("No active game");
  const actor = findActor(room, params.userId, params.guestId);
  if (!actor) throw new Error("Join the room first");
  const actorKey = params.userId || params.guestId || "anonymous";
  consumeActionCooldown(
    lastGameAnswerByActor,
    actorKey,
    GAME_ANSWER_COOLDOWN_MS,
    "Please wait before submitting another answer",
  );
  if (room.activeGame.type === "word_guess") {
    const submitted = params.answer.trim().toUpperCase();
    const target = String(room.activeGame.answer || "").toUpperCase();
    if (!target) throw new Error("Game answer is not configured");
    if (submitted.length === 1) {
      const letter = submitted;
      const guessed = new Set<string>(room.activeGame.guessedLetters || []);
      const wrong = new Set<string>(room.activeGame.wrongLetters || []);
      if (guessed.has(letter) || wrong.has(letter)) {
        return { correct: false, duplicate: true, maskedWord: room.activeGame.maskedWord };
      }
      if (target.includes(letter)) {
        guessed.add(letter);
        room.activeGame.guessedLetters = Array.from(guessed);
        room.activeGame.maskedWord = toMaskedWord(target, room.activeGame.guessedLetters || []);
        const completed = !room.activeGame.maskedWord.includes("_");
        if (!completed) {
          await room.save();
          emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
            roomCode: room.roomCode,
            game: room.activeGame,
          });
          return { correct: true, maskedWord: room.activeGame.maskedWord };
        }
        room.activeGame.status = "reveal";
        room.activeGame.revealEndsAt = new Date(Date.now() + REVEAL_MS);
        room.activeGame.nextRoundStartsAt = new Date(Date.now() + REVEAL_MS);
        room.activeGame.isActive = false;
        await runInTransaction(async (session) => {
          await awardPoints({
            room,
            amount: 14,
            reason: "game_win",
            actor,
            metadata: { gameType: room.activeGame!.type },
            session,
          });
          await room.save({ session });
        });
        emitRoomEvent(room.roomCode, "study_room:game:winner", {
          roomCode: room.roomCode,
          winner: actor.displayName,
          leaderboard: getLeaderboard(room),
          revealEndsAt: room.activeGame.revealEndsAt,
          nextRoundStartsAt: room.activeGame.nextRoundStartsAt,
        });
        return { winner: actor.displayName, correct: true, maskedWord: room.activeGame.maskedWord };
      }
      wrong.add(letter);
      room.activeGame.wrongLetters = Array.from(wrong);
      await runInTransaction(async (session) => {
        await awardPoints({
          room,
          amount: -2,
          reason: "game_wrong_penalty",
          actor,
          metadata: { gameType: room.activeGame!.type },
          session,
        });
        await room.save({ session });
      });
      emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
        roomCode: room.roomCode,
        game: room.activeGame,
      });
      return { correct: false, maskedWord: room.activeGame.maskedWord };
    }
    if (submitted === target) {
      room.activeGame.maskedWord = target.split("").join(" ");
      room.activeGame.status = "reveal";
      room.activeGame.revealEndsAt = new Date(Date.now() + REVEAL_MS);
      room.activeGame.nextRoundStartsAt = new Date(Date.now() + REVEAL_MS);
      room.activeGame.isActive = false;
      await runInTransaction(async (session) => {
        await awardPoints({
          room,
          amount: 16,
          reason: "game_win",
          actor,
          metadata: { gameType: room.activeGame!.type, solvedByWord: true },
          session,
        });
        await room.save({ session });
      });
      emitRoomEvent(room.roomCode, "study_room:game:winner", {
        roomCode: room.roomCode,
        winner: actor.displayName,
        leaderboard: getLeaderboard(room),
        revealEndsAt: room.activeGame.revealEndsAt,
        nextRoundStartsAt: room.activeGame.nextRoundStartsAt,
      });
      return { winner: actor.displayName, correct: true, maskedWord: room.activeGame.maskedWord };
    }
    await runInTransaction(async (session) => {
      await awardPoints({
        room,
        amount: -2,
        reason: "game_wrong_penalty",
        actor,
        metadata: { gameType: room.activeGame!.type, wrongWordAttempt: true },
        session,
      });
      await room.save({ session });
    });
    // Notify all players so they see the failed attempt
    emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
      roomCode: room.roomCode,
      game: room.activeGame,
    });
    return { correct: false };
  }

  const optionIndex = Number(params.answer);
  if (!Number.isInteger(optionIndex)) throw new Error("Select a valid option");
  const activeGame = room.activeGame;
  if (!activeGame) throw new Error("No active game");
  activeGame.responses = activeGame.responses || [];
  const existing = activeGame.responses.find(
    (entry: any) =>
      (params.userId && entry.userId?.toString() === params.userId) ||
      (params.guestId && entry.guestId === params.guestId),
  );
  if (existing) {
    return { correct: existing.optionIndex === activeGame.correctOption, duplicate: true };
  }
  activeGame.responses.push({
    userId: actor.userId,
    guestId: actor.guestId,
    optionIndex,
    answeredAt: new Date(),
  } as any);
  const isCorrect = optionIndex === activeGame.correctOption;

  const totalResponses = activeGame.responses.length;
  const optionCount = activeGame.options?.length || 0;
  const percentages = Array.from({ length: optionCount }).map((_, idx) => {
    const picks = (activeGame.responses || []).filter((entry: any) => entry.optionIndex === idx).length;
    return totalResponses > 0 ? Math.round((picks / totalResponses) * 100) : 0;
  });

  // Reveal only when every active participant has submitted an answer
  const activePlayers = room.participants.filter((p: any) => !p.leftAt);
  const allAnswered =
    activePlayers.length > 0 &&
    activePlayers.every((p: any) =>
      (activeGame.responses || []).some(
        (r: any) =>
          (p.userId && r.userId?.toString() === p.userId.toString()) ||
          (p.guestId && r.guestId === p.guestId),
      ),
    );

  // Persist response + updated points before any reveal logic reads from DB
  await runInTransaction(async (session) => {
    await awardPoints({
      room,
      amount: isCorrect ? 12 : -2,
      reason: isCorrect ? "qa_correct" : "game_wrong_penalty",
      actor,
      metadata: { gameType: activeGame.type },
      session,
    });
    await room.save({ session });
  });

  if (allAnswered) {
    // endQaRound fetches fresh from DB — safe because we just committed above
    await endQaRound(room.roomCode);
    return { correct: isCorrect, percentages, correctOption: activeGame.correctOption, revealed: true };
  }

  // Round still in progress — broadcast live percentages so UI updates
  emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
    roomCode: room.roomCode,
    game: room.activeGame,
    percentages,
  });
  return { correct: isCorrect, percentages };
};

export const moderateMember = async (params: {
  roomCode: string;
  actorId: string;
  memberUserId?: string;
  memberGuestId?: string;
  action: "mute" | "kick";
}) => {
  const room = await StudyRoom.findOne({ roomCode: params.roomCode.toUpperCase() });
  if (!room) throw new Error("Study room not found");
  if (!canManageRoom(room, params.actorId)) throw new Error("Only host or moderators can moderate");
  const actor = findActor(room, params.actorId, undefined);
  const target = room.participants.find(
    (p) =>
      !p.leftAt &&
      ((params.memberUserId && p.userId?.toString() === params.memberUserId) ||
        (params.memberGuestId && p.guestId === params.memberGuestId)),
  );
  if (!target) throw new Error("Member not found");
  if (target.role === "host") throw new Error("Host cannot be moderated");
  if (params.action === "kick") {
    target.leftAt = new Date();
  }
  appendRoomEventLog(room, {
    action: "member_moderated",
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName,
    targetUserId: target.userId,
    targetDisplayName: target.displayName,
    metadata: { moderationAction: params.action },
  });
  await room.save();
  emitRoomEvent(room.roomCode, "study_room:moderation", {
    roomCode: room.roomCode,
    action: params.action,
    target: target.displayName,
    targetUserId: target.userId?.toString() ?? undefined,
    targetGuestId: target.guestId ?? undefined,
  });
  return target;
};

