import { v } from "convex/values";
import {
	mutation,
	query,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const DEFAULT_WORLD_SLUG = "default";
const now = () => Date.now();

const characterSeeds = [
	{ characterId: "aria", label: "01", cell: { col: 19, row: 21 } },
	{ characterId: "milo", label: "02", cell: { col: 20, row: 20 } },
	{ characterId: "nora", label: "03", cell: { col: 21, row: 21 } },
] as const;

function distance(
	a: { col: number; row: number },
	b: { col: number; row: number },
) {
	return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

const tileInput = v.object({
	stableId: v.string(),
	assetId: v.string(),
	col: v.number(),
	row: v.number(),
	rotation: v.union(
		v.literal(0),
		v.literal(90),
		v.literal(180),
		v.literal(270),
	),
	label: v.optional(v.string()),
	placeKind: v.optional(
		v.union(
			v.literal("home"),
			v.literal("market"),
			v.literal("diner"),
			v.literal("school"),
			v.literal("work"),
			v.literal("nature"),
			v.literal("road"),
			v.literal("building"),
		),
	),
	ownerCharacterId: v.optional(v.union(v.string(), v.null())),
});

function labelFromAssetId(assetId: string) {
	return (assetId.split(":").pop() ?? assetId)
		.replace(/[_-]/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function kindFromAssetId(assetId: string): Doc<"tiles">["placeKind"] {
	if (assetId.startsWith("roads:")) {
		return "road";
	}
	if (assetId.startsWith("nature:")) {
		return "nature";
	}
	if (assetId.startsWith("commercial:")) {
		return "work";
	}
	return "building";
}

function placeKindForTile(tile: Doc<"tiles">): Doc<"places">["kind"] {
	return tile.placeKind === "road" ? "road" : tile.placeKind;
}

async function getDefaultWorld(ctx: QueryCtx | MutationCtx) {
	return await ctx.db
		.query("worlds")
		.withIndex("by_slug", (q) => q.eq("slug", DEFAULT_WORLD_SLUG))
		.unique();
}

async function ensureDefaultWorld(ctx: MutationCtx) {
	const existing = await getDefaultWorld(ctx);
	if (existing) {
		return existing;
	}

	const timestamp = now();
	const worldId = await ctx.db.insert("worlds", {
		slug: DEFAULT_WORLD_SLUG,
		cols: 40,
		rows: 40,
		mode: "auto",
		importedLocalStorage: false,
		updatedAt: timestamp,
	});
	const world = await ctx.db.get(worldId);
	if (!world) {
		throw new Error("Failed to create default world");
	}

	await Promise.all(
		characterSeeds.flatMap((seed) => [
			ctx.db.insert("characters", {
				worldId,
				characterId: seed.characterId,
				label: seed.label,
				cell: seed.cell,
				homePlaceStableId: `${seed.characterId}:home`,
				activity: "idle",
				currentTask: null,
				updatedAt: timestamp,
			}),
			ctx.db.insert("places", {
				worldId,
				tileId: null,
				stableId: `${seed.characterId}:home`,
				label: `${seed.label} Home`,
				kind: "fallback",
				entryCell: seed.cell,
				ownerCharacterId: seed.characterId,
				updatedAt: timestamp,
			}),
		]),
	);

	return world;
}

async function reconcilePlaces(ctx: MutationCtx, worldId: Id<"worlds">) {
	const timestamp = now();
	const [tiles, places] = await Promise.all([
		ctx.db
			.query("tiles")
			.withIndex("by_worldId", (q) => q.eq("worldId", worldId))
			.collect(),
		ctx.db
			.query("places")
			.withIndex("by_worldId", (q) => q.eq("worldId", worldId))
			.collect(),
	]);
	const placeByStableId = new Map(
		places.map((place) => [place.stableId, place]),
	);

	await Promise.all(
		tiles.map((tile) => {
			const stableId = `tile:${tile.stableId}`;
			const existing = placeByStableId.get(stableId);
			const place = {
				worldId,
				tileId: tile._id,
				stableId,
				label: tile.label,
				kind: placeKindForTile(tile),
				entryCell: { col: tile.col, row: tile.row },
				ownerCharacterId: tile.ownerCharacterId,
				updatedAt: timestamp,
			};
			if (existing) {
				return ctx.db.patch(existing._id, place);
			} else {
				return ctx.db.insert("places", place);
			}
		}),
	);

	const homeTilesByOwner = new Map<string, Doc<"tiles">>();
	for (const tile of tiles) {
		if (tile.placeKind === "home" && tile.ownerCharacterId !== null) {
			homeTilesByOwner.set(tile.ownerCharacterId, tile);
		}
	}
	const characters = await ctx.db
		.query("characters")
		.withIndex("by_worldId", (q) => q.eq("worldId", worldId))
		.collect();

	await Promise.all(
		characters.map(async (character) => {
			const homeTile = homeTilesByOwner.get(character.characterId);
			if (homeTile) {
				await ctx.db.patch(character._id, {
					homePlaceStableId: `tile:${homeTile.stableId}`,
					updatedAt: timestamp,
				});
				return;
			}

			const stableId = `${character.characterId}:home`;
			const fallback = placeByStableId.get(stableId);
			const home = {
				worldId,
				tileId: null,
				stableId,
				label: `${character.label} Home`,
				kind: "fallback" as const,
				entryCell: character.cell,
				ownerCharacterId: character.characterId,
				updatedAt: timestamp,
			};
			if (fallback) {
				await ctx.db.patch(fallback._id, home);
			} else {
				await ctx.db.insert("places", home);
			}
			await ctx.db.patch(character._id, {
				homePlaceStableId: stableId,
				updatedAt: timestamp,
			});
		}),
	);
}

export const ensureWorld = mutation({
	args: {},
	handler: async (ctx) => {
		await ensureDefaultWorld(ctx);
		return null;
	},
});

export const importLocalTiles = mutation({
	args: { tiles: v.array(tileInput) },
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		if (world.importedLocalStorage || args.tiles.length === 0) {
			return { imported: false };
		}

		const timestamp = now();
		const homeCandidateIndexes = new Map<string, number>();
		for (const [index, tile] of args.tiles.entries()) {
			if (
				tile.assetId.startsWith("suburban:") ||
				tile.assetId.includes("building")
			) {
				homeCandidateIndexes.set(tile.stableId, index);
			}
		}

		await Promise.all(
			args.tiles.map((tile) => {
				const owner = homeCandidateIndexes.get(tile.stableId) ?? -1;
				const ownerCharacter =
					owner >= 0 && owner < characterSeeds.length
						? characterSeeds[owner]
						: null;
				const placeKind =
					tile.placeKind ??
					(ownerCharacter ? "home" : kindFromAssetId(tile.assetId));
				return ctx.db.insert("tiles", {
					worldId: world._id,
					stableId: tile.stableId,
					assetId: tile.assetId,
					col: tile.col,
					row: tile.row,
					rotation: tile.rotation,
					label:
						tile.label ??
						(ownerCharacter
							? `${ownerCharacter.label} Home`
							: labelFromAssetId(tile.assetId)),
					placeKind,
					ownerCharacterId:
						tile.ownerCharacterId ?? ownerCharacter?.characterId ?? null,
					updatedAt: timestamp,
				});
			}),
		);

		await ctx.db.patch(world._id, {
			importedLocalStorage: true,
			updatedAt: timestamp,
		});
		await reconcilePlaces(ctx, world._id);
		return { imported: true };
	},
});

export const getState = query({
	args: {},
	handler: async (ctx) => {
		const world = await getDefaultWorld(ctx);
		if (!world) {
			return null;
		}

		const [tiles, places, characters, actions, chatMessages] =
			await Promise.all([
				ctx.db
					.query("tiles")
					.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
					.collect(),
				ctx.db
					.query("places")
					.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
					.collect(),
				ctx.db
					.query("characters")
					.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
					.collect(),
				ctx.db
					.query("agentActions")
					.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
					.collect(),
				ctx.db
					.query("chatMessages")
					.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
					.collect(),
			]);

		return {
			world,
			tiles,
			places,
			characters,
			actions: actions.sort((a, b) => a.createdAt - b.createdAt).slice(-80),
			chatMessages: chatMessages
				.sort((a, b) => a.createdAt - b.createdAt)
				.slice(-40),
		};
	},
});

export const getTurnContext = query({
	args: { characterId: v.string() },
	handler: async (ctx, args) => {
		const world = await getDefaultWorld(ctx);
		if (!world) {
			return null;
		}

		const [places, characters, actions, chatMessages] = await Promise.all([
			ctx.db
				.query("places")
				.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
				.collect(),
			ctx.db
				.query("characters")
				.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
				.collect(),
			ctx.db
				.query("agentActions")
				.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
				.collect(),
			ctx.db
				.query("chatMessages")
				.withIndex("by_worldId", (q) => q.eq("worldId", world._id))
				.collect(),
		]);

		const character = characters.find(
			(candidate) => candidate.characterId === args.characterId,
		);
		if (!character) {
			return null;
		}

		const labelledPlaces = places
			.map((place) => ({
				stableId: place.stableId,
				label: place.label,
				kind: place.kind,
				ownerCharacterId: place.ownerCharacterId,
				entryCell: place.entryCell,
				distance: distance(character.cell, place.entryCell),
			}))
			.sort((a, b) => a.distance - b.distance);

		return {
			world: {
				cols: world.cols,
				rows: world.rows,
				mode: world.mode,
			},
			character: {
				characterId: character.characterId,
				label: character.label,
				cell: character.cell,
				homePlaceStableId: character.homePlaceStableId,
				currentTask: character.currentTask,
			},
			places: labelledPlaces,
			otherCharacters: characters.reduce<
				Array<{
					characterId: string;
					label: string;
					cell: { col: number; row: number };
					distance: number;
				}>
			>((others, candidate) => {
				if (candidate.characterId !== character.characterId) {
					others.push({
						characterId: candidate.characterId,
						label: candidate.label,
						cell: candidate.cell,
						distance: distance(character.cell, candidate.cell),
					});
				}
				return others;
			}, []),
			recentMessages: chatMessages
				.sort((a, b) => a.createdAt - b.createdAt)
				.slice(-8)
				.map((message) => ({
					label: message.label,
					text: message.text,
				})),
			pendingActions: actions.reduce<
				Array<{
					characterId: string;
					actionId: Doc<"agentActions">["actionId"];
					targetPlaceStableId: string | null;
					reason: string;
				}>
			>((pendingActions, pending) => {
				if (pending.status === "pending") {
					pendingActions.push({
						characterId: pending.characterId,
						actionId: pending.actionId,
						targetPlaceStableId: pending.targetPlaceStableId,
						reason: pending.reason,
					});
				}
				return pendingActions;
			}, []),
		};
	},
});

export const setMode = mutation({
	args: { mode: v.union(v.literal("auto"), v.literal("mock_manual")) },
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		await ctx.db.patch(world._id, { mode: args.mode, updatedAt: now() });
		return null;
	},
});

export const upsertTile = mutation({
	args: { tile: tileInput },
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		const existing = await ctx.db
			.query("tiles")
			.withIndex("by_worldId_and_stableId", (q) =>
				q.eq("worldId", world._id).eq("stableId", args.tile.stableId),
			)
			.unique();
		const timestamp = now();
		const patch = {
			worldId: world._id,
			stableId: args.tile.stableId,
			assetId: args.tile.assetId,
			col: args.tile.col,
			row: args.tile.row,
			rotation: args.tile.rotation,
			label: args.tile.label ?? labelFromAssetId(args.tile.assetId),
			placeKind: args.tile.placeKind ?? kindFromAssetId(args.tile.assetId),
			ownerCharacterId: args.tile.ownerCharacterId ?? null,
			updatedAt: timestamp,
		};
		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("tiles", patch);
		}
		await reconcilePlaces(ctx, world._id);
		return null;
	},
});

