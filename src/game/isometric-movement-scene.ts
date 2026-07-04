import Phaser from "phaser";
import {
  GRID_COLS,
  GRID_ROWS,
  PLAYER_START_CELL,
  blockedMovementCellKeys,
  cellKey,
  footprintStart,
  isGridCellInBounds,
  occupiedCellKeys,
  type ActionResult,
  type GridCell,
} from "./grid-world";
import type { CellClickAction, MovementSceneData } from "./movement-game-config";
import type { BakedPlaceableSprite, SpriteFootprint } from "./placeable-sprite-baker";
import { placeableSpriteKey, type PlacedTile, type TileRotation } from "./placed-assets";

const TILE_WIDTH = 128;
const TILE_HEIGHT = 64;
const BG_COLOR = "#9CB080";
const LAND_COLOR = 0x9cb080;
const OCCUPIED_LAND_COLOR = 0xffffff;
const OCCUPIED_LAND_ALPHA = 0.55;
const GRID_LINE_COLOR = 0x000000;
const GRID_LINE_ALPHA = 0.28;
const VALID_PREVIEW_COLOR = 0x6ee07f;
const INVALID_PREVIEW_COLOR = 0xef4c42;
const REMOVE_PREVIEW_COLOR = 0xf2b84b;
const PREVIEW_FILL_ALPHA = 0.34;
const PREVIEW_LINE_ALPHA = 0.9;
const VALID_ASSET_PREVIEW_ALPHA = 0.72;
const INVALID_ASSET_PREVIEW_ALPHA = 0.48;
const ASSET_PREVIEW_DEPTH_OFFSET = 0.5;
const CAMERA_DRAG_THRESHOLD = 4;
const LAND_DEPTH = -3000;
const PLACEMENT_PREVIEW_DEPTH = -2500;
const ASSET_DEPTH_BASE = -1000;
const PLAYER_MOVE_MS = 300;
const PLAYER_SCALE = 0.1;
const DEFAULT_PLAYER_ROTATION: TileRotation = 180;

type SceneCharacter = {
  id: string;
  name: string;
  cell: GridCell;
  rotation: TileRotation;
  sprite: Phaser.GameObjects.Image;
  tween?: Phaser.Tweens.Tween;
  tweenResolve?: (result: ActionResult) => void;
};

export class IsometricMovementScene extends Phaser.Scene {
  private origin = new Phaser.Math.Vector2(0, 0);
  private placedTiles: PlacedTile[] = [];
  private landGraphics?: Phaser.GameObjects.Graphics;
  private placementPreviewGraphics?: Phaser.GameObjects.Graphics;
  private placementPreviewAsset?: Phaser.GameObjects.Image;
  private placedAssetGroup?: Phaser.GameObjects.Group;
  private hoveredCell: { col: number; row: number } | null = null;
  private activeDragPointerId: number | null = null;
  private isCameraDragging = false;
  private dragStart = new Phaser.Math.Vector2(0, 0);
  private lastDragPointer = new Phaser.Math.Vector2(0, 0);
  private characters = new Map<string, SceneCharacter>();

  constructor() {
    super("isometric-movement-scene");
  }

  create() {
    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;

    this.cameras.main.setBackgroundColor(BG_COLOR);

    const worldWidth = (GRID_COLS + GRID_ROWS) * (TILE_WIDTH / 2);
    const worldHeight = (GRID_COLS + GRID_ROWS) * (TILE_HEIGHT / 2);
    this.origin.set(worldWidth / 2, TILE_HEIGHT);

    this.cameras.main.setBounds(
      -worldWidth * 0.15,
      -TILE_HEIGHT * 2,
      worldWidth * 1.3,
      worldHeight + TILE_HEIGHT * 4,
    );

    this.drawLand();
    this.registerPlaceableTextures(data);
    this.registerCharacterTextures(data);
    this.placedTiles = data?.placedTiles ?? [];
    this.placedAssetGroup = this.add.group();
    this.drawPlacedAssets();
    this.createCharacters();
    this.cameras.main.centerOn(this.origin.x, this.origin.y + worldHeight * 0.35);
    this.createPointerControls();
    this.createKeyboardControls();
  }

