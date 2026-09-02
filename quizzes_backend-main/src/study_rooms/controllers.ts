import { Request, Response } from "express";
import { sendError, sendSuccess } from "@/utils";
import * as services from "./services";
import { services as featuresServices } from "@/features";

export const createRoom = async (req: Request, res: Response) => {
  try {
    if (!(await featuresServices.isEnabled("study_rooms_enabled"))) {
      return sendError(res, "Study rooms feature is disabled", 404);
    }
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const room = await services.createRoom({
      hostId: user.id,
      hostName: user.name,
      title: req.body.title,
      topic: req.body.topic,
      visibility: req.body.visibility,
      maxParticipants: req.body.maxParticipants,
      timerMinutes: req.body.timerMinutes,
    });
    return sendSuccess(res, "Study room created", room, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const listRooms = async (req: Request, res: Response) => {
  try {
    const rooms = await services.listRoomsForUser(req.user?.id);
    return sendSuccess(res, "Study rooms fetched", rooms);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const getRoom = async (req: Request, res: Response) => {
  try {
    const data = await services.getRoomByCode(String(req.params.code));
    return sendSuccess(res, "Study room fetched", data);
  } catch (error: any) {
    return sendError(res, error.message, 404);
  }
};

export const joinRoom = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const room = await services.joinRoom({
      roomCode: String(req.body.roomCode || req.params.code),
      userId: user?.id,
      userName: user?.name,
      inviteToken: req.body.inviteToken,
      guestName: req.body.guestName,
      guestId: req.headers["x-guest-id"] as string | undefined,
    });
    return sendSuccess(res, "Joined study room", room);
  } catch (error: any) {
    return sendError(res, error.message, 403);
  }
};

export const inviteByUsername = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const invite = await services.inviteByUsername({
      roomCode: String(req.params.code),
      hostId: user.id,
      username: req.body.username,
    });
    return sendSuccess(res, "Invite created", invite, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const inviteByEmail = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const invite = await services.inviteByEmail({
      roomCode: String(req.params.code),
      hostId: user.id,
      email: req.body.email,
    });
    return sendSuccess(res, "Invite email sent", invite, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const postMessage = async (req: Request, res: Response) => {
  try {
    const message = await services.postMessage({
      roomCode: String(req.params.code),
      content: req.body.content,
      userId: req.user?.id,
      userName: req.user?.name,
      guestId: req.headers["x-guest-id"] as string | undefined,
      guestName: req.body.guestName,
    });
    return sendSuccess(res, "Message sent", message, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const updateTimer = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const result = await services.updateTimer({
      roomCode: String(req.params.code),
      actorId: user.id,
      action: req.body.action,
      durationSeconds: req.body.durationSeconds,
    });
    return sendSuccess(res, "Timer updated", result);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const setRoomLock = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const room = await services.setRoomLock(
      String(req.params.code),
      user.id,
      Boolean(req.body.isLocked),
    );
    return sendSuccess(res, "Room lock updated", room);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const endRoom = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const room = await services.endRoom(String(req.params.code), user.id);
    return sendSuccess(res, "Room ended", room);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const revokeInvite = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return sendError(res, "Unauthorized", 401);
    const invite = await services.revokeInvite(
      String(req.params.code),
      user.id,
      String(req.params.inviteId),
    );
    return sendSuccess(res, "Invite revoked", invite);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const updateMemberRole = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const member = await services.updateMemberRole({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      memberUserId: req.body.memberUserId,
      role: req.body.role,
    });
    return sendSuccess(res, "Member role updated", member);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const submitCycleCheckIn = async (req: Request, res: Response) => {
  try {
    const checkIns = await services.submitCycleCheckIn({
      roomCode: String(req.params.code),
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
      displayName: req.user?.name || req.body.guestName,
      status: req.body.status,
      note: req.body.note,
    });
    return sendSuccess(res, "Cycle check-in submitted", checkIns);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const updateAvatar = async (req: Request, res: Response) => {
  try {
    const actor = await services.updateAvatar({
      roomCode: String(req.params.code),
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
      avatarConfig: req.body.avatarConfig,
    });
    return sendSuccess(res, "Avatar updated", actor);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const task = await services.createTask({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      title: req.body.title,
      description: req.body.description,
      points: req.body.points,
    });
    return sendSuccess(res, "Task created", task, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const completeTask = async (req: Request, res: Response) => {
  try {
    const task = await services.completeTask({
      roomCode: String(req.params.code),
      taskId: req.body.taskId,
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
    });
    return sendSuccess(res, "Task completed", task);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const postMedia = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const media = await services.postMedia({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      url: req.body.url,
      title: req.body.title,
    });
    return sendSuccess(res, "Media posted", media, null, 201);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const startGame = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const game = await services.startGame({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      type: req.body.type,
      prompt: req.body.prompt,
      answer: req.body.answer,
    });
    return sendSuccess(res, "Game started", game);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const submitGameAnswer = async (req: Request, res: Response) => {
  try {
    const result = await services.submitGameAnswer({
      roomCode: String(req.params.code),
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
      answer: req.body.answer,
    });
    return sendSuccess(res, "Answer submitted", result);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const moderateMember = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const result = await services.moderateMember({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      memberUserId: req.body.memberUserId,
      memberGuestId: req.body.memberGuestId,
      action: req.body.action,
    });
    return sendSuccess(res, "Moderation action applied", result);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const openGameReadyCheck = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const readyState = await services.openGameReadyCheck({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      minReadyCount: req.body.minReadyCount,
    });
    return sendSuccess(res, "Ready check opened", readyState);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const toggleGameReady = async (req: Request, res: Response) => {
  try {
    const readyState = await services.toggleGameReady({
      roomCode: String(req.params.code),
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
      displayName: req.user?.name || req.body.guestName,
      ready: Boolean(req.body.ready),
    });
    return sendSuccess(res, "Ready state updated", readyState);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const generateAiGame = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const game = await services.generateAiGame({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      type: req.body.type,
      topic: req.body.topic,
    });
    return sendSuccess(res, "AI game generation started", game);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const updateMediaPreference = async (req: Request, res: Response) => {
  try {
    const data = await services.updateMediaPreference({
      roomCode: String(req.params.code),
      userId: req.user?.id,
      guestId: req.headers["x-guest-id"] as string | undefined,
      mode: req.body.mode,
      personalMediaUrl: req.body.personalMediaUrl,
    });
    return sendSuccess(res, "Media preference updated", data);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

export const syncMediaState = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const data = await services.syncMediaState({
      roomCode: String(req.params.code),
      actorId: req.user.id,
      status: req.body.status,
      currentTime: req.body.currentTime,
    });
    return sendSuccess(res, "Media state synced", data);
  } catch (error: any) {
    return sendError(res, error.message, 400);
  }
};

