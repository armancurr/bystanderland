import {
  cellKey,
  findGridPath,
  isGridCellInBounds,
  type ActionResult,
  type GridCell,
  type WorldModel,
} from "./grid-world";

export type PlayerBrainSnapshot = {
  status: "paused" | "idle" | "moving" | "waiting" | "blocked";
  goal: "go_home" | "wander" | "wait";
  action: "none" | "pathfind" | "walk" | "wait";
  targetCell: GridCell | null;
  pathLength: number;
  lastMessage: string;
  isPaused: boolean;
};

export const initialPlayerBrainSnapshot: PlayerBrainSnapshot = {
  status: "idle",
  goal: "go_home",
  action: "none",
  targetCell: null,
  pathLength: 0,
  lastMessage: "Brain ready.",
  isPaused: false,
};

type PlayerBrainControllerOptions = {
  getWorld: () => WorldModel | null;
  getPlayerCell: () => GridCell | null;
  moveAlongPath: (path: GridCell[]) => Promise<ActionResult>;
  onChange: (snapshot: PlayerBrainSnapshot) => void;
};

const THINK_INTERVAL_MS = 1400;
const WAIT_MS = 1200;
const WANDER_RADIUS = 8;

function sameCell(a: GridCell, b: GridCell) {
  return a.col === b.col && a.row === b.row;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function wanderCandidates(origin: GridCell, world: WorldModel) {
  const candidates: GridCell[] = [];

  for (let col = origin.col - WANDER_RADIUS; col <= origin.col + WANDER_RADIUS; col += 1) {
    for (let row = origin.row - WANDER_RADIUS; row <= origin.row + WANDER_RADIUS; row += 1) {
      const cell = { col, row };
      const distance = Math.abs(origin.col - col) + Math.abs(origin.row - row);
      if (distance >= 3 && isGridCellInBounds(cell) && !world.blockedCellKeys.has(cellKey(cell))) {
        candidates.push(cell);
      }
    }
  }

  return candidates;
}

export function createPlayerBrainController(options: PlayerBrainControllerOptions) {
  let snapshot = { ...initialPlayerBrainSnapshot };
  let disposed = false;
  let running = false;
  let timer: number | undefined;
  let nextGoal: PlayerBrainSnapshot["goal"] = "go_home";

  function publish(patch: Partial<PlayerBrainSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    options.onChange(snapshot);
  }

  function setTimer(ms = THINK_INTERVAL_MS) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void tick();
    }, ms);
  }

  async function runMovement(goal: PlayerBrainSnapshot["goal"], targetCell: GridCell) {
    const world = options.getWorld();
    const start = options.getPlayerCell();
    if (!world || !start) {
      publish({
        status: "blocked",
        goal,
        action: "none",
        targetCell,
        pathLength: 0,
        lastMessage: "World or player is not ready.",
      });
      return;
    }

    publish({ status: "moving", goal, action: "pathfind", targetCell, lastMessage: "Planning." });
    const path = await findGridPath(start, targetCell, world);
    if (disposed || snapshot.isPaused) {
      return;
    }

    if (!path || path.length === 0) {
      publish({
        status: "blocked",
        goal,
        action: "none",
        targetCell,
        pathLength: 0,
        lastMessage: "No path to target.",
      });
      return;
    }

    publish({
      status: "moving",
      goal,
      action: "walk",
      targetCell,
      pathLength: Math.max(0, path.length - 1),
      lastMessage: `Walking ${Math.max(0, path.length - 1)} steps.`,
    });
    const result = await options.moveAlongPath(path);
    if (disposed || snapshot.isPaused) {
      return;
    }

    publish({
      status: result.success ? "idle" : "blocked",
      goal,
      action: "none",
      targetCell,
      pathLength: 0,
      lastMessage: result.success ? (result.message ?? "Arrived.") : result.reason,
    });
  }

  async function tick() {
    if (disposed || running || snapshot.isPaused) {
      return;
    }

    running = true;
    try {
      const world = options.getWorld();
      const playerCell = options.getPlayerCell();
      if (!world || !playerCell) {
        publish({ status: "blocked", action: "none", lastMessage: "Waiting for world." });
        return;
      }

      if (nextGoal === "go_home" && !sameCell(playerCell, world.home.entryCell)) {
        await runMovement("go_home", world.home.entryCell);
        nextGoal = "wait";
        return;
      }

      if (nextGoal === "wait") {
        publish({
          status: "waiting",
          goal: "wait",
          action: "wait",
          targetCell: null,
          pathLength: 0,
          lastMessage: "Waiting.",
        });
        await delay(WAIT_MS);
        if (!disposed && !snapshot.isPaused) {
          publish({ status: "idle", action: "none", lastMessage: "Done waiting." });
        }
        nextGoal = "wander";
        return;
      }

      const candidates = wanderCandidates(playerCell, world);
      const targetCell = candidates[Math.floor(Math.random() * candidates.length)];
      if (!targetCell) {
        publish({
          status: "blocked",
          goal: "wander",
          action: "none",
          targetCell: null,
          pathLength: 0,
          lastMessage: "No wander targets.",
        });
        nextGoal = "wait";
        return;
      }

      await runMovement("wander", targetCell);
      nextGoal = "go_home";
    } finally {
      running = false;
      if (!disposed && !snapshot.isPaused) {
        setTimer();
      }
    }
  }

  function start() {
    publish({ isPaused: false, status: "idle", lastMessage: "Brain running." });
    setTimer(200);
  }

  function pause() {
    window.clearTimeout(timer);
    publish({ isPaused: true, status: "paused", action: "none", lastMessage: "Brain paused." });
  }

  function resume() {
    if (disposed) {
      return;
    }

    publish({ isPaused: false, status: "idle", lastMessage: "Brain resumed." });
    setTimer(200);
  }

  function notifyWorldChanged() {
    if (!snapshot.isPaused) {
      publish({ lastMessage: "World changed; replanning soon." });
      setTimer(200);
    }
  }

  function dispose() {
    disposed = true;
    window.clearTimeout(timer);
  }

  return { start, pause, resume, notifyWorldChanged, dispose };
}
