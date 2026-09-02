import { z } from "genkit";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { MindMapContent } from "../../interfaces";
import { nanoid } from "nanoid";
import { StudySession } from "../../models";

const generateMindmapTool = defineToolOnce(
  {
    name: "generate_mindmap",
    description:
      "Persist a hierarchical mind map artifact synthesized from study materials.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goalId: z.string().nullish(),
      title: z.string().describe("The descriptive title for the mind map"),
      nodes: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            type: z.enum(["concept", "topic", "detail", "question"]),
            parentId: z.string().optional(),
            position: z.object({ x: z.number(), y: z.number() }),
          }),
        )
        .describe("The hierarchical nodes of the mind map"),
      edges: z
        .array(
          z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            label: z.string().optional(),
          }),
        )
        .describe("The connecting edges between nodes"),
    }),
  },
  async (input) => {
    const { goalId, title, nodes, edges } = input;
    const { sessionId, userId, courseId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to generate a mindmap");
    }

    const processedNodes = (nodes || []).map((n: any) => ({
      ...n,
      id: n.id || nanoid(),
    }));
    const processedEdges = (edges || []) as any[];

    // Merge with existing mindmap if one exists
    const existing = await ArtifactServices.getLatest(sessionId, "mindmap");
    if (existing && sessionId && userId) {
      const existingContent = existing.content as MindMapContent;
      const existingNodeIds = new Set(existingContent.nodes.map((n) => n.id));
      const existingNodeLabels = new Set(
        existingContent.nodes.map((n) => n.label.trim().toLowerCase()),
      );
      const uniqueNodes = processedNodes.filter(
        (n) =>
          !existingNodeIds.has(n.id) &&
          !existingNodeLabels.has(n.label.trim().toLowerCase()),
      );
      const existingEdgeIds = new Set(
        existingContent.edges.map((e: any) => e.id),
      );
      const uniqueEdges = processedEdges.filter(
        (e) => !existingEdgeIds.has(e.id),
      );
      const merged: MindMapContent = {
        nodes: [...existingContent.nodes, ...uniqueNodes],
        edges: [...existingContent.edges, ...uniqueEdges],
      };
      await ArtifactServices.update(sessionId, userId, existing.artifactId, {
        content: merged as never,
        title: title && title !== existing.title ? title : existing.title,
      });
      return {
        artifactId: existing.artifactId,
        nodeCount: uniqueNodes.length,
        totalNodes: merged.nodes.length,
        duplicatesSkipped: processedNodes.length - uniqueNodes.length,
        merged: true,
      };
    }

    const content: MindMapContent = {
      nodes: processedNodes,
      edges: processedEdges,
    };
    const artifact = await ArtifactServices.save(
      sessionId ?? undefined,
      userId ?? undefined,
      {
        type: "mindmap",
        title: title || "Mind Map",
        content,
        phase: "implementation",
        goalId: goalId ?? undefined,
      },
    );
    return {
      artifactId: artifact.artifactId,
      nodeCount: processedNodes.length,
      totalNodes: processedNodes.length,
      merged: false,
    };
  },
);

const updateMindmapTool = defineToolOnce(
  {
    name: "update_mindmap",
    description:
      "Merge new nodes and edges into an existing mind map artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      newNodes: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            type: z.enum(["concept", "topic", "detail", "question"]),
            parentId: z.string().optional(),
            position: z.object({ x: z.number(), y: z.number() }),
          }),
        )
        .optional(),
      newEdges: z
        .array(
          z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            label: z.string().optional(),
          }),
        )
        .optional(),
    }),
  },
  async (input) => {
    const { artifactId, newNodes, newEdges } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to update a mindmap");
    }

    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Mindmap artifact not found");
    const current = artifact.content as MindMapContent;
    const merged: MindMapContent = {
      nodes: [...current.nodes, ...(newNodes ?? [])],
      edges: [...current.edges, ...(newEdges ?? [])],
    };

    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: merged as never,
    });

    return { updated: true, totalNodes: merged.nodes.length };
  },
);

const mindmapSkill: ISkill = {
  name: "mindmap",
  displayName: "Mindmap",
  description: "Generate and update mind map artifacts.",
  scope: "session",
  category: "implementation",
  tools: [generateMindmapTool, updateMindmapTool],
  phases: ["implementation"],
  autoEquip: (s) => s.mode === "structured",
};

export default mindmapSkill;
