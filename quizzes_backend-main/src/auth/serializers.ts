import { z } from "zod";
import { User } from "@/users";

export const SignupSerializer = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.email("Invalid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(6, "Password must be at least 6 characters"),
  referralCode: z.string().optional(),
});

export const GoogleOAuthLoginSerializer = z.object({
  idToken: z.string().min(1, "Google id_token is required"),
  referralCode: z.string().optional(),
});
