import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const cell = v.object({
  col: v.number(),
  row: v.number(),
});

export default defineSchema({
  worlds: defineTable({
    slug: v.string(),
    cols: v.number(),
    rows: v.number(),
    mode: v.union(v.literal("auto"), v.literal("mock_manual")),
    importedLocalStorage: v.boolean(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
  tiles: defineTable({
    worldId: v.id("worlds"),
    stableId: v.string(),
    assetId: v.string(),
    col: v.number(),
    row: v.number(),
    rotation: v.union(v.literal(0), v.literal(90), v.literal(180), v.literal(270)),
    label: v.string(),
    placeKind: v.union(
      v.literal("home"),
      v.literal("market"),
      v.literal("diner"),
      v.literal("school"),
      v.literal("work"),
      v.literal("nature"),
      v.literal("road"),
      v.literal("building"),
    ),
    ownerCharacterId: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_worldId", ["worldId"])
    .index("by_worldId_and_stableId", ["worldId", "stableId"]),
  places: defineTable({
    worldId: v.id("worlds"),
    tileId: v.union(v.id("tiles"), v.null()),
    stableId: v.string(),
    label: v.string(),
    kind: v.union(
      v.literal("home"),
      v.literal("market"),
      v.literal("diner"),
      v.literal("school"),
      v.literal("work"),
      v.literal("nature"),
      v.literal("road"),
      v.literal("building"),
      v.literal("fallback"),
    ),
    entryCell: cell,
    ownerCharacterId: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_worldId", ["worldId"])
    .index("by_worldId_and_stableId", ["worldId", "stableId"])
    .index("by_worldId_and_ownerCharacterId", ["worldId", "ownerCharacterId"]),
  characters: defineTable({
    worldId: v.id("worlds"),
    characterId: v.string(),
    label: v.string(),
    cell,
    homePlaceStableId: v.string(),
    activity: v.union(v.literal("idle"), v.literal("moving"), v.literal("talking"), v.literal("waiting")),
    currentTask: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_worldId", ["worldId"])
    .index("by_worldId_and_characterId", ["worldId", "characterId"]),
  agentActions: defineTable({
    worldId: v.id("worlds"),
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
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    targetPlaceStableId: v.union(v.string(), v.null()),
    targetCell: v.union(cell, v.null()),
    message: v.union(v.string(), v.null()),
    task: v.union(v.string(), v.null()),
    reason: v.string(),
    result: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_worldId", ["worldId"])
    .index("by_worldId_and_status", ["worldId", "status"])
    .index("by_worldId_and_characterId", ["worldId", "characterId"]),
  chatMessages: defineTable({
    worldId: v.id("worlds"),
    characterId: v.string(),
    label: v.string(),
    text: v.string(),
    source: v.union(v.literal("llm"), v.literal("mock"), v.literal("manual"), v.literal("system")),
    createdAt: v.number(),
  }).index("by_worldId", ["worldId"]),
});
