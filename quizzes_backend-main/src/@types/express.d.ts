type User = {
  id: string;
  name: string;
  role?: "student" | "creator" | "moderator" | "super_admin";
  isBanned: boolean;
  isSubscribed?: boolean;
};

declare global {
  declare module "express-serve-static-core" {
    interface Request {
      user?: User;
    }
  }
}
