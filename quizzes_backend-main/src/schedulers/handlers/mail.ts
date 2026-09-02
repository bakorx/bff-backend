import { Job, longQueue, shortQueue } from "../queues";
import { User } from "@/users";
import { StudySession } from "@/app";
import { normalizeName, maskEmail } from "@/utils";
import React from "react";
import { PUBLISHERS, maybeMarkEmailCampaignDone } from "../utils";
import { EmailCampaign, services as emailServices } from "@/email";
import { Contact } from "@/contacts";
import { CONFIG } from "@/config";
import { Payment, Subscription, Package } from "@/subscriptions";
import { PersonalQuiz, FlashcardSet, MindMap, Material } from "@/learning";
import { logger } from "@/config";
import { sendMail, EmailTemplate } from "@/mail";
import { services as featuresServices } from "@/features";

// -------------------------------------------------------------------------
// Email Campaign Handlers (unified EmailCampaign model)
// -------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[Mail Handler] Registering Mail queue handlers...");
  longQueue.register("email:weekly_digest", async () => {
    // Defensive gate: a manual enqueue from Bull Board (or any other path)
    // shouldn't bypass the admin-controlled flag.
    const enabled = await featuresServices.isEnabled("weekly_digest_enabled");
    if (!enabled) {
      logger.info(
        "[email:weekly_digest] Skipped: weekly_digest_enabled is off.",
      );
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const idempotencyCutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const PAGE_SIZE = 100;
    let skip = 0;
    let processed = 0;
    let skipped = 0;

    while (true) {
      const users = await User.find({
        "notificationSettings.weeklyDigest": true,
        isDeleted: false,
      })
        .select("_id name email username lastDigestSentAt")
        .skip(skip)
        .limit(PAGE_SIZE)
        .lean();

      if (users.length === 0) break;

      for (const user of users) {
        try {
          // Idempotency guard: if we already sent a digest to this user
          // within the last 6 days, skip. 6 (not 7) gives a 1-day buffer
          // past the weekly cadence so a slightly-late Monday cron doesn't
          // double-fire, but a re-enqueue the same day definitely won't.
          if (
            user.lastDigestSentAt &&
            new Date(user.lastDigestSentAt) > idempotencyCutoff
          ) {
            const daysAgo = Math.floor(
              (Date.now() - new Date(user.lastDigestSentAt).getTime()) /
                (24 * 60 * 60 * 1000),
            );
            logger.info(
              `[email:weekly_digest] Skipped user ${user._id}: digest sent ${daysAgo}d ago.`,
            );
            skipped++;
            continue;
          }

          const [sessionCount, messageCount, studyDays] = await Promise.all([
            StudySession.countDocuments({
              userId: user._id,
              createdAt: { $gte: sevenDaysAgo },
            }),
            StudySession.aggregate([
              {
                $match: { userId: user._id, createdAt: { $gte: sevenDaysAgo } },
              },
              { $unwind: "$messages" },
              { $match: { "messages.role": "user" } },
              { $count: "total" },
            ]).then((r: any[]) => r[0]?.total ?? 0),
            StudySession.aggregate([
              {
                $match: { userId: user._id, createdAt: { $gte: sevenDaysAgo } },
              },
              {
                $group: {
                  _id: {
                    y: { $year: "$createdAt" },
                    m: { $month: "$createdAt" },
                    d: { $dayOfMonth: "$createdAt" },
                  },
                },
              },
              { $count: "days" },
            ]).then((r: any[]) => r[0]?.days ?? 0),
          ]);

          // Activity gate: only send if the user actually did something
          // this week. Zero sessions + zero messages + zero study days = skip.
          if (sessionCount === 0 && messageCount === 0 && studyDays === 0) {
            logger.info(
              `[email:weekly_digest] Skipped user ${user._id}: no activity in the last 7 days.`,
            );
            skipped++;
            continue;
          }

          const subject = `Your weekly study summary — ${studyDays} day${studyDays !== 1 ? "s" : ""} this week`;
          const markdownBody = [
            `## Your week in review`,
            ``,
            `Here's what you got done over the last 7 days:`,
            ``,
            `| Metric | Count |`,
            `|--------|-------|`,
            `| Study sessions | ${sessionCount} |`,
            `| Messages sent to Z | ${messageCount} |`,
            `| Days you studied | ${studyDays} |`,
            ``,
            `Keep it up! Consistency is what makes the difference at exam time.`,
          ].join("\n");

          await sendMail({
            to: user.email,
            subject,
            template: React.createElement(EmailTemplate, {
              category: "transactional",
              type: "notification",
              title: subject,
              content: "",
              markdownBody,
              email: user.email,
              name: user.name || user.username || "Student",
              links: [],
            }),
          });

          // Mark the digest as sent *after* a successful send. A failed
          // SMTP attempt leaves `lastDigestSentAt` unset so the next
          // worker attempt can retry.
          await User.updateOne(
            { _id: user._id },
            { $set: { lastDigestSentAt: new Date() } },
          );

          processed++;
        } catch (err: any) {
          logger.error(
            `[email:weekly_digest] Failed for user ${user._id}: ${err.message}`,
          );
        }
      }

      skip += PAGE_SIZE;
      if (users.length < PAGE_SIZE) break;
    }

    logger.info(
      `[email:weekly_digest] Sent digests to ${processed} users (skipped ${skipped}).`,
    );
  });

  // -------------------------------------------------------------------------
  // Billing: end-of-cycle usage summary
  // -------------------------------------------------------------------------

  longQueue.register("email:billing_cycle_summary", async () => {
    const now = new Date();
    const PAGE_SIZE = 100;
    let processed = 0;

    const TIER_LABELS: Record<string, string> = {
      cooked: "Cooked",
      cruising: "Cruising",
      locked_in: "Locked In",
    };
    const DURATION_LABELS: Record<string, string> = {
      daily: "Daily",
      weekly: "Weekly",
      semester: "Semester",
    };
    const formatDate = (d: Date) =>
      new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

    // No offset/skip here on purpose: each subscription is claimed (see
    // below) as soon as it's processed, so it naturally drops out of the
    // next iteration's query — looping on .limit() alone is correct and
    // avoids the skip-vs-shrinking-result-set bug that offset pagination
    // would have here.
    while (true) {
      const dueSubscriptions = await Subscription.find({
        endDate: { $lt: now },
        billingSummaryEmailSentAt: { $exists: false },
      })
        .limit(PAGE_SIZE)
        .lean();

      if (dueSubscriptions.length === 0) break;

      for (const sub of dueSubscriptions) {
        try {
          // Claim first, before any work — guarantees at-most-once send per
          // subscription even if this sweep overlaps with a retry.
          const claimed = await Subscription.findOneAndUpdate(
            { _id: sub._id, billingSummaryEmailSentAt: { $exists: false } },
            { $set: { billingSummaryEmailSentAt: now } },
          );
          if (!claimed) continue;

          const [user, pkg] = await Promise.all([
            User.findById(sub.userId)
              .select("name email username")
              .lean(),
            Package.findById(sub.packageId)
              .select("name tier durationType")
              .lean(),
          ]);

          if (!user) continue;

          const { startDate, endDate } = sub;

          const [
            sessionCount,
            quizCount,
            flashcardCount,
            mindMapCount,
            materialCount,
          ] = await Promise.all([
            StudySession.countDocuments({
              userId: sub.userId,
              createdAt: { $gte: startDate, $lt: endDate },
            }),
            PersonalQuiz.countDocuments({
              createdBy: sub.userId,
              createdAt: { $gte: startDate, $lt: endDate },
              isDeleted: { $ne: true },
            }),
            FlashcardSet.countDocuments({
              createdBy: sub.userId,
              createdAt: { $gte: startDate, $lt: endDate },
              isDeleted: { $ne: true },
            }),
            MindMap.countDocuments({
              userId: sub.userId,
              createdAt: { $gte: startDate, $lt: endDate },
              isDeleted: { $ne: true },
            }),
            Material.countDocuments({
              uploadedBy: sub.userId,
              createdAt: { $gte: startDate, $lt: endDate },
            }),
          ]);

          const tierLabel = pkg?.tier
            ? (TIER_LABELS[pkg.tier] ?? pkg.tier)
            : null;
          const durationLabel = pkg?.durationType
            ? (DURATION_LABELS[pkg.durationType] ?? pkg.durationType)
            : null;
          const planName =
            tierLabel && durationLabel
              ? `${tierLabel} — ${durationLabel}`
              : (pkg?.name ?? "Your plan");

          const subject = `Your ${planName} cycle summary`;
          const markdownBody = [
            `## Your cycle just wrapped up`,
            ``,
            `**Plan:** ${planName}`,
            `**Cycle:** ${formatDate(startDate)} – ${formatDate(endDate)}`,
            ``,
            `Here's what you got done this cycle:`,
            ``,
            `| Metric | Count |`,
            `|--------|-------|`,
            `| Study sessions | ${sessionCount} |`,
            `| Quizzes generated | ${quizCount} |`,
            `| Flashcard sets created | ${flashcardCount} |`,
            `| Mind maps created | ${mindMapCount} |`,
            `| Materials uploaded | ${materialCount} |`,
            ``,
            `Your plan has now ended. Renew any time to keep studying with Qz's full feature set.`,
          ].join("\n");

          await sendMail({
            to: user.email,
            subject,
            template: React.createElement(EmailTemplate, {
              category: "transactional",
              type: "billing_cycle_summary",
              title: subject,
              content: "",
              markdownBody,
              email: user.email,
              name: user.name || user.username || "Student",
              links: [],
            }),
          });

          processed++;
        } catch (err: any) {
          logger.error(
            `[email:billing_cycle_summary] Failed for subscription ${sub._id}: ${err.message}`,
          );
        }
      }
    }

    logger.info(
      `[email:billing_cycle_summary] Sent ${processed} cycle summaries.`,
    );
  });

  longQueue.register("email:campaign:generate_body", async (job: Job) => {
    const { campaignId } = job.payload as { campaignId: string };
    try {
      await emailServices.generateCampaignBody(campaignId);
      await PUBLISHERS.publishEmailEvent({
        type: "email:campaign:generate_body",
        campaignId,
        status: "completed",
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(
        `[email:campaign:generate_body] Failed for campaign ${campaignId}:`,
        error.message,
      );
      await EmailCampaign.findByIdAndUpdate(campaignId, { status: "failed" });
      await PUBLISHERS.publishEmailEvent({
        type: "email:campaign:generate_body",
        campaignId,
        status: "failed",
        timestamp: new Date().toISOString(),
        details: { reason: error.message },
      });
      throw error;
    }
  });

  longQueue.register("email:campaign:dispatch", async (job: Job) => {
    const { campaignId } = job.payload as { campaignId: string };
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    campaign.status = "dispatching";
    campaign.stats = {
      sent: 0,
      failed: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      unsubscribed: 0,
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
    };
    campaign.dispatchedAt = new Date();
    campaign.sendingStartedAt = new Date();
    await campaign.save();

    await PUBLISHERS.publishEmailEvent({
      type: "email:campaign:dispatch",
      campaignId,
      status: "started",
      timestamp: new Date().toISOString(),
      details: {
        campaignType: campaign.campaignType,
      },
    });

    const filter = campaign.audienceFilter || {};
    const emailsToProcess = new Set<string>();
    const dispatchTargets: {
      email: string;
      contactId?: string;
      userId?: string;
    }[] = [];

    const addTarget = (email: string, contactId?: string, userId?: string) => {
      const lowerEmail = email.toLowerCase().trim();
      if (!emailsToProcess.has(lowerEmail)) {
        emailsToProcess.add(lowerEmail);
        dispatchTargets.push({ email: lowerEmail, contactId, userId });
      } else if (userId) {
        // Registered user already added via contacts — backfill userId so the
        // send job can load their UI preferences
        const existing = dispatchTargets.find((t) => t.email === lowerEmail);
        if (existing && !existing.userId) existing.userId = userId;
      }
    };

    const includeContacts = filter.includeContacts !== false;
    const includeUsers = filter.includeUsers !== false;

    // 1. Gather Contacts
    if (includeContacts) {
      const contactQuery: Record<string, any> = {};
      const orFilters: any[] = [];

      const waitlistActive = filter.contactLanes?.waitlist !== false;
      const newsletterActive = filter.contactLanes?.newsletter !== false;

      if (waitlistActive) {
        const wStatuses = filter.contactStatus?.waitlistStatus?.length
          ? filter.contactStatus.waitlistStatus
          : ["active"];
        // Apply excludeBounced within the waitlist lane filter
        const wStatusFiltered =
          filter.excludeBounced !== false
            ? wStatuses.filter((s: string) => s !== "bounced")
            : wStatuses;
        if (wStatusFiltered.length > 0) {
          orFilters.push({
            isWaitlist: true,
            waitlistStatus: { $in: wStatusFiltered },
          });
        }
      }
      if (newsletterActive) {
        const nStatuses = filter.contactStatus?.newsletterStatus?.length
          ? filter.contactStatus.newsletterStatus
          : ["active"];
        // Apply excludeUnsubscribed within the newsletter lane filter
        const nStatusFiltered =
          filter.excludeUnsubscribed !== false
            ? nStatuses.filter((s: string) => s !== "unsubscribed")
            : nStatuses;
        if (nStatusFiltered.length > 0) {
          orFilters.push({
            isNewsletter: true,
            newsletterStatus: { $in: nStatusFiltered },
          });
        }
      }

      if (orFilters.length > 0) {
        contactQuery.$or = orFilters;
      }

      const excludeEmails = (filter.excludeEmails || []).map((e: string) =>
        e.toLowerCase(),
      );

      const contacts = await Contact.find(contactQuery).select("email").lean();
      for (const c of contacts) {
        if (!excludeEmails.includes(c.email.toLowerCase())) {
          addTarget(c.email, (c as any)._id.toString());
        }
      }
    }

    // 2. Gather Users
    if (includeUsers) {
      const userQuery: Record<string, any> = {
        isDeleted: false,
        isBanned: false,
      };

      if (filter.roles && filter.roles.length > 0) {
        userQuery.role = { $in: filter.roles };
      }

      const excludeUserIds = filter.excludeUserIds || [];
      const excludeEmails = (filter.excludeEmails || []).map((e: string) =>
        e.toLowerCase(),
      );

      if (excludeUserIds.length > 0) {
        userQuery._id = { $nin: excludeUserIds };
      }

      const users = await User.find(userQuery).select("email").lean();
      for (const u of users) {
        if (!excludeEmails.includes(u.email.toLowerCase())) {
          addTarget(u.email, undefined, (u as any)._id.toString());
        }
      }
    }

    // 3. Always include specificUserIds and specificEmails (override)
    if (filter.specificUserIds && filter.specificUserIds.length > 0) {
      const specificUsers = await User.find({
        _id: { $in: filter.specificUserIds },
      })
        .select("email")
        .lean();
      for (const u of specificUsers) {
        addTarget(u.email, undefined, (u as any)._id.toString());
      }
    }
    if (filter.specificEmails && filter.specificEmails.length > 0) {
      for (const email of filter.specificEmails) {
        addTarget(email);
      }
    }

    await EmailCampaign.findByIdAndUpdate(campaignId, {
      dispatchTotal: dispatchTargets.length,
    });

    await PUBLISHERS.publishEmailEvent({
      type: "email:campaign:dispatch:progress",
      campaignId,
      status: "progress",
      timestamp: new Date().toISOString(),
      details: {
        sent: 0,
        failed: 0,
        total: dispatchTargets.length,
        percentComplete: dispatchTargets.length > 0 ? 0 : 100,
      },
    });

    if (dispatchTargets.length === 0) {
      await EmailCampaign.findByIdAndUpdate(campaignId, {
        status: "done",
        completedAt: new Date(),
      });
      await PUBLISHERS.publishEmailEvent({
        type: "email:campaign:dispatch:completed",
        campaignId,
        status: "completed",
        timestamp: new Date().toISOString(),
        details: { sent: 0, failed: 0, total: 0 },
      });
      return;
    }

    for (const target of dispatchTargets) {
      await shortQueue.enqueue(
        "email:campaign:send",
        {
          campaignId,
          email: target.email,
          contactId: target.contactId,
          userId: target.userId,
        },
        3,
      );
    }
  });

  shortQueue.register("email:campaign:send", async (job: Job) => {
    const { campaignId, contactId, userId, email } = job.payload as {
      campaignId: string;
      contactId?: string;
      userId?: string;
      email?: string;
    };

    const [campaign, contact, user] = await Promise.all([
      EmailCampaign.findById(campaignId),
      contactId ? Contact.findById(contactId).lean() : Promise.resolve(null),
      userId
        ? User.findById(userId)
            .select("name username authKey")
            .lean()
        : Promise.resolve(null),
    ]);

    if (!campaign) {
      throw new Error(`[email:campaign:send] Missing campaign`);
    }

    const recipientEmail = contact?.email || user?.email || email;
    if (!recipientEmail) {
      throw new Error(`[email:campaign:send] Missing recipient email`);
    }

    const normalizedName = normalizeName(
      contact?.name || user?.username || "Subscriber",
    );

    const resolvedLinks = contact
      ? await emailServices.resolveAllLinks(campaign as any, contact as any)
      : Object.fromEntries(
          (campaign.linkContexts || []).map((link: any) => {
            const fallbackCtx = {
              contactId: userId || "",
              email: recipientEmail,
              unsubscribeToken: user?.authKey || "",
            };
            return [
              link.label,
              emailServices.resolveLinkContext(link, fallbackCtx) as string,
            ];
          }),
        );

    const linkButtons = Object.entries(resolvedLinks).map(([label, url]) => ({
      label,
      url: url as string,
    }));
    const unsubscribeToken = contact?.unsubscribeToken || user?.authKey;

    try {
      await sendMail({
        to: recipientEmail,
        subject: campaign.subjectLine,
        template: React.createElement(EmailTemplate, {
          category: "newsletter",
          type: "promotional",
          title: campaign.title,
          content: "",
          markdownBody: campaign.bodyMarkdown,
          email: recipientEmail,
          unsubscribeToken,
          links: linkButtons,
          name: normalizedName,
        }),
      });

      await EmailCampaign.findByIdAndUpdate(campaignId, {
        $inc: { "stats.sent": 1 },
      });

      const progressCampaign = await EmailCampaign.findById(campaignId)
        .select("stats dispatchTotal")
        .lean();
      const sent = progressCampaign?.stats?.sent ?? 0;
      const failed = progressCampaign?.stats?.failed ?? 0;
      const total = progressCampaign?.dispatchTotal ?? 0;

      await PUBLISHERS.publishEmailEvent({
        type: "email:campaign:send",
        campaignId,
        status: "progress",
        timestamp: new Date().toISOString(),
        details: {
          recipientEmail,
          sent,
          failed,
          total,
          percentComplete:
            total > 0 ? Math.round(((sent + failed) / total) * 100) : 100,
        },
      });

      await maybeMarkEmailCampaignDone(campaignId);
    } catch (err: any) {
      logger.error(
        `[email:campaign:send] Failed for campaign ${campaignId} to target ${maskEmail(recipientEmail)}: ${err.message}`,
      );
      try {
        await EmailCampaign.findByIdAndUpdate(campaignId, {
          $inc: { "stats.failed": 1 },
        });

        const progressCampaign = await EmailCampaign.findById(campaignId)
          .select("stats dispatchTotal")
          .lean();
        const sent = progressCampaign?.stats?.sent ?? 0;
        const failed = progressCampaign?.stats?.failed ?? 0;
        const total = progressCampaign?.dispatchTotal ?? 0;

        await PUBLISHERS.publishEmailEvent({
          type: "email:campaign:send",
          campaignId,
          status: "failed",
          timestamp: new Date().toISOString(),
          details: {
            recipientEmail,
            reason: err.message,
            sent,
            failed,
            total,
            percentComplete:
              total > 0 ? Math.round(((sent + failed) / total) * 100) : 100,
          },
        });

        await maybeMarkEmailCampaignDone(campaignId);
      } catch (statErr: any) {
        logger.error(
          `[email:campaign:send] Failed to record send failure for campaign ${campaignId}: ${statErr.message}`,
        );
      }
    }
  });

  longQueue.register("email:campaign:dispatch:recovery", async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // stuck > 30 min
    const stuckCampaigns = await EmailCampaign.find({
      status: "dispatching",
      sendingStartedAt: { $lt: cutoff },
    })
      .select("_id stats dispatchTotal")
      .lean();

    for (const campaign of stuckCampaigns) {
      const sent = campaign.stats?.sent ?? 0;
      const failed = campaign.stats?.failed ?? 0;
      const total = campaign.dispatchTotal ?? 0;

      if (total === 0) continue;

      const failedFinal = sent + failed >= total ? failed : total - sent;

      await EmailCampaign.findOneAndUpdate(
        { _id: campaign._id, status: "dispatching" },
        {
          status: "done",
          completedAt: new Date(),
          "stats.failed": failedFinal,
        },
      );

      logger.info(
        `[email:campaign:dispatch:recovery] Force-completed stuck campaign ${campaign._id} (sent=${sent}, failed=${failedFinal}, total=${total})`,
      );

      await PUBLISHERS.publishEmailEvent({
        type: "email:campaign:dispatch:completed",
        campaignId: campaign._id.toString(),
        status: "completed",
        timestamp: new Date().toISOString(),
        details: { sent, failed: failedFinal, total },
      });
    }
  });

  shortQueue.register("email:waitlist_joined", async (job: Job) => {
    const { email, name } = job.payload as { email: string; name?: string };
    const normalizedName = normalizeName(name);
    await sendMail({
      to: email,
      subject: "You're on the list🎉",
      template: React.createElement(EmailTemplate, {
        category: "waitlist",
        type: "welcome",
        title: "Welcome to the Inner Circle",
        content: "",
        markdownBody:
          "We've received your request to join the Qz waitlist. We're currently in a staged rollout, and we'll notify you as soon as your spot is ready.\n\nIn the meantime, stay tuned for updates.",
        email: email,
        name: normalizedName,
      }),
    });
  });

  shortQueue.register("email:newsletter_confirm", async (job: Job) => {
    const { email, token } = job.payload as { email: string; token: string };
    const confirmUrl = `${CONFIG.FRONTEND_URL}/newsletter/confirm?token=${token}`;
    await sendMail({
      to: email,
      subject: "Confirm your subscription",
      template: React.createElement(EmailTemplate, {
        category: "newsletter",
        type: "confirmation",
        title: "Confirm Subscription",
        content: `Please confirm your subscription by clicking the button below.`,
        markdownBody: `You're one step away from joining our newsletter. Click the button below to confirm your subscription and start receiving updates.`,
        email: email,
        links: [{ label: "Confirm Subscription", url: confirmUrl }],
      }),
    });
  });

  shortQueue.register("email:newsletter_welcome", async (job: Job) => {
    const { email, name, unsubscribeToken } = job.payload as {
      email: string;
      name?: string;
      unsubscribeToken?: string;
    };
    const normalizedName = normalizeName(name);
    await sendMail({
      to: email,
      subject: "Welcome to the Qz Newsletter🥳",
      template: React.createElement(EmailTemplate, {
        category: "newsletter",
        type: "welcome",
        title: "You're officially subscribed",
        content: "",
        markdownBody:
          "Thank you for subscribing to the Qz newsletter! You'll now receive regular updates, insights, and early access to new features.\n\nWe're excited to have you with us.",
        email: email,
        name: normalizedName,
        unsubscribeToken: unsubscribeToken,
      }),
    });
  });

  shortQueue.register("email:campaign:send_test", async (job: Job) => {
    const {
      campaignId,
      subject,
      bodyMarkdown,
      recipient,
      links,
      category,
      type,
      userId,
    } = job.payload as {
      campaignId: string;
      subject: string;
      bodyMarkdown: string;
      recipient: { email: string; name: string; unsubscribeToken: string };
      links: { label: string; url: string }[];
      category: string;
      type: string;
      userId?: string;
    };

    const campaign = await EmailCampaign.findById(campaignId);

    if (!campaign)
      throw new Error(
        `[email:campaign:send_test] Campaign not found: ${campaignId}`,
      );

    const normalizedName = normalizeName(recipient.name);

    await sendMail({
      to: recipient.email,
      subject: subject,
      template: React.createElement(EmailTemplate, {
        category: category as any,
        type: type as any,
        title: campaign.title,
        content: "",
        markdownBody: bodyMarkdown,
        email: recipient.email,
        unsubscribeToken: recipient.unsubscribeToken,
        links: links,
        name: normalizedName,
      }),
    });
  });

  shortQueue.register("email:transactional:send", async (job: Job) => {
    const { campaignId, recipientId, email, templateVariables } =
      job.payload as {
        campaignId: string;
        recipientId: string;
        email: string;
        templateVariables?: Record<string, any>;
      };

    const [campaign, targetUser] = await Promise.all([
      EmailCampaign.findById(campaignId),
      User.findById(recipientId).select("name username").lean(),
    ]);

    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    try {
      // Determine template and category based on campaignType
      let category: any = "transactional";
      let type: any = "notification";

      if (campaign.campaignType === "password_reset") {
        category = "auth";
        type = "reset_password";
      } else if (campaign.campaignType === "welcome") {
        category = "transactional";
        type = "welcome";
      } else if (campaign.campaignType === "security_alert") {
        category = "security";
        type = "alert";
      } else if (campaign.campaignType === "exam_reminder") {
        category = "transactional";
        type = "notification";
      } else if (campaign.campaignType === "student_verification") {
        category = "transactional";
        type = "confirmation";
      } else if (
        campaign.campaignType === "announcement" ||
        campaign.campaignType === "system_update"
      ) {
        category = "system";
        type = "promotional";
      } else if (campaign.campaignType === "account_banned") {
        category = "security";
        type = "alert";
      } else if (campaign.campaignType === "role_update") {
        category = "transactional";
        type = "notification";
      }

      const links = templateVariables?.resetLink
        ? [{ label: "Reset Password", url: templateVariables.resetLink }]
        : templateVariables?.accountUrl
          ? [{ label: "Review Account", url: templateVariables.accountUrl }]
          : templateVariables?.appUrl
            ? [
                {
                  label: String(
                    templateVariables?.ctaLabel || "Continue Setup",
                  ),
                  url: templateVariables.appUrl,
                },
              ]
            : templateVariables?.timetableUrl
              ? [
                  {
                    label: "View Timetable",
                    url: templateVariables.timetableUrl,
                  },
                ]
              : templateVariables?.quizUrl
                ? [{ label: "Take the Quiz", url: templateVariables.quizUrl }]
                : [];

      // The EmailTemplate automatically prepends "Greetings {name}," before the
      // body. If the body itself starts with a greeting ("Hi {name}," / "Hello
      // {name}," / "Greetings {name},") we'd render a duplicated greeting like
      // "Greetings Michael, Hi Michael, ...". Strip a single leading greeting
      // line if present so this can never leak to a recipient.
      const GREETING_PREFIX =
        /^\s*(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))\s+[^,]+,\s*/i;
      const sanitizeBodyGreeting = (body: string): string =>
        GREETING_PREFIX.test(body) ? body.replace(GREETING_PREFIX, "") : body;

      const name =
        targetUser?.name ||
        targetUser?.username ||
        templateVariables?.name ||
        "there";

      const DEFAULT_BODIES: Partial<Record<string, string>> = {
        welcome: `Your account is ready. Continue your setup to personalize your study experience and start using Qz right away.\n\nWe recommend completing onboarding first so your university context, study program, and preferences are configured correctly.`,
        role_update: `Your role on Qz has been updated from **${templateVariables?.previousRole ?? "your previous role"}** to **${templateVariables?.newRole ?? "a new role"}**.\n\nThis change may affect what you can access on the platform. If you have any questions, please reach out to the team.`,
        account_linked: `Your Qz account was just signed in with ${templateVariables?.provider ?? "Google"} (${templateVariables?.providerEmail ?? "your email"}). We've linked this sign-in method to your existing account so you can use it next time.\n\nIf this was you, you're all set — no action needed.\n\nIf you don't recognize this activity, click below to review your account and remove the linked sign-in method. Your password will still work to keep your account safe.`,
        account_banned: templateVariables?.newRole
          ? `Your Qz account has been suspended.\n\n**Reason:** ${templateVariables?.reason ?? "Violation of platform policies"}\n\nAdditionally, your role was updated to **${templateVariables.newRole}** as part of this action.\n\nIf you believe this is a mistake, please contact support.`
          : `Your Qz account has been suspended.\n\n**Reason:** ${templateVariables?.reason ?? "Violation of platform policies"}\n\nIf you believe this is a mistake, please contact support.`,
      };

      const markdownBody = sanitizeBodyGreeting(
        campaign.bodyMarkdown ||
          DEFAULT_BODIES[campaign.campaignType as string] ||
          "",
      );

      await sendMail({
        to: email,
        subject: campaign.subjectLine,
        template: React.createElement(EmailTemplate, {
          category,
          type,
          title: campaign.subjectLine,
          content: "",
          markdownBody,
          email,
          name:
            targetUser?.name ||
            targetUser?.username ||
            templateVariables?.name ||
            "Subscriber",
          links,
          variables: templateVariables,
        }),
      });

      await EmailCampaign.findByIdAndUpdate(campaignId, {
        status: "done",
        completedAt: new Date(),
        $inc: { "stats.sent": 1 },
      });
    } catch (err: any) {
      logger.error(
        `[email:transactional:send] Failed for campaign ${campaignId}: ${err.message}`,
      );
      await EmailCampaign.findByIdAndUpdate(campaignId, {
        status: "failed",
        $inc: { "stats.failed": 1 },
      });
      throw err;
    }
  });

  shortQueue.register("email:payment_confirmation", async (job: Job) => {
    const { userId, reference, amount, currency } = job.payload as {
      userId: string;
      reference: string;
      amount: number;
      currency: string;
    };

    try {
      const [user, payment] = await Promise.all([
        User.findById(userId).select("name email").lean(),
        Payment.findOne({ reference })
          .populate<{
            package: { name?: string; tier?: string; durationType?: string };
          }>("package")
          .lean(),
      ]);

      if (!user || !payment) {
        logger.info(
          `[email:payment_confirmation] Missing data for ref=${reference}`,
        );
        return;
      }

      const pkg = payment.package as {
        name?: string;
        tier?: string;
        durationType?: string;
      } | null;

      const TIER_LABELS: Record<string, string> = {
        cooked: "Cooked",
        cruising: "Cruising",
        locked_in: "Locked In",
      };
      const DURATION_LABELS: Record<string, string> = {
        daily: "Daily",
        weekly: "Weekly",
        semester: "Semester",
      };
      const TYPE_LABELS: Record<string, string> = {
        plan: "Subscription Plan",
        credits: "Credit Bundle",
        course: "Course Access",
        quiz: "Quiz Pack",
        duration: "Duration Extension",
        default: "Purchase",
      };

      const METHOD_LABELS: Record<string, string> = {
        mobile_money: "Mobile Money (MoMo)",
        card: "Card",
        bank: "Bank Transfer",
        bank_transfer: "Bank Transfer",
        ussd: "USSD",
        qr: "QR Code",
        eft: "EFT",
        free_tier: "Free",
        paystack: "Paystack",
      };

      const tierLabel = pkg?.tier ? (TIER_LABELS[pkg.tier] ?? pkg.tier) : null;
      const durationLabel = pkg?.durationType
        ? (DURATION_LABELS[pkg.durationType] ?? pkg.durationType)
        : null;
      const itemName =
        tierLabel && durationLabel
          ? `${tierLabel} — ${durationLabel}`
          : (pkg?.name ?? TYPE_LABELS[(payment as any).type] ?? "Purchase");

      const currencySymbol = currency === "GHS" ? "GHS" : currency;
      const amountFormatted = `${currencySymbol} ${amount.toFixed(2)}`;
      const dateFormatted = new Date(
        (payment as any).createdAt ?? Date.now(),
      ).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const invoiceId = `INV-${reference
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase()
        .slice(-10)}`;
      const userName = normalizeName((user as any).name) || "Student";
      const activationNote = tierLabel
        ? `Your ${itemName} plan is now active. Keep grinding.`
        : "Your purchase has been confirmed.";

      await sendMail({
        to: (user as any).email,
        subject: `Payment Confirmed — ${itemName} [${invoiceId}]`,
        template: React.createElement(EmailTemplate, {
          category: "transactional",
          type: "payment_receipt",
          title: "Payment Confirmed",
          content: "",
          email: (user as any).email,
          name: userName,
          variables: {
            invoiceId,
            itemName,
            amountFormatted,
            dateFormatted,
            reference,
            method:
              METHOD_LABELS[(payment as any).method] ??
              (payment as any).method ??
              "Mobile Money",
            promoCode: (payment as any).promoCode ?? null,
            activationNote,
          },
        }),
      });

      logger.info(
        `[email:payment_confirmation] Receipt sent to ${(user as any).email} (ref=${reference})`,
      );
    } catch (err: any) {
      logger.error(
        `[email:payment_confirmation] Failed for ref=${reference}: ${err.message}`,
      );
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // Billing: Donation thank-you
  // -------------------------------------------------------------------------

  shortQueue.register("email:donation_thank_you", async (job: Job) => {
    const {
      donorEmail,
      donorName,
      userId,
      amount,
      currency,
      reference,
      message,
    } = job.payload as {
      donorEmail: string;
      donorName: string | null;
      userId: string | null;
      amount: number;
      currency: string;
      reference: string;
      message: string | null;
    };

    try {
      const user = userId
        ? await User.findById(userId).select("name").lean()
        : null;

      const displayName =
        donorName ||
        (user ? normalizeName((user as any).name) : null) ||
        "Friend";
      const currencySymbol = currency === "GHS" ? "GHS" : currency;
      const amountFormatted = `${currencySymbol} ${amount.toFixed(2)}`;

      const messageSection = message ? `\n\n> *"${message}"*` : "";

      const markdownBody = `
We received your donation of **${amountFormatted}** and it means the world to us. Every contribution — big or small — goes directly toward keeping Qz accessible for students across Ghana.${messageSection}

---

**Amount:** ${amountFormatted}
**Reference:** \`${reference}\`

---

If you have any questions about your donation, reach us at **michaelperryt97@gmail.com** and quote your reference.

Thank you for believing in what we're building. 🙏
      `.trim();

      await sendMail({
        to: donorEmail,
        subject: `Thank you for your donation — ${amountFormatted}`,
        template: React.createElement(EmailTemplate, {
          category: "transactional",
          type: "donation_thank_you",
          title: "Thank You",
          content: markdownBody,
          markdownBody,
          email: donorEmail,
          name: displayName,
        }),
      });

      logger.info(
        `[email:donation_thank_you] Sent to ${donorEmail} (ref=${reference})`,
      );
    } catch (err: any) {
      logger.error(
        `[email:donation_thank_you] Failed for ref=${reference}: ${err.message}`,
      );
      throw err;
    }
  });
}
