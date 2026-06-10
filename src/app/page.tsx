// biome-ignore-all lint/suspicious/noUselessEscapeInString: ASCII art needs literal backslashes.

"use client";

import { useEffect, useRef } from "react";

const MAP = [
  ` .~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.`,
  ` |                                                                                                 |`,
  ` |   .--------------.        ^ ^ ^ ^ ^          .-------------------.                              |`,
  ` |   |  ~~  ~~  ~~  |      ^ ^ ^ ^ ^ ^ ^        |  _           _   |                               |`,
  ` |   |  ~~  ~~  ~~  |      ^ ^  XXXXX  ^ ^       | | |  ___  | | | |                               |`,
  ` |   |   [FORGE]    |      ^ ^  X   X  ^ ^       | |_| |   | |_| | |                               |`,
  ` |   |   (===)      |        ^  XXXXX  ^          |   |_____|     |  |                             |`,
  ` |   |    | |       |        ^  ^ ^ ^  ^          | [=]       [=] |  |                             |`,
  ` |   |____|_|_______|       ^ ^ ^ ^ ^ ^           |___________________|                            |`,
  ` |   ||           ||                              ||        |        ||                            |`,
  ` |   =============||                              =================== |                            |`,
  ` |                                                                                                 |`,
  ` |                                                                                                 |`,
  ` |   /\     /\     /\                    .--------------------------------------.                  |`,
  ` |  /  \   /  \   /  \                   |  $$$   ~~~~~   $$$   ~~~~~   $$$    |                   |`,
  ` | / /\ \ / /\ \ / /\ \                  | [   ] [     ] [   ] [     ] [   ]  |                    |`,
  ` |/  \/  X  \/  X  \/  \                 |                                     |                   |`,
  ` || []  | | []  | | []  ||                |       .-------.                     |                  |`,
  ` || []  | | []  | | []  ||                |       | (~~~) |                     |                  |`,
  ` ||  _  | |  _  | |  _  ||                |       | |-O-| |                     |                  |`,
  ` || [_] | | [_] | | [_] ||                |       | |___| |                     |                  |`,
  ` ||_____|_|_____|_|_____||                |       ~~~~~~~~~                     |                  |`,
  ` |=========================               '--------------------------------------'                 |`,
  ` |                                                                                                 |`,
  ` |                                                                                                 |`,
  ` |      +                                          ^ ^  ^ ^ ^ ^ ^                                  |`,
  ` |    _|_|_                                       ^ ^ ^  ^ ^ ^ ^                                   |`,
  ` |   / === \                                      ^ ^  XXXXXXX  ^ ^                                |`,
  ` |  /  | | \                                      ^ ^  X     X  ^ ^                                |`,
  ` | | .---. |                                         ^  XXXXXXX  ^                                 |`,
  ` | | |   | |                                         ^  ^ ^ ^ ^  ^                                 |`,
  ` | | |(+)| |                                        ^ ^ ^ ^ ^ ^ ^                                  |`,
  ` | |  ---  |                                                                                       |`,
  ` | |_______|                                                                                       |`,
  ` | |  | |  |                                                                                       |`,
  ` | ==========                                                                                      |`,
  ` |                                                                                                 |`,
  ` |                                                                                                 |`,
  ` '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'`,
];

const ZONES = [
  [1, 2, 94],
  [2, 40, 60],
  [3, 40, 60],
  [11, 2, 94],
  [12, 2, 94],
  [23, 2, 94],
  [24, 2, 94],
  [36, 2, 94],
  [37, 2, 94],
  [13, 2, 20],
  [14, 2, 20],
  [15, 2, 20],
  [16, 2, 20],
  [17, 2, 20],
  [18, 2, 20],
  [19, 2, 20],
  [20, 2, 20],
  [13, 68, 92],
  [14, 68, 92],
  [15, 68, 92],
  [16, 68, 92],
  [17, 68, 92],
  [18, 68, 92],
  [19, 68, 92],
  [20, 68, 92],
  [21, 68, 92],
  [25, 2, 42],
  [26, 2, 42],
  [27, 2, 42],
  [28, 2, 42],
  [29, 2, 42],
  [30, 2, 42],
  [31, 2, 42],
  [32, 2, 42],
  [33, 2, 42],
  [25, 55, 92],
  [26, 55, 92],
  [27, 55, 92],
  [28, 55, 92],
  [29, 55, 92],
  [30, 55, 92],
  [31, 55, 92],
  [32, 55, 92],
  [33, 55, 92],
] as const;

