import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { IsometricMovementScene } from "./game/isometric-movement-scene";
import { createMovementGameConfig } from "./game/movement-game-config";
import { createSpriteStore, ensurePlaceableSprites, getPlaceableSprite } from "./game/sprite-cache";
import type { BakedPlaceableSprites, SpriteFootprint } from "./game/placeable-sprite-baker";
import {
  placeableSpriteKey,
  placeableAssets,
  placeableAssetsById,
  type PlaceableAsset,
  type PlacedTile,
  type TileRotation,
} from "./game/placed-assets";

const PLACED_TILES_STORAGE_KEY = "bystanderland:placed-tiles:v1";
const GRID_COLS = 40;
const GRID_ROWS = 40;
const DEFAULT_TILE_ROTATION: TileRotation = 180;

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

function footprintStart(col: number, row: number, footprint: SpriteFootprint) {
  return {
    col: Math.round(col - (footprint.cols - 1) / 2),
    row: Math.round(row - (footprint.rows - 1) / 2),
  };
}

function footprintCells(col: number, row: number, footprint: SpriteFootprint) {
  const start = footprintStart(col, row, footprint);
  const cells: Array<{ col: number; row: number }> = [];

  for (let offsetCol = 0; offsetCol < footprint.cols; offsetCol += 1) {
    for (let offsetRow = 0; offsetRow < footprint.rows; offsetRow += 1) {
      cells.push({
        col: start.col + offsetCol,
        row: start.row + offsetRow,
      });
    }
  }

  return cells;
}

function getPlacedTileFootprint(tile: PlacedTile, sprites: BakedPlaceableSprites): SpriteFootprint {
  return (
    sprites.sprites.get(placeableSpriteKey(tile.assetId, tile.rotation))?.footprint ?? {
      cols: 1,
      rows: 1,
    }
  );
}

function containsCell(tile: PlacedTile, sprites: BakedPlaceableSprites, col: number, row: number) {
  return footprintCells(tile.col, tile.row, getPlacedTileFootprint(tile, sprites)).some(
    (cell) => cell.col === col && cell.row === row,
  );
}

function isInBounds(cells: Array<{ col: number; row: number }>) {
  return cells.every(
    (cell) => cell.col >= 0 && cell.col < GRID_COLS && cell.row >= 0 && cell.row < GRID_ROWS,
  );
}

function intersectsPlacedTile(
  cells: Array<{ col: number; row: number }>,
  placedTile: PlacedTile,
  sprites: BakedPlaceableSprites,
) {
  const occupied = new Set(
    footprintCells(placedTile.col, placedTile.row, getPlacedTileFootprint(placedTile, sprites)).map(
      (cell) => `${cell.col}:${cell.row}`,
    ),
  );

  return cells.some((cell) => occupied.has(`${cell.col}:${cell.row}`));
}

function PanelIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#ffffff"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H88V56H216V200Z" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#ffffff"
      viewBox="0 0 256 256"
    >
      <path d="M88,104H40a8,8,0,0,1-8-8V48a8,8,0,0,1,13.66-5.66L64,60.7a95.42,95.42,0,0,1,66-26.76h.53a95.36,95.36,0,0,1,67.07,27.33,8,8,0,0,1-11.18,11.44,79.52,79.52,0,0,0-55.89-22.77h-.45A79.48,79.48,0,0,0,75.35,72L93.66,90.34A8,8,0,0,1,88,104Zm128,48H168a8,8,0,0,0-5.66,13.66L180.65,184a79.48,79.48,0,0,1-54.72,22.09h-.45a79.52,79.52,0,0,1-55.89-22.77,8,8,0,1,0-11.18,11.44,95.36,95.36,0,0,0,67.07,27.33H126a95.42,95.42,0,0,0,66-26.76l18.36,18.36A8,8,0,0,0,224,208V160A8,8,0,0,0,216,152Z"></path>
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#ffffff"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path d="M216,40H68.53a16.12,16.12,0,0,0-13.72,7.77L9.14,123.88a8,8,0,0,0,0,8.24l45.67,76.11h0A16.11,16.11,0,0,0,68.53,216H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM165.66,146.34a8,8,0,0,1-11.32,11.32L136,139.31l-18.35,18.35a8,8,0,0,1-11.31-11.32L124.69,128l-18.35-18.34a8,8,0,1,1,11.31-11.32L136,116.69l18.34-18.35a8,8,0,0,1,11.32,11.32L147.31,128Z" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="#ffffff"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path d="M224,56a8,8,0,0,1-8,8h-8V208a16,16,0,0,1-16,16H64a16,16,0,0,1-16-16V64H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,56ZM88,32h80a8,8,0,0,0,0-16H88a8,8,0,0,0,0,16Z" />
    </svg>
  );
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

