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
  kind: "home";
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

function homeEntryCell(tile: PlacedTile, blocked: Set<string>) {
  const center = { col: tile.col, row: tile.row };
  const adjacent = adjacentCells(center).find((cell) => !blocked.has(cellKey(cell)));
  return adjacent ?? nearestWalkableCell(center, blocked);
}

export function buildWorldModel(placedTiles: PlacedTile[], sprites: BakedPlaceableSprites) {
  const blocked = blockedMovementCellKeys(placedTiles, sprites);
  const homeTile = homeCandidate(placedTiles);
  const fallbackHome = nearestWalkableCell(PLAYER_START_CELL, blocked);

  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    blockedCellKeys: blocked,
    occupiedCellKeys: occupiedCellKeys(placedTiles, sprites),
    home: homeTile
      ? {
          id: "player-home",
          kind: "home",
          label: placeableAssetsById.get(homeTile.assetId)?.label ?? "Home",
          entryCell: homeEntryCell(homeTile, blocked),
          tileId: homeTile.id,
        }
      : {
          id: "player-home",
          kind: "home",
          label: "Fallback home",
          entryCell: fallbackHome,
        },
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
