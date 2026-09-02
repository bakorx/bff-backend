import { IStudySession, ISessionMemory, PlanningMode } from "./interfaces";

export const Z_IDENTITY = `You are Z — an academic study partner and mentor for university students.

You teach through short spoken explanations plus interactive artifact cards (exposition, quiz, question, recap, flashcards, mindmap). Artifacts render automatically in the UI — you never describe them, name them, or narrate that you are "calling a tool."

HARD RULES (violating these breaks the product — check every response against them before sending):

1. NEVER write your planning, tool selection, or reasoning as chat text.
   Your visible reply is ONLY the short thing you'd say out loud to the student — never "Let's see what we have," never a walkthrough of what you're about to call, never restating session/goal/topic IDs.
2. NEVER put a question, MCQ options, or answer choices in your chat text.
   If you are testing the student, your chat text contains ZERO question marks tied to content and ZERO lettered/numbered options. The question itself exists only inside the ask_question / generate_quiz artifact.
3. NEVER repeat a chat message or question you already sent this session.
   If asked to "continue" or "let's start" and you already gave an intro or already asked the active question, do not resend it — move to the next step (wait for their answer, or advance to teaching).
4. Chat text is capped at 1-2 sentences outside of emotional-support mode.
   Longer explanation belongs in create_exposition, not chat text.
5. NEVER write '(Source: ...)' or citation text inside chat or artifact markdown.
   Pass 'materialId' and 'pageNumber' into tool call arguments ('create_exposition', 'ask_question', etc.) so the client can render interactive citation badges and open the document reader.

TEACHING FLOW per topic:
1. One-sentence warm framing in chat text.
2. create_exposition — full explanation, cited to source + page.
3. ask_question — test understanding. (Chat text before this call, if any, is a single sentence like "Let's check that." — never the question.)
4. On response: brief chat feedback (correct/why), then create_recap.

EMOTIONAL SUPPORT: if the student is venting or distressed, drop the teaching flow entirely, respond with plain warm text, no artifacts, no questions. If they mention self-harm or crisis, respond with care and suggest a counsellor or trusted person — you are a companion, not a therapist.

FORMATTING: LaTeX for math ($...$, $$...$$). No markdown headers or option lists in chat text — those belong in artifacts only.`;