function MovementRoute() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedAssetIdRef = useRef(placeableAssets[0]?.id ?? "");
  const toolRef = useRef<"asset" | "erase">("asset");
  const rotationRef = useRef<TileRotation>(DEFAULT_TILE_ROTATION);
  const [placedTiles, setPlacedTiles] = useState<PlacedTile[]>(loadPlacedTiles);
  const [selectedAssetId, setSelectedAssetId] = useState(selectedAssetIdRef.current);
  const [tool, setTool] = useState<"asset" | "erase">("asset");
  const [rotation, setRotation] = useState<TileRotation>(DEFAULT_TILE_ROTATION);
  const [isBaking, setIsBaking] = useState(true);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

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
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    const store = createSpriteStore();

    // Only bake/load sprites for assets that are already placed on the map
    // (persisted from a previous session), instead of the whole catalog.
    // Anything else gets baked lazily the moment the user actually places it
    // (see onCellClick below), so startup cost no longer scales with the
    // size of the asset catalog.
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

    void ensurePlaceableSprites(store, Array.from(initialRequests.values())).then(() => {
      if (disposed) {
        return;
      }

      const game = new Phaser.Game(
        createMovementGameConfig(container, {
          placedTiles,
          placeableSprites: store,
          onCellClick: (col, row, action) => {
            if (action === "erase" || toolRef.current === "erase") {
              setPlacedTiles((current) =>
                current.filter((tile) => !containsCell(tile, store, col, row)),
              );
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
                const cells = footprintCells(col, row, sprite.footprint);
                if (
                  !isInBounds(cells) ||
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
      setIsBaking(false);
    });

    return () => {
      disposed = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    savePlacedTiles(placedTiles);

    const game = gameRef.current;
    if (!game) {
      return;
    }

    const scene = game.scene.getScene("isometric-movement-scene") as
      | IsometricMovementScene
      | undefined;
    scene?.setPlacedTiles(placedTiles);
  }, [placedTiles]);

  function selectAsset(assetId: string) {
    setSelectedAssetId(assetId);
    setTool("asset");
  }

  function rotateSelection() {
    setRotation((current) => ((current + 90) % 360) as TileRotation);
  }

  function clearMap() {
    setPlacedTiles([]);
  }

  return (
    <main className="movement-shell">
      <div className="editor-logo">
        <span>townbase</span>
        <span className="editor-logo__divider" />
        <a
          href="https://github.com/armancurr/townbase"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
        >
          <svg viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
              transform="scale(64)"
              fill="#eef4ea"
            />
          </svg>
        </a>
      </div>
      <div ref={containerRef} className="movement-viewport" />
      {isBaking ? (
        <div
          className="movement-loading"
          role="status"
          aria-live="polite"
          aria-label="Preparing world"
        >
          <span className="movement-loading__spinner">
            <SpinnerIcon />
          </span>
          <span>Preparing world...</span>
        </div>
      ) : null}
      <aside
        className={`editor-toolbar${isPanelOpen ? "" : " is-collapsed"}`}
        aria-label="Asset placement tools"
      >
        <div className="editor-actions">
          <button
            type="button"
            onClick={() => setIsPanelOpen((current) => !current)}
            title={isPanelOpen ? "Close asset panel" : "Open asset panel"}
            aria-label={isPanelOpen ? "Close asset panel" : "Open asset panel"}
            aria-expanded={isPanelOpen}
          >
            <PanelIcon />
          </button>
          {isPanelOpen ? (
            <>
              <button
                type="button"
                onClick={rotateSelection}
                title="Rotate selection"
                aria-label="Rotate selection"
              >
                <RotateIcon />
              </button>
              <button
                type="button"
                className={tool === "erase" ? "is-active" : ""}
                onClick={() => setTool("erase")}
                title="Erase"
                aria-label="Erase"
              >
                <RemoveIcon />
              </button>
              <button type="button" onClick={clearMap} title="Clear map" aria-label="Clear map">
                <ClearIcon />
              </button>
            </>
          ) : null}
        </div>

        {isPanelOpen ? (
          <div className="editor-pack-list">
            <div className="asset-grid">
              {placeableAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={tool === "asset" && selectedAssetId === asset.id ? "is-active" : ""}
                  onClick={() => selectAsset(asset.id)}
                  title={asset.label}
                >
                  <img src={asset.previewUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </main>
  );
}

export function App() {
  return <MovementRoute />;
}
