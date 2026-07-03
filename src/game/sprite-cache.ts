import {
  bakeSprite,
  createSpriteStore,
  TARGET_DIAMOND_PX,
  type BakedPlaceableSprite,
  type BakedPlaceableSprites,
} from "./placeable-sprite-baker";
import { placeableSpriteKey, type PlaceableAsset, type TileRotation } from "./placed-assets";

// ---------------------------------------------------------------------------
// On-demand placeable sprite resolution.
//
// Sprite resolution is lazy: each (asset, rotation) is baked from its GLB
// model with three.js only when needed (i.e. a placed tile references it,
// or the user selects/places it), and the result is cached in IndexedDB so
// a given browser only ever pays the render cost once, ever.
// ---------------------------------------------------------------------------

const DB_NAME = "townbase-sprite-cache";
const STORE_NAME = "sprites";
// Bump this if the baking output changes shape (camera angle, crop, etc.) to
// invalidate previously cached sprites.
const CACHE_VERSION = "v1";

type CachedSpriteRecord = {
  blob: Blob;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
};

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(undefined);
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });

  return dbPromise;
}

async function readCachedSprite(cacheKey: string): Promise<CachedSpriteRecord | undefined> {
  const db = await openDb();
  if (!db) {
    return undefined;
  }

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(cacheKey);
    request.onsuccess = () => resolve(request.result as CachedSpriteRecord | undefined);
    request.onerror = () => resolve(undefined);
  });
}

async function writeCachedSprite(cacheKey: string, record: CachedSpriteRecord): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record, cacheKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
  });
}

async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire 2D context while restoring cached sprite.");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

// In-memory cache: once a sprite is resolved in this page session (whether
// freshly baked or loaded from IndexedDB) it's kept here for instant reuse.
const memoryCache = new Map<string, BakedPlaceableSprite>();

async function resolveBakedSprite(
  asset: PlaceableAsset,
  rotation: TileRotation,
  cacheKey: string,
): Promise<BakedPlaceableSprite> {
  const cached = await readCachedSprite(cacheKey);
  if (cached) {
    const canvas = await canvasFromBlob(cached.blob);
    return {
      canvas,
      originX: cached.originX,
      originY: cached.originY,
      footprint: { cols: cached.cols, rows: cached.rows },
    };
  }

  const baked = await bakeSprite(asset, rotation);

  const blob = await canvasToBlob(baked.canvas);
  if (blob) {
    void writeCachedSprite(cacheKey, {
      blob,
      originX: baked.originX,
      originY: baked.originY,
      cols: baked.footprint.cols,
      rows: baked.footprint.rows,
    });
  }

  return baked;
}

/**
 * Resolves (baking or loading, as needed) a single placeable sprite, caching
 * it in-memory for the session and in IndexedDB so future sessions in this
 * browser skip baking entirely.
 */
export async function getPlaceableSprite(
  asset: PlaceableAsset,
  rotation: TileRotation,
): Promise<BakedPlaceableSprite> {
  const key = placeableSpriteKey(asset.id, rotation);
  const cached = memoryCache.get(key);
  if (cached) {
    return cached;
  }

  const cacheKey = `${CACHE_VERSION}:${key}`;
  const sprite = await resolveBakedSprite(asset, rotation, cacheKey);

  memoryCache.set(key, sprite);
  return sprite;
}

/**
 * Resolves multiple sprites in parallel and stores them into a
 * BakedPlaceableSprites store (used both for populating a fresh store and
 * for topping up an existing one).
 */
export async function ensurePlaceableSprites(
  store: BakedPlaceableSprites,
  requests: Array<{ asset: PlaceableAsset; rotation: TileRotation }>,
): Promise<void> {
  await Promise.all(
    requests.map(async ({ asset, rotation }) => {
      const key = placeableSpriteKey(asset.id, rotation);
      if (store.sprites.has(key)) {
        return;
      }
      store.sprites.set(key, await getPlaceableSprite(asset, rotation));
    }),
  );
}

export { createSpriteStore, TARGET_DIAMOND_PX };
