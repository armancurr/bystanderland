import * as EasyStar from "easystarjs";
import type { BakedPlaceableSprites, SpriteFootprint } from "./placeable-sprite-baker";
import { placeableAssetsById, placeableSpriteKey, type PlacedTile } from "./placed-assets";

export const GRID_COLS = 40;
export const GRID_ROWS = 40;
export const PLAYER_START_CELL: GridCell = { col: 20, row: 20 };

export type GridCell = {
  col: number;
  row: number;
};

export type WorldPlace = {
  id: string;
  kind: "home_or_building" | "work_site" | "nature_spot" | "road_patrol";
  label: string;
  entryCell: GridCell;
  tileId?: string;
};

export type WorldModel = {
  cols: number;
  rows: number;
  blockedCellKeys: Set<string>;
  occupiedCellKeys: Set<string>;
  home: WorldPlace;
  places: Record<WorldPlace["kind"], WorldPlace>;
};

export type ActionResult = { success: true; message?: string } | { success: false; reason: string };

export function cellKey(cell: GridCell) {
  return `${cell.col}:${cell.row}`;
}

export function isGridCellInBounds(cell: GridCell) {
  return cell.col >= 0 && cell.col < GRID_COLS && cell.row >= 0 && cell.row < GRID_ROWS;
}

export function footprintStart(cell: GridCell, footprint: SpriteFootprint): GridCell {
  return {
    col: Math.round(cell.col - (footprint.cols - 1) / 2),
    row: Math.round(cell.row - (footprint.rows - 1) / 2),
  };
}

