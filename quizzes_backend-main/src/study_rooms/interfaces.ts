import { Document, Types } from "mongoose";

export type StudyRoomVisibility = "open" | "closed";
export type StudyRoomStatus = "active" | "ended";
export type StudyRoomParticipantRole =
  | "host"
  | "moderator"
  | "member"
  | "guest";
export type StudyRoomInviteType = "username" | "email" | "link";
export type StudyRoomInviteStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface IStudyRoomParticipant {
  userId?: Types.ObjectId;
  guestId?: string;
  displayName: string;
  email?: string;
  role: StudyRoomParticipantRole;
  joinedAt: Date;
  leftAt?: Date;
  points: number;
  lastActiveAt?: Date;
  avatarConfig?: Record<string, unknown>;
  level?: number;
  xp?: number;
  completedCycles?: number;
  mediaMode?: "follow_host" | "personal";
  personalMediaUrl?: string;
}

export interface IStudyRoomTimerState {
  isRunning: boolean;
  startedAt?: Date;
  durationSeconds: number;
  remainingSeconds: number;
  cycle: number;
  checkInOpen?: boolean;
  checkInDeadlineAt?: Date;
}

export interface IStudyRoomTask {
  id: string;
  title: string;
  description?: string;
  points: number;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  completedBy: Array<{
    userId?: Types.ObjectId;
    guestId?: string;
    completedAt: Date;
  }>;
}

export interface IStudyRoomCycleCheckIn {
  cycle: number;
  userId?: Types.ObjectId;
  guestId?: string;
  displayName: string;
  status: "completed" | "partial" | "not_done";
  note?: string;
  submittedAt: Date;
}

export interface IStudyRoomMediaPost {
  id: string;
  kind: "youtube" | "spotify" | "link";
  url: string;
  title?: string;
  postedByUserId?: Types.ObjectId;
  postedByGuestId?: string;
  postedByName: string;
  createdAt: Date;
}

export interface IStudyRoomMilestoneEvent {
  id: string;
  type: "level_up" | "points_milestone" | "cycles_milestone" | "task_streak";
  userId?: Types.ObjectId;
  guestId?: string;
  displayName: string;
  value: number;
  createdAt: Date;
}

export interface IStudyRoom extends Document {
  _id: Types.ObjectId;
  roomCode: string;
  title: string;
  topic?: string;
  hostId: Types.ObjectId;
  visibility: StudyRoomVisibility;
  status: StudyRoomStatus;
  isLocked: boolean;
  maxParticipants: number;
  participants: IStudyRoomParticipant[];
  inviteRateWindow: {
    startedAt: Date;
    count: number;
  };
  timer: IStudyRoomTimerState;
  featureFlags: {
    tasksEnabled: boolean;
    gamesEnabled: boolean;
    mediaEnabled: boolean;
    avatarsEnabled: boolean;
  };
  tasks: IStudyRoomTask[];
  cycleCheckIns: IStudyRoomCycleCheckIn[];
  mediaPosts: IStudyRoomMediaPost[];
  milestones: IStudyRoomMilestoneEvent[];
  eventLogs?: Array<{
    id: string;
    action: string;
    actorUserId?: Types.ObjectId;
    actorDisplayName?: string;
    targetUserId?: Types.ObjectId;
    targetDisplayName?: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
  }>;
  readyState?: {
    isOpen: boolean;
    startedByUserId?: Types.ObjectId;
    startedAt?: Date;
    expiresAt?: Date;
    minReadyCount: number;
    readyParticipants: Array<{
      userId?: Types.ObjectId;
      guestId?: string;
      displayName: string;
      readyAt: Date;
    }>;
  };
  sharedMedia?: {
    currentUrl?: string;
    kind?: "youtube" | "spotify" | "link";
    status?: "playing" | "paused";
    currentTime?: number;
    updatedByUserId?: Types.ObjectId;
    updatedByName?: string;
    updatedAt?: Date;
  };
  activeGame?: {
    type: "word_guess" | "qa";
    prompt: string;
    answer?: string;
    source?: "manual" | "ai";
    status?: "generating" | "ready" | "waiting" | "running" | "reveal" | "ended";
    topic?: string;
    maskedWord?: string;
    guessedLetters?: string[];
    wrongLetters?: string[];
    options?: string[];
    correctOption?: number;
    responses?: Array<{
      userId?: Types.ObjectId;
      guestId?: string;
      optionIndex: number;
      answeredAt: Date;
    }>;
    roundEndsAt?: Date;
    revealEndsAt?: Date;
    nextRoundStartsAt?: Date;
    startedByUserId: Types.ObjectId;
    startedAt: Date;
    isActive: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IStudyRoomPointsLedger extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  userId?: Types.ObjectId;
  guestId?: string;
  displayName: string;
  amount: number;
  reason:
    | "join"
    | "timer_complete"
    | "task_complete"
    | "game_win"
    | "qa_correct"
    | "game_wrong_penalty"
    | "moderator_adjustment";
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IStudyRoomInvite extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  invitedBy: Types.ObjectId;
  inviteType: StudyRoomInviteType;
  status: StudyRoomInviteStatus;
  userId?: Types.ObjectId;
  email?: string;
  username?: string;
  token: string;
  expiresAt: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStudyRoomMessage extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  senderUserId?: Types.ObjectId;
  senderGuestId?: string;
  senderName: string;
  content: string;
  createdAt: Date;
}