export const updateTileMetadata = mutation({
	args: {
		stableId: v.string(),
		label: v.string(),
		placeKind: tileInput.fields.placeKind,
		ownerCharacterId: v.union(v.string(), v.null()),
	},
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		const tile = await ctx.db
			.query("tiles")
			.withIndex("by_worldId_and_stableId", (q) =>
				q.eq("worldId", world._id).eq("stableId", args.stableId),
			)
			.unique();
		if (!tile) {
			return null;
		}
		await ctx.db.patch(tile._id, {
			label: args.label.trim() || tile.label,
			placeKind: args.placeKind,
			ownerCharacterId: args.ownerCharacterId,
			updatedAt: now(),
		});
		await reconcilePlaces(ctx, world._id);
		return null;
	},
});

export const deleteTile = mutation({
	args: { stableId: v.string() },
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		const tile = await ctx.db
			.query("tiles")
			.withIndex("by_worldId_and_stableId", (q) =>
				q.eq("worldId", world._id).eq("stableId", args.stableId),
			)
			.unique();
		if (tile) {
			await ctx.db.delete(tile._id);
		}
		const place = await ctx.db
			.query("places")
			.withIndex("by_worldId_and_stableId", (q) =>
				q.eq("worldId", world._id).eq("stableId", `tile:${args.stableId}`),
			)
			.unique();
		if (place) {
			await ctx.db.delete(place._id);
		}
		await reconcilePlaces(ctx, world._id);
		return null;
	},
});

