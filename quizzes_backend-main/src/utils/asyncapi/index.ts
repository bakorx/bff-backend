/**
 * AsyncAPI 2.6 specification for the BetaForge Labs Quizzes WebSocket API.
 *
 * The WebSocket layer is powered by Socket.IO (transports: websocket + polling).
 * Every client must authenticate with a Bearer JWT via the handshake auth token:
 *
 *   const socket = io(SERVER_URL, { auth: { token: "Bearer <accessToken>" } })
 *
 * On connect the server automatically joins the client to:
 *   • user:{userId}  — personal room for all user-scoped events
 *
 * Clients may then join/leave additional rooms by emitting:
 *   • join:campaign  / leave:campaign         → campaign:{campaignId}
 *   • join:quiz_generation / leave:quiz_generation → quiz_generation:{personalQuizId}
 */

const asyncapiSpec = {
  asyncapi: "2.6.0",
  info: {
    title: "BetaForge Labs Quizzes WebSocket API",
    version: "2.0.0",
    description:
      "Real-time event documentation for the BetaForge Labs Quizzes backend. " +
      "The WebSocket layer is powered by Socket.IO. All connections require a " +
      "Bearer JWT passed in `socket.handshake.auth.token`.",
    contact: { name: "BetaForge Labs" },
  },
  servers: {
    production: {
      url: "wss://api.bflabs.tech",
      protocol: "wss",
      description: "Production Socket.IO server",
      security: [{ bearerAuth: [] }],
    },
    development: {
      url: "ws://localhost:3000",
      protocol: "ws",
      description: "Local development Socket.IO server",
      security: [{ bearerAuth: [] }],
    },
  },
  defaultContentType: "application/json",
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Pass the JWT access token in the Socket.IO handshake: " +
          "`socket = io(url, { auth: { token: 'Bearer <token>' } })`",
      },
    },
    schemas: {
      // ── Shared ──────────────────────────────────────────────────────────
      CampaignDispatchStarted: {
        type: "object",
        description: "Emitted when a campaign dispatch job begins.",
        required: [
          "campaignId",
          "campaignType",
          "totalRecipients",
          "startedAt",
        ],
        properties: {
          campaignId: {
            type: "string",
            description: "MongoDB ObjectId of the campaign",
          },
          campaignType: {
            type: "string",
            description: "Semantic type of the campaign",
          },
          totalRecipients: {
            type: "integer",
            description: "Total number of resolved recipients",
          },
          startedAt: { type: "string", format: "date-time" },
        },
      },
      CampaignDispatchProgress: {
        type: "object",
        description:
          "Periodic progress update while a campaign is being dispatched.",
        required: ["campaignId", "sent", "failed", "total", "percentComplete"],
        properties: {
          campaignId: { type: "string" },
          sent: { type: "integer" },
          failed: { type: "integer" },
          total: { type: "integer" },
          percentComplete: {
            type: "number",
            format: "float",
            minimum: 0,
            maximum: 100,
          },
        },
      },
      CampaignDispatchCompleted: {
        type: "object",
        description:
          "Emitted when all emails in a campaign have been processed.",
        required: ["campaignId", "sent", "failed", "total", "completedAt"],
        properties: {
          campaignId: { type: "string" },
          sent: { type: "integer" },
          failed: { type: "integer" },
          total: { type: "integer" },
          completedAt: { type: "string", format: "date-time" },
        },
      },
      CampaignDispatchFailed: {
        type: "object",
        description:
          "Emitted when a campaign dispatch job fails unrecoverably.",
        required: ["campaignId", "reason", "failedAt"],
        properties: {
          campaignId: { type: "string" },
          reason: { type: "string" },
          failedAt: { type: "string", format: "date-time" },
        },
      },
      EmailSent: {
        type: "object",
        description:
          "Emitted after a single email has been delivered successfully.",
        required: ["campaignId", "recipientEmail", "sentAt"],
        properties: {
          campaignId: { type: "string" },
          recipientEmail: { type: "string", format: "email" },
          sentAt: { type: "string", format: "date-time" },
        },
      },
      EmailFailed: {
        type: "object",
        description: "Emitted when delivery of a single email fails.",
        required: ["campaignId", "recipientEmail", "reason", "failedAt"],
        properties: {
          campaignId: { type: "string" },
          recipientEmail: { type: "string", format: "email" },
          reason: { type: "string" },
          failedAt: { type: "string", format: "date-time" },
        },
      },
      EmailBounced: {
        type: "object",
        description: "Emitted when a delivered email bounces.",
        required: ["campaignId", "recipientEmail", "bouncedAt"],
        properties: {
          campaignId: { type: "string" },
          recipientEmail: { type: "string", format: "email" },
          bouncedAt: { type: "string", format: "date-time" },
        },
      },
      QuizGenerationStarted: {
        type: "object",
        description: "Emitted when AI quiz generation begins.",
        required: ["personalQuizId", "userId", "totalTasks", "startedAt"],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          totalTasks: { type: "integer" },
          startedAt: { type: "string", format: "date-time" },
        },
      },
      QuizGenerationPlanReady: {
        type: "object",
        description: "Emitted when the AI generation plan has been determined.",
        required: ["personalQuizId", "userId", "plan"],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          plan: {
            type: "array",
            items: {
              type: "object",
              properties: {
                lectureTitle: { type: "string" },
                topics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      questionTypes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: { type: "string" },
                            count: { type: "integer" },
                          },
                        },
                      },
                      totalQuestions: { type: "integer" },
                    },
                  },
                },
                totalQuestions: { type: "integer" },
                estimatedDuration: { type: "string" },
              },
            },
          },
        },
      },
      QuizGenerationTaskStarted: {
        type: "object",
        description:
          "Emitted when a single generation task (lecture/topic batch) begins.",
        required: [
          "personalQuizId",
          "userId",
          "taskIndex",
          "taskLabel",
          "totalTasks",
        ],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          taskIndex: { type: "integer" },
          taskLabel: { type: "string" },
          totalTasks: { type: "integer" },
        },
      },
      QuizGenerationTaskDone: {
        type: "object",
        description: "Emitted when a single generation task completes.",
        required: [
          "personalQuizId",
          "userId",
          "taskIndex",
          "taskLabel",
          "completedTasks",
          "totalTasks",
          "percentComplete",
        ],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          taskIndex: { type: "integer" },
          taskLabel: { type: "string" },
          completedTasks: { type: "integer" },
          totalTasks: { type: "integer" },
          percentComplete: {
            type: "number",
            format: "float",
            minimum: 0,
            maximum: 100,
          },
        },
      },
      QuizGenerationTaskFailed: {
        type: "object",
        description: "Emitted when a single generation task fails.",
        required: [
          "personalQuizId",
          "userId",
          "taskIndex",
          "taskLabel",
          "errorMessage",
        ],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          taskIndex: { type: "integer" },
          taskLabel: { type: "string" },
          errorMessage: { type: "string" },
        },
      },
      QuizGenerationCompleted: {
        type: "object",
        description: "Emitted when all generation tasks finish successfully.",
        required: ["personalQuizId", "userId", "totalQuestions", "completedAt"],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          totalQuestions: { type: "integer" },
          completedAt: { type: "string", format: "date-time" },
        },
      },
      QuizGenerationFailed: {
        type: "object",
        description: "Emitted when the overall quiz generation job fails.",
        required: ["personalQuizId", "userId", "reason", "failedAt"],
        properties: {
          personalQuizId: { type: "string" },
          userId: { type: "string" },
          reason: { type: "string" },
          failedAt: { type: "string", format: "date-time" },
        },
      },
      ProfileReaggregationCompleted: {
        type: "object",
        description:
          "Emitted when a learner profile reaggregation job completes.",
        required: ["userId", "reaggregatedAt"],
        properties: {
          userId: { type: "string" },
          reaggregatedAt: { type: "string", format: "date-time" },
        },
      },
      RecommendationRefreshCompleted: {
        type: "object",
        description: "Emitted when a recommendation batch refresh completes.",
        required: ["userId", "refreshedAt", "expiresAt"],
        properties: {
          userId: { type: "string" },
          refreshedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      ApprovalStatusChanged: {
        type: "object",
        description:
          "Emitted to the content owner when moderation status changes.",
        required: ["contentId", "contentType", "newStatus", "changedAt"],
        properties: {
          contentId: { type: "string" },
          contentType: { type: "string", enum: ["course", "quiz", "material"] },
          newStatus: {
            type: "string",
            enum: ["approved", "rejected", "pending_approval"],
          },
          reviewedBy: {
            type: "string",
            description: "MongoDB ObjectId of the reviewer (optional)",
          },
          note: { type: "string", description: "Optional reviewer note" },
          changedAt: { type: "string", format: "date-time" },
        },
      },
      ProgramOfferingPublished: {
        type: "object",
        description:
          "Emitted to subscribers when a program offering is published.",
        required: [
          "programOfferingId",
          "programId",
          "universityId",
          "programName",
          "publishedAt",
        ],
        properties: {
          programOfferingId: { type: "string" },
          programId: { type: "string" },
          universityId: { type: "string" },
          programName: { type: "string" },
          publishedAt: { type: "string", format: "date-time" },
        },
      },
      JobStarted: {
        type: "object",
        description: "Generic event emitted when a background job starts.",
        required: ["jobName", "jobId", "queueName", "startedAt"],
        properties: {
          jobName: { type: "string" },
          jobId: { type: "string" },
          queueName: { type: "string" },
          startedAt: { type: "string", format: "date-time" },
          meta: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Optional job metadata",
          },
        },
      },
      JobCompleted: {
        type: "object",
        description: "Generic event emitted when a background job completes.",
        required: ["jobName", "jobId", "queueName", "completedAt"],
        properties: {
          jobName: { type: "string" },
          jobId: { type: "string" },
          queueName: { type: "string" },
          completedAt: { type: "string", format: "date-time" },
          meta: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      JobFailed: {
        type: "object",
        description: "Generic event emitted when a background job fails.",
        required: ["jobName", "jobId", "queueName", "reason", "failedAt"],
        properties: {
          jobName: { type: "string" },
          jobId: { type: "string" },
          queueName: { type: "string" },
          reason: { type: "string" },
          failedAt: { type: "string", format: "date-time" },
          meta: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      JobProgress: {
        type: "object",
        description: "Generic event emitted to report background job progress.",
        required: ["jobName", "jobId", "queueName", "progress"],
        properties: {
          jobName: { type: "string" },
          jobId: { type: "string" },
          queueName: { type: "string" },
          progress: {
            type: "number",
            format: "float",
            minimum: 0,
            maximum: 100,
          },
          message: { type: "string" },
          meta: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      // ── Client → Server room join/leave payloads ─────────────────────────
      CampaignId: {
        type: "string",
        description: "MongoDB ObjectId of the campaign to join or leave.",
        example: "64b2f3a1c9e77b001234abcd",
      },
      PersonalQuizId: {
        type: "string",
        description: "MongoDB ObjectId of the personal quiz to join or leave.",
        example: "64b2f3a1c9e77b001234efgh",
      },
    },
    messages: {
      // ── Server → Client ──────────────────────────────────────────────────
      CampaignDispatchStartedMessage: {
        name: "campaign:dispatch:started",
        title: "Campaign dispatch started",
        summary: "The bulk email dispatch for a campaign has begun.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignDispatchStarted" },
      },
      CampaignDispatchProgressMessage: {
        name: "campaign:dispatch:progress",
        title: "Campaign dispatch progress",
        summary: "Periodic progress update during bulk email dispatch.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignDispatchProgress" },
      },
      CampaignDispatchCompletedMessage: {
        name: "campaign:dispatch:completed",
        title: "Campaign dispatch completed",
        summary: "All emails in the campaign have been processed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignDispatchCompleted" },
      },
      CampaignDispatchFailedMessage: {
        name: "campaign:dispatch:failed",
        title: "Campaign dispatch failed",
        summary: "The campaign dispatch job failed unrecoverably.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignDispatchFailed" },
      },
      CampaignCancelledMessage: {
        name: "campaign:cancelled",
        title: "Campaign cancelled",
        summary: "The campaign was cancelled before or during dispatch.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignDispatchFailed" },
      },
      EmailSentMessage: {
        name: "email:sent",
        title: "Email sent",
        summary: "A single email was delivered successfully.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/EmailSent" },
      },
      EmailFailedMessage: {
        name: "email:failed",
        title: "Email failed",
        summary: "Delivery of a single email failed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/EmailFailed" },
      },
      EmailBouncedMessage: {
        name: "email:bounced",
        title: "Email bounced",
        summary: "A delivered email bounced.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/EmailBounced" },
      },
      QuizGenerationStartedMessage: {
        name: "quiz:generation:started",
        title: "Quiz generation started",
        summary: "AI quiz generation has begun.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationStarted" },
      },
      QuizGenerationPlanReadyMessage: {
        name: "quiz:generation:plan_ready",
        title: "Quiz generation plan ready",
        summary: "The AI generation plan has been determined.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationPlanReady" },
      },
      QuizGenerationTaskStartedMessage: {
        name: "quiz:generation:task:started",
        title: "Quiz generation task started",
        summary: "A single generation task (lecture/topic batch) has begun.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationTaskStarted" },
      },
      QuizGenerationTaskDoneMessage: {
        name: "quiz:generation:task:done",
        title: "Quiz generation task done",
        summary: "A single generation task completed successfully.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationTaskDone" },
      },
      QuizGenerationTaskFailedMessage: {
        name: "quiz:generation:task:failed",
        title: "Quiz generation task failed",
        summary: "A single generation task failed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationTaskFailed" },
      },
      QuizGenerationCompletedMessage: {
        name: "quiz:generation:completed",
        title: "Quiz generation completed",
        summary: "All generation tasks finished; the quiz is ready.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationCompleted" },
      },
      QuizGenerationFailedMessage: {
        name: "quiz:generation:failed",
        title: "Quiz generation failed",
        summary: "The overall quiz generation job failed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/QuizGenerationFailed" },
      },
      ProfileReaggregationCompletedMessage: {
        name: "profile:reaggregation:completed",
        title: "Profile reaggregation completed",
        summary: "The learner profile reaggregation job completed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/ProfileReaggregationCompleted" },
      },
      RecommendationRefreshCompletedMessage: {
        name: "recommendation:refresh:completed",
        title: "Recommendation refresh completed",
        summary: "The recommendation batch refresh completed.",
        contentType: "application/json",
        payload: {
          $ref: "#/components/schemas/RecommendationRefreshCompleted",
        },
      },
      ApprovalStatusChangedMessage: {
        name: "approval:status:changed",
        title: "Approval status changed",
        summary:
          "Moderation status changed on content owned by the receiving user.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/ApprovalStatusChanged" },
      },
      ProgramOfferingPublishedMessage: {
        name: "program:offering:published",
        title: "Program offering published",
        summary: "A subscribed program offering has been published.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/ProgramOfferingPublished" },
      },
      JobStartedMessage: {
        name: "job:started",
        title: "Job started",
        summary: "A background job started.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/JobStarted" },
      },
      JobCompletedMessage: {
        name: "job:completed",
        title: "Job completed",
        summary: "A background job completed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/JobCompleted" },
      },
      JobFailedMessage: {
        name: "job:failed",
        title: "Job failed",
        summary: "A background job failed.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/JobFailed" },
      },
      JobProgressMessage: {
        name: "job:progress",
        title: "Job progress",
        summary: "Background job progress update.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/JobProgress" },
      },
      // ── Client → Server ──────────────────────────────────────────────────
      JoinCampaignMessage: {
        name: "join:campaign",
        title: "Join campaign room",
        summary:
          "Subscribe to real-time events for a specific campaign dispatch.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignId" },
      },
      LeaveCampaignMessage: {
        name: "leave:campaign",
        title: "Leave campaign room",
        summary: "Unsubscribe from real-time events for a campaign.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/CampaignId" },
      },
      JoinQuizGenerationMessage: {
        name: "join:quiz_generation",
        title: "Join quiz generation room",
        summary:
          "Subscribe to progress events for a personal quiz generation job.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/PersonalQuizId" },
      },
      LeaveQuizGenerationMessage: {
        name: "leave:quiz_generation",
        title: "Leave quiz generation room",
        summary: "Unsubscribe from progress events for a quiz generation job.",
        contentType: "application/json",
        payload: { $ref: "#/components/schemas/PersonalQuizId" },
      },
    },
  },

  channels: {
    // ── Client → Server ────────────────────────────────────────────────────

    "join:campaign": {
      description:
        "Join the campaign room `campaign:{campaignId}` to receive real-time " +
        "dispatch events for the given campaign. Typically used by admins " +
        "monitoring an active dispatch.",
      publish: {
        operationId: "joinCampaignRoom",
        summary: "Join a campaign room",
        message: { $ref: "#/components/messages/JoinCampaignMessage" },
      },
    },
    "leave:campaign": {
      description: "Leave the campaign room `campaign:{campaignId}`.",
      publish: {
        operationId: "leaveCampaignRoom",
        summary: "Leave a campaign room",
        message: { $ref: "#/components/messages/LeaveCampaignMessage" },
      },
    },
    "join:quiz_generation": {
      description:
        "Join the quiz generation room `quiz_generation:{personalQuizId}` to " +
        "receive granular task-level progress events while AI generates questions.",
      publish: {
        operationId: "joinQuizGenerationRoom",
        summary: "Join a quiz generation room",
        message: { $ref: "#/components/messages/JoinQuizGenerationMessage" },
      },
    },
    "leave:quiz_generation": {
      description:
        "Leave the quiz generation room `quiz_generation:{personalQuizId}`.",
      publish: {
        operationId: "leaveQuizGenerationRoom",
        summary: "Leave a quiz generation room",
        message: { $ref: "#/components/messages/LeaveQuizGenerationMessage" },
      },
    },

    // ── Campaign events (room: campaign:{campaignId}) ──────────────────────

    "campaign:dispatch:started": {
      description:
        "Emitted to the `campaign:{campaignId}` room when bulk email dispatch begins.",
      subscribe: {
        operationId: "onCampaignDispatchStarted",
        summary: "Campaign dispatch started",
        message: {
          $ref: "#/components/messages/CampaignDispatchStartedMessage",
        },
      },
    },
    "campaign:dispatch:progress": {
      description:
        "Emitted periodically to the `campaign:{campaignId}` room while emails are being sent.",
      subscribe: {
        operationId: "onCampaignDispatchProgress",
        summary: "Campaign dispatch progress",
        message: {
          $ref: "#/components/messages/CampaignDispatchProgressMessage",
        },
      },
    },
    "campaign:dispatch:completed": {
      description:
        "Emitted to the `campaign:{campaignId}` room when all emails are processed.",
      subscribe: {
        operationId: "onCampaignDispatchCompleted",
        summary: "Campaign dispatch completed",
        message: {
          $ref: "#/components/messages/CampaignDispatchCompletedMessage",
        },
      },
    },
    "campaign:dispatch:failed": {
      description:
        "Emitted to the `campaign:{campaignId}` room when the dispatch job fails.",
      subscribe: {
        operationId: "onCampaignDispatchFailed",
        summary: "Campaign dispatch failed",
        message: {
          $ref: "#/components/messages/CampaignDispatchFailedMessage",
        },
      },
    },
    "campaign:cancelled": {
      description:
        "Emitted to the `campaign:{campaignId}` room when the campaign is cancelled.",
      subscribe: {
        operationId: "onCampaignCancelled",
        summary: "Campaign cancelled",
        message: { $ref: "#/components/messages/CampaignCancelledMessage" },
      },
    },

    // ── Individual email events (room: campaign:{campaignId}) ──────────────

    "email:sent": {
      description:
        "Emitted to the `campaign:{campaignId}` room after each successful email delivery.",
      subscribe: {
        operationId: "onEmailSent",
        summary: "Email sent",
        message: { $ref: "#/components/messages/EmailSentMessage" },
      },
    },
    "email:failed": {
      description:
        "Emitted to the `campaign:{campaignId}` room when a single email fails.",
      subscribe: {
        operationId: "onEmailFailed",
        summary: "Email failed",
        message: { $ref: "#/components/messages/EmailFailedMessage" },
      },
    },
    "email:bounced": {
      description:
        "Emitted to the `campaign:{campaignId}` room when a delivered email bounces.",
      subscribe: {
        operationId: "onEmailBounced",
        summary: "Email bounced",
        message: { $ref: "#/components/messages/EmailBouncedMessage" },
      },
    },

    // ── AI quiz generation events (rooms: quiz_generation:{id} + user:{id}) ─

    "quiz:generation:started": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room **and** the " +
        "`user:{userId}` room when AI generation begins.",
      subscribe: {
        operationId: "onQuizGenerationStarted",
        summary: "Quiz generation started",
        message: { $ref: "#/components/messages/QuizGenerationStartedMessage" },
      },
    },
    "quiz:generation:plan_ready": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room **and** the " +
        "`user:{userId}` room when the generation plan is determined.",
      subscribe: {
        operationId: "onQuizGenerationPlanReady",
        summary: "Quiz generation plan ready",
        message: {
          $ref: "#/components/messages/QuizGenerationPlanReadyMessage",
        },
      },
    },
    "quiz:generation:task:started": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room when a task begins.",
      subscribe: {
        operationId: "onQuizGenerationTaskStarted",
        summary: "Quiz generation task started",
        message: {
          $ref: "#/components/messages/QuizGenerationTaskStartedMessage",
        },
      },
    },
    "quiz:generation:task:done": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room when a task completes.",
      subscribe: {
        operationId: "onQuizGenerationTaskDone",
        summary: "Quiz generation task done",
        message: {
          $ref: "#/components/messages/QuizGenerationTaskDoneMessage",
        },
      },
    },
    "quiz:generation:task:failed": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room when a task fails.",
      subscribe: {
        operationId: "onQuizGenerationTaskFailed",
        summary: "Quiz generation task failed",
        message: {
          $ref: "#/components/messages/QuizGenerationTaskFailedMessage",
        },
      },
    },
    "quiz:generation:completed": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room **and** the " +
        "`user:{userId}` room when the quiz is fully generated.",
      subscribe: {
        operationId: "onQuizGenerationCompleted",
        summary: "Quiz generation completed",
        message: {
          $ref: "#/components/messages/QuizGenerationCompletedMessage",
        },
      },
    },
    "quiz:generation:failed": {
      description:
        "Emitted to the `quiz_generation:{personalQuizId}` room **and** the " +
        "`user:{userId}` room when quiz generation fails.",
      subscribe: {
        operationId: "onQuizGenerationFailed",
        summary: "Quiz generation failed",
        message: { $ref: "#/components/messages/QuizGenerationFailedMessage" },
      },
    },

    // ── Profile + recommendation events (room: user:{userId}) ─────────────

    "profile:reaggregation:completed": {
      description:
        "Emitted to the `user:{userId}` room when the learner profile reaggregation " +
        "job completes.",
      subscribe: {
        operationId: "onProfileReaggregationCompleted",
        summary: "Learner profile reaggregation completed",
        message: {
          $ref: "#/components/messages/ProfileReaggregationCompletedMessage",
        },
      },
    },
    "recommendation:refresh:completed": {
      description:
        "Emitted to the `user:{userId}` room when the recommendation batch refresh " +
        "completes.",
      subscribe: {
        operationId: "onRecommendationRefreshCompleted",
        summary: "Recommendation refresh completed",
        message: {
          $ref: "#/components/messages/RecommendationRefreshCompletedMessage",
        },
      },
    },

    // ── Approval events (room: user:{userId}) ─────────────────────────────

    "approval:status:changed": {
      description:
        "Emitted to the `user:{userId}` room (the content owner) when a moderator " +
        "approves or rejects their submitted course, quiz, or material.",
      subscribe: {
        operationId: "onApprovalStatusChanged",
        summary: "Content approval status changed",
        message: { $ref: "#/components/messages/ApprovalStatusChangedMessage" },
      },
    },

    // ── Program events (room: user:{userId}) ──────────────────────────────

    "program:offering:published": {
      description:
        "Emitted to the `user:{userId}` room of every subscriber when a program " +
        "offering they subscribed to is published.",
      subscribe: {
        operationId: "onProgramOfferingPublished",
        summary: "Program offering published",
        message: {
          $ref: "#/components/messages/ProgramOfferingPublishedMessage",
        },
      },
    },

    // ── Generic job events (room: user:{userId}) ──────────────────────────

    "job:started": {
      description:
        "Emitted to the `user:{userId}` room when a background job starts.",
      subscribe: {
        operationId: "onJobStarted",
        summary: "Background job started",
        message: { $ref: "#/components/messages/JobStartedMessage" },
      },
    },
    "job:completed": {
      description:
        "Emitted to the `user:{userId}` room when a background job completes.",
      subscribe: {
        operationId: "onJobCompleted",
        summary: "Background job completed",
        message: { $ref: "#/components/messages/JobCompletedMessage" },
      },
    },
    "job:failed": {
      description:
        "Emitted to the `user:{userId}` room when a background job fails.",
      subscribe: {
        operationId: "onJobFailed",
        summary: "Background job failed",
        message: { $ref: "#/components/messages/JobFailedMessage" },
      },
    },
    "job:progress": {
      description:
        "Emitted to the `user:{userId}` room to report background job progress.",
      subscribe: {
        operationId: "onJobProgress",
        summary: "Background job progress",
        message: { $ref: "#/components/messages/JobProgressMessage" },
      },
    },
  },
};

