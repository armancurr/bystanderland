import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import Phaser from "phaser";
import {
  buildWorldModel,
  cellsAreInBounds,
  containsCell,
  footprintCells,
  getPlacedTileFootprint,
  intersectsPlacedTile,
  tileAtCell,
  type WorldModel,
} from "./game/grid-world";
import {
  createAgentBrainController,
  type ChatMessage,
} from "./game/agent-brain";
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
const DEFAULT_TILE_ROTATION: TileRotation = 180;
const PLAYER_ROTATIONS: TileRotation[] = [0, 90, 180, 270];

type CharacterConfig = {
  id: string;
  name: string;
  asset: PlaceableAsset;
};

const CHARACTER_CONFIGS: CharacterConfig[] = [
  {
    id: "aria",
    name: "Aria",
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
    name: "Milo",
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
    name: "Nora",
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

type EditorTool = "explore" | "asset" | "remove";
type CommandPage = "root" | "assets";

function isTileRotation(value: unknown): value is TileRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function loadPlacedTiles() {
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
      const col = candidate.col;
      const row = candidate.row;

      return (
        typeof candidate.id === "string" &&
        typeof candidate.assetId === "string" &&
        placeableAssetsById.has(candidate.assetId) &&
        typeof col === "number" &&
        Number.isInteger(col) &&
        typeof row === "number" &&
        Number.isInteger(row) &&
        col >= 0 &&
        col < 40 &&
        row >= 0 &&
        row < 40 &&
        isTileRotation(candidate.rotation)
      );
    });
  } catch {
    return [];
  }
}