export const enqueueAction = mutation({
	args: {
		characterId: v.string(),
		source: v.union(v.literal("llm"), v.literal("mock"), v.literal("manual")),
		actionId: v.union(
			v.literal("move_to_place"),
			v.literal("move_to_cell"),
			v.literal("say"),
			v.literal("wait"),
			v.literal("inspect_place"),
			v.literal("set_task"),
		),
		targetPlaceStableId: v.union(v.string(), v.null()),
		targetCell: v.union(
			v.object({ col: v.number(), row: v.number() }),
			v.null(),
		),
		message: v.union(v.string(), v.null()),
		task: v.union(v.string(), v.null()),
		reason: v.string(),
	},
	handler: async (ctx, args) => {
		const world = await ensureDefaultWorld(ctx);
		const timestamp = now();
		return await ctx.db.insert("agentActions", {
			worldId: world._id,
			characterId: args.characterId,
			source: args.source,
			actionId: args.actionId,
			status: "pending",
			targetPlaceStableId: args.targetPlaceStableId,
			targetCell: args.targetCell,
			message: args.message,
			task: args.task,
			reason: args.reason,
			result: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	},
});

export const setActionStatus = mutation({
	args: {
		actionId: v.id("agentActions"),
		status: v.union(
			v.literal("running"),
			v.literal("completed"),
			v.literal("failed"),
		),
		result: v.union(v.string(), v.null()),
		characterCell: v.union(
			v.object({ col: v.number(), row: v.number() }),
			v.null(),
		),
	},
	handler: async (ctx, args) => {
		const action = await ctx.db.get(args.actionId);
		if (!action) {
			return null;
		}
		await ctx.db.patch(args.actionId, {
			status: args.status,
			result: args.result,
			updatedAt: now(),
		});
		const character = await ctx.db
			.query("characters")
			.withIndex("by_worldId_and_characterId", (q) =>
				q.eq("worldId", action.worldId).eq("characterId", action.characterId),
			)
			.unique();
		if (character) {
			await ctx.db.patch(character._id, {
				cell: args.characterCell ?? character.cell,
				activity: args.status === "running" ? "moving" : "idle",
				currentTask: action.task,
				updatedAt: now(),
			});
		}
		if (
			args.status === "completed" &&
			action.actionId === "say" &&
			action.message
		) {
			const label = character?.label ?? action.characterId;
			await ctx.db.insert("chatMessages", {
				worldId: action.worldId,
				characterId: action.characterId,
				label,
				text: action.message,
				source: action.source,
				createdAt: now(),
			});
		}
		return null;
	},
});
