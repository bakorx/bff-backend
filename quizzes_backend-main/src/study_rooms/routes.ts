import { Router } from "express";
import { authGuard, attachUser } from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  CreateStudyRoomSerializer,
  InviteByEmailSerializer,
  InviteByUsernameSerializer,
  JoinRoomSerializer,
  ModerateMemberSerializer,
  PostRoomMessageSerializer,
  PostMediaSerializer,
  StartGameSerializer,
  SubmitGameAnswerSerializer,
  OpenReadyCheckSerializer,
  ToggleReadySerializer,
  GenerateGameSerializer,
  MediaPreferenceSerializer,
  UpdateMemberRoleSerializer,
  UpdateTimerSerializer,
  AvatarUpdateSerializer,
  CycleCheckInSerializer,
  CreateTaskSerializer,
  CompleteTaskSerializer,
  SyncMediaStateSerializer,
} from "./serializers";

export const publicRouter = Router();
export const adminRouter = Router();

publicRouter.get("/", attachUser, controllers.listRooms);
publicRouter.post("/", authGuard, validate(CreateStudyRoomSerializer), controllers.createRoom);

publicRouter.get("/:code", attachUser, controllers.getRoom);
publicRouter.post("/:code/join", attachUser, validate(JoinRoomSerializer), controllers.joinRoom);
publicRouter.post("/:code/messages", attachUser, validate(PostRoomMessageSerializer), controllers.postMessage);

publicRouter.post(
  "/:code/invites/username",
  authGuard,
  validate(InviteByUsernameSerializer),
  controllers.inviteByUsername,
);
publicRouter.post(
  "/:code/invites/email",
  authGuard,
  validate(InviteByEmailSerializer),
  controllers.inviteByEmail,
);
publicRouter.delete("/:code/invites/:inviteId", authGuard, controllers.revokeInvite);

publicRouter.patch("/:code/timer", authGuard, validate(UpdateTimerSerializer), controllers.updateTimer);
publicRouter.patch("/:code/lock", authGuard, controllers.setRoomLock);
publicRouter.post("/:code/end", authGuard, controllers.endRoom);
publicRouter.patch("/:code/members/role", authGuard, validate(UpdateMemberRoleSerializer), controllers.updateMemberRole);
publicRouter.post("/:code/checkins", attachUser, validate(CycleCheckInSerializer), controllers.submitCycleCheckIn);
publicRouter.patch("/:code/avatar", attachUser, validate(AvatarUpdateSerializer), controllers.updateAvatar);
publicRouter.post("/:code/tasks", authGuard, validate(CreateTaskSerializer), controllers.createTask);
publicRouter.post("/:code/tasks/complete", attachUser, validate(CompleteTaskSerializer), controllers.completeTask);
publicRouter.post("/:code/media", authGuard, validate(PostMediaSerializer), controllers.postMedia);
publicRouter.post("/:code/games/start", authGuard, validate(StartGameSerializer), controllers.startGame);
publicRouter.post("/:code/games/answer", attachUser, validate(SubmitGameAnswerSerializer), controllers.submitGameAnswer);
publicRouter.post("/:code/games/ready/open", authGuard, validate(OpenReadyCheckSerializer), controllers.openGameReadyCheck);
publicRouter.post("/:code/games/ready/toggle", attachUser, validate(ToggleReadySerializer), controllers.toggleGameReady);
publicRouter.post("/:code/games/generate", authGuard, validate(GenerateGameSerializer), controllers.generateAiGame);
publicRouter.patch("/:code/media/preference", attachUser, validate(MediaPreferenceSerializer), controllers.updateMediaPreference);
publicRouter.post(
  "/:code/media/sync",
  attachUser,
  validate(SyncMediaStateSerializer),
  controllers.syncMediaState,
);
publicRouter.post(
  "/:code/moderate",
  authGuard,
  validate(ModerateMemberSerializer),
  controllers.moderateMember,
);