const WALK_RIGHT = [
  [" o ", "/|\\", "/ \\"].join("\n"),
  [" o ", "-|-", "/ \\"].join("\n"),
  [" o ", "/|\\", " \\\/"].join("\n"),
];
const WALK_LEFT = [
  [" o ", "/|\\", "/ \\"].join("\n"),
  [" o ", "-|-", "/ \\"].join("\n"),
  [" o ", "/|\\ ", "\\/ "].join("\n"),
];
const STAND = [" o ", "/|\\", "/ \\"].join("\n");

function randZone() {
  const z = ZONES[Math.floor(Math.random() * ZONES.length)];
  return { row: z[0], col: z[1] + Math.floor(Math.random() * (z[2] - z[1])) };
}

export default function Home() {
  const villageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const village = villageRef.current;

    if (!village) {
      return;
    }

    const root = village;
    let charWidth = 7.8;
    let lineHeight = 18.85;
    let animationFrame = 0;
    let last = 0;

    const measure = () => {
      const rect = root.getBoundingClientRect();
      lineHeight = rect.height / MAP.length;
      charWidth = rect.width / MAP[0].length;
    };

    class Villager {
      el: HTMLDivElement;
      row: number;
      col: number;
      tx: number;
      ty: number;
      tick = 0;
      wait = Math.floor(20 + Math.random() * 40);
      moving = false;
      dir = 1;

      constructor() {
        this.el = document.createElement("div");
        this.el.className = "villager";
        root.appendChild(this.el);

        const p = randZone();
        this.row = p.row;
        this.col = p.col;
        this.tx = p.col;
        this.ty = p.row;
        this.place();
      }

      place() {
        this.el.style.left = `${this.col * charWidth}px`;
        this.el.style.top = `${this.row * lineHeight}px`;
      }

      pickTarget() {
        let p = randZone();
        let tries = 0;

        while (
          Math.abs(p.row - this.row) + Math.abs(p.col - this.col) < 4 &&
          tries < 30
        ) {
          p = randZone();
          tries++;
        }

        this.tx = p.col;
        this.ty = p.row;
      }

      step() {
        this.tick++;

        if (!this.moving) {
          this.el.textContent = STAND;

          if (this.tick >= this.wait) {
            this.tick = 0;
            this.moving = true;
            this.pickTarget();
          }

          return;
        }

        const dx = this.tx - this.col;
        const dy = this.ty - this.row;

        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          this.moving = false;
          this.wait = Math.floor(30 + Math.random() * 60);
          this.tick = 0;
          return;
        }

        if (this.tick % 4 === 0) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            this.col += dx > 0 ? 1 : -1;
            this.dir = dx > 0 ? 1 : -1;
          } else {
            this.row += dy > 0 ? 1 : -1;
          }

          this.place();
        }

        const frames = this.dir >= 0 ? WALK_RIGHT : WALK_LEFT;
        this.el.textContent = frames[Math.floor(this.tick / 2) % frames.length];
      }

      remove() {
        this.el.remove();
      }
    }

    measure();
    const villagers = Array.from({ length: 6 }, () => new Villager());

    const loop = (timestamp: number) => {
      if (timestamp - last > 80) {
        last = timestamp;
        measure();
        for (const villager of villagers) {
          villager.step();
        }
      }

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrame);
      for (const villager of villagers) {
        villager.remove();
      }
    };
  }, []);

  return (
    <main className="flex min-h-screen justify-center overflow-x-auto bg-[#0a0a0a] p-8">
      <div
        ref={villageRef}
        className="relative inline-block whitespace-pre font-mono text-[13px] leading-[1.45] text-[#4a4535] [&_.villager]:pointer-events-none [&_.villager]:absolute [&_.villager]:whitespace-pre [&_.villager]:font-mono [&_.villager]:text-[13px] [&_.villager]:leading-[1.45] [&_.villager]:text-[#d4c9a8]"
      >
        {MAP.join("\n")}
      </div>
    </main>
  );
}
