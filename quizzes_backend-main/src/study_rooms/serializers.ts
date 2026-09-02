import { z } from "zod";

export const CreateStudyRoomSerializer = z.object({
  title: z.string().min(2).max(120),
  topic: z.string().max(200).optional(),
  visibility: z.enum(["open", "closed"]).default("open"),
  maxParticipants: z.number().int().min(2).max(300).default(25),
  timerMinutes: z.number().int().min(5).max(180).default(25),
});

export const InviteByUsernameSerializer = z.object({
  username: z.string().min(2).max(64),
});

export const InviteByEmailSerializer = z.object({
  email: z.string().email(),
});

export const JoinRoomSerializer = z.object({
  roomCode: z.string().min(4).max(16),
  inviteToken: z.string().optional(),
  guestName: z.string().min(2).max(40).optional(),
});

export const PostRoomMessageSerializer = z.object({
  content: z.string().min(1).max(2000),
  guestName: z.string().min(2).max(40).optional(),
});

export const UpdateTimerSerializer = z.object({
  action: z.enum(["start", "pause", "reset", "tickComplete"]),
  durationSeconds: z.number().int().min(60).max(6 * 60 * 60).optional(),
});

export const UpdateMemberRoleSerializer = z.object({
  memberUserId: z.string().min(8),
  role: z.enum(["moderator", "member"]),
});

export const CycleCheckInSerializer = z.object({
  status: z.enum(["completed", "partial", "not_done"]),
  note: z.string().max(300).optional(),
});

export const AvatarUpdateSerializer = z.object({
  avatarConfig: z.record(z.string(), z.unknown()),
});

export const CreateTaskSerializer = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  points: z.number().int().min(1).max(500),
});

export const CompleteTaskSerializer = z.object({
  taskId: z.string().min(4).max(40),
});

export const PostMediaSerializer = z.object({
  url: z.string().url().max(500),
  title: z.string().max(120).optional(),
});

export const StartGameSerializer = z.object({
  type: z.enum(["word_guess", "qa"]),
  prompt: z.string().min(2).max(200),
  answer: z.string().max(200).optional(),
});

export const SubmitGameAnswerSerializer = z.object({
  answer: z.string().min(1).max(200),
});

export const OpenReadyCheckSerializer = z.object({
  minReadyCount: z.number().int().min(2).max(100).optional(),
});

export const ToggleReadySerializer = z.object({
  ready: z.boolean(),
});

export const GenerateGameSerializer = z.object({
  type: z.enum(["word_guess", "qa"]),
  topic: z.string().max(120).optional(),
});

export const MediaPreferenceSerializer = z.object({
  mode: z.enum(["follow_host", "personal"]),
  personalMediaUrl: z.string().url().max(500).optional(),
});

export const ModerateMemberSerializer = z.object({
  memberUserId: z.string().min(8).optional(),
  memberGuestId: z.string().min(4).optional(),
  action: z.enum(["mute", "kick"]),
}).refine((value) => Boolean(value.memberUserId) !== Boolean(value.memberGuestId), {
  message: "Provide either memberUserId or memberGuestId",
});

export const SyncMediaStateSerializer = z.object({
  status: z.enum(["playing", "paused"]),
  currentTime: z.number().min(0),
});