export function buildSessionContext(
  session: IStudySession,
  memory: ISessionMemory | null,
  materials: Array<{ id: string; filename: string; summary?: any }>,
): string {
  const studyPlan =
    session.studyPlan && typeof session.studyPlan === "object"
      ? (session.studyPlan as any)
      : null;
  const hasStudyPlan = Boolean(session.studyPlan);

  const chapters: any[] = studyPlan?.chapters || [];
  let activeChapter = chapters.find(
    (ch: any) =>
      ch.chapterId === session.activeChapterId ||
      ch._id?.toString() === session.activeChapterId,
  );
  if (!activeChapter && chapters.length > 0) activeChapter = chapters[0];

  const steps: any[] = activeChapter?.steps || activeChapter?.goals || [];
  let activeStep = steps.find(
    (s: any) =>
      s.stepId === session.activeStepId ||
      s.goalId === session.activeStepId ||
      s._id?.toString() === session.activeStepId,
  );
  if (!activeStep && steps.length > 0) activeStep = steps[0];

  const blocks: any[] =
    activeStep?.prerequisites || activeStep?.knowledgeBlocks || [];
  let activeBlock = blocks.find(
    (b: any) =>
      b.blockId === session.activeBlockId ||
      b._id?.toString() === session.activeBlockId,
  );
  if (!activeBlock && blocks.length > 0) activeBlock = blocks[0];

  const currentGoal = session.goals.find(
    (g) => g.goalId === session.currentGoalId,
  );

  let planInfo = "Study Plan: NONE YET (Generate one during planning phase)";
  if (hasStudyPlan) {
    planInfo = `Study Plan: ACTIVE${studyPlan?.goal ? ` (Goal: "${studyPlan.goal}")` : ""}`;
    if (activeChapter) {
      planInfo += `\nActive Chapter: "${activeChapter.title}" (Chapter ${activeChapter.chapterNumber || 1})`;
    }
    if (activeStep) {
      planInfo += `\nActive Step / Topic: "${activeStep.title}"`;
      if (activeStep.coreIdea) {
        planInfo += `\n  - Core Intuition: "${activeStep.coreIdea}"`;
      }
      if (activeStep.whyItMatters) {
        planInfo += `\n  - Why It Matters: "${activeStep.whyItMatters}"`;
      }
    }
    if (activeBlock) {
      planInfo += `\nTarget Knowledge Block: "${activeBlock.title}"`;
    }
    planInfo += `\n(Do NOT call generate_study_plan; continue with the active topic/block above)`;
  }

  let goalsInfo = "Goals: none yet";
  if (session.goals.length > 0) {
    goalsInfo = `Goals (${session.goals.filter((g) => g.status === "completed").length}/${session.goals.length} complete):\n${session.goals.map((g) => `  [${g.status}] ${g.title} (id:${g.goalId})`).join("\n")}`;
  } else if (activeStep?.title) {
    goalsInfo = `Goals (Active Roadmap):\n  [in_progress] Master ${activeStep.title}`;
  }

  return [
    `Session: ${session.name}`,
    `SessionId: ${String((session as any)._id ?? "")}`,
    `UserId: ${String(session.userId)}`,
    `CourseId: ${session.courseId ? String(session.courseId) : "none"}`,
    `Mode: ${session.mode} | Planning Mode: ${session.planningMode}`,
    `Phase: ${session.currentPhase}${session.previousPhase ? ` (was: ${session.previousPhase})` : ""}`,
    planInfo,
    currentGoal
      ? `Current Goal: ${currentGoal.title} [id:${currentGoal.goalId}] (${currentGoal.status})`
      : "",
    goalsInfo,
    session.artifacts.length > 0
      ? `Artifacts (${session.artifacts.length} total): ${session.artifacts
          .map((a) => {
            const c = a.content as any;
            if (a.type === "flashcard_set")
              return `flashcard_set "${a.title}" (${c?.cards?.length ?? 0} cards, id:${a.artifactId})`;
            if (a.type === "quiz")
              return `quiz "${a.title}" (${c?.questions?.length ?? 0} questions, id:${a.artifactId})`;
            if (a.type === "mindmap")
              return `mindmap "${a.title}" (${c?.nodes?.length ?? 0} nodes, id:${a.artifactId})`;
            return `${a.type} "${a.title}" (id:${a.artifactId})`;
          })
          .join(" | ")}`
      : "Artifacts: none yet",
    materials.length > 0
      ? `Materials (${materials.length}):\n${materials
          .map((m) => {
            const kbCount = m.summary?.knowledgeBlocks?.length ?? 0;
            const pillars = (m.summary?.logicalOverview || [])
              .map((p: any) => p.title)
              .join(", ");
            let line = `  - "${m.filename}" [id:${m.id}]`;
            if (m.summary?.overview) {
              line += `\n    Overview: ${m.summary.overview.slice(0, 160)}...`;
            }
            if (pillars) {
              line += `\n    Logical Pillars: ${pillars}`;
            }
            if (kbCount > 0) {
              line += `\n    Source Knowledge Blocks (${kbCount}): ${m.summary.knowledgeBlocks
                .slice(0, 8)
                .map((b: any) => b.title)
                .join(" | ")}`;
            }
            return line;
          })
          .join("\n")}`
      : "Materials: none uploaded",
    `Citations: ${session.citations.length}`,
    memory
      ? `Known Concepts: ${memory.knownConcepts.slice(0, 10).join(", ") || "none"}`
      : "",
    memory ? `Gaps: ${memory.gaps.slice(0, 10).join(", ") || "none"}` : "",
    memory
      ? `Mastered Goals: ${memory.masteredGoals.slice(0, 5).join(", ") || "none"}`
      : "",
    session.interruptState
      ? `⚠ STEERING INTERRUPT PENDING: ${session.interruptState.pendingInstruction}`
      : "",
    "ID SAFETY: For tool calls, only use SessionId/CourseId/Material ids listed above. Never use names/titles as ids.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getAnalysisInstructions(): string {
  return `PHASE: ANALYSIS
Steps:
1. Call read_memory to understand what the student already knows.
2. Call equip_skill for each session skill needed (syllabus_research, study_plan, exposition, lesson, quiz, flashcard, mindmap, verification, walkthrough).
3. For each uploaded material call analyze_material to extract objectives, prerequisites, and difficult concepts.
4. Call search_materials to ground your analysis in source chunks.
5. If the first search is weak/empty, retry search_materials once with a refined query.
6. Call identify_gaps to cross-reference identified concepts against student memory.
7. Present a clear, high-level analysis overview in chat text without mentioning tool names or internal functions.
8. Call transition_phase to "planning" when analysis is complete.`;
}

export function getPlanningInstructions(planningMode: PlanningMode): string {
  return `PHASE: PLANNING
Steps:
1. If a study plan already exists in session context, do NOT regenerate it. Call transition_phase to "implementation" directly.
2. Inspect the uploaded materials and their knowledge blocks. Call search_materials if deeper context is needed.
3. Call generate_study_plan from the study_plan skill with the structured multi-chapter curriculum:
   - Provide overall goal.
   - For each chapter, specify sequential study steps (topics) with title, coreIdea, whyItMatters, and prerequisites (knowledge blocks).
4. ${
    planningMode === "planning"
      ? `Call transition_phase to "awaiting_approval" and wait for the student to approve or request edits.`
      : `planningMode is "fast" — call transition_phase to "implementation" immediately.`
  }`;
}

export function getAwaitingApprovalInstructions(): string {
  return `PHASE: AWAITING APPROVAL
The study plan has been generated and linked to the session.
- Do NOT regenerate the study plan.
- Wait for the student's response:
  - If they approve (trigger: approve_plan) — call transition_phase to "implementation".
  - If they request changes — update the study plan tasks.
- Do not start implementation until transition_phase to "implementation" has been called.`;
}

export function getImplementationInstructions(): string {
  return `PHASE: IMPLEMENTATION
The session goals and study plan steps are listed in the session context above. Work through them sequentially.

STRICT PEDAGOGICAL FLOW (Per Knowledge Block / Topic):
1. Explain & Guide: In chat text, provide a concise (1–2 sentences) high-level intuition on why the concept matters.
2. Teach (Exposition): Call 'create_exposition' to deliver a step-by-step conceptual lesson citing source material and page number.
3. Test Understanding: Call 'ask_question' (or 'generate_quiz') to test the student interactively. NEVER write the question in plain prose text.
4. Evaluate & Feedback: Validate student answers, explain mistakes constructively, and record mastery in memory.
5. Advance & Recap: Call 'create_recap' with keyPoints to summarize the concept and smoothly advance to the next topic.

Rules:
- Call each generation tool at most once per topic. Do not loop or retry if an artifact was already produced.
- Never write questions or quizzes in plain text. Always invoke 'ask_question' or 'generate_quiz'.
- Do NOT narrate tool executions or tell the student you are saving artifacts.
- When all goals are mastered, call transition_phase to "verification".`;
}

export function getVerificationInstructions(): string {
  return `PHASE: VERIFICATION
Steps:
1. Call create_verification or generate_quiz to build a verification exercise.
2. Collect the student's response via the interactive artifact.
3. Call evaluate_verification with their response.
4. If passed: call transition_phase to "signoff".
5. If failed: re-teach failed concepts with create_exposition, then verify again.`;
}

export function getSignoffInstructions(): string {
  return `PHASE: SIGNOFF
Steps:
1. Call generate_walkthrough to produce the final session walkthrough artifact.
2. Call update_memory to save mastered goals and remaining gaps.
3. Congratulate the student with warm encouraging words in chat text.
4. Call transition_phase to "complete".`;
}

export function getPhaseInstructions(
  phase: string,
  planningMode: PlanningMode,
): string {
  switch (phase) {
    case "analysis":
      return getAnalysisInstructions();
    case "planning":
      return getPlanningInstructions(planningMode);
    case "awaiting_approval":
      return getAwaitingApprovalInstructions();
    case "implementation":
      return getImplementationInstructions();
    case "verification":
      return getVerificationInstructions();
    case "signoff":
      return getSignoffInstructions();
    default:
      return "You are in free exploration mode. Teach concepts with step-by-step intuition in chat text, call search_materials for source facts, call ask_question whenever you want to test understanding, and generate artifacts (flashcards, quizzes, mindmaps, summaries) whenever beneficial. Never narrate tool calls or announce internal mechanics to the student. If the student needs emotional support, shift into companion mode and listen first.";
  }
}

export function NOTES_PROMPT(ctx: {
  topicTitle: string;
  courseTitle: string;
  knownConcepts: string[];
}): string {
  return `Create a detailed set of academic study notes on: "${ctx.topicTitle}"
Course: ${ctx.courseTitle}
Student prior knowledge: ${ctx.knownConcepts.slice(0, 10).join(", ") || "none yet"}

Produce a set of 3–5 logical sections. Each section must have a clear 'title' and a detailed 'body' content in markdown format.`;
}

export function LESSON_PROMPT(ctx: {
  topicTitle: string;
  courseTitle: string;
  knownConcepts: string[];
}): string {
  return `Create a detailed academic lesson on: "${ctx.topicTitle}"
Course: ${ctx.courseTitle}
Student prior knowledge: ${ctx.knownConcepts.slice(0, 10).join(", ") || "none yet"}

Produce a complete lesson with: clear body content in markdown, bullet-point key takeaways, 2–3 concrete examples, and an optional analogy if helpful.`;
}

export function QUESTION_GENERATION_PROMPT(ctx: {
  topicTitle: string;
  questionTypes: string[];
  count: number;
  difficulty: string;
}): string {
  return `Generate exactly ${ctx.count} ${ctx.difficulty} academic questions about "${ctx.topicTitle}".
You MUST produce all ${ctx.count} questions — do not stop early. Cover the topic comprehensively: spread questions across all major concepts, subtopics, definitions, applications, and edge cases so that every significant area of the material is tested.
Question types: ${ctx.questionTypes.join(", ")}.
For each question include: question text, options if MCQ/true_false, correct answer, and a brief explanation.
Do not prefix question text with type labels (e.g. "True or False:", "MCQ:") and do not prefix options with labels like "A.", "B)", "(C)", or "1.".
Assign a unique questionId to each question.`;
}

export function ANSWER_EVALUATION_PROMPT(ctx: {
  question: string;
  studentAnswer: string;
}): string {
  return `Evaluate this student answer:
Question: ${ctx.question}
Student Answer: ${ctx.studentAnswer}

Assess correctness, provide actionable feedback, identify the key mistake if any, estimate partial credit (0.0–1.0).`;
}

export function EVALUATE_TEACHBACK_PROMPT(ctx: {
  topic: string;
  studentResponse: string;
  expectedConcepts: string[];
}): string {
  return `Evaluate this student teach-back:
Topic: ${ctx.topic}
Expected Concepts: ${ctx.expectedConcepts.join(", ")}
Student Response: ${ctx.studentResponse}

Did the student demonstrate understanding? Provide a score 0–100 and specific feedback.`;
}

export function WALKTHROUGH_PROMPT(ctx: {
  goals: string;
  artifacts: string;
  sessionSummary: string;
}): string {
  return `Generate a comprehensive session walkthrough:
Session: ${ctx.sessionSummary}
Goals covered: ${ctx.goals}
Artifacts produced: ${ctx.artifacts}

Identify: what was mastered, remaining knowledge gaps, personalised recommendations, and suggested next steps.`;
}

export function MINI_WALKTHROUGH_PROMPT(ctx: {
  goalTitle: string;
  goalArtifacts: string;
}): string {
  return `Generate a brief goal-completion walkthrough:
Completed Goal: "${ctx.goalTitle}"
Artifacts produced: ${ctx.goalArtifacts || "none"}

Identify what was mastered, any gaps, immediate recommendations, and next steps.`;
}

export function MINDMAP_PROMPT(messagesText: string): string {
  return `Extract key concepts and relationships from this study session transcript and produce a mind map:

${messagesText.slice(0, 8000)}

Create a hierarchical mind map with concept nodes (core ideas), topic nodes (subtopics), detail nodes (specific facts), and question nodes (unresolved questions). Include edges showing relationships between nodes.`;
}

export function ANALYZE_MATERIAL_PROMPT(text: string): string {
  return `Analyze this academic material:

${text.slice(0, 8000)}

Identify: learning objectives, required prerequisites, difficult/complex concepts, and estimated study time in minutes.`;
}
