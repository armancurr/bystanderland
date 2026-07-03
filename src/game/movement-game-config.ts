import Phaser from "phaser";
import { IsometricMovementScene } from "./isometric-movement-scene";
import type { BakedPlaceableSprites } from "./placeable-sprite-baker";
import type { PlacedTile } from "./placed-assets";

export type CellClickAction = "place" | "erase";

export type PlacementPreview = {
  cells: Array<{ col: number; row: number }>;
  isValid: boolean;
};

export type MovementSceneData = {
  placedTiles: PlacedTile[];
  placeableSprites: BakedPlaceableSprites;
  onCellClick: (col: number, row: number, action: CellClickAction) => void;
  getPlacementPreview: (col: number, row: number) => PlacementPreview | null;
};

export function createMovementGameConfig(
  parent: HTMLElement,
  data: MovementSceneData,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: parent.clientWidth,
    height: parent.clientHeight,
    backgroundColor: "#9CB080",
    disableContextMenu: true,
    scene: [IsometricMovementScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set("movementSceneData", data);
      },
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };
}