export { asyncapiSpec };

/**
 * Returns an Express request handler that serves a self-contained AsyncAPI
 * browser UI (powered by @asyncapi/react-component) at the registered route.
 *
 * Usage (server.ts):
 *   app.get("/api/v1/asyncapi/docs", asyncapiUiSetup(asyncapiSpec));
 *
 * The handler embeds the spec inline so no extra network request is needed,
 * and overrides the global Content-Security-Policy just for this route to
 * allow the CDN assets required by the component.
 */
import { Request, Response } from "express";

export function asyncapiUiSetup(
  spec: object,
): (_req: Request, res: Response) => void {
  const specJson = JSON.stringify(spec)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BetaForge Labs – WebSocket API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/@asyncapi/react-component@latest/styles/default.min.css"
    />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      #asyncapi-root { height: 100%; }
    </style>
  </head>
  <body>
    <div id="asyncapi-root"></div>
    <script src="https://unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js"></script>
    <script>
      document.addEventListener("DOMContentLoaded", function () {
        if (typeof AsyncApiStandalone === "undefined") {
          document.getElementById("asyncapi-root").innerHTML =
            "<p style='padding:2rem;font-family:monospace'>Failed to load AsyncAPI renderer. Check your network connection.</p>";
          return;
        }

        AsyncApiStandalone.render(
          {
            schema: ${specJson},
            config: {
              show: {
                sidebar: true,
                info: true,
                servers: true,
                operations: true,
                messages: true,
                schemas: true,
                errors: true,
              },
            },
          },
          document.getElementById("asyncapi-root")
        );
      });
    </script>
  </body>
</html>`;

  return (_req: Request, res: Response): void => {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // unsafe-eval required — ajv (used internally by AsyncAPI) compiles
        // validators using new Function(). No way around this with this renderer.
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com https://unpkg.com data:",
        "img-src 'self' data: https://unpkg.com",
        "worker-src blob:",
        "connect-src 'self' https://unpkg.com",
      ].join("; "),
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  };
}
