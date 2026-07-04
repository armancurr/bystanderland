import Phaser from "phaser";
import { IsometricMovementScene } from "./isometric-movement-scene";
import type {
  BakedPlaceableSprite,
  BakedPlaceableSprites,
  SpriteFootprint,
} from "./placeable-sprite-baker";
import type { PlacedTile, TileRotation } from "./placed-assets";

export type CellClickAction = "place" | "erase";

export type PlacementPreview = {
  cells: Array<{ col: number; row: number }>;
  isValid: boolean;
  intent: "place" | "remove";
  assetId?: string;
  rotation?: TileRotation;
  textureKey?: string;
  footprint?: SpriteFootprint;
};

export type MovementSceneData = {
  placedTiles: PlacedTile[];
  placeableSprites: BakedPlaceableSprites;
  characters: Array<{
    id: string;
    name: string;
    sprites: Map<TileRotation, BakedPlaceableSprite>;
  }>;
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
