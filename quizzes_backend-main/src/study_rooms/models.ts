import { Schema, model } from "mongoose";
import { nanoid } from "nanoid";
import {
  IStudyRoom,
  IStudyRoomInvite,
  IStudyRoomMessage,
  IStudyRoomPointsLedger,
} from "./interfaces";

const ParticipantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestId: { type: String, trim: true },
    displayName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    role: {
      type: String,
      enum: ["host", "moderator", "member", "guest"],
      default: "member",
    },
    joinedAt: { type: Date, default: () => new Date() },
    leftAt: { type: Date },
    points: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: () => new Date() },
    avatarConfig: { type: Schema.Types.Mixed, default: undefined },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    completedCycles: { type: Number, default: 0 },
    mediaMode: { type: String, enum: ["follow_host", "personal"], default: "follow_host" },
    personalMediaUrl: { type: String, trim: true },
  },
  { _id: false },
);

const StudyRoomSchema = new Schema<IStudyRoom>(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      default: () => nanoid(8).toUpperCase(),
    },
    title: { type: String, required: true, trim: true },
    topic: { type: String, trim: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    visibility: { type: String, enum: ["open", "closed"], default: "open" },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    isLocked: { type: Boolean, default: false },
    maxParticipants: { type: Number, default: 25, min: 2, max: 300 },
    participants: { type: [ParticipantSchema], default: [] },
    inviteRateWindow: {
      startedAt: { type: Date, default: () => new Date() },
      count: { type: Number, default: 0 },
    },
    timer: {
      isRunning: { type: Boolean, default: false },
      startedAt: { type: Date },
      durationSeconds: { type: Number, default: 1500 },
      remainingSeconds: { type: Number, default: 1500 },
      cycle: { type: Number, default: 0 },
      checkInOpen: { type: Boolean, default: false },
      checkInDeadlineAt: { type: Date },
    },
    featureFlags: {
      tasksEnabled: { type: Boolean, default: true },
      gamesEnabled: { type: Boolean, default: true },
      mediaEnabled: { type: Boolean, default: true },
      avatarsEnabled: { type: Boolean, default: true },
    },
    tasks: {
      type: [
        {
          id: { type: String, required: true },
          title: { type: String, required: true, trim: true },
          description: { type: String, trim: true },
          points: { type: Number, required: true, min: 1, max: 500 },
          createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          createdAt: { type: Date, default: () => new Date() },
          completedBy: {
            type: [
              {
                userId: { type: Schema.Types.ObjectId, ref: "User" },
                guestId: { type: String },
                completedAt: { type: Date, default: () => new Date() },
              },
            ],
            default: [],
          },
        },
      ],
      default: [],
    },
    cycleCheckIns: {
      type: [
        {
          cycle: { type: Number, required: true },
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          guestId: { type: String },
          displayName: { type: String, required: true },
          status: {
            type: String,
            enum: ["completed", "partial", "not_done"],
            required: true,
          },
          note: { type: String, trim: true, maxlength: 300 },
          submittedAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    mediaPosts: {
      type: [
        {
          id: { type: String, required: true },
          kind: { type: String, enum: ["youtube", "spotify", "link"], required: true },
          url: { type: String, required: true, trim: true },
          title: { type: String, trim: true },
          postedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
          postedByGuestId: { type: String },
          postedByName: { type: String, required: true },
          createdAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    milestones: {
      type: [
        {
          id: { type: String, required: true },
          type: {
            type: String,
            enum: ["level_up", "points_milestone", "cycles_milestone", "task_streak"],
            required: true,
          },
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          guestId: { type: String },
          displayName: { type: String, required: true },
          value: { type: Number, required: true },
          createdAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    eventLogs: {
      type: [
        {
          id: { type: String, required: true },
          action: { type: String, required: true },
          actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
          actorDisplayName: { type: String, trim: true },
          targetUserId: { type: Schema.Types.ObjectId, ref: "User" },
          targetDisplayName: { type: String, trim: true },
          metadata: { type: Schema.Types.Mixed, default: undefined },
          createdAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    readyState: {
      type: {
        isOpen: { type: Boolean, default: false },
        startedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
        startedAt: { type: Date },
        expiresAt: { type: Date },
        minReadyCount: { type: Number, default: 2 },
        readyParticipants: {
          type: [
            {
              userId: { type: Schema.Types.ObjectId, ref: "User" },
              guestId: { type: String },
              displayName: { type: String, required: true },
              readyAt: { type: Date, default: () => new Date() },
            },
          ],
          default: [],
        },
      },
      default: { isOpen: false, minReadyCount: 2, readyParticipants: [] },
    },
    sharedMedia: {
      currentUrl: { type: String, trim: true },
      kind: { type: String, enum: ["youtube", "spotify", "link"] },
      status: { type: String, enum: ["playing", "paused"], default: "paused" },
      currentTime: { type: Number, default: 0 },
      updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
      updatedByName: { type: String, trim: true },
      updatedAt: { type: Date, default: Date.now },
    },
    activeGame: {
      type: {
        type: { type: String, enum: ["word_guess", "qa"] },
        prompt: { type: String, trim: true },
        answer: { type: String, trim: true },
        source: { type: String, enum: ["manual", "ai"], default: "manual" },
        status: { type: String, enum: ["generating", "ready", "waiting", "running", "reveal", "ended"], default: "running" },
        topic: { type: String, trim: true },
        maskedWord: { type: String, trim: true },
        guessedLetters: { type: [String], default: [] },
        wrongLetters: { type: [String], default: [] },
        options: { type: [String], default: [] },
        correctOption: { type: Number },
        responses: {
          type: [
            {
              userId: { type: Schema.Types.ObjectId, ref: "User" },
              guestId: { type: String },
              optionIndex: { type: Number, required: true },
              answeredAt: { type: Date, default: () => new Date() },
            },
          ],
          default: [],
        },
        roundEndsAt: { type: Date },
        revealEndsAt: { type: Date },
        nextRoundStartsAt: { type: Date },
        startedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
        startedAt: { type: Date },
        isActive: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true },
);

StudyRoomSchema.index({ hostId: 1, createdAt: -1 });
StudyRoomSchema.index({ status: 1, visibility: 1, createdAt: -1 });
StudyRoomSchema.index({ "participants.userId": 1, status: 1 });

const StudyRoomInviteSchema = new Schema<IStudyRoomInvite>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "StudyRoom", required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    inviteType: {
      type: String,
      enum: ["username", "email", "link"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked", "expired"],
      default: "pending",
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    email: { type: String, trim: true, lowercase: true },
    username: { type: String, trim: true, lowercase: true },
    token: { type: String, required: true, unique: true, default: () => nanoid(24) },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

StudyRoomInviteSchema.index(
  { roomId: 1, userId: 1, status: 1 },
  { partialFilterExpression: { status: "pending", userId: { $exists: true } } },
);
StudyRoomInviteSchema.index(
  { roomId: 1, email: 1, status: 1 },
  { partialFilterExpression: { status: "pending", email: { $exists: true } } },
);
StudyRoomInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const StudyRoomMessageSchema = new Schema<IStudyRoomMessage>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "StudyRoom", required: true },
    senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
    senderGuestId: { type: String, trim: true },
    senderName: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

StudyRoomMessageSchema.index({ roomId: 1, createdAt: -1 });

const StudyRoomPointsLedgerSchema = new Schema<IStudyRoomPointsLedger>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "StudyRoom", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestId: { type: String, trim: true },
    displayName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    reason: {
      type: String,
      enum: [
        "join",
        "timer_complete",
        "task_complete",
        "game_win",
        "qa_correct",
        "game_wrong_penalty",
        "moderator_adjustment",
      ],
      required: true,
    },
    metadata: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

StudyRoomPointsLedgerSchema.index({ roomId: 1, createdAt: -1 });

export const StudyRoom = model<IStudyRoom>("StudyRoom", StudyRoomSchema);
export const StudyRoomInvite = model<IStudyRoomInvite>(
  "StudyRoomInvite",
  StudyRoomInviteSchema,
);
export const StudyRoomMessage = model<IStudyRoomMessage>(
  "StudyRoomMessage",
  StudyRoomMessageSchema,
);
export const StudyRoomPointsLedger = model<IStudyRoomPointsLedger>(
  "StudyRoomPointsLedger",
  StudyRoomPointsLedgerSchema,
);