function savePlacedTiles(tiles: PlacedTile[]) {
  window.localStorage.setItem(PLACED_TILES_STORAGE_KEY, JSON.stringify(tiles));
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

function rotationLabel(rotation: TileRotation) {
  switch (rotation) {
    case 0:
      return "North";
    case 90:
      return "East";
    case 180:
      return "South";
    case 270:
      return "West";
  }
}

function nextRotation(rotation: TileRotation, direction: 1 | -1) {
  const rotations: TileRotation[] = [0, 90, 180, 270];
  const index = rotations.indexOf(rotation);
  return rotations[(index + direction + rotations.length) % rotations.length];
}

function packLabel(pack: string) {
  return pack
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Shortcut({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-[#53635b] bg-[#1d2724] px-1.5 py-0.5 text-[11px] text-[#cdd8c4]">
      {children}
    </kbd>
  );
}

function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const colorByCharacter: Record<string, string> = {
    aria: "#4cc9f0",
    milo: "#f6a04d",
    nora: "#f7d84a",
  };

  return (
    <section
      className="absolute right-3 top-3 z-[4] flex max-h-[34vh] w-[min(430px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-[#0b1720]/55 bg-[#101820]/78 text-sm text-[#eef4ea] shadow-[0_12px_34px_rgba(5,12,16,0.26)] backdrop-blur"
      aria-label="Character chat"
    >
      <div className="min-h-0 overflow-hidden px-3 py-2">
        {messages.length === 0 ? (
          <p className="text-[#cdd8c4]/70">...</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {messages.map((message) => (
              <li key={message.id} className="min-w-0 leading-5">
                <span
                  className="font-semibold"
                  style={{ color: colorByCharacter[message.fromCharacterId] ?? "#d9e4cd" }}
                >
                  {message.fromName}:
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

function MovementRoute() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const placeableSpritesRef = useRef<BakedPlaceableSprites | null>(null);
  const worldModelRef = useRef<WorldModel | null>(null);
  const brainControllerRef = useRef<ReturnType<typeof createAgentBrainController> | null>(null);
  const selectedAssetIdRef = useRef(placeableAssets[0]?.id ?? "");
  const toolRef = useRef<EditorTool>("explore");
  const rotationRef = useRef<TileRotation>(DEFAULT_TILE_ROTATION);
  const placedTilesRef = useRef<PlacedTile[]>([]);
  const commandSearchRef = useRef<HTMLInputElement | null>(null);
  const [placedTiles, setPlacedTiles] = useState<PlacedTile[]>(loadPlacedTiles);
  const [selectedAssetId, setSelectedAssetId] = useState(selectedAssetIdRef.current);
  const [tool, setTool] = useState<EditorTool>("explore");
  const [rotation, setRotation] = useState<TileRotation>(DEFAULT_TILE_ROTATION);
  const [isBaking, setIsBaking] = useState(true);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandPage, setCommandPage] = useState<CommandPage>("root");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const selectedAsset = placeableAssetsById.get(selectedAssetId) ?? placeableAssets[0];
  const assetsByPack = useMemo(() => {
    const groups = new Map<string, PlaceableAsset[]>();
    for (const asset of placeableAssets) {
      groups.set(asset.pack, [...(groups.get(asset.pack) ?? []), asset]);
    }
    return Array.from(groups);
  }, []);

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
    const container = containerRef.current;
    if (!container) {
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
          return {
            id: character.id,
            name: character.name,
            sprites: new Map<TileRotation, BakedPlaceableSprite>(sprites),
          };
        }),
      ),
    ]).then(([, characters]) => {
      if (disposed) {
        return;
      }

      setChatMessages([]);
      const game = new Phaser.Game(
        createMovementGameConfig(container, {
          placedTiles,
          placeableSprites: store,
          characters,
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
            const rotation = rotationRef.current;
            const sprite = store.sprites.get(placeableSpriteKey(assetId, rotation));
            if (!sprite) {
              return null;
            }

            const cells = footprintCells({ col, row }, sprite.footprint);
            const textureKey = placeableSpriteKey(assetId, rotation);
            return {
              cells,
              isValid:
                cellsAreInBounds(cells) &&
                !placedTilesRef.current.some((tile) => intersectsPlacedTile(cells, tile, store)),
              intent: "place",
              assetId,
              rotation,
              textureKey,
              footprint: sprite.footprint,
            };
          },
          onCellClick: (col, row, action) => {
            if (toolRef.current === "remove") {
              setPlacedTiles((current) =>
                current.filter((tile) => !containsCell(tile, store, col, row)),
              );
              return;
            }

            if (action === "erase" || toolRef.current !== "asset") {
              return;
            }

            const assetId = selectedAssetIdRef.current;
            const asset = placeableAssetsById.get(assetId);
            if (!asset) {
              return;
            }

            const rotation = rotationRef.current;
            void getPlaceableSprite(asset, rotation).then((sprite) => {
              if (disposed) {
                return;
              }

              store.sprites.set(placeableSpriteKey(assetId, rotation), sprite);

              setPlacedTiles((current) => {
                const cells = footprintCells({ col, row }, sprite.footprint);
                if (
                  !cellsAreInBounds(cells) ||
                  current.some((tile) => intersectsPlacedTile(cells, tile, store))
                ) {
                  return current;
                }

                return [
                  ...current,
                  {
                    id: `tile:${col}:${row}`,
                    assetId,
                    col,
                    row,
                    rotation,
                  },
                ];
              });
            });
          },
        }),
      );
      gameRef.current = game;
      worldModelRef.current = buildWorldModel(placedTilesRef.current, store);
      window.setTimeout(() => {
        if (disposed) {
          return;
        }

        const scene = game.scene.getScene("isometric-movement-scene") as
          | IsometricMovementScene
          | undefined;
        const initialAgents = CHARACTER_CONFIGS.map((character) => ({
          id: character.id,
          name: character.name,
          cell: scene?.getCharacterCell(character.id) ?? { col: 20, row: 20 },
        }));
        const brain = createAgentBrainController(initialAgents, {
          getWorld: () => worldModelRef.current,
          getCharacterCell: (id) => scene?.getCharacterCell(id) ?? null,
          moveAlongPath: (id, path) =>
            scene?.moveCharacterAlongPath(id, path) ??
            Promise.resolve({ success: false, reason: "Movement scene is not ready." }),
          onChatMessage: (message) => {
            setChatMessages((current) => [...current.slice(-19), message]);
          },
        });
        brainControllerRef.current = brain;
        brain.start();
      }, 0);
      setIsBaking(false);
    });

    return () => {
      disposed = true;
      brainControllerRef.current?.dispose();
      brainControllerRef.current = null;
      placeableSpritesRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

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
    savePlacedTiles(placedTiles);

    const game = gameRef.current;
    const store = placeableSpritesRef.current;
    if (!game) {
      return;
    }

    const scene = game.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    scene?.setPlacedTiles(placedTiles);
    if (store) {
      worldModelRef.current = buildWorldModel(placedTiles, store);
      brainControllerRef.current?.notifyWorldChanged();
    }
  }, [placedTiles]);

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

  function toggleRemoveModeFromCommand() {
    toggleRemoveMode();
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

  /*
   * Clear map is intentionally hidden because it wipes all persisted local
   * storage state. Keep this here until a safer reset flow exists.
   *
   * function clearMap() {
   *   setPlacedTiles([]);
   * }
   */

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

  const commandItem =
    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[#eef4ea] outline-none aria-selected:bg-[#d9e4cd] aria-selected:text-[#17201d] data-[selected=true]:bg-[#d9e4cd] data-[selected=true]:text-[#17201d]";
  const commandMeta = "ml-auto flex shrink-0 items-center gap-1.5 text-xs opacity-80";

  return (
    <main className="relative h-full w-full overflow-hidden bg-[#9cb080]">
      <span className="absolute left-3 top-3 z-[3] p-3 font-['Bytesized'] text-2xl text-[#273338] select-none pointer-events-none">
        townbase
      </span>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden cursor-crosshair [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:touch-none [&_canvas]:cursor-crosshair"
      />
      <ChatPanel messages={chatMessages} />
      {isBaking ? (
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
          {commandPage === "assets" ? (
            <button
              type="button"
              onClick={() => setCommandPage("root")}
              className="rounded px-2 py-1 text-sm text-[#cdd8c4] hover:bg-[#35443d] hover:text-[#eef4ea]"
            >
              Back
            </button>
          ) : null}
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
            <>
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
              <Command.Group
                heading="Current Selection"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[#96a79d]"
              >
                {selectedAsset ? (
                  <Command.Item
                    value={`${selectedAsset.label} ${selectedAsset.id}`}
                    onSelect={() => setCommandPage("assets")}
                    className={commandItem}
                  >
                    <img
                      src={selectedAsset.previewUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 object-contain"
                    />
                    <span className="min-w-0 flex-1 truncate">{selectedAsset.label}</span>
                    <span className="text-xs opacity-80">Facing {rotationLabel(rotation)}</span>
                  </Command.Item>
                ) : null}
              </Command.Group>
            </>
          ) : (
            assetsByPack.map(([pack, assets]) => (
              <Command.Group
                key={pack}
                heading={packLabel(pack)}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[#96a79d]"
              >
                {assets.map((asset) => (
                  <Command.Item
                    key={asset.id}
                    value={`${asset.label} ${asset.id} ${asset.category} ${asset.pack}`}
                    onSelect={() => selectAsset(asset.id)}
                    className={commandItem}
                  >
                    <img
                      src={asset.previewUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 object-contain"
                      loading="lazy"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{asset.label}</span>
                      <span className="block truncate text-xs opacity-75">{asset.id}</span>
                    </span>
                    {selectedAssetId === asset.id ? (
                      <span className="text-xs font-semibold">Selected</span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ))
          )}
        </Command.List>
      </Command.Dialog>
    </main>
  );
}

export function App() {
  return <MovementRoute />;
}
