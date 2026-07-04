"use node";

import { createGateway, generateObject } from "ai";
import { z } from "zod";
import { v } from "convex/values";
import { action, env, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";

const modelId = env.AI_GATEWAY_MODEL ?? "groq/llama-3.3-70b-versatile";

const decisionSchema = z.object({
  actionId: z.enum(["move_to_place", "move_to_cell", "say", "wait", "inspect_place", "set_task"]),
  targetPlaceStableId: z.string().nullable(),
  targetCell: z.object({ col: z.number(), row: z.number() }).nullable(),
  message: z.string().nullable(),
  task: z.string().nullable(),
  reason: z.string(),
});

type AgentTurnResult = {
  ok: boolean;
  reason?: string;
  decision?: z.infer<typeof decisionSchema>;
};

type PopulationStepResult = {
  ok: boolean;
  reason?: string;
  results?: Array<AgentTurnResult & { characterId: string }>;
};

type CharacterSummary = {
  characterId: string;
};

async function runAgentTurnHelper(ctx: ActionCtx, characterId: string): Promise<AgentTurnResult> {
  const context = await ctx.runQuery(api.town.getTurnContext, { characterId });
  if (!context) {
    return { ok: false, reason: "Character or world is not ready." };
  }
  if (context.world.mode !== "auto") {
    return { ok: false, reason: "World is not in auto mode." };
  }

  if (!env.AI_GATEWAY_API_KEY) {
    await ctx.runMutation(api.town.enqueueAction, {
      characterId,
      source: "llm",
      actionId: "wait",
      targetPlaceStableId: null,
      targetCell: null,
      message: null,
      task: "missing_ai_gateway_key",
      reason: "AI_GATEWAY_API_KEY is not configured.",
    });
    return { ok: false, reason: "AI_GATEWAY_API_KEY is not configured." };
  }

  const gateway = createGateway({
    apiKey: env.AI_GATEWAY_API_KEY,
  });

  const result = await generateObject({
    model: gateway(modelId),
    schema: decisionSchema,
    system:
      "You drive one town character in a small grid simulation. Choose exactly one next action. Prefer purposeful movement to labelled places, use the character's own home when relevant, and only say short lines when another character is nearby. Use targetPlaceStableId when moving to or inspecting a place. Do not invent place ids.",
    prompt: JSON.stringify(context, null, 2),
  });

  const decision = result.object;
  await ctx.runMutation(api.town.enqueueAction, {
    characterId,
    source: "llm",
    actionId: decision.actionId,
    targetPlaceStableId: decision.targetPlaceStableId,
    targetCell: decision.targetCell,
    message: decision.message,
    task: decision.task,
    reason: decision.reason,
  });

  return { ok: true, decision };
}

export const runAgentTurn = action({
  args: { characterId: v.string() },
  handler: async (ctx, args): Promise<AgentTurnResult> => {
    return await runAgentTurnHelper(ctx, args.characterId);
  },
});

export const runPopulationStep = action({
  args: {},
  handler: async (ctx): Promise<PopulationStepResult> => {
    const state: { characters: CharacterSummary[] } | null = await ctx.runQuery(api.town.getState, {});
    if (!state) {
      return { ok: false, reason: "World is not ready." };
    }

    const results: Array<AgentTurnResult & { characterId: string }> = [];
    for (const character of state.characters) {
      const result = await runAgentTurnHelper(ctx, character.characterId);
      results.push({ characterId: character.characterId, ...result });
    }
    return { ok: true, results };
  },
});