export function footprintCells(cell: GridCell, footprint: SpriteFootprint) {
  const start = footprintStart(cell, footprint);
  const cells: GridCell[] = [];

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

export function getPlacedTileFootprint(
  tile: PlacedTile,
  sprites: BakedPlaceableSprites,
): SpriteFootprint {
  return (
    sprites.sprites.get(placeableSpriteKey(tile.assetId, tile.rotation))?.footprint ?? {
      cols: 1,
      rows: 1,
    }
  );
}

export function placedTileCells(tile: PlacedTile, sprites: BakedPlaceableSprites) {
  return footprintCells({ col: tile.col, row: tile.row }, getPlacedTileFootprint(tile, sprites));
}

export function containsCell(
  tile: PlacedTile,
  sprites: BakedPlaceableSprites,
  col: number,
  row: number,
) {
  return placedTileCells(tile, sprites).some((cell) => cell.col === col && cell.row === row);
}

export function tileAtCell(
  tiles: PlacedTile[],
  sprites: BakedPlaceableSprites,
  col: number,
  row: number,
) {
  return tiles.find((tile) => containsCell(tile, sprites, col, row));
}

export function cellsAreInBounds(cells: GridCell[]) {
  return cells.every(isGridCellInBounds);
}

export function intersectsPlacedTile(
  cells: GridCell[],
  placedTile: PlacedTile,
  sprites: BakedPlaceableSprites,
) {
  const occupied = new Set(placedTileCells(placedTile, sprites).map(cellKey));
  return cells.some((cell) => occupied.has(cellKey(cell)));
}

export function blockedMovementCellKeys(placedTiles: PlacedTile[], sprites: BakedPlaceableSprites) {
  const blocked = new Set<string>();

  for (const tile of placedTiles) {
    const asset = placeableAssetsById.get(tile.assetId);
    if (asset?.category === "road") {
      continue;
    }

    for (const cell of placedTileCells(tile, sprites)) {
      blocked.add(cellKey(cell));
    }
  }

  return blocked;
}

export function occupiedCellKeys(placedTiles: PlacedTile[], sprites: BakedPlaceableSprites) {
  const occupied = new Set<string>();

  for (const tile of placedTiles) {
    for (const cell of placedTileCells(tile, sprites)) {
      occupied.add(cellKey(cell));
    }
  }

  return occupied;
}

function adjacentCells(cell: GridCell) {
  return [
    { col: cell.col, row: cell.row - 1 },
    { col: cell.col + 1, row: cell.row },
    { col: cell.col, row: cell.row + 1 },
    { col: cell.col - 1, row: cell.row },
  ].filter(isGridCellInBounds);
}

function nearestWalkableCell(target: GridCell, blocked: Set<string>) {
  if (isGridCellInBounds(target) && !blocked.has(cellKey(target))) {
    return target;
  }

  for (let radius = 1; radius < Math.max(GRID_COLS, GRID_ROWS); radius += 1) {
    for (let col = target.col - radius; col <= target.col + radius; col += 1) {
      for (let row = target.row - radius; row <= target.row + radius; row += 1) {
        const cell = { col, row };
        if (isGridCellInBounds(cell) && !blocked.has(cellKey(cell))) {
          return cell;
        }
      }
    }
  }

  return target;
}

function homeCandidate(placedTiles: PlacedTile[]) {
  return (
    placedTiles.find((tile) => {
      const asset = placeableAssetsById.get(tile.assetId);
      return asset?.pack === "suburban" && asset.category === "building";
    }) ??
    placedTiles.find((tile) => {
      const asset = placeableAssetsById.get(tile.assetId);
      return asset?.category === "building";
    })
  );
}

function placeEntryCell(tile: PlacedTile, blocked: Set<string>) {
  const center = { col: tile.col, row: tile.row };
  const adjacent = adjacentCells(center).find((cell) => !blocked.has(cellKey(cell)));
  return adjacent ?? nearestWalkableCell(center, blocked);
}

function firstTileMatching(
  placedTiles: PlacedTile[],
  predicate: (asset: NonNullable<ReturnType<typeof placeableAssetsById.get>>) => boolean,
) {
  return placedTiles.find((tile) => {
    const asset = placeableAssetsById.get(tile.assetId);
    return asset ? predicate(asset) : false;
  });
}

function fallbackOpenEdgeCell(blocked: Set<string>) {
  const candidates: GridCell[] = [
    { col: 4, row: 4 },
    { col: GRID_COLS - 5, row: 4 },
    { col: 4, row: GRID_ROWS - 5 },
    { col: GRID_COLS - 5, row: GRID_ROWS - 5 },
  ];
  return (
    candidates.find((cell) => !blocked.has(cellKey(cell))) ??
    nearestWalkableCell(candidates[0], blocked)
  );
}

function worldPlace(
  kind: WorldPlace["kind"],
  label: string,
  tile: PlacedTile | undefined,
  fallback: GridCell,
  blocked: Set<string>,
): WorldPlace {
  if (!tile) {
    return {
      id: kind,
      kind,
      label: `Fallback ${label}`,
      entryCell: nearestWalkableCell(fallback, blocked),
    };
  }

  return {
    id: kind,
    kind,
    label: placeableAssetsById.get(tile.assetId)?.label ?? label,
    entryCell: placeEntryCell(tile, blocked),
    tileId: tile.id,
  };
}

export function buildWorldModel(placedTiles: PlacedTile[], sprites: BakedPlaceableSprites) {
  const blocked = blockedMovementCellKeys(placedTiles, sprites);
  const homeTile = homeCandidate(placedTiles);
  const fallbackHome = nearestWalkableCell(PLAYER_START_CELL, blocked);
  const workTile = firstTileMatching(
    placedTiles,
    (asset) =>
      asset.category === "building" && (asset.pack === "commercial" || asset.pack === "industrial"),
  );
  const natureTile = firstTileMatching(placedTiles, (asset) => asset.category === "nature");
  const roadTile = firstTileMatching(placedTiles, (asset) => asset.category === "road");
  const places: WorldModel["places"] = {
    home_or_building: worldPlace("home_or_building", "home", homeTile, fallbackHome, blocked),
    work_site: worldPlace("work_site", "work site", workTile, { col: 20, row: 20 }, blocked),
    nature_spot: worldPlace(
      "nature_spot",
      "nature spot",
      natureTile,
      fallbackOpenEdgeCell(blocked),
      blocked,
    ),
    road_patrol: worldPlace("road_patrol", "road patrol", roadTile, { col: 21, row: 20 }, blocked),
  };

  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    blockedCellKeys: blocked,
    occupiedCellKeys: occupiedCellKeys(placedTiles, sprites),
    home: places.home_or_building,
    places,
  } satisfies WorldModel;
}

export function findGridPath(start: GridCell, target: GridCell, world: WorldModel) {
  return new Promise<GridCell[] | null>((resolve) => {
    const grid: number[][] = [];
    for (let row = 0; row < world.rows; row += 1) {
      const gridRow: number[] = [];
      for (let col = 0; col < world.cols; col += 1) {
        gridRow.push(world.blockedCellKeys.has(cellKey({ col, row })) ? 1 : 0);
      }
      grid.push(gridRow);
    }

    const finder = new EasyStar.js();
    finder.setGrid(grid);
    finder.setAcceptableTiles([0]);
    finder.disableDiagonals();
    finder.findPath(start.col, start.row, target.col, target.row, (path) => {
      resolve(path?.map((cell) => ({ col: cell.x, row: cell.y })) ?? null);
    });
    finder.calculate();
  });
}