  setPlacedTiles(placedTiles: PlacedTile[]) {
    this.placedTiles = placedTiles;
    this.stopAllCharacterMovement();
    // Sprites can be baked/loaded lazily after the scene was created (e.g.
    // the user just placed an asset that hadn't been baked yet), so make
    // sure any newly available textures get registered before redrawing.
    this.registerPlaceableTextures(
      this.registry.get("movementSceneData") as MovementSceneData | undefined,
    );
    this.drawLand();
    if (!this.placedAssetGroup) {
      return;
    }
    this.drawPlacedAssets();
    this.refreshPlacementPreview();
  }

  refreshPlacementPreview() {
    this.registerPlaceableTextures(
      this.registry.get("movementSceneData") as MovementSceneData | undefined,
    );
    this.drawPlacementPreview(this.hoveredCell);
  }

  getCharacterCell(id: string): GridCell | null {
    const character = this.characters.get(id);
    return character ? { ...character.cell } : null;
  }

  isCharacterMoving(id: string) {
    return Boolean(this.characters.get(id)?.tween?.isPlaying());
  }

  stopAllCharacterMovement() {
    for (const character of this.characters.values()) {
      if (!character.tween) {
        continue;
      }

      character.tween.stop();
      character.tween = undefined;
      character.tweenResolve?.({ success: false, reason: "Movement stopped." });
      character.tweenResolve = undefined;
      const position = this.gridToScreen(character.cell.col, character.cell.row);
      character.sprite.setPosition(position.x, position.y);
      this.updateCharacterDepth(character);
    }
  }

  async moveCharacterAlongPath(id: string, path: GridCell[]): Promise<ActionResult> {
    const character = this.characters.get(id);
    if (!character) {
      return { success: false, reason: "Character sprite is not ready." };
    }

    if (path.length <= 1) {
      return { success: true, message: "Already at target." };
    }

    for (const step of path.slice(1)) {
      const result = await this.moveCharacterToAdjacentCell(character, step);
      if (!result.success) {
        return result;
      }
    }

    return { success: true, message: "Arrived." };
  }

  private registerPlaceableTextures(data: MovementSceneData | undefined) {
    if (!data) {
      return;
    }

    for (const [key, sprite] of data.placeableSprites.sprites) {
      if (!this.textures.exists(key)) {
        this.textures.addCanvas(key, sprite.canvas);
      }
    }
  }

  private registerCharacterTextures(data: MovementSceneData | undefined) {
    if (!data) {
      return;
    }

    for (const character of data.characters) {
      for (const [rotation, sprite] of character.sprites) {
        const key = this.characterTextureKey(character.id, rotation as TileRotation);
        if (!this.textures.exists(key)) {
          this.textures.addCanvas(key, sprite.canvas);
        }
      }
    }
  }

