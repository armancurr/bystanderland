"use node";

import { generateText, tool } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import { v } from "convex/values";
import { action, env, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";

const modelId = env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const decisionSchema = z.object({
	actionId: z.enum([
		"move_to_place",
		"move_to_cell",
		"say",
		"wait",
		"inspect_place",
		"set_task",
	]),
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
	toolName?: string;
	toolInput?: unknown;
	toolResult?: unknown;
};

type PopulationStepResult = {
	ok: boolean;
	reason?: string;
	results?: Array<AgentTurnResult & { characterId: string }>;
};

type CharacterSummary = {
	characterId: string;
};

type TurnContext = {
	world: {
		cols: number;
		rows: number;
		mode: "auto" | "mock_manual";
	};
	character: {
		characterId: string;
		label: string;
		cell: { col: number; row: number };
		homePlaceStableId: string;
		currentTask: string | null;
	};
	places: Array<{
		stableId: string;
		label: string;
		kind: string;
		ownerCharacterId: string | null;
		entryCell: { col: number; row: number };
		distance: number;
	}>;
	otherCharacters: Array<{
		characterId: string;
		label: string;
		cell: { col: number; row: number };
		distance: number;
	}>;
	recentMessages: Array<{ label: string; text: string }>;
	pendingActions: Array<{
		characterId: string;
		actionId: string;
		targetPlaceStableId: string | null;
		reason: string;
	}>;
};

function distance(
	a: { col: number; row: number },
	b: { col: number; row: number },
) {
	return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function placeExists(context: TurnContext, stableId: string) {
	return context.places.some((place) => place.stableId === stableId);
}

function fallbackMoveDecision(
	context: TurnContext,
): z.infer<typeof decisionSchema> {
	const home = context.places.find(
		(place) => place.stableId === context.character.homePlaceStableId,
	);
	const differentPlace = context.places.find(
		(place) => distance(place.entryCell, context.character.cell) > 0,
	);
	const target =
		home && distance(home.entryCell, context.character.cell) > 0
			? home
			: differentPlace;

	if (target) {
		return {
			actionId: "move_to_place",
			targetPlaceStableId: target.stableId,
			targetCell: null,
			message: null,
			task: `go_to_${target.label}`,
			reason: `Fallback: move to ${target.label}.`,
		};
	}

	return {
		actionId: "wait",
		targetPlaceStableId: null,
		targetCell: null,
		message: null,
		task: "no_available_target",
		reason: "No distinct reachable place was available.",
	};
}

async function enqueueDecision(
	ctx: ActionCtx,
	characterId: string,
	decision: z.infer<typeof decisionSchema>,
) {
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
	return decision;
}

async function enqueueValidatedDecision(
	ctx: ActionCtx,
	context: TurnContext,
	decision: z.infer<typeof decisionSchema>,
) {
	if (
		(decision.actionId === "move_to_place" ||
			decision.actionId === "inspect_place") &&
		(!decision.targetPlaceStableId ||
			!placeExists(context, decision.targetPlaceStableId))
	) {
		return await enqueueDecision(ctx, context.character.characterId, {
			...fallbackMoveDecision(context),
			reason: `Fallback after invalid place target: ${decision.reason}`,
		});
	}

	if (decision.actionId === "move_to_cell" && !decision.targetCell) {
		return await enqueueDecision(ctx, context.character.characterId, {
			...fallbackMoveDecision(context),
			reason: `Fallback after missing target cell: ${decision.reason}`,
		});
	}

	return await enqueueDecision(ctx, context.character.characterId, decision);
}

async function runAgentTurnHelper(
	ctx: ActionCtx,
	characterId: string,
): Promise<AgentTurnResult> {
	const context: TurnContext | null = await ctx.runQuery(
		api.town.getTurnContext,
		{ characterId },
	);
	if (!context) {
		return { ok: false, reason: "Character or world is not ready." };
	}
	if (context.world.mode !== "auto") {
		return { ok: false, reason: "World is not in auto mode." };
	}

	if (!env.GROQ_API_KEY) {
		const decision = await enqueueDecision(ctx, characterId, {
			actionId: "wait",
			targetPlaceStableId: null,
			targetCell: null,
			message: null,
			task: "missing_groq_api_key",
			reason: "GROQ_API_KEY is not configured.",
		});
		return { ok: false, reason: "GROQ_API_KEY is not configured.", decision };
	}

	const groq = createGroq({
		apiKey: env.GROQ_API_KEY,
	});

	let selectedDecision: z.infer<typeof decisionSchema> | null = null;
	const tools = {
		moveToPlace: tool({
			description:
				"Move this character to a labelled place by stable id. Use this for assigned homes and purposeful town movement.",
			inputSchema: z.object({
				targetPlaceStableId: z
					.string()
					.describe("One of the place stableIds from the context."),
				task: z
					.string()
					.nullable()
					.describe("Short task label for the character."),
				reason: z.string().describe("Why this character chose this place."),
			}),
			execute: async ({ targetPlaceStableId, task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "move_to_place",
					targetPlaceStableId,
					targetCell: null,
					message: null,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
		moveToCell: tool({
			description:
				"Move this character to a specific grid cell when no labelled place fits.",
			inputSchema: z.object({
				col: z.number(),
				row: z.number(),
				task: z.string().nullable(),
				reason: z.string(),
			}),
			execute: async ({ col, row, task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "move_to_cell",
					targetPlaceStableId: null,
					targetCell: { col, row },
					message: null,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
		say: tool({
			description: "Say a short line, only when another character is nearby.",
			inputSchema: z.object({
				message: z.string(),
				task: z.string().nullable(),
				reason: z.string(),
			}),
			execute: async ({ message, task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "say",
					targetPlaceStableId: null,
					targetCell: null,
					message,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
		inspectPlace: tool({
			description: "Move to and inspect a labelled place by stable id.",
			inputSchema: z.object({
				targetPlaceStableId: z.string(),
				task: z.string().nullable(),
				reason: z.string(),
			}),
			execute: async ({ targetPlaceStableId, task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "inspect_place",
					targetPlaceStableId,
					targetCell: null,
					message: null,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
		setTask: tool({
			description: "Set an internal task without moving this turn.",
			inputSchema: z.object({
				task: z.string(),
				reason: z.string(),
			}),
			execute: async ({ task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "set_task",
					targetPlaceStableId: null,
					targetCell: null,
					message: null,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
		wait: tool({
			description:
				"Wait only if there is no useful movement or speech action available.",
			inputSchema: z.object({
				task: z.string().nullable(),
				reason: z.string(),
			}),
			execute: async ({ task, reason }) => {
				selectedDecision = await enqueueValidatedDecision(ctx, context, {
					actionId: "wait",
					targetPlaceStableId: null,
					targetCell: null,
					message: null,
					task,
					reason,
				});
				return selectedDecision;
			},
		}),
	};

	const result = await generateText({
		model: groq(modelId),
		tools,
		toolChoice: "required",
		system:
			"You drive one town character in a small grid simulation. You must call exactly one provided tool. If the character has an assigned home and is not already at that home's entryCell, call moveToPlace for that home. Otherwise prefer purposeful movement to another labelled place. Do not choose a movement target equal to the character's current cell. Only call say when another character is nearby. Do not invent place ids.",
		prompt: JSON.stringify(context, null, 2),
	});

	const decision =
		selectedDecision ??
		(await enqueueDecision(ctx, characterId, fallbackMoveDecision(context)));
	const firstToolCall = result.toolCalls[0];
	const firstToolResult = result.toolResults[0];

	return {
		ok: true,
		decision,
		toolName: firstToolCall?.toolName,
		toolInput: firstToolCall?.input,
		toolResult: firstToolResult?.output,
	};
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
		const state: { characters: CharacterSummary[] } | null = await ctx.runQuery(
			api.town.getState,
			{},
		);
		if (!state) {
			return { ok: false, reason: "World is not ready." };
		}

		const results: Array<AgentTurnResult & { characterId: string }> =
			await Promise.all(
				state.characters.map(async (character) => ({
					characterId: character.characterId,
					...(await runAgentTurnHelper(ctx, character.characterId)),
				})),
			);
		const okCount = results.filter((result) => result.ok).length;
		return {
			ok: okCount > 0,
			reason:
				okCount > 0
					? undefined
					: "No character produced a successful tool call.",
			results,
		};
	},
});
