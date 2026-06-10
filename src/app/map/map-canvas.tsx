"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { AsciiBlock } from "../town/types";

type Building = {
  name: string;
  block: AsciiBlock;
};

type MapCanvasProps = {
  buildings: Building[];
};

const CHAR_WIDTH = 8;
const LINE_HEIGHT = 18.85;
const TILE_PADDING_X = 0;
const TILE_PADDING_Y = 0;
const MAP_MARGIN = 60;
const MIN_SCALE = 0.38;
const MAX_SCALE = 2.8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function measureBlock(block: AsciiBlock) {
  return {
    columns: Math.max(1, ...block.map((line) => line.length)),
    rows: Math.max(1, block.length),
  };
}

function buildNodes(buildings: Building[]) {
  const columns = 2;
  const gapX = 0;
  const gapY = 0;
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];
  const measured = buildings.map((building, index) => {
    const { columns: blockColumns, rows } = measureBlock(building.block);
    const width = blockColumns * CHAR_WIDTH;
    const height = rows * LINE_HEIGHT;
    const column = index % columns;
    const row = Math.floor(index / columns);

    columnWidths[column] = Math.max(columnWidths[column], width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);

    return { building, column, height, row, width };
  });

  const columnX = columnWidths.reduce<number[]>((positions, _width, index) => {
    const previous = positions[index - 1] ?? 0;
    const previousWidth = columnWidths[index - 1] ?? 0;
    positions.push(index === 0 ? 0 : previous + previousWidth + gapX);
    return positions;
  }, []);

  const rowY = rowHeights.reduce<number[]>((positions, _height, index) => {
    const previous = positions[index - 1] ?? 0;
    const previousHeight = rowHeights[index - 1] ?? 0;
    positions.push(index === 0 ? 0 : previous + previousHeight + gapY);
    return positions;
  }, []);

  const nodes = measured.map(({ building, column, height, row, width }) => ({
    ...building,
    height,
    width,
    x: MAP_MARGIN + columnX[column],
    y: MAP_MARGIN + rowY[row],
  }));

  const mapWidth =
    MAP_MARGIN * 2 +
    columnX[columnX.length - 1] +
    columnWidths[columnWidths.length - 1];
  const mapHeight =
    MAP_MARGIN * 2 + rowY[rowY.length - 1] + rowHeights[rowHeights.length - 1];

  return { mapHeight, mapWidth, nodes };
}

export function MapCanvas({ buildings }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef({ scale: 0.82, x: 0, y: 0 });
  const dragRef = useRef({ active: false, pointerId: 0, startX: 0, startY: 0 });
  const map = useMemo(() => buildNodes(buildings), [buildings]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;

    if (!canvas || !viewport) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, rect.width, rect.height);

    const { scale, x, y } = transformRef.current;
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);

    for (const node of map.nodes) {
      context.fillStyle = "#ffffff";
      context.font = '13px "IBM Plex Mono", monospace';
      context.textBaseline = "top";
      node.block.forEach((line, index) => {
        context.fillText(
          line,
          node.x + TILE_PADDING_X,
          node.y + TILE_PADDING_Y + index * LINE_HEIGHT,
        );
      });
    }

    context.restore();
  }, [map]);

  const centerMap = useCallback(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const scale = 1;

    transformRef.current = {
      scale,
      x: (rect.width - map.mapWidth * scale) / 2,
      y: (rect.height - map.mapHeight * scale) / 2,
    };
    draw();
  }, [draw, map.mapHeight, map.mapWidth]);

  const zoomAt = useCallback(
    (nextScale: number, originX?: number, originY?: number) => {
      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const current = transformRef.current;
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const focalX = originX ?? rect.width / 2;
      const focalY = originY ?? rect.height / 2;
      const worldX = (focalX - current.x) / current.scale;
      const worldY = (focalY - current.y) / current.scale;

      transformRef.current = {
        scale,
        x: focalX - worldX * scale,
        y: focalY - worldY * scale,
      };
      draw();
    },
    [draw],
  );

  useEffect(() => {
    centerMap();
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(centerMap);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [centerMap]);

  useEffect(() => {
    document.fonts.ready.then(centerMap);
  }, [centerMap]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const direction = event.deltaY > 0 ? 0.9 : 1.1;

      zoomAt(
        transformRef.current.scale * direction,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    [zoomAt],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (!drag.active || drag.pointerId !== event.pointerId) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      transformRef.current = {
        ...transformRef.current,
        x: transformRef.current.x + dx,
        y: transformRef.current.y + dy,
      };
      dragRef.current = {
        ...drag,
        startX: event.clientX,
        startY: event.clientY,
      };
      draw();
    },
    [draw],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current.pointerId === event.pointerId) {
        dragRef.current = { active: false, pointerId: 0, startX: 0, startY: 0 };
      }
    },
    [],
  );

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#070706] px-4 py-4 text-white sm:px-6 sm:py-6">
      <section className="mx-auto flex min-h-0 w-full max-w-[1540px] flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 border border-white/20 bg-black p-3 sm:p-4">
          <div
            className="relative h-full min-h-0 overflow-hidden bg-black"
            ref={viewportRef}
          >
            <canvas
              ref={canvasRef}
              aria-label="Zoomable ASCII map canvas of bystanderland"
              className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
              onPointerCancel={handlePointerUp}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onWheel={handleWheel}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