  private createPointerControls() {
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUpOutside, this);
    this.input.on("gameout", this.clearPlacementPreview, this);
  }

  private createKeyboardControls() {
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const direction = this.keyDirection(event.key);
      if (!direction) {
        return;
      }

      event.preventDefault();
      this.moveCharacterBy("aria", direction.col, direction.row);
    });
  }

  private keyDirection(key: string) {
    if (key === "ArrowUp" || key.toLowerCase() === "w") {
      return { col: 0, row: -1 };
    }

    if (key === "ArrowDown" || key.toLowerCase() === "s") {
      return { col: 0, row: 1 };
    }

    if (key === "ArrowLeft" || key.toLowerCase() === "a") {
      return { col: -1, row: 0 };
    }

    if (key === "ArrowRight" || key.toLowerCase() === "d") {
      return { col: 1, row: 0 };
    }

    return null;
  }

  private directionToRotation(deltaCol: number, deltaRow: number): TileRotation {
    if (deltaRow < 0) {
      return 180;
    }

    if (deltaCol > 0) {
      return 90;
    }

    if (deltaRow > 0) {
      return 0;
    }

    return 270;
  }

  private characterTextureKey(id: string, rotation: TileRotation) {
    return `character:${id}@${rotation}`;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (this.activeDragPointerId !== null) {
      return;
    }

    this.activeDragPointerId = pointer.id;
    this.isCameraDragging = false;
    this.dragStart.set(pointer.x, pointer.y);
    this.lastDragPointer.copy(this.dragStart);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.activeDragPointerId === null || !pointer.isDown) {
      this.updatePlacementPreview(pointer);
      return;
    }

    if (this.activeDragPointerId !== pointer.id) {
      return;
    }

    if (!this.isCameraDragging) {
      const distance = Phaser.Math.Distance.Between(
        this.dragStart.x,
        this.dragStart.y,
        pointer.x,
        pointer.y,
      );

      if (distance < CAMERA_DRAG_THRESHOLD) {
        return;
      }

      this.isCameraDragging = true;
      this.clearPlacementPreview();
    }

    const deltaX = pointer.x - this.lastDragPointer.x;
    const deltaY = pointer.y - this.lastDragPointer.y;
    this.cameras.main.scrollX -= deltaX / this.cameras.main.zoom;
    this.cameras.main.scrollY -= deltaY / this.cameras.main.zoom;
    this.lastDragPointer.set(pointer.x, pointer.y);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.activeDragPointerId !== pointer.id) {
      return;
    }

    const wasDragging = this.isCameraDragging;
    this.activeDragPointerId = null;
    this.isCameraDragging = false;

    if (wasDragging) {
      this.updatePlacementPreview(pointer);
      return;
    }

    const action = this.cellClickAction(pointer);
    if (!action) {
      return;
    }

    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    const cell = this.screenToGrid(pointer);
    if (!cell || !data) {
      return;
    }

    data.onCellClick(cell.col, cell.row, action);
  }

  private cellClickAction(pointer: Phaser.Input.Pointer): CellClickAction | null {
    if (pointer.rightButtonReleased()) {
      return "erase";
    }

    if (pointer.leftButtonReleased()) {
      return "place";
    }

    return null;
  }

  private handlePointerUpOutside(pointer: Phaser.Input.Pointer) {
    if (this.activeDragPointerId !== pointer.id) {
      return;
    }

    this.activeDragPointerId = null;
    this.isCameraDragging = false;
    this.clearPlacementPreview();
  }

  private screenToGrid(pointer: Phaser.Input.Pointer) {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const dx = world.x - this.origin.x;
    const dy = world.y - this.origin.y;
    const projectedCol = (dx / (TILE_WIDTH / 2) + dy / (TILE_HEIGHT / 2)) / 2;
    const projectedRow = (dy / (TILE_HEIGHT / 2) - dx / (TILE_WIDTH / 2)) / 2;
    const col = Math.floor(projectedCol + 0.5);
    const row = Math.floor(projectedRow + 0.5);

    if (!this.isInBounds(col, row)) {
      return null;
    }

    return { col, row };
  }

  private isInBounds(col: number, row: number) {
    return isGridCellInBounds({ col, row });
  }

  private gridToScreen(col: number, row: number) {
    return new Phaser.Math.Vector2(
      this.origin.x + (col - row) * (TILE_WIDTH / 2),
      this.origin.y + (col + row) * (TILE_HEIGHT / 2),
    );
  }

  private footprintStart(col: number, row: number, footprint: SpriteFootprint) {
    return footprintStart({ col, row }, footprint);
  }

  private footprintCenter(col: number, row: number, footprint: SpriteFootprint) {
    const start = this.footprintStart(col, row, footprint);
    return {
      col: start.col + (footprint.cols - 1) / 2,
      row: start.row + (footprint.rows - 1) / 2,
    };
  }

  private assetDepth(tile: Pick<PlacedTile, "col" | "row">, sprite: BakedPlaceableSprite) {
    const start = this.footprintStart(tile.col, tile.row, sprite.footprint);
    return (
      ASSET_DEPTH_BASE +
      start.col +
      sprite.footprint.cols -
      1 +
      start.row +
      sprite.footprint.rows -
      1
    );
  }

  private assetScreenPosition(tile: Pick<PlacedTile, "col" | "row">, sprite: BakedPlaceableSprite) {
    const centerCell = this.footprintCenter(tile.col, tile.row, sprite.footprint);
    return this.gridToScreen(centerCell.col, centerCell.row);
  }

  private placeAssetImage(
    image: Phaser.GameObjects.Image,
    tile: Pick<PlacedTile, "col" | "row">,
    sprite: BakedPlaceableSprite,
    textureKey: string,
    scale: number,
    depthOffset = 0,
  ) {
    const position = this.assetScreenPosition(tile, sprite);
    return image
      .setTexture(textureKey)
      .setPosition(position.x, position.y)
      .setOrigin(sprite.originX / sprite.canvas.width, sprite.originY / sprite.canvas.height)
      .setScale(scale)
      .setDepth(this.assetDepth(tile, sprite) + depthOffset);
  }

  private occupiedCellKeys(data: MovementSceneData | undefined) {
    return data ? occupiedCellKeys(this.placedTiles, data.placeableSprites) : new Set<string>();
  }

  private blockedMovementCellKeys(data: MovementSceneData | undefined) {
    return data ? blockedMovementCellKeys(this.placedTiles, data.placeableSprites) : new Set();
  }

  private createCharacters() {
    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    if (!data) {
      return;
    }

    this.characters.clear();
    const reserved = new Set<string>();
    data.characters.forEach((characterConfig, index) => {
      const rotation = DEFAULT_PLAYER_ROTATION;
      const characterSprite = characterConfig.sprites.get(rotation);
      const textureKey = this.characterTextureKey(characterConfig.id, rotation);
      if (!characterSprite || !this.textures.exists(textureKey)) {
        return;
      }

      const cell = this.firstAvailableCharacterCell(data, index, reserved);
      reserved.add(cellKey(cell));
      const position = this.gridToScreen(cell.col, cell.row);
      const scale = (TILE_WIDTH / data.placeableSprites.diamondPx) * PLAYER_SCALE;
      const sprite = this.add
        .image(position.x, position.y, textureKey)
        .setOrigin(
          characterSprite.originX / characterSprite.canvas.width,
          characterSprite.originY / characterSprite.canvas.height,
        )
        .setScale(scale);
      const character: SceneCharacter = {
        id: characterConfig.id,
        name: characterConfig.name,
        cell,
        rotation,
        sprite,
      };
      this.characters.set(character.id, character);
      this.updateCharacterDepth(character);
    });
  }

  private firstAvailableCharacterCell(
    data: MovementSceneData,
    index: number,
    reserved: Set<string>,
  ) {
    const blocked = this.blockedMovementCellKeys(data);
    const preferred = {
      col: PLAYER_START_CELL.col + index - 1,
      row: PLAYER_START_CELL.row + Math.abs(index - 1),
    };
    if (
      this.isInBounds(preferred.col, preferred.row) &&
      !blocked.has(cellKey(preferred)) &&
      !reserved.has(cellKey(preferred))
    ) {
      return preferred;
    }

    if (!blocked.has(cellKey(PLAYER_START_CELL)) && !reserved.has(cellKey(PLAYER_START_CELL))) {
      return { ...PLAYER_START_CELL };
    }

    for (let radius = 1; radius < Math.max(GRID_COLS, GRID_ROWS); radius += 1) {
      for (
        let col = PLAYER_START_CELL.col - radius;
        col <= PLAYER_START_CELL.col + radius;
        col += 1
      ) {
        for (
          let row = PLAYER_START_CELL.row - radius;
          row <= PLAYER_START_CELL.row + radius;
          row += 1
        ) {
          if (
            this.isInBounds(col, row) &&
            !blocked.has(cellKey({ col, row })) &&
            !reserved.has(cellKey({ col, row }))
          ) {
            return { col, row };
          }
        }
      }
    }

    return { ...PLAYER_START_CELL };
  }

  private moveCharacterBy(id: string, deltaCol: number, deltaRow: number) {
    const character = this.characters.get(id);
    if (!character || character.tween?.isPlaying()) {
      return;
    }

    const nextRotation = this.directionToRotation(deltaCol, deltaRow);
    const nextCell = {
      col: character.cell.col + deltaCol,
      row: character.cell.row + deltaRow,
    };
    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    if (
      !data ||
      !this.isInBounds(nextCell.col, nextCell.row) ||
      this.blockedMovementCellKeys(data).has(cellKey(nextCell))
    ) {
      return;
    }

    this.setCharacterRotation(character, nextRotation);
    void this.tweenCharacterToCell(character, nextCell);
  }

  private moveCharacterToAdjacentCell(character: SceneCharacter, nextCell: GridCell) {
    if (character.tween?.isPlaying()) {
      return Promise.resolve({ success: false, reason: "Character is already moving." } as const);
    }

    const deltaCol = nextCell.col - character.cell.col;
    const deltaRow = nextCell.row - character.cell.row;
    const isAdjacent = Math.abs(deltaCol) + Math.abs(deltaRow) === 1;
    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    if (!isAdjacent) {
      return Promise.resolve({ success: false, reason: "Next path step is not adjacent." } as const);
    }

    if (
      !data ||
      !this.isInBounds(nextCell.col, nextCell.row) ||
      this.blockedMovementCellKeys(data).has(cellKey(nextCell))
    ) {
      return Promise.resolve({ success: false, reason: "Next path step is blocked." } as const);
    }

    this.setCharacterRotation(character, this.directionToRotation(deltaCol, deltaRow));
    return this.tweenCharacterToCell(character, nextCell);
  }

  private tweenCharacterToCell(character: SceneCharacter, nextCell: GridCell) {
    return new Promise<ActionResult>((resolve) => {
      if (!character.sprite) {
        resolve({ success: false, reason: "Character sprite is not ready." });
        return;
      }

      character.cell = nextCell;
      const position = this.gridToScreen(nextCell.col, nextCell.row);
      this.updateCharacterDepth(character);
      character.tween = this.tweens.add({
        targets: character.sprite,
        x: position.x,
        y: position.y,
        duration: PLAYER_MOVE_MS,
        ease: "Sine.easeInOut",
        onComplete: () => {
          character.tween = undefined;
          character.tweenResolve = undefined;
          this.updateCharacterDepth(character);
          resolve({ success: true, message: "Step complete." });
        },
      });
      character.tweenResolve = resolve;
    });
  }

  private updateCharacterDepth(character: SceneCharacter) {
    character.sprite.setDepth(ASSET_DEPTH_BASE + character.cell.col + character.cell.row + 1);
  }

  private setCharacterRotation(character: SceneCharacter, rotation: TileRotation) {
    if (rotation === character.rotation) {
      return;
    }

    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    const characterConfig = data?.characters.find((candidate) => candidate.id === character.id);
    const characterSprite = characterConfig?.sprites.get(rotation);
    const textureKey = this.characterTextureKey(character.id, rotation);
    if (!characterSprite || !this.textures.exists(textureKey)) {
      return;
    }

    character.rotation = rotation;
    character.sprite
      .setTexture(textureKey)
      .setOrigin(
        characterSprite.originX / characterSprite.canvas.width,
        characterSprite.originY / characterSprite.canvas.height,
      );
  }

  private drawPlacedAssets() {
    this.placedAssetGroup?.clear(true, true);

    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    if (!data) {
      return;
    }

    for (const tile of this.placedTiles) {
      const key = placeableSpriteKey(tile.assetId, tile.rotation);
      const bakedSprite = data.placeableSprites.sprites.get(key);
      if (!bakedSprite || !this.textures.exists(key)) {
        continue;
      }

      const sprite = this.placeAssetImage(
        this.add.image(0, 0, key),
        tile,
        bakedSprite,
        key,
        this.assetScale(data),
      );

      this.placedAssetGroup?.add(sprite);
    }
  }

  private drawLand() {
    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    const occupied = this.occupiedCellKeys(data);
    const graphics = this.landGraphics ?? this.add.graphics().setDepth(LAND_DEPTH);
    this.landGraphics = graphics;
    graphics.clear();

    for (let col = 0; col < GRID_COLS; col += 1) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        const isOccupied = occupied.has(`${col}:${row}`);
        graphics.fillStyle(
          isOccupied ? OCCUPIED_LAND_COLOR : LAND_COLOR,
          isOccupied ? OCCUPIED_LAND_ALPHA : 1,
        );
        graphics.fillPoints(this.cellCorners(col, row), true, true);
      }
    }

    graphics.lineStyle(1, GRID_LINE_COLOR, GRID_LINE_ALPHA);
    for (let col = 0; col < GRID_COLS; col += 1) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        graphics.strokePoints(this.cellCorners(col, row), true, true);
      }
    }
  }

  private updatePlacementPreview(pointer: Phaser.Input.Pointer) {
    const cell = this.screenToGrid(pointer);
    this.hoveredCell = cell;
    this.drawPlacementPreview(cell);
  }

  private drawPlacementPreview(cell: { col: number; row: number } | null) {
    const graphics =
      this.placementPreviewGraphics ?? this.add.graphics().setDepth(PLACEMENT_PREVIEW_DEPTH);
    this.placementPreviewGraphics = graphics;
    graphics.clear();

    const data = this.registry.get("movementSceneData") as MovementSceneData | undefined;
    if (!data || !cell) {
      this.clearPlacementPreviewAsset();
      return;
    }

    const preview = data.getPlacementPreview(cell.col, cell.row);
    if (!preview) {
      this.clearPlacementPreviewAsset();
      return;
    }

    const color =
      preview.intent === "remove" && preview.isValid
        ? REMOVE_PREVIEW_COLOR
        : preview.isValid
          ? VALID_PREVIEW_COLOR
          : INVALID_PREVIEW_COLOR;
    graphics.fillStyle(color, PREVIEW_FILL_ALPHA);
    for (const previewCell of preview.cells) {
      graphics.fillPoints(this.cellCorners(previewCell.col, previewCell.row), true, true);
    }

    graphics.lineStyle(3, color, PREVIEW_LINE_ALPHA);
    for (const previewCell of preview.cells) {
      graphics.strokePoints(this.cellCorners(previewCell.col, previewCell.row), true, true);
    }

    this.drawPlacementPreviewAsset(cell, data, preview);
  }

  private clearPlacementPreview() {
    this.hoveredCell = null;
    this.placementPreviewGraphics?.clear();
    this.clearPlacementPreviewAsset();
  }

  private assetScale(data: MovementSceneData) {
    return TILE_WIDTH / data.placeableSprites.diamondPx;
  }

  private drawPlacementPreviewAsset(
    cell: { col: number; row: number },
    data: MovementSceneData,
    preview: ReturnType<MovementSceneData["getPlacementPreview"]>,
  ) {
    if (!preview || preview.intent !== "place" || !preview.textureKey) {
      this.clearPlacementPreviewAsset();
      return;
    }

    const bakedSprite = data.placeableSprites.sprites.get(preview.textureKey);
    if (!bakedSprite || !this.textures.exists(preview.textureKey)) {
      this.clearPlacementPreviewAsset();
      return;
    }

    const image = this.placementPreviewAsset ?? this.add.image(0, 0, preview.textureKey);
    this.placementPreviewAsset = image;
    this.placeAssetImage(
      image,
      cell,
      bakedSprite,
      preview.textureKey,
      this.assetScale(data),
      ASSET_PREVIEW_DEPTH_OFFSET,
    )
      .setVisible(true)
      .setAlpha(preview.isValid ? VALID_ASSET_PREVIEW_ALPHA : INVALID_ASSET_PREVIEW_ALPHA);

    if (preview.isValid) {
      image.clearTint();
    } else {
      image.setTint(INVALID_PREVIEW_COLOR);
    }
  }

  private clearPlacementPreviewAsset() {
    this.placementPreviewAsset?.destroy();
    this.placementPreviewAsset = undefined;
  }

  private cellCorners(col: number, row: number) {
    const center = this.gridToScreen(col, row);
    const top = new Phaser.Math.Vector2(center.x, center.y - TILE_HEIGHT / 2);
    const right = new Phaser.Math.Vector2(center.x + TILE_WIDTH / 2, center.y);
    const bottom = new Phaser.Math.Vector2(center.x, center.y + TILE_HEIGHT / 2);
    const left = new Phaser.Math.Vector2(center.x - TILE_WIDTH / 2, center.y);
    return [top, right, bottom, left];
  }
}
