import { Request, Response, NextFunction } from "express";;
import { IOnboardingSteps } from "@/users";

/**
 * Checks if required onboarding steps are complete.
 */
export function onboardingGuard(req: any, res: Response, next: NextFunction) {
  if (!req.user) {
    return next();
  }

  const required: Array<keyof IOnboardingSteps> = [
    "profile",
    "yearOfStudy",
    "pushOptIn",
  ];
  const steps = req.user.onboarding?.steps || {};

  const incomplete = required.filter((s) => !steps[s]);

  req.onboardingIncomplete = incomplete;
  req.isOnboardingComplete = req.user.onboarding?.completed || false;

  next();
}
