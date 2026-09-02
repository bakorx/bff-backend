import { z } from "zod";

export const PackageSerializer = z.object({
  // New tier fields (optional so legacy admin CRUD continues to work)
  tier: z.enum(["cooked", "cruising", "locked_in"]).optional().describe("Plan tier"),
  durationType: z.enum(["daily", "weekly", "semester"]).optional().describe("Plan duration type"),
  priceGHS: z.number().min(0).optional().describe("Canonical price in GHS"),
  isActive: z.boolean().default(true).describe("Whether the package is purchasable"),
  // Legacy fields
  name: z.string().min(1, "Name is required").describe("The commercial name of the package/plan"),
  price: z.number().min(0, "Price must be >= 0").describe("Cost in lowest denomination or base currency"),
  duration: z.number().min(1, "Duration required").describe("Time valid in days/months depending on logic"),
  access: z.enum(["quiz", "course", "duration", "default"]).default("default").describe("Which tier of limits this unlocks"),
  isUpgradable: z.boolean().default(false).describe("Whether it can be pro-rated to a higher tier"),
  numberOfQuizzes: z.number().int().default(0).describe("Limit of personal quizzes if explicitly bound"),
  quizzes: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).default([]).describe("Specific unlocked test IDs"),
  numberOfCourses: z.number().int().default(0).describe("Limit of course enrollments if explicitly bound"),
  courses: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).default([]).describe("Specific unlocked course IDs"),
  discountCode: z.string().optional().describe("Unique promo code entry"),
  discountPercentage: z.number().min(0).max(100).default(0).describe("Percentage off base price"),
}).describe("Serializer for Subscription Plans (Packages)");

export const InitiatePaymentSerializer = z.object({
  packageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid package ID").optional().describe("Plan package ID"),
  bundleId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid bundle ID").optional().describe("Credit bundle ID"),
  type: z.enum(["plan", "credits"]).describe("What is being purchased"),
  promoCode: z.string().optional().describe("Optional promo code"),
  referralCode: z.string().optional().describe("Optional referral code"),
}).refine((d) => d.type === "plan" ? !!d.packageId : !!d.bundleId, {
  message: "packageId required for plan purchases; bundleId required for credit purchases",
}).describe("Serializer for initiating a Paystack payment");

export const PaymentSerializer = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID").describe("The user making the payment"),
  amount: z.number().min(0).describe("Final amount paid"),
  reference: z.string().min(1, "Reference required").describe("External gateway transaction ID"),
  date: z.date().describe("Local transaction creation time"),
  endsAt: z.date().nullable().optional().describe("Extinction block for temporary tokens"),
  isValid: z.boolean().describe("Whether successful verification occurred"),
  method: z.string().default("mobile_money").describe("Payment provider or gateway route"),
  accessCode: z.string().min(1).describe("Provider initialization token"),
  status: z.enum([
    "abandoned", "failed", "ongoing", "pending", 
    "processing", "queued", "success", "reversed"
  ]).default("pending").describe("Payment lifecycle status"),
  type: z.enum(["course", "quiz", "duration", "credits", "default", "plan"]).default("default").describe("What was purchased"),
  package: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("The correlated Package plan ID"),
  creditsAdded: z.number().default(0).describe("If topup, how many AI credits were rewarded"),
}).describe("Serializer for Financial Transactions");

export const SubscriptionSerializer = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID").describe("The subscriber"),
  packageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid package ID").describe("The active plan layout"),
  paymentId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid payment ID").optional().describe("The funding transaction, if any"),
  status: z.enum(["active", "expired", "cancelled"]).describe("Current lifecycle state of the recurrent plan"),
  startDate: z.date().describe("When it became active"),
  endDate: z.date().describe("When it naturally ceases"),
}).describe("Serializer for runtime active User-to-Package relations");