import { Bank } from "./buildings/bank";
import { Cafe } from "./buildings/cafe";
import { Diner } from "./buildings/diner";
import { Hospital } from "./buildings/hospital";
import { LargeHouse } from "./buildings/large-house";
import { TownHall } from "./buildings/town-hall";
import type { AsciiBlock } from "./types";

const MAP_WIDTH = 100;
const MAP_HEIGHT = 39;
const INNER_WIDTH = MAP_WIDTH - 4;

type Placement = {
  block: AsciiBlock;
  row: number;
  col: number;
};

const placements: Placement[] = [
  { block: TownHall, row: 2, col: 5 },
  { block: Hospital, row: 2, col: 27 },
  { block: LargeHouse, row: 2, col: 51 },
  { block: Bank, row: 13, col: 3 },
  { block: Cafe, row: 13, col: 43 },
  { block: Diner, row: 25, col: 52 },
];

function createEmptyMap() {
  return Array.from({ length: MAP_HEIGHT }, (_, row) => {
    if (row === 0) {
      return ` .${"~".repeat(INNER_WIDTH)}.`;
    }

    if (row === MAP_HEIGHT - 1) {
      return ` '${"~".repeat(INNER_WIDTH)}'`;
    }

    return ` |${" ".repeat(INNER_WIDTH)}|`;
  });
}

function placeBlock(
  map: string[],
  top: number,
  left: number,
  block: AsciiBlock,
) {
  for (const [rowIndex, row] of block.entries()) {
    const targetRow = top + rowIndex;

    if (targetRow < 0 || targetRow >= map.length) {
      continue;
    }

    const chars = map[targetRow].split("");

    for (const [colIndex, char] of [...row].entries()) {
      const targetCol = left + colIndex;

      if (targetCol > 0 && targetCol < MAP_WIDTH - 1) {
        chars[targetCol] = char;
      }
    }

    map[targetRow] = chars.join("");
  }
}

export function buildMap() {
  const map = createEmptyMap();

  for (const placement of placements) {
    placeBlock(map, placement.row, placement.col, placement.block);
  }

  return map;
}

export const MAP = buildMap();
