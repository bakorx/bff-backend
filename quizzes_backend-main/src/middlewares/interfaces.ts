import { PlatformRole } from "@/users";

export type JWTPayload = {
  id: string;
  name: string;
  role?: PlatformRole;
  isBanned: boolean;
  isSubscribed?: boolean;
};
