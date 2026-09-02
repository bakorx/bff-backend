import { CorsOptions } from "cors";
import { ENV } from "@/config/env";

export const CorsOption: CorsOptions = {
  origin:
    ENV.NODE_ENV === "production"
      ? [
          /^https?:\/\/(www\.)?.*\.bflabs\.tech$/i,
          "https://theminiscripts.vercel.app",
          "https://www.theminiscripts.vercel.app",
          "https://qz.bflabs.tech",
          /^https?:\/\/.*michael-perry-tetteys-projects\.vercel\.app$/i,
        ]
      : [
          "http://localhost:5500",
          "http://127.0.0.1:5500",
          "http://localhost:3000",
          "http://127.0.0.1",
          `http://localhost:${ENV.PORT}`,
        ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-guest-id",
    "x-guest-name",
  ],
  credentials: true,
};