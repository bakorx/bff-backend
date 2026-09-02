import { PlatformRole } from "@/users";

export interface TokenUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role?: PlatformRole;
  studentId?: string;
  isBanned: boolean;
  isSubscribed?: boolean;
  profilePicture?: string;
  /** Foreign URL of the user's OAuth profile picture (Google/GitHub). Set on
   * OAuth signup or auto-link when the user has no custom-uploaded picture. */
  oauthPicture?: string;
  notificationSettings?: any;
  exp?: number | undefined;
}