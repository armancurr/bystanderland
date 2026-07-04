import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Command } from "cmdk";
import Phaser from "phaser";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  buildWorldModel,
  cellsAreInBounds,
  findGridPath,
  footprintCells,
  getPlacedTileFootprint,
  intersectsPlacedTile,
  tileAtCell,
  type GridCell,
  type WorldModel,
} from "./game/grid-world";
import { IsometricMovementScene } from "./game/isometric-movement-scene";
import { createMovementGameConfig } from "./game/movement-game-config";
import { createSpriteStore, ensurePlaceableSprites, getPlaceableSprite } from "./game/sprite-cache";
import type { BakedPlaceableSprite, BakedPlaceableSprites } from "./game/placeable-sprite-baker";
import {
  placeableSpriteKey,
  placeableAssets,
  placeableAssetsById,
  type PlaceableAsset,
  type PlacedTile,
  type TileRotation,
} from "./game/placed-assets";

const PLACED_TILES_STORAGE_KEY = "bystanderland:placed-tiles:v1";
const LOCAL_IMPORT_DONE_KEY = "townbase:convex-imported-local-tiles:v1";
const DEFAULT_TILE_ROTATION: TileRotation = 180;
const PLAYER_ROTATIONS: TileRotation[] = [0, 90, 180, 270];

type EditorTool = "explore" | "asset" | "remove";
type CommandPage = "root" | "assets";
type PlaceKind = Doc<"tiles">["placeKind"];
type SimulationMode = Doc<"worlds">["mode"];
type TownState = {
  world: Doc<"worlds">;
  tiles: Doc<"tiles">[];
  places: Doc<"places">[];
  characters: Doc<"characters">[];
  actions: Doc<"agentActions">[];
  chatMessages: Doc<"chatMessages">[];
};
type ToolTestStep = {
  characterId: string;
  toolName: string;
  task: string;
  message?: string;
};
type ToolTestStatus = {
  tone: "idle" | "running" | "success" | "error";
  text: string;
};

type CharacterConfig = {
  id: string;
  name: string;
  asset: PlaceableAsset;
};

const CHARACTER_CONFIGS: CharacterConfig[] = [
  {
    id: "aria",
    name: "01",
    asset: {
      id: "characters:character-a",
      label: "Character A",
      category: "building",
      pack: "characters",
      previewUrl: new URL(
        "../assets/kenney_blocky-characters_20/Previews/character-a.png",
        import.meta.url,
      ).href,
      modelUrl: new URL(
        "../assets/kenney_blocky-characters_20/Models/GLB format/character-a.glb",
        import.meta.url,
      ).href,
    },
  },
  {
    id: "milo",
    name: "02",
    asset: {
      id: "characters:character-b",
      label: "Character B",
      category: "building",
      pack: "characters",
      previewUrl: new URL(
        "../assets/kenney_blocky-characters_20/Previews/character-b.png",
        import.meta.url,
      ).href,
      modelUrl: new URL(
        "../assets/kenney_blocky-characters_20/Models/GLB format/character-b.glb",
        import.meta.url,
      ).href,
    },
  },
  {
    id: "nora",
    name: "03",
    asset: {
      id: "characters:character-c",
      label: "Character C",
      category: "building",
      pack: "characters",
      previewUrl: new URL(
        "../assets/kenney_blocky-characters_20/Previews/character-c.png",
        import.meta.url,
      ).href,
      modelUrl: new URL(
        "../assets/kenney_blocky-characters_20/Models/GLB format/character-c.glb",
        import.meta.url,
      ).href,
    },
  },
];

const placeKindOptions: PlaceKind[] = [
  "home",
  "market",
  "diner",
  "school",
  "work",
  "nature",
  "road",
  "building",
];

function isTileRotation(value: unknown): value is TileRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function loadLocalPlacedTiles() {
  const raw = window.localStorage.getItem(PLACED_TILES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((tile): tile is PlacedTile => {
      if (!tile || typeof tile !== "object") {
        return false;
      }
      const candidate = tile as Partial<PlacedTile>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.assetId === "string" &&
        placeableAssetsById.has(candidate.assetId) &&
        typeof candidate.col === "number" &&
        Number.isInteger(candidate.col) &&
        typeof candidate.row === "number" &&
        Number.isInteger(candidate.row) &&
        isTileRotation(candidate.rotation)
      );
    });
  } catch {
    return [];
  }
}

function labelFromAssetId(assetId: string) {
  return (
    assetId
      .split(":")
      .pop()
      ?.replace(/[_-]/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? assetId
  );
}

function placeKindFromAsset(asset: PlaceableAsset): PlaceKind {
  if (asset.category === "road") {
    return "road";
  }
  if (asset.category === "nature") {
    return "nature";
  }
  if (asset.pack === "commercial" || asset.pack === "industrial") {
    return "work";
  }
  return "building";
}

function convexTileToPlacedTile(tile: Doc<"tiles">): PlacedTile {
  return {
    id: tile.stableId,
    assetId: tile.assetId,
    col: tile.col,
    row: tile.row,
    rotation: tile.rotation,
  };
}

function nearestWalkableCell(target: GridCell, world: WorldModel) {
  if (!world.blockedCellKeys.has(`${target.col}:${target.row}`)) {
    return target;
  }

  for (let radius = 1; radius < Math.max(world.cols, world.rows); radius += 1) {
    for (let col = target.col - radius; col <= target.col + radius; col += 1) {
      for (let row = target.row - radius; row <= target.row + radius; row += 1) {
        const cell = { col, row };
        if (
          col >= 0 &&
          col < world.cols &&
          row >= 0 &&
          row < world.rows &&
          !world.blockedCellKeys.has(`${col}:${row}`)
        ) {
          return cell;
        }
      }
    }
  }

  return target;
}

function SpinnerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#ffffff"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path d="M136,32V64a8,8,0,0,1-16,0V32a8,8,0,0,1,16,0Zm88,88H192a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16Zm-45.09,47.6a8,8,0,0,0-11.31,11.31l22.62,22.63a8,8,0,0,0,11.32-11.32ZM128,184a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V192A8,8,0,0,0,128,184ZM77.09,167.6,54.46,190.22a8,8,0,0,0,11.32,11.32L88.4,178.91A8,8,0,0,0,77.09,167.6ZM72,128a8,8,0,0,0-8-8H32a8,8,0,0,0,0,16H64A8,8,0,0,0,72,128ZM65.78,54.46A8,8,0,0,0,54.46,65.78L77.09,88.4A8,8,0,0,0,88.4,77.09Z" />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  );
}

function nextRotation(rotation: TileRotation, direction: 1 | -1) {
  const rotations: TileRotation[] = [0, 90, 180, 270];
  const index = rotations.indexOf(rotation);
  return rotations[(index + direction + rotations.length) % rotations.length];
}

function Shortcut({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-[#53635b] bg-[#1d2724] px-1.5 py-0.5 text-[11px] text-[#cdd8c4]">
      {children}
    </kbd>
  );
}

function ChatPanel({ messages }: { messages: Doc<"chatMessages">[] }) {
  const colorByCharacter: Record<string, string> = {
    aria: "#4cc9f0",
    milo: "#f6a04d",
    nora: "#f7d84a",
  };

  return (
    <section
      className="absolute right-3 top-3 z-[4] flex max-h-[34vh] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-[#0b1720]/55 bg-[#101820]/78 font-['Geist_Mono'] text-xs text-[#eef4ea] shadow-[0_12px_34px_rgba(5,12,16,0.26)] backdrop-blur"
      aria-label="Character chat"
    >
      <div className="min-h-0 overflow-hidden px-3 py-2">
        {messages.length === 0 ? (
          <p className="text-[#cdd8c4]/70">...</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {messages.map((message) => (
              <li key={message._id} className="min-w-0 leading-5">
                <span
                  className="font-semibold"
                  style={{ color: colorByCharacter[message.characterId] ?? "#d9e4cd" }}
                >
                  {message.label}:
                </span>{" "}
                <span className="break-words text-[#f7fbf2]">{message.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function AgentLogPanel({
  actions,
  characters,
  places,
}: {
  actions: Doc<"agentActions">[];
  characters: Doc<"characters">[];
  places: Doc<"places">[];
}) {
  const characterById = new Map(characters.map((character) => [character.characterId, character]));
  const placeByStableId = new Map(places.map((place) => [place.stableId, place]));
  const recentActions = [...actions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);

  return (
    <section
      className="absolute left-3 top-16 z-[4] flex max-h-[34vh] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-[#0b1720]/55 bg-[#101820]/82 font-['Geist_Mono'] text-xs text-[#eef4ea] shadow-[0_12px_34px_rgba(5,12,16,0.26)] backdrop-blur"
      aria-label="Agent log"
    >
      <div className="flex items-center justify-between border-b border-[#273338] px-3 py-2">
        <strong className="text-[#f7fbf2]">Agent Log</strong>
        <span className="text-[#cdd8c4]/70">latest tool calls</span>
      </div>
      <div className="min-h-0 overflow-auto px-3 py-2 scrollbar-none">
        <div className="mb-2 grid gap-1 border-b border-[#273338] pb-2 text-[#cdd8c4]">
          {characters.map((character) => (
            <div key={character._id} className="flex items-center justify-between gap-2">
              <span>{character.label}</span>
              <span className="truncate text-right text-[#f7fbf2]">
                {character.currentTask ?? character.activity}
              </span>
            </div>
          ))}
        </div>
        {recentActions.length === 0 ? (
          <p className="text-[#cdd8c4]/70">No agent actions yet.</p>
        ) : (
          <ol className="grid gap-2">
            {recentActions.map((action) => {
              const character = characterById.get(action.characterId);
              const place = action.targetPlaceStableId
                ? placeByStableId.get(action.targetPlaceStableId)
                : null;
              const target = place
                ? place.label
                : action.targetCell
                  ? `${action.targetCell.col},${action.targetCell.row}`
                  : action.message
                    ? `"${action.message}"`
                    : "none";
              return (
                <li key={action._id} className="rounded bg-[#17201d]/80 p-2 leading-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#f7fbf2]">
                      {character?.label ?? action.characterId} / {action.actionId}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        action.status === "failed"
                          ? "bg-[#5b2222] text-[#ffd0c9]"
                          : action.status === "completed"
                            ? "bg-[#23442f] text-[#d9e4cd]"
                            : "bg-[#4b3c1b] text-[#ffe2a3]"
                      }`}
                    >
                      {action.status}
                    </span>
                  </div>
                  <div className="truncate text-[#cdd8c4]">target: {target}</div>
                  <div className="break-words text-[#f7fbf2]">reason: {action.reason}</div>
                  {action.result ? (
                    <div className="break-words text-[#cdd8c4]">result: {action.result}</div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function ModePanel({
  mode,
  onSetMode,
  onRunPopulationStep,
  isRunning,
}: {
  mode: SimulationMode;
  onSetMode: (mode: SimulationMode) => void;
  onRunPopulationStep: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="absolute bottom-3 right-3 z-[4] flex items-center gap-1.5 rounded-md bg-[#273338]/88 px-2.5 py-2 text-xs text-[#eef4ea] shadow-[0_10px_24px_rgba(23,32,29,0.16)] backdrop-blur">
      <button
        type="button"
        onClick={() => onSetMode("auto")}
        className={`rounded px-2 py-1 ${mode === "auto" ? "bg-[#d9e4cd] text-[#17201d]" : "bg-[#17201d] text-[#cdd8c4]"}`}
      >
        Auto
      </button>
      <button
        type="button"
        onClick={() => onSetMode("mock_manual")}
        className={`rounded px-2 py-1 ${mode === "mock_manual" ? "bg-[#d9e4cd] text-[#17201d]" : "bg-[#17201d] text-[#cdd8c4]"}`}
      >
        Mock Manual
      </button>
      <button
        type="button"
        disabled={isRunning || mode !== "auto"}
        onClick={onRunPopulationStep}
        className="rounded bg-[#f2b84b] px-2 py-1 text-[#17201d] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isRunning ? "Running..." : "Run Step"}
      </button>
    </div>
  );
}

function ToolTestPanel({
  plan,
  stepIndex,
  status,
  isRunning,
  mode,
  onRunStep,
  onReset,
}: {
  plan: ToolTestStep[];
  stepIndex: number;
  status: ToolTestStatus;
  isRunning: boolean;
  mode: SimulationMode;
  onRunStep: () => void;
  onReset: () => void;
}) {
  const step = plan[stepIndex];
  const isComplete = plan.length > 0 && stepIndex >= plan.length;
  const progress =
    plan.length === 0 ? "0 / 0" : `${Math.min(stepIndex + 1, plan.length)} / ${plan.length}`;
  const disabled = isRunning || mode !== "auto" || plan.length === 0 || isComplete;
  const statusClass =
    status.tone === "error"
      ? "text-[#ffd0c9]"
      : status.tone === "success"
        ? "text-[#d9e4cd]"
        : status.tone === "running"
          ? "text-[#ffe2a3]"
          : "text-[#cdd8c4]/75";

  return (
    <section
      className="absolute right-3 top-[calc(34vh+24px)] z-[4] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 rounded-md border border-[#0b1720]/55 bg-[#101820]/82 px-3 py-2 font-['Geist_Mono'] text-xs text-[#eef4ea] shadow-[0_12px_34px_rgba(5,12,16,0.26)] backdrop-blur"
      aria-label="Tool test runner"
    >
      <div className="flex items-center justify-between gap-2">
        <strong>Tool Test</strong>
        <span className="text-[#cdd8c4]/70">{progress}</span>
      </div>
      <div className="min-h-[3.75rem] rounded bg-[#17201d]/80 p-2 leading-5">
        {isComplete ? (
          <div className="text-[#d9e4cd]">All tool test steps completed.</div>
        ) : step ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-[#f7fbf2]">{step.characterId}</span>
              <span className="rounded bg-[#273338] px-1.5 py-0.5 text-[#cdd8c4]">
                {step.toolName}
              </span>
            </div>
            <div className="truncate text-[#cdd8c4]">{step.task}</div>
            {step.message ? <div className="break-words text-[#f7fbf2]">{step.message}</div> : null}
          </>
        ) : (
          <div className="text-[#cdd8c4]/70">No test plan loaded.</div>
        )}
      </div>
      <div className={statusClass}>{status.text}</div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onRunStep}
          className="rounded bg-[#f2b84b] px-2 py-1 text-[#17201d] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isRunning ? "Running..." : "Run Test Step"}
        </button>
        <button
          type="button"
          disabled={isRunning || stepIndex === 0}
          onClick={onReset}
          className="rounded bg-[#17201d] px-2 py-1 text-[#cdd8c4] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Reset
        </button>
      </div>
    </section>
  );
}

function MetadataPanel({
  tile,
  characters,
  onSave,
}: {
  tile: Doc<"tiles"> | undefined;
  characters: Doc<"characters">[];
  onSave: (
    stableId: string,
    label: string,
    placeKind: PlaceKind,
    ownerCharacterId: string | null,
  ) => void;
}) {
  const [label, setLabel] = useState("");
  const [placeKind, setPlaceKind] = useState<PlaceKind>("building");
  const [ownerCharacterId, setOwnerCharacterId] = useState<string>("");

  useEffect(() => {
    if (!tile) {
      return;
    }
    setLabel(tile.label);
    setPlaceKind(tile.placeKind);
    setOwnerCharacterId(tile.ownerCharacterId ?? "");
  }, [tile]);

  if (!tile) {
    return null;
  }

  return (
    <form
      className="absolute bottom-16 right-3 z-[4] flex w-[min(330px,calc(100vw-24px))] flex-col gap-2 rounded-md bg-[#273338]/92 p-3 text-xs text-[#eef4ea] shadow-[0_10px_24px_rgba(23,32,29,0.2)] backdrop-blur"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(tile.stableId, label, placeKind, ownerCharacterId || null);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">Place metadata</span>
        <span className="truncate text-[#cdd8c4]/75">{tile.assetId}</span>
      </div>
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        className="h-9 rounded border border-[#53635b] bg-[#17201d] px-2 text-[#eef4ea] outline-none"
        aria-label="Place label"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={placeKind}
          onChange={(event) => setPlaceKind(event.target.value as PlaceKind)}
          className="h-9 rounded border border-[#53635b] bg-[#17201d] px-2 text-[#eef4ea] outline-none"
          aria-label="Place kind"
        >
          {placeKindOptions.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <select
          value={ownerCharacterId}
          onChange={(event) => setOwnerCharacterId(event.target.value)}
          className="h-9 rounded border border-[#53635b] bg-[#17201d] px-2 text-[#eef4ea] outline-none"
          aria-label="Owner character"
        >
          <option value="">No owner</option>
          {characters.map((character) => (
            <option key={character.characterId} value={character.characterId}>
              {character.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="h-9 rounded bg-[#d9e4cd] px-3 text-[#17201d]">
        Save
      </button>
    </form>
  );
}

function MovementRoute() {
  const state = useQuery(api.town.getState) as TownState | null | undefined;
  const ensureWorld = useMutation(api.town.ensureWorld);
  const importLocalTiles = useMutation(api.town.importLocalTiles);
  const setMode = useMutation(api.town.setMode);
  const upsertTile = useMutation(api.town.upsertTile);
  const deleteTile = useMutation(api.town.deleteTile);
  const updateTileMetadata = useMutation(api.town.updateTileMetadata);
  const enqueueAction = useMutation(api.town.enqueueAction);
  const setActionStatus = useMutation(api.town.setActionStatus);
  const runAgentTurn = useAction(api.agents.runAgentTurn);
  const runPopulationStep = useAction(api.agents.runPopulationStep);

  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const placeableSpritesRef = useRef<BakedPlaceableSprites | null>(null);
  const worldModelRef = useRef<WorldModel | null>(null);
  const selectedAssetIdRef = useRef(placeableAssets[0]?.id ?? "");
  const toolRef = useRef<EditorTool>("explore");
  const rotationRef = useRef<TileRotation>(DEFAULT_TILE_ROTATION);
  const placedTilesRef = useRef<PlacedTile[]>([]);
  const modeRef = useRef<SimulationMode>("auto");
  const commandSearchRef = useRef<HTMLInputElement | null>(null);
  const runningActionsRef = useRef(new Set<string>());
  const [selectedAssetId, setSelectedAssetId] = useState(selectedAssetIdRef.current);
  const [tool, setTool] = useState<EditorTool>("explore");
  const [rotation, setRotation] = useState<TileRotation>(DEFAULT_TILE_ROTATION);
  const [isBaking, setIsBaking] = useState(true);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandPage, setCommandPage] = useState<CommandPage>("root");
  const [selectedTileStableId, setSelectedTileStableId] = useState<string | null>(null);
  const [isRunningLlm, setIsRunningLlm] = useState(false);
  const [toolTestStepIndex, setToolTestStepIndex] = useState(0);
  const [toolTestStatus, setToolTestStatus] = useState<ToolTestStatus>({
    tone: "idle",
    text: "Ready to run the next tool test step.",
  });

  const convexTiles = state?.tiles ?? [];
  const placedTiles = useMemo(() => convexTiles.map(convexTileToPlacedTile), [convexTiles]);
  const characters = state?.characters ?? [];
  const places = state?.places ?? [];
  const mode = state?.world.mode ?? "auto";
  const isWorldReady = state !== undefined && state !== null;
  const selectedAsset = placeableAssetsById.get(selectedAssetId) ?? placeableAssets[0];
  const selectedTile = convexTiles.find((tile) => tile.stableId === selectedTileStableId);
  const toolTestPlan = useMemo<ToolTestStep[]>(
    () =>
      characters.map((character) => ({
        characterId: character.characterId,
        toolName: "required agent tool",
        task: `Run one agent turn for ${character.label}.`,
      })),
    [characters],
  );

  useEffect(() => {
    void ensureWorld();
  }, [ensureWorld]);

  useEffect(() => {
    if (state === undefined || !state?.world || state.world.importedLocalStorage) {
      return;
    }
    if (window.localStorage.getItem(LOCAL_IMPORT_DONE_KEY)) {
      return;
    }

    const localTiles = loadLocalPlacedTiles();
    window.localStorage.setItem(LOCAL_IMPORT_DONE_KEY, "1");
    void importLocalTiles({
      tiles: localTiles.map((tile) => ({
        stableId: tile.id,
        assetId: tile.assetId,
        col: tile.col,
        row: tile.row,
        rotation: tile.rotation,
      })),
    });
  }, [importLocalTiles, state]);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
  }, [selectedAssetId]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    placedTilesRef.current = placedTiles;
  }, [placedTiles]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isWorldReady || gameRef.current) {
      return;
    }

    let disposed = false;
    const store = createSpriteStore();
    placeableSpritesRef.current = store;

    const initialRequests = new Map<string, { asset: PlaceableAsset; rotation: TileRotation }>();
    for (const tile of placedTiles) {
      const asset = placeableAssetsById.get(tile.assetId);
      if (!asset) {
        continue;
      }
      initialRequests.set(placeableSpriteKey(tile.assetId, tile.rotation), {
        asset,
        rotation: tile.rotation,
      });
    }

    void Promise.all([
      ensurePlaceableSprites(store, Array.from(initialRequests.values())),
      Promise.all(
        CHARACTER_CONFIGS.map(async (character) => {
          const sprites = await Promise.all(
            PLAYER_ROTATIONS.map(
              async (rotation) =>
                [rotation, await getPlaceableSprite(character.asset, rotation)] as const,
            ),
          );
          const savedCharacter = characters.find(
            (candidate: Doc<"characters">) => candidate.characterId === character.id,
          );
          return {
            id: character.id,
            name: character.name,
            cell: savedCharacter?.cell ?? { col: 20, row: 20 },
            sprites: new Map<TileRotation, BakedPlaceableSprite>(sprites),
          };
        }),
      ),
    ]).then(([, sceneCharacters]) => {
      if (disposed) {
        return;
      }

      const game = new Phaser.Game(
        createMovementGameConfig(container, {
          placedTiles,
          placeableSprites: store,
          characters: sceneCharacters,
          allowKeyboardMovement: modeRef.current === "mock_manual",
          getPlacementPreview: (col, row) => {
            if (toolRef.current === "remove") {
              const tile = tileAtCell(placedTilesRef.current, store, col, row);
              if (!tile) {
                return { cells: [{ col, row }], isValid: false, intent: "remove" };
              }
              return {
                cells: footprintCells(
                  { col: tile.col, row: tile.row },
                  getPlacedTileFootprint(tile, store),
                ),
                isValid: true,
                intent: "remove",
              };
            }

            if (toolRef.current !== "asset") {
              return null;
            }

            const assetId = selectedAssetIdRef.current;
            const selectedRotation = rotationRef.current;
            const sprite = store.sprites.get(placeableSpriteKey(assetId, selectedRotation));
            if (!sprite) {
              return null;
            }

            const cells = footprintCells({ col, row }, sprite.footprint);
            return {
              cells,
              isValid:
                cellsAreInBounds(cells) &&
                !placedTilesRef.current.some((tile) => intersectsPlacedTile(cells, tile, store)),
              intent: "place",
              assetId,
              rotation: selectedRotation,
              textureKey: placeableSpriteKey(assetId, selectedRotation),
              footprint: sprite.footprint,
            };
          },
          onCellClick: (col, row, action) => {
            const clickedTile = tileAtCell(placedTilesRef.current, store, col, row);
            if (toolRef.current === "remove") {
              if (clickedTile) {
                void deleteTile({ stableId: clickedTile.id });
                setSelectedTileStableId(null);
              }
              return;
            }

            if (action === "erase") {
              return;
            }

            if (toolRef.current !== "asset") {
              setSelectedTileStableId(clickedTile?.id ?? null);
              return;
            }

            const assetId = selectedAssetIdRef.current;
            const asset = placeableAssetsById.get(assetId);
            if (!asset) {
              return;
            }

            const selectedRotation = rotationRef.current;
            void getPlaceableSprite(asset, selectedRotation).then((sprite) => {
              if (disposed) {
                return;
              }

              store.sprites.set(placeableSpriteKey(assetId, selectedRotation), sprite);
              const cells = footprintCells({ col, row }, sprite.footprint);
              if (
                !cellsAreInBounds(cells) ||
                placedTilesRef.current.some((tile) => intersectsPlacedTile(cells, tile, store))
              ) {
                return;
              }

              const stableId = `tile:${col}:${row}`;
              void upsertTile({
                tile: {
                  stableId,
                  assetId,
                  col,
                  row,
                  rotation: selectedRotation,
                  label: labelFromAssetId(assetId),
                  placeKind: placeKindFromAsset(asset),
                  ownerCharacterId: null,
                },
              });
              setSelectedTileStableId(stableId);
            });
          },
        }),
      );
      gameRef.current = game;
      worldModelRef.current = buildWorldModel(placedTilesRef.current, store);
      setIsBaking(false);
    });

    return () => {
      disposed = true;
      placeableSpritesRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [deleteTile, isWorldReady, upsertTile]);

  useEffect(() => {
    const store = placeableSpritesRef.current;
    const game = gameRef.current;
    if (!store || !game) {
      return;
    }

    const scene = game.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    scene?.setPlacedTiles(placedTiles);
    scene?.setCharacterCells(
      Object.fromEntries(characters.map((character) => [character.characterId, character.cell])),
    );
    worldModelRef.current = buildWorldModel(placedTiles, store);
  }, [characters, placedTiles]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) {
      return;
    }

    const scene = game.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    scene?.setAllowKeyboardMovement(mode === "mock_manual");
  }, [mode]);

  useEffect(() => {
    const store = placeableSpritesRef.current;
    const asset = placeableAssetsById.get(selectedAssetId);
    if (!store || !asset || tool !== "asset") {
      refreshPlacementPreview();
      return;
    }

    let cancelled = false;
    void getPlaceableSprite(asset, rotation).then((sprite) => {
      if (cancelled) {
        return;
      }
      store.sprites.set(placeableSpriteKey(asset.id, rotation), sprite);
      refreshPlacementPreview();
    });
    refreshPlacementPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedAssetId, rotation, tool]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const commandModifier = event.metaKey || event.ctrlKey;

      if (commandModifier && key === "k") {
        event.preventDefault();
        openCommand("root");
        return;
      }
      if (commandModifier && key === "b") {
        event.preventDefault();
        togglePlaceMode();
        return;
      }
      if (isCommandOpen || isEditableTarget(event.target)) {
        return;
      }
      if (key === "r") {
        event.preventDefault();
        toggleRemoveMode();
        return;
      }
      if (key === "q") {
        event.preventDefault();
        if (toolRef.current === "asset") {
          rotatePlacement(-1);
        }
        return;
      }
      if (key === "e") {
        event.preventDefault();
        if (toolRef.current === "asset") {
          rotatePlacement(1);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandOpen, commandPage]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const pending = state.actions.filter((action) => action.status === "pending");
    for (const action of pending) {
      if (runningActionsRef.current.has(action._id)) {
        continue;
      }
      runningActionsRef.current.add(action._id);
      void executeAction(action).finally(() => {
        runningActionsRef.current.delete(action._id);
      });
    }
  }, [state]);

  async function executeAction(action: Doc<"agentActions">) {
    const game = gameRef.current;
    const scene = game?.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    const world = worldModelRef.current;
    if (!scene || !world) {
      await setActionStatus({
        actionId: action._id as Id<"agentActions">,
        status: "failed",
        result: "Movement scene is not ready.",
        characterCell: null,
      });
      return;
    }

    await setActionStatus({
      actionId: action._id as Id<"agentActions">,
      status: "running",
      result: null,
      characterCell: null,
    });

    const startCell = scene.getCharacterCell(action.characterId);
    if (!startCell) {
      await setActionStatus({
        actionId: action._id as Id<"agentActions">,
        status: "failed",
        result: "Character is not ready.",
        characterCell: null,
      });
      return;
    }

    let targetCell: GridCell | null = null;
    if (action.actionId === "move_to_place" || action.actionId === "inspect_place") {
      const place = places.find((candidate) => candidate.stableId === action.targetPlaceStableId);
      if (!place) {
        await setActionStatus({
          actionId: action._id as Id<"agentActions">,
          status: "failed",
          result: `Unknown place target: ${action.targetPlaceStableId ?? "none"}.`,
          characterCell: startCell,
        });
        return;
      }
      targetCell = nearestWalkableCell(place.entryCell, world);
    } else if (action.actionId === "move_to_cell") {
      targetCell = action.targetCell ? nearestWalkableCell(action.targetCell, world) : null;
    }

    if (targetCell) {
      const path = await findGridPath(startCell, targetCell, world);
      if (!path || path.length === 0) {
        await setActionStatus({
          actionId: action._id as Id<"agentActions">,
          status: "failed",
          result: "No path to target.",
          characterCell: startCell,
        });
        return;
      }
      if (path.length <= 1) {
        await setActionStatus({
          actionId: action._id as Id<"agentActions">,
          status: "completed",
          result: action.reason || "Already at target.",
          characterCell: startCell,
        });
        return;
      }
      const result = await scene.moveCharacterAlongPath(action.characterId, path);
      const cell = scene.getCharacterCell(action.characterId) ?? startCell;
      await setActionStatus({
        actionId: action._id as Id<"agentActions">,
        status: result.success ? "completed" : "failed",
        result: result.success ? action.reason || (result.message ?? "Done.") : result.reason,
        characterCell: cell,
      });
      return;
    }

    window.setTimeout(
      () => {
        void setActionStatus({
          actionId: action._id as Id<"agentActions">,
          status: "completed",
          result: action.reason || "Done.",
          characterCell: startCell,
        });
      },
      action.actionId === "wait" ? 700 : 250,
    );
  }

  function selectAsset(assetId: string) {
    setSelectedAssetId(assetId);
    setTool("asset");
    setIsCommandOpen(false);
  }

  function copySelectedAssetId() {
    if (!selectedAsset) {
      return;
    }
    void navigator.clipboard?.writeText(selectedAsset.id);
    setIsCommandOpen(false);
  }

  function rotatePlacementFromCommand(direction: 1 | -1) {
    if (toolRef.current !== "asset") {
      return;
    }
    rotatePlacement(direction);
    setIsCommandOpen(false);
  }

  function rotatePlacement(direction: 1 | -1) {
    setRotation((current) => nextRotation(current, direction));
  }

  function toggleRemoveMode() {
    setTool((current) => (current === "remove" ? "explore" : "remove"));
  }

  function toggleRemoveModeFromCommand() {
    toggleRemoveMode();
    setIsCommandOpen(false);
  }

  function togglePlaceMode() {
    if (toolRef.current === "asset") {
      setTool("explore");
      setIsCommandOpen(false);
      setCommandPage("root");
      return;
    }
    setTool("asset");
    openCommand("assets");
  }

  function openCommand(page: CommandPage) {
    setCommandPage(page);
    setIsCommandOpen(true);
    window.setTimeout(() => commandSearchRef.current?.focus(), 0);
  }

  function refreshPlacementPreview() {
    const game = gameRef.current;
    if (!game) {
      return;
    }
    const scene = game.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    scene?.refreshPlacementPreview();
  }

  async function runMockStep() {
    const character = characters[0];
    const target =
      places.find((place: Doc<"places">) => place.stableId === character?.homePlaceStableId) ??
      places[0];
    if (!character || !target) {
      return;
    }
    await enqueueAction({
      characterId: character.characterId,
      source: "mock",
      actionId: "move_to_place",
      targetPlaceStableId: target.stableId,
      targetCell: null,
      message: null,
      task: "mock_visit_home",
      reason: `Mock step toward ${target.label}.`,
    });
  }

  async function handleRunPopulationStep() {
    if (mode === "mock_manual") {
      await runMockStep();
      return;
    }

    setIsRunningLlm(true);
    try {
      const result = await runPopulationStep();
      console.info("Population step result:", result);
      for (const turn of result.results ?? []) {
        if (!turn.ok) {
          console.warn("Character turn failed:", turn.characterId, turn.reason);
        }
      }
      if (!result.ok) {
        console.warn("Population step failed:", result.reason ?? result);
      }
    } catch (error) {
      console.error("Population step action failed:", error);
    } finally {
      setIsRunningLlm(false);
    }
  }

  async function handleRunToolTestStep() {
    const step = toolTestPlan[toolTestStepIndex];
    if (!step || mode !== "auto") {
      return;
    }

    setIsRunningLlm(true);
    setToolTestStatus({ tone: "running", text: `Running ${step.characterId} tool call...` });
    try {
      const result = await runAgentTurn({ characterId: step.characterId });
      if (!result.ok) {
        setToolTestStatus({
          tone: "error",
          text: result.reason ?? `${step.characterId} did not complete a tool call.`,
        });
        return;
      }
      setToolTestStatus({
        tone: "success",
        text: `${step.characterId} called ${result.toolName ?? "a fallback tool"}.`,
      });
      setToolTestStepIndex((current) => current + 1);
    } catch (error) {
      console.error("Tool test step failed:", error);
      setToolTestStatus({ tone: "error", text: "Tool test step failed. See console for details." });
    } finally {
      setIsRunningLlm(false);
    }
  }

  function resetToolTest() {
    setToolTestStepIndex(0);
    setToolTestStatus({ tone: "idle", text: "Ready to run the next tool test step." });
  }

  const commandItem =
    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[#eef4ea] outline-none aria-selected:bg-[#d9e4cd] aria-selected:text-[#17201d] data-[selected=true]:bg-[#d9e4cd] data-[selected=true]:text-[#17201d]";
  const commandAssetItem =
    "flex aspect-square cursor-pointer items-center justify-center rounded-md p-3 outline-none aria-selected:bg-[#35443d] data-[selected=true]:bg-[#35443d]";
  const commandMeta = "ml-auto flex shrink-0 items-center gap-1.5 text-xs opacity-80";

  return (
    <main className="relative h-full w-full overflow-hidden bg-[#9cb080]">
      <span className="absolute left-3 top-3 z-[3] pl-3 pt-3 font-['Bytesized'] text-2xl leading-none text-[#273338] select-none pointer-events-none">
        townbase
      </span>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden cursor-crosshair [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:touch-none [&_canvas]:cursor-crosshair"
      />
      <ChatPanel messages={state?.chatMessages ?? []} />
      <AgentLogPanel actions={state?.actions ?? []} characters={characters} places={places} />
      {state?.world ? (
        <ModePanel
          mode={mode}
          onSetMode={(nextMode) => void setMode({ mode: nextMode })}
          isRunning={isRunningLlm}
          onRunPopulationStep={() => void handleRunPopulationStep()}
        />
      ) : null}
      {state?.world ? (
        <ToolTestPanel
          plan={toolTestPlan}
          stepIndex={toolTestStepIndex}
          status={toolTestStatus}
          isRunning={isRunningLlm}
          mode={mode}
          onRunStep={() => void handleRunToolTestStep()}
          onReset={resetToolTest}
        />
      ) : null}
      <MetadataPanel
        tile={selectedTile}
        characters={characters}
        onSave={(stableId, label, kind, owner) =>
          void updateTileMetadata({
            stableId,
            label,
            placeKind: kind,
            ownerCharacterId: owner,
          })
        }
      />
      {isBaking || state === undefined ? (
        <div
          className="absolute inset-0 z-[1] grid place-items-center content-center gap-3 text-sm text-[#f7fbf2] pointer-events-none"
          role="status"
          aria-live="polite"
          aria-label="Preparing world"
        >
          <span className="grid h-11 w-11 place-items-center animate-[editor-spinner-spin_0.9s_linear_infinite] motion-reduce:animate-[editor-spinner-spin_1.8s_linear_infinite] [&_svg]:block [&_svg]:h-10 [&_svg]:w-10 [&_svg]:drop-shadow-[0_2px_8px_rgba(23,32,29,0.24)]">
            <SpinnerIcon />
          </span>
          <span>Preparing world...</span>
        </div>
      ) : null}

      <div className="absolute bottom-3 left-3 z-[3] flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1.5 rounded-md bg-[#273338]/88 px-2.5 py-2 text-xs text-[#cdd8c4] shadow-[0_10px_24px_rgba(23,32,29,0.16)] backdrop-blur">
        <Shortcut>{navigator.platform.includes("Mac") ? "Cmd K" : "Ctrl K"}</Shortcut>
        <span>Commands</span>
        <Shortcut>{navigator.platform.includes("Mac") ? "Cmd B" : "Ctrl B"}</Shortcut>
        <span>Place</span>
        <Shortcut>R</Shortcut>
        <span>Remove</span>
        <Shortcut>Q/E</Shortcut>
        <span>Rotate in Place</span>
      </div>

      <Command.Dialog
        open={isCommandOpen}
        onOpenChange={(open) => {
          setIsCommandOpen(open);
          if (!open) {
            setCommandPage("root");
          }
        }}
        label={commandPage === "assets" ? "Assets Store" : "Command palette"}
        className="fixed left-1/2 top-[12vh] z-10 flex max-h-[76vh] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-[#3f4e47] bg-[#273338] text-[#eef4ea] shadow-[0_28px_80px_rgba(23,32,29,0.42)]"
      >
        <div className="flex items-center gap-2 border-b border-[#3f4e47] px-3 py-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            fill="#96a79d"
            viewBox="0 0 256 256"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M168,112a56,56,0,1,1-56-56A56,56,0,0,1,168,112Zm61.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88,88,0,1,1,11.32-11.31l50.06,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z" />
          </svg>
          <Command.Input
            ref={commandSearchRef}
            placeholder={commandPage === "assets" ? "Search assets..." : "Search commands..."}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-[#eef4ea] outline-none placeholder:text-[#96a79d]"
          />
        </div>
        <Command.List className="min-h-0 overflow-auto p-2 scrollbar-none">
          <Command.Empty className="px-3 py-8 text-center text-sm text-[#cdd8c4]">
            No results found.
          </Command.Empty>

          {commandPage === "root" ? (
            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[#96a79d]"
            >
              <Command.Item
                value="place mode assets store asset placement"
                onSelect={togglePlaceMode}
                className={commandItem}
              >
                <span>{tool === "asset" ? "Exit Place mode" : "Place assets"}</span>
                <span className={commandMeta}>
                  <Shortcut>{navigator.platform.includes("Mac") ? "Cmd B" : "Ctrl B"}</Shortcut>
                </span>
              </Command.Item>
              <Command.Item
                value="toggle remove mode delete asset erase"
                onSelect={toggleRemoveModeFromCommand}
                className={commandItem}
              >
                <span>{tool === "remove" ? "Exit Remove mode" : "Toggle Remove mode"}</span>
                <span className={commandMeta}>
                  <Shortcut>R</Shortcut>
                </span>
              </Command.Item>
              <Command.Item
                value="run population auto llm step"
                onSelect={() => {
                  setIsCommandOpen(false);
                  void handleRunPopulationStep();
                }}
                className={commandItem}
              >
                <span>Run LLM population step</span>
              </Command.Item>
              {tool === "asset" ? (
                <>
                  <Command.Item
                    value="rotate placement counterclockwise left"
                    onSelect={() => rotatePlacementFromCommand(-1)}
                    className={commandItem}
                  >
                    <span>Rotate placement counterclockwise</span>
                    <span className={commandMeta}>
                      <Shortcut>Q</Shortcut>
                    </span>
                  </Command.Item>
                  <Command.Item
                    value="rotate placement clockwise right"
                    onSelect={() => rotatePlacementFromCommand(1)}
                    className={commandItem}
                  >
                    <span>Rotate placement clockwise</span>
                    <span className={commandMeta}>
                      <Shortcut>E</Shortcut>
                    </span>
                  </Command.Item>
                </>
              ) : null}
              <Command.Item
                value="copy selected asset id slug"
                onSelect={copySelectedAssetId}
                className={commandItem}
              >
                <span>Copy selected asset id</span>
                {selectedAsset ? (
                  <span className="ml-auto max-w-[42%] truncate text-xs opacity-80">
                    {selectedAsset.id}
                  </span>
                ) : null}
              </Command.Item>
            </Command.Group>
          ) : (
            <Command.Group className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-4 [&_[cmdk-group-items]]:gap-2">
              {placeableAssets.map((asset) => (
                <Command.Item
                  key={asset.id}
                  value={`${asset.label} ${asset.id} ${asset.category} ${asset.pack}`}
                  onSelect={() => selectAsset(asset.id)}
                  className={`${commandAssetItem} ${selectedAssetId === asset.id ? "bg-[#d9e4cd]" : ""}`}
                >
                  <img
                    src={asset.previewUrl}
                    alt={asset.label}
                    className="h-[56%] w-[56%] object-contain"
                    loading="lazy"
                  />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command.Dialog>
    </main>
  );
}

export function App() {
  return <MovementRoute />;
}
