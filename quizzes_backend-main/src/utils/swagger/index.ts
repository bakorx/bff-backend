import swaggerJsdoc from "swagger-jsdoc";

const swaggerDefinition: swaggerJsdoc.SwaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "BetaForge Labs Quizzes API",
    version: "2.0.0",
    description:
      "Interactive API documentation for the BetaForge Labs Quizzes backend. " +
      "Most endpoints require a Bearer JWT obtained from `POST /auth/login`.",
    contact: { name: "BetaForge Labs" },
  },
  servers: [{ url: "/api/v1", description: "API v1" }],
  tags: [
    { name: "Auth", description: "Authentication and token management" },
    { name: "Users", description: "User management (admin and self-service)" },
    { name: "Institutions", description: "Campuses, schools and courses" },
    {
      name: "Learning",
      description: "Questions, materials, flashcards and personal quizzes",
    },
    {
      name: "AI",
      description: "AI personas, chat sessions and usage tracking",
    },
    {
      name: "Subscriptions",
      description: "Packages, payments and subscriptions",
    },
    { name: "System", description: "Waitlist and system operations" },
    {
      name: "EmailCampaigns",
      description:
        "Email campaign management — audience targeting, scheduling, dispatch and engagement tracking (super-admin only)",
    },
    {
      name: "Push",
      description: "Web Push notification subscription management",
    },
    {
      name: "Sessions",
      description: "Z AI study sessions, messages, highlights and studio tools",
    },
    { name: "Donations", description: "Donation initiation and verification" },
    { name: "Streak", description: "Study streak tracking and freezes" },
    { name: "Discounts", description: "Promo codes and discount management" },
    { name: "StudentVerify", description: "Student email verification" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    parameters: {
      PageParam: {
        in: "query",
        name: "page",
        schema: { type: "integer", minimum: 1, default: 1 },
        description: "Page number for pagination",
      },
      LimitParam: {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        description: "Number of results per page",
      },
      SortByParam: {
        in: "query",
        name: "sortBy",
        schema: { type: "string", default: "createdAt" },
        description: "Field to sort results by",
      },
      SortOrderParam: {
        in: "query",
        name: "sortOrder",
        schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
        description: "Sort direction",
      },
      SearchParam: {
        in: "query",
        name: "search",
        schema: { type: "string" },
        description: "Free-text search term (case-insensitive)",
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid authentication token",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      Forbidden: {
        description: "Insufficient permissions",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      BadRequest: {
        description: "Validation error or bad request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      InternalError: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
    schemas: {
      // ── Generic ───────────────────────────────────────────────────────────
      Error: {
        type: "object",
        properties: {
          message: { type: "string", example: "Something went wrong" },
        },
      },

      // ── Auth ──────────────────────────────────────────────────────────────
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", example: "johndoe" },
          password: {
            type: "string",
            format: "password",
            example: "secret123",
          },
          rememberMe: {
            type: "boolean",
            default: false,
            description: "Extends refresh token expiry to 30 days",
          },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          user: {
            type: "object",
            description:
              "The token payload returned at login — mirrors the JWT claims.",
            properties: {
              id: {
                type: "string",
                description: "MongoDB ObjectId of the authenticated user",
              },
              name: { type: "string", description: "Display name of the user" },
              username: { type: "string" },
              email: { type: "string", format: "email" },
              role: {
                type: "string",
                enum: ["student", "creator", "moderator", "super_admin"],
                default: "student",
              },
              isBanned: { type: "boolean" },
              isSubscribed: { type: "boolean" },
              profilePicture: {
                type: "string",
                format: "uri",
                description: "URL of the user's profile picture",
              },
            },
          },
        },
      },
      TokenRefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" },
        },
      },
      TokenRefreshResponse: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          message: { type: "string" },
        },
      },
      SignupRequest: {
        type: "object",
        required: ["name", "email", "username", "password"],
        properties: {
          name: { type: "string", minLength: 2, example: "Jane Doe" },
          email: {
            type: "string",
            format: "email",
            example: "jane@example.com",
          },
          username: {
            type: "string",
            minLength: 3,
            maxLength: 30,
            pattern: "^[a-zA-Z0-9_]+$",
            example: "jane_doe",
          },
          password: {
            type: "string",
            format: "password",
            minLength: 6,
            description: "Initial password (minimum 6 characters)",
            example: "secret123",
          },
        },
      },
      SignupResponse: {
        type: "object",
        description:
          "Tokens and minimal user payload returned after successful registration.",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          user: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "MongoDB ObjectId of the new user",
              },
              name: { type: "string" },
              username: { type: "string" },
              email: { type: "string", format: "email" },
              role: {
                type: "string",
                enum: ["student", "creator", "moderator", "super_admin"],
                default: "student",
              },
              isBanned: { type: "boolean", default: false },
              isSubscribed: { type: "boolean", default: false },
            },
          },
        },
      },

      // ── Users ─────────────────────────────────────────────────────────────
      User: {
        type: "object",
        required: ["username", "email", "password", "name"],
        properties: {
          name: { type: "string" },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
          role: {
            type: "string",
            enum: ["student", "creator", "moderator", "super_admin"],
            default: "student",
            description: "Platform authorization role",
          },
          accessType: {
            type: "string",
            enum: ["quiz", "course", "duration", "default"],
            default: "default",
            description:
              "Access tier type unlocked by the user's current subscription",
          },
          isBanned: { type: "boolean", default: false },
          isSubscribed: { type: "boolean", default: false },
          hasFreeAccess: { type: "boolean", default: true },
          freeAccessCount: { type: "integer", default: 2 },
          quizCredits: { type: "integer", default: 1200 },
          preferredPersonaId: {
            type: "string",
            description: "MongoDB ObjectId of the preferred AI persona",
          },
        },
      },
      ProfileCheck: {
        type: "object",
        description:
          "Fields to validate before updating a user profile (username availability, email uniqueness, current password verification).",
        properties: {
          username: {
            type: "string",
            description: "Username to check for availability",
          },
          email: {
            type: "string",
            format: "email",
            description: "Email to check for uniqueness",
          },
          currentPassword: {
            type: "string",
            description: "Current password to verify (requires auth)",
          },
        },
      },
      ProfileUpdate: {
        type: "object",
        description:
          "Fields the authenticated user can update on their own profile. `currentPassword` is always required to authorize any change.",
        required: ["currentPassword"],
        properties: {
          username: { type: "string", minLength: 1 },
          password: {
            type: "string",
            format: "password",
            minLength: 8,
            description:
              "New password (minimum 8 characters for profile updates)",
          },
          currentPassword: {
            type: "string",
            description:
              "Current password — always required to authorize the update",
          },
          profilePicture: {
            type: "string",
            pattern: "^[0-9a-fA-F]{24}$",
            description: "ObjectId of the uploaded avatar",
          },
          bio: { type: "string", maxLength: 160 },
        },
      },
      OnboardingSteps: {
        type: "object",
        description:
          "Boolean flags tracking which onboarding steps have been completed.",
        properties: {
          profile: { type: "boolean" },
          yearOfStudy: { type: "boolean" },
          pushOptIn: { type: "boolean" },
          zIntro: { type: "boolean" },
        },
      },
      OnboardingStatus: {
        type: "object",
        description: "Onboarding state for the authenticated user.",
        properties: {
          completed: {
            type: "boolean",
            description: "True once all required steps are done",
          },
          completedAt: {
            type: "string",
            format: "date-time",
            description: "ISO timestamp when onboarding was first completed",
          },
          currentStep: {
            type: "integer",
            minimum: 0,
            description: "Zero-based index of the current step",
          },
          steps: { $ref: "#/components/schemas/OnboardingSteps" },
        },
      },

      // ── Institutions ──────────────────────────────────────────────────────
      University: {
        type: "object",
        required: ["name", "code"],
        description: "The root node of an institution hierarchy.",
        properties: {
          name: { type: "string", description: "Name of the university" },
          code: { type: "string", description: "Unique university code" },
          description: { type: "string" },
          logo: { type: "string", format: "uri" },
          website: { type: "string", format: "uri" },
          isActive: { type: "boolean", default: true },
          settings: {
            type: "object",
            properties: {
              requireEmailVerification: { type: "boolean", default: true },
              defaultStudentCredits: { type: "integer", default: 1200 },
              allowPublicCourses: { type: "boolean", default: true },
            },
          },
          sharingSettings: {
            type: "object",
            properties: {
              allowCrossCampusSharing: { type: "boolean", default: false },
              allowCrossCollegeSharing: { type: "boolean", default: false },
              allowCrossSchoolSharing: { type: "boolean", default: false },
              allowCrossDepartmentSharing: { type: "boolean", default: false },
            },
          },
        },
      },
      Campus: {
        type: "object",
        required: ["name", "code", "location"],
        properties: {
          name: { type: "string", example: "Main Campus" },
          code: { type: "string", example: "UG-MAIN" },
          location: { type: "string", example: "Accra, Ghana" },
          isActive: { type: "boolean", default: true },
          allowResourceSharing: { type: "boolean", default: true },
          admins: {
            type: "array",
            items: { type: "string" },
            description: "Array of admin user ObjectIds",
          },
        },
      },
      School: {
        type: "object",
        required: ["name", "code", "universityId", "campusId", "collegeId"],
        description:
          "A School/Faculty within a College. Hierarchy: University → Campus → College → School → Department",
        properties: {
          name: {
            type: "string",
            example: "School of Physical & Mathematical Sciences",
          },
          code: { type: "string", example: "SPMS" },
          universityId: {
            type: "string",
            description: "Denormalized parent University ObjectId",
          },
          campusId: {
            type: "string",
            description: "Denormalized parent Campus ObjectId",
          },
          collegeId: { type: "string", description: "Parent College ObjectId" },
          isActive: { type: "boolean", default: true },
        },
      },
      College: {
        type: "object",
        required: ["name", "code", "universityId", "campusId"],
        description:
          "A College within a Campus. Hierarchy: University → Campus → College → School → Department",
        properties: {
          name: {
            type: "string",
            example: "College of Basic & Applied Sciences",
          },
          code: { type: "string", example: "CBAS" },
          universityId: {
            type: "string",
            description: "Denormalized parent University ObjectId",
          },
          campusId: { type: "string", description: "Parent Campus ObjectId" },
          isActive: { type: "boolean", default: true },
        },
      },
      Department: {
        type: "object",
        required: [
          "name",
          "code",
          "universityId",
          "campusId",
          "collegeId",
          "schoolId",
        ],
        description:
          "A Department — leaf of the hierarchy. Hierarchy: University → Campus → College → School → Department",
        properties: {
          name: { type: "string", example: "Department of Computer Science" },
          code: { type: "string", example: "CS" },
          universityId: {
            type: "string",
            description: "Denormalized parent University ObjectId",
          },
          campusId: {
            type: "string",
            description: "Denormalized parent Campus ObjectId",
          },
          collegeId: {
            type: "string",
            description: "Denormalized parent College ObjectId",
          },
          schoolId: { type: "string", description: "Parent School ObjectId" },
          isActive: { type: "boolean", default: true },
        },
      },
      Course: {
        type: "object",
        required: ["code", "about", "semester", "createdBy", "campusId"],
        properties: {
          code: { type: "string", example: "CS101" },
          title: { type: "string" },
          about: { type: "string" },
          numberOfLectures: { type: "integer", minimum: 0 },
          semester: { type: "integer", minimum: 1 },
          creditHours: { type: "integer", default: 3 },
          year: { type: "integer" },
          createdBy: { type: "string", description: "MongoDB ObjectId" },
          campusId: { type: "string", description: "MongoDB ObjectId" },
          schoolId: { type: "string", description: "MongoDB ObjectId" },
          isShared: { type: "boolean", default: false },
          sharedAcrossSchools: { type: "boolean", default: false },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      CourseEnrollment: {
        deprecated: true,
        description:
          "Removed from API. Enrollments are no longer modeled in this backend.",
        type: "object",
        properties: {},
      },
      Program: {
        type: "object",
        required: [
          "name",
          "code",
          "degreeType",
          "fieldOfStudy",
          "description",
          "createdBy",
        ],
        properties: {
          name: { type: "string", example: "BSc Computer Science" },
          code: { type: "string", example: "BSC-CS" },
          degreeType: {
            type: "string",
            enum: [
              "bachelor",
              "master",
              "phd",
              "diploma",
              "certificate",
              "associate",
            ],
          },
          fieldOfStudy: { type: "string", example: "Computer Science" },
          tags: {
            type: "array",
            items: { type: "string" },
            example: ["STEM", "Computing"],
          },
          description: { type: "string" },
          isActive: { type: "boolean", default: true },
          createdBy: {
            type: "string",
            description: "MongoDB ObjectId of the creator",
          },
        },
      },
      ProgramOffering: {
        type: "object",
        required: [
          "programId",
          "universityId",
          "collegeId",
          "schoolId",
          "departmentId",
          "name",
          "code",
          "createdBy",
        ],
        properties: {
          programId: {
            type: "string",
            description: "MongoDB ObjectId of the global IProgram",
          },
          universityId: { type: "string" },
          campusId: {
            type: "string",
            description: "Optional — if campus-specific",
          },
          collegeId: { type: "string" },
          schoolId: { type: "string" },
          departmentId: { type: "string" },
          name: { type: "string", example: "BSc Computer Science" },
          code: { type: "string", example: "UG-BSC-CS" },
          isActive: { type: "boolean", default: true },
          isPublished: {
            type: "boolean",
            default: false,
            description:
              "Setting to true triggers notifications to all pending subscribers",
          },
          applicationOpen: { type: "boolean", default: false },
          maxStudents: { type: "integer", minimum: 1 },
          createdBy: { type: "string" },
        },
      },
      ProgramVersion: {
        type: "object",
        required: [
          "programOfferingId",
          "universityId",
          "versionNumber",
          "effectiveFrom",
          "totalCreditsRequired",
          "durationYears",
          "approvedBy",
        ],
        properties: {
          programOfferingId: { type: "string" },
          universityId: { type: "string" },
          versionNumber: { type: "integer", minimum: 1 },
          effectiveFrom: { type: "string", format: "date-time" },
          effectiveTo: { type: "string", format: "date-time" },
          totalCreditsRequired: { type: "number", minimum: 0 },
          minimumGPA: { type: "number", minimum: 0, maximum: 4 },
          durationYears: { type: "integer", minimum: 1 },
          structure: {
            type: "array",
            description: "Curriculum structure — array of IProgramYear",
            items: { type: "object" },
          },
          changeNotes: { type: "string" },
          approvedBy: { type: "string" },
        },
      },
      ProgramOfferingSubscription: {
        type: "object",
        required: ["userId", "programId", "universityId"],
        properties: {
          userId: { type: "string" },
          programId: { type: "string" },
          universityId: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "notified", "enrolled", "cancelled"],
            default: "pending",
            description: "pending → notified → enrolled (or cancelled)",
          },
        },
      },
      StudentEnrolment: {
        deprecated: true,
        description:
          "Legacy schema retained for compatibility docs only; model is no longer used by learning APIs.",
        type: "object",
        properties: {},
      },

      // ── Learning ──────────────────────────────────────────────────────────
      Question: {
        type: "object",
        required: [
          "courseId",
          "question",
          "options",
          "answer",
          "type",
          "author",
        ],
        properties: {
          courseId: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          type: { type: "string", enum: ["mcq", "fill-in", "true-false"] },
          explanation: { type: "string" },
          lectureNumber: { type: "string" },
          hint: { type: "string" },
          author: { type: "string" },
          isModerated: { type: "boolean", default: false },
          year: { type: "integer" },
          aiGeneratedExplanation: { type: "string" },
          aiConfidenceScore: {
            type: "number",
            minimum: 0,
            maximum: 100,
            default: 0,
          },
        },
      },
      Flashcard: {
        type: "object",
        required: [
          "courseId",
          "materialId",
          "front",
          "back",
          "lectureNumber",
          "createdBy",
        ],
        properties: {
          courseId: { type: "string" },
          materialId: { type: "string" },
          front: {
            type: "string",
            description: "Prompt / question shown on the front",
          },
          back: {
            type: "string",
            description: "Answer / explanation on the back",
          },
          lectureNumber: { type: "string" },
          createdBy: { type: "string" },
          isPublic: { type: "boolean", default: false },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            default: "medium",
          },
          tags: { type: "array", items: { type: "string" } },
          masteryLevel: {
            type: "number",
            minimum: 0,
            maximum: 100,
            default: 0,
          },
        },
      },
      Material: {
        type: "object",
        required: [
          "title",
          "url",
          "type",
          "questionRefType",
          "uploadedBy",
          "courseId",
        ],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          type: {
            type: "string",
            enum: ["pdf", "doc", "slides", "text", "img", "link", "data"],
          },
          questionRefType: { type: "string" },
          isProcessed: { type: "boolean", default: false },
          uploadedBy: { type: "string" },
          courseId: { type: "string" },
        },
      },
      PersonalQuiz: {
        type: "object",
        required: ["title", "courseId", "materialId", "createdBy", "questions"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          courseId: { type: "string" },
          materialId: { type: "string" },
          createdBy: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                answer: { type: "string" },
                explanation: { type: "string" },
                type: {
                  type: "string",
                  enum: ["mcq", "true-false", "fill-in", "short-answer"],
                },
                difficulty: {
                  type: "string",
                  enum: ["basic", "intermediate", "advanced", "critical"],
                },
              },
            },
          },
          isPublic: { type: "boolean", default: false },
          tags: { type: "array", items: { type: "string" } },
        },
      },

      // ── AI ────────────────────────────────────────────────────────────────
      ChatbotPersona: {
        type: "object",
        required: [
          "name",
          "description",
          "personalityTraits",
          "responseStyle",
          "systemPrompt",
        ],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          personalityTraits: { type: "array", items: { type: "string" } },
          responseStyle: {
            type: "string",
            enum: [
              "friendly",
              "professional",
              "encouraging",
              "concise",
              "detailed",
            ],
          },
          systemPrompt: { type: "string" },
          isDefault: { type: "boolean", default: false },
          isActive: { type: "boolean", default: true },
          schoolId: { type: "string" },
          createdBy: { type: "string" },
        },
      },
      AiResponse: {
        type: "object",
        required: [
          "userId",
          "query",
          "responses",
          "creditsCharged",
          "queryType",
        ],
        properties: {
          userId: { type: "string" },
          query: { type: "string" },
          queryType: {
            type: "string",
            enum: ["explanation", "answer", "hint", "discussion", "other"],
          },
          responses: {
            type: "array",
            description:
              "Generated candidate responses from one or more AI models",
            items: {
              type: "object",
              required: ["modelName", "response"],
              properties: {
                modelName: {
                  type: "string",
                  description:
                    "Which AI model generated this (e.g. gpt-4o-mini)",
                },
                response: { type: "string" },
                probabilityScore: { type: "number", minimum: 0, maximum: 100 },
                responseTimeMs: { type: "number" },
                tokensUsed: { type: "number" },
                evaluationMetrics: {
                  type: "object",
                  properties: {
                    accuracy: { type: "number", minimum: 0, maximum: 100 },
                    relevance: { type: "number", minimum: 0, maximum: 100 },
                    clarity: { type: "number", minimum: 0, maximum: 100 },
                    confidence: { type: "number", minimum: 0, maximum: 100 },
                  },
                },
              },
            },
          },
          selectedResponse: { type: "string" },
          selectedModelName: { type: "string" },
          creditsCharged: { type: "number", minimum: 0 },
          sessionId: { type: "string" },
          personaId: { type: "string" },
        },
      },
      AiUsageTransaction: {
        type: "object",
        required: [
          "userId",
          "transactionType",
          "amount",
          "balanceBefore",
          "balanceAfter",
          "reason",
        ],
        properties: {
          userId: { type: "string" },
          transactionType: {
            type: "string",
            enum: ["debit", "credit", "refund"],
          },
          amount: { type: "number", minimum: 0 },
          balanceBefore: { type: "number" },
          balanceAfter: { type: "number" },
          reason: { type: "string" },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: {
            type: "string",
            example: "Explain Newton's second law",
          },
          courseId: { type: "string" },
          personaId: { type: "string" },
        },
      },
      ChatResponse: {
        type: "object",
        properties: {
          reply: { type: "string" },
          creditsUsed: { type: "number" },
          creditsRemaining: { type: "number" },
        },
      },

      // ── Subscriptions ─────────────────────────────────────────────────────
      Package: {
        type: "object",
        required: ["name", "price", "duration"],
        properties: {
          name: { type: "string" },
          price: { type: "number", minimum: 0 },
          duration: {
            type: "integer",
            minimum: 1,
            description: "Duration in days",
          },
          access: {
            type: "string",
            enum: ["quiz", "course", "duration", "default"],
            default: "default",
          },
          isUpgradable: { type: "boolean", default: false },
          numberOfQuizzes: { type: "integer", default: 0 },
          numberOfCourses: { type: "integer", default: 0 },
          discountCode: { type: "string" },
          discountPercentage: {
            type: "number",
            minimum: 0,
            maximum: 100,
            default: 0,
          },
        },
      },
      PaymentInitiateRequest: {
        type: "object",
        required: ["amount", "packageId"],
        properties: {
          amount: { type: "number", minimum: 0 },
          packageId: { type: "string" },
          discountCode: { type: "string" },
        },
      },
      Payment: {
        type: "object",
        properties: {
          userId: { type: "string" },
          amount: { type: "number" },
          reference: { type: "string" },
          status: {
            type: "string",
            enum: [
              "abandoned",
              "failed",
              "ongoing",
              "pending",
              "processing",
              "queued",
              "success",
              "reversed",
            ],
          },
          type: {
            type: "string",
            enum: ["course", "quiz", "duration", "credits", "default"],
          },
          method: { type: "string", default: "mobile_money" },
          package: { type: "string" },
          creditsAdded: { type: "number", default: 0 },
        },
      },
      Subscription: {
        type: "object",
        properties: {
          userId: { type: "string" },
          packageId: { type: "string" },
          paymentId: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "expired", "cancelled"],
          },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
        },
      },

      // ── System ────────────────────────────────────────────────────────────
      WaitlistEntry: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          university: {
            type: "string",
            description: "Optional explicitly provided name",
          },
          universityId: {
            type: "string",
            description: "Optional MongoDB ObjectId of University",
          },
        },
      },
      NewsletterSubscriber: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
          status: {
            type: "string",
            enum: ["pending", "active", "unsubscribed", "bounced"],
          },
          source: {
            type: "string",
            enum: ["landing_hero", "landing_cta", "in_app", "manual", "import"],
          },
          subscribedAt: { type: "string", format: "date-time" },
        },
      },

      // ── Newsletter Campaigns ──────────────────────────────────────────────
      LinkContext: {
        type: "object",
        required: ["label", "baseUrl", "pathTemplate"],
        description: "A personalized URL template resolved per subscriber.",
        properties: {
          label: { type: "string", example: "View Dashboard" },
          baseUrl: {
            type: "string",
            format: "uri",
            example: "https://app.qz.bflabs.tech",
          },
          pathTemplate: {
            type: "string",
            example: "/:subscriberId/dashboard",
            description:
              "Path template supporting :contactId, :email, :unsubscribeToken, :universityId, :institution",
          },
        },
      },
      NewsletterCampaign: {
        type: "object",
        required: [
          "title",
          "subjectLine",
          "promptInstruction",
          "targetAudience",
        ],
        properties: {
          title: { type: "string", example: "April Newsletter" },
          subjectLine: {
            type: "string",
            example: "What's new at BetaForge Labs",
          },
          previewText: {
            type: "string",
            description: "Short preview text shown by email clients",
          },
          promptInstruction: {
            type: "string",
            description:
              "Natural-language instruction sent to the AI for body generation",
          },
          linkContexts: {
            type: "array",
            items: { $ref: "#/components/schemas/LinkContext" },
            description:
              "Personalized link templates provided to the AI as context",
          },
          bodyMarkdown: {
            type: "string",
            description:
              "AI-generated Markdown body (populated after POST /:id/generate)",
          },
          status: {
            type: "string",
            enum: [
              "draft",
              "generating",
              "approved",
              "dispatching",
              "done",
              "failed",
            ],
            default: "draft",
          },
          targetAudience: {
            type: "array",
            items: {
              type: "string",
              enum: ["waitlist", "newsletter", "users", "all"],
            },
            default: ["all"],
            description:
              "Recipient groups — one or more of: waitlist, newsletter, users, all",
          },
          stats: {
            type: "object",
            properties: {
              sent: { type: "integer", default: 0 },
              failed: { type: "integer", default: 0 },
            },
          },
          createdBy: {
            type: "string",
            description:
              "MongoDB ObjectId of the super-admin who created the campaign",
          },
          dispatchedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      NewsletterImage: {
        type: "object",
        required: ["url", "altText"],
        description: "Image metadata associated with a newsletter campaign.",
        properties: {
          url: {
            type: "string",
            format: "uri",
            example: "https://cdn.bflabs.tech/images/banner.png",
          },
          altText: { type: "string", example: "BetaForge Labs banner" },
          filename: { type: "string", example: "banner.png" },
          mimetype: { type: "string", example: "image/png" },
          size: { type: "integer", example: 102400 },
          campaignId: {
            type: "string",
            description: "MongoDB ObjectId of the parent campaign",
          },
          createdBy: {
            type: "string",
            description: "MongoDB ObjectId of the uploader",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      // ── EmailCampaign schemas ─────────────────────────────────────────────
      AudienceFilter: {
        type: "object",
        description:
          "Structured filter controlling which contacts and/or users receive a campaign.",
        properties: {
          includeContacts: {
            type: "boolean",
            default: false,
            description: "Include Contact documents in the recipient list",
          },
          includeUsers: {
            type: "boolean",
            default: false,
            description: "Include User documents in the recipient list",
          },
          contactLanes: {
            type: "object",
            properties: {
              waitlist: { type: "boolean" },
              newsletter: { type: "boolean" },
            },
          },
          contactStatus: {
            type: "object",
            properties: {
              waitlistStatus: {
                type: "array",
                items: { type: "string", enum: ["active", "removed"] },
              },
              newsletterStatus: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["pending", "active", "unsubscribed", "bounced"],
                },
              },
            },
          },
          universityId: {
            type: "string",
            description: "Filter users by university (ObjectId)",
          },
          campusId: {
            type: "string",
            description: "Filter users by campus (ObjectId)",
          },
          collegeId: {
            type: "string",
            description: "Filter users by college (ObjectId)",
          },
          schoolId: {
            type: "string",
            description: "Filter users by school (ObjectId)",
          },
          departmentId: {
            type: "string",
            description: "Filter users by department (ObjectId)",
          },
          roles: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "super_admin",
                "uni_admin",
                "admin",
                "staff",
                "moderator",
                "student",
              ],
            },
            description: "Filter users by role",
          },
          courseIds: {
            type: "array",
            items: { type: "string" },
            description: "Filter users enrolled in specific courses",
          },
          contactUniversityId: {
            type: "string",
            description:
              "Filter contacts associated with a university (ObjectId)",
          },
          specificUserIds: {
            type: "array",
            items: { type: "string" },
            description: "Always-include user ObjectIds",
          },
          specificEmails: {
            type: "array",
            items: { type: "string", format: "email" },
            description: "Always-include email addresses",
          },
          excludeUnsubscribed: { type: "boolean", default: true },
          excludeBounced: { type: "boolean", default: true },
          excludeUserIds: {
            type: "array",
            items: { type: "string" },
            description: "User ObjectIds to exclude",
          },
          excludeEmails: {
            type: "array",
            items: { type: "string", format: "email" },
            description: "Email addresses to exclude",
          },
          excludeRecentRecipientHours: {
            type: "integer",
            description:
              "Exclude recipients who received any email within this many hours",
          },
        },
      },
      AudiencePreview: {
        type: "object",
        description: "Cached estimate of the resolved audience size.",
        properties: {
          estimatedCount: { type: "integer" },
          estimatedAt: { type: "string", format: "date-time" },
          exactCount: { type: "integer" },
          exactCountAt: { type: "string", format: "date-time" },
          description: { type: "string" },
          level: {
            type: "string",
            enum: [
              "platform",
              "university",
              "campus",
              "college",
              "school",
              "department",
              "course",
              "role",
              "individual",
            ],
          },
        },
      },
      RecipientStatus: {
        type: "object",
        description:
          "Per-recipient delivery status for single-audience campaigns.",
        properties: {
          recipientId: {
            type: "string",
            description: "MongoDB ObjectId of the User (if applicable)",
          },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "sent", "failed", "bounced"],
          },
          sentAt: { type: "string", format: "date-time" },
          failedAt: { type: "string", format: "date-time" },
          failureReason: { type: "string" },
          jobId: { type: "string" },
        },
        required: ["email", "status"],
      },
      EmailCampaign: {
        type: "object",
        required: ["title", "subjectLine", "promptInstruction", "campaignType"],
        description:
          "A fully-featured email campaign supporting transactional and broadcast delivery.",
        properties: {
          title: { type: "string", example: "April Newsletter" },
          subjectLine: {
            type: "string",
            example: "What's new at BetaForge Labs",
          },
          previewText: {
            type: "string",
            description: "Short preview text shown in email clients",
          },
          promptInstruction: {
            type: "string",
            description: "Natural-language instruction for AI body generation",
          },
          linkContexts: {
            type: "array",
            items: { $ref: "#/components/schemas/LinkContext" },
            description:
              "Personalized link templates passed to the AI as context",
          },
          bodyMarkdown: {
            type: "string",
            description:
              "AI-generated Markdown body (populated after POST /:id/generate)",
          },
          status: {
            type: "string",
            enum: [
              "draft",
              "generating",
              "approved",
              "scheduled",
              "dispatching",
              "done",
              "failed",
              "cancelled",
            ],
            default: "draft",
          },
          campaignType: {
            type: "string",
            enum: [
              "newsletter",
              "announcement",
              "product_update",
              "waitlist_update",
              "system_update",
              "exam_reminder",
              "quiz_available",
              "welcome",
              "password_reset",
              "security_alert",
              "account_activity",
              "approval_status_change",
              "program_offering_available",
              "study_partner_request",
              "email_verification",
            ],
            description: "Semantic type of the campaign",
          },
          audience: {
            type: "string",
            enum: ["single", "broadcast"],
            default: "broadcast",
            description:
              "Whether this is a one-to-one transactional email or a bulk broadcast",
          },
          recipient: { $ref: "#/components/schemas/RecipientStatus" },
          scheduledFor: {
            type: "string",
            format: "date-time",
            description: "Scheduled dispatch time (for scheduled campaigns)",
          },
          sendingStartedAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          blogPostId: {
            type: "string",
            description: "Related blog post ObjectId",
          },
          examEntryId: {
            type: "string",
            description: "Related exam entry ObjectId",
          },
          quizId: { type: "string", description: "Related quiz ObjectId" },
          programOfferingId: {
            type: "string",
            description: "Related program offering ObjectId",
          },
          universityId: {
            type: "string",
            description: "Related university ObjectId",
          },
          audienceFilter: { $ref: "#/components/schemas/AudienceFilter" },
          audiencePreview: { $ref: "#/components/schemas/AudiencePreview" },
          stats: {
            type: "object",
            properties: {
              sent: { type: "integer", default: 0 },
              failed: { type: "integer", default: 0 },
              bounced: { type: "integer", default: 0 },
              opened: { type: "integer", default: 0 },
              clicked: { type: "integer", default: 0 },
              unsubscribed: { type: "integer", default: 0 },
              openRate: {
                type: "number",
                format: "float",
                description: "opened / sent (0–1)",
              },
              clickRate: {
                type: "number",
                format: "float",
                description: "clicked / sent (0–1)",
              },
              bounceRate: {
                type: "number",
                format: "float",
                description: "bounced / sent (0–1)",
              },
              lastUpdated: { type: "string", format: "date-time" },
            },
          },
          dispatchTotal: {
            type: "integer",
            description: "Total recipients resolved at dispatch time",
          },
          isSystemGenerated: { type: "boolean", default: false },
          isTest: { type: "boolean", default: false },
          createdBy: {
            type: "string",
            description:
              "MongoDB ObjectId of the super-admin who created the campaign",
          },
          dispatchedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      EmailCampaignImage: {
        type: "object",
        required: ["url", "altText"],
        description: "Image metadata associated with an email campaign.",
        properties: {
          url: {
            type: "string",
            format: "uri",
            example: "https://cdn.bflabs.tech/images/banner.png",
          },
          altText: { type: "string", example: "BetaForge Labs banner" },
          filename: { type: "string", example: "banner.png" },
          mimetype: { type: "string", example: "image/png" },
          size: { type: "integer", example: 102400 },
          campaignId: {
            type: "string",
            description: "MongoDB ObjectId of the parent email campaign",
          },
          createdBy: {
            type: "string",
            description: "MongoDB ObjectId of the uploader",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StudySession: {
        type: "object",
        properties: {
          _id: { type: "string", description: "MongoDB ObjectId" },
          name: { type: "string" },
          courseId: { type: "string" },
          mode: { type: "string", enum: ["free", "structured"] },
          planningMode: { type: "string", enum: ["planning", "fast"] },
          status: {
            type: "string",
            enum: ["idle", "active", "paused", "completed", "failed"],
          },
          phase: {
            type: "string",
            enum: ["planning", "learning", "review", "assessment", "done"],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      FlashcardSet: {
        type: "object",
        description: "An AI-generated set of flashcards tied to a material.",
        properties: {
          _id: { type: "string" },
          title: { type: "string" },
          materialId: { type: "string" },
          courseId: { type: "string" },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                _id: { type: "string" },
                front: { type: "string" },
                back: { type: "string" },
                difficulty: {
                  type: "string",
                  enum: ["easy", "medium", "hard"],
                },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AppQuiz: {
        type: "object",
        description: "An AI-generated quiz tied to a study session material.",
        properties: {
          _id: { type: "string" },
          title: { type: "string" },
          materialId: { type: "string" },
          courseId: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                _id: { type: "string" },
                question: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                answer: { type: "string" },
                type: {
                  type: "string",
                  enum: ["mcq", "true-false", "fill-in", "short-answer"],
                },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      MindMap: {
        type: "object",
        description:
          "An AI-generated mind map tied to a study session material.",
        properties: {
          _id: { type: "string" },
          title: { type: "string" },
          materialId: { type: "string" },
          nodes: { type: "array", items: { type: "object" } },
          edges: { type: "array", items: { type: "object" } },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AppNote: {
        type: "object",
        description: "A note generated or stored within a study session.",
        properties: {
          _id: { type: "string" },
          sessionId: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AppMaterial: {
        type: "object",
        description: "A study material attached to a session.",
        properties: {
          _id: { type: "string" },
          title: { type: "string" },
          url: { type: "string", format: "uri" },
          type: {
            type: "string",
            enum: ["pdf", "doc", "slides", "text", "img", "link", "data"],
          },
          isProcessed: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AnalyticsSummary: {
        type: "object",
        description: "Aggregated study analytics for the authenticated user.",
        properties: {
          sessionsByPhase: {
            type: "object",
            additionalProperties: { type: "integer" },
            description: "Count of sessions grouped by phase",
          },
          totalMessages: { type: "integer" },
          artifactsByType: {
            type: "object",
            additionalProperties: { type: "integer" },
            description:
              "Count of generated artifacts grouped by type (flashcards, quizzes, mindmaps, notes)",
          },
          totalDurationMinutes: { type: "number" },
          studyDays: {
            type: "integer",
            description: "Number of distinct days with session activity",
          },
          messageRatings: {
            type: "object",
            properties: {
              positive: { type: "integer" },
              negative: { type: "integer" },
            },
          },
        },
      },
      Donation: {
        type: "object",
        description: "A donation record.",
        properties: {
          _id: { type: "string" },
          userId: {
            type: "string",
            description:
              "MongoDB ObjectId of the donor (optional if anonymous)",
          },
          email: { type: "string", format: "email" },
          amount: { type: "number", minimum: 1 },
          currency: { type: "string", default: "GHS" },
          reference: {
            type: "string",
            description: "Paystack transaction reference",
          },
          status: { type: "string", enum: ["pending", "success", "failed"] },
          message: { type: "string", description: "Optional donor message" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Streak: {
        type: "object",
        description: "User study streak information.",
        properties: {
          currentStreak: { type: "integer" },
          longestStreak: { type: "integer" },
          lastActivity: { type: "string", format: "date-time" },
          freezesRemaining: { type: "integer" },
          isFrozen: { type: "boolean" },
        },
      },
      PromoCode: {
        type: "object",
        description: "A promotional discount code.",
        required: ["code", "discountType", "discountValue"],
        properties: {
          code: { type: "string", example: "SAVE20" },
          discountType: { type: "string", enum: ["percentage", "fixed"] },
          discountValue: { type: "number", minimum: 0 },
          maxUses: {
            type: "integer",
            description: "Maximum number of uses (null = unlimited)",
          },
          usedCount: { type: "integer", default: 0 },
          expiresAt: { type: "string", format: "date-time" },
          isActive: { type: "boolean", default: true },
          packageId: {
            type: "string",
            description: "Restrict to a specific package ObjectId (optional)",
          },
        },
      },
      GenerateAIContent: {
        type: "object",
        required: ["materialId"],
        properties: {
          materialId: {
            type: "string",
            description:
              "MongoDB ObjectId of the material to generate content from",
          },
          courseId: { type: "string" },
          options: {
            type: "object",
            description: "Optional generation parameters",
          },
        },
      },
    },
  },
  paths: {
    "/asyncapi": {
      get: {
        summary: "AsyncAPI WebSocket spec",
        description:
          "Returns the full AsyncAPI 2.6 specification describing the Socket.IO WebSocket event layer. " +
          "Paste the URL (`GET /api/v1/asyncapi`) into [AsyncAPI Studio](https://studio.asyncapi.com) to visualize the real-time event channels. " +
          "No authentication required.",
        tags: ["System"],
        responses: {
          "200": {
            description: "AsyncAPI 2.6 specification object",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "AsyncAPI 2.6 specification document",
                },
              },
            },
          },
        },
      },
    },
  },
};

const options: swaggerJsdoc.Options = {
  swaggerDefinition,
  apis: ["./src/*/routes.ts", "./src/*/*/routes.ts"],
};

// swagger-jsdoc → @apidevtools/json-schema-ref-parser internally calls the
// deprecated url.parse(). Suppress that specific warning — it is harmless
// (only affects swagger doc generation at startup, no user-facing paths).
const _emit = process.emitWarning.bind(process);
(process as any).emitWarning = (warning: string | Error, ...args: any[]) => {
  const msg = typeof warning === "string" ? warning : (warning?.message ?? "");
  if (msg.includes("DEP0169") || msg.includes("url.parse()")) return;
  _emit(warning, ...args);
};

export const swaggerSpec = swaggerJsdoc(options);

(process as any).emitWarning = _emit; // restore immediately after
