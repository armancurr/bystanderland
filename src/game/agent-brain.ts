import {
  cellKey,
  findGridPath,
  isGridCellInBounds,
  type ActionResult,
  type GridCell,
  type WorldModel,
} from "./grid-world";

export type CharacterActivity = "idle" | "moving" | "wandering" | "talking" | "waiting";

export type CharacterAgentState = {
  id: string;
  name: string;
  cell: GridCell;
  activity: CharacterActivity;
  conversationId: string | null;
  lastSpokeAt: number;
};

export type ChatMessage = {
  id: string;
  fromCharacterId: string;
  fromName: string;
  target: "all" | string[];
  text: string;
  createdAt: number;
};

export type ConversationState = {
  id: string;
  participantIds: string[];
  speakerIndex: number;
  turnCount: number;
  lastMessageAt: number;
};

export type AgentActionId =
  | "wander"
  | "move_to_cell"
  | "move_near_character"
  | "say"
  | "wait"
  | "leave_conversation";

export type AgentDecision = {
  actionId: AgentActionId;
  reason: string;
  targetCell?: GridCell;
  targetCharacterId?: string;
  message?: string;
  target?: "all" | string[];
};

type AgentBrainControllerOptions = {
  getWorld: () => WorldModel | null;
  getCharacterCell: (id: string) => GridCell | null;
  moveAlongPath: (id: string, path: GridCell[]) => Promise<ActionResult>;
  onChatMessage: (message: ChatMessage) => void;
};

const THINK_INTERVAL_MS = 2200;
const WAIT_MS = 900;
const WANDER_RADIUS = 7;
const TALK_DISTANCE = 3;
const MAX_CONVERSATION_TURNS = 8;
const CONVERSATION_IDLE_MS = 12000;
const SPEAK_COOLDOWN_MS = 1600;

const conversationLines = [
  "Hey @all, what are you looking at?",
  "@all I am going to wander around.",
  "This place is starting to feel busy.",
  "@all Let's stay close for a bit.",
  "I found a clear path over here.",
  "@all I will keep moving soon.",
];

function sameCell(a: GridCell, b: GridCell) {
  return a.col === b.col && a.row === b.row;
}

function manhattanDistance(a: GridCell, b: GridCell) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nearbyCells(origin: GridCell, radius: number, world: WorldModel) {
  const cells: GridCell[] = [];
  for (let col = origin.col - radius; col <= origin.col + radius; col += 1) {
    for (let row = origin.row - radius; row <= origin.row + radius; row += 1) {
      const cell = { col, row };
      const distance = manhattanDistance(origin, cell);
      if (
        distance > 0 &&
        distance <= radius &&
        isGridCellInBounds(cell) &&
        !world.blockedCellKeys.has(cellKey(cell))
      ) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

function wanderCandidates(origin: GridCell, world: WorldModel) {
  return nearbyCells(origin, WANDER_RADIUS, world).filter(
    (cell) => manhattanDistance(origin, cell) >= 3,
  );
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function messageTarget(text: string, agents: CharacterAgentState[]): "all" | string[] {
  if (text.includes("@all")) {
    return "all";
  }

  const targets = agents
    .filter((agent) => text.toLowerCase().includes(`@${agent.name.toLowerCase()}`))
    .map((agent) => agent.id);
  return targets.length > 0 ? targets : "all";
}

export function createAgentBrainController(
  initialAgents: Array<Pick<CharacterAgentState, "id" | "name" | "cell">>,
  options: AgentBrainControllerOptions,
) {
  const agents = new Map<string, CharacterAgentState>(
    initialAgents.map((agent) => [
      agent.id,
      {
        ...agent,
        activity: "idle",
        conversationId: null,
        lastSpokeAt: 0,
      },
    ]),
  );
  const conversations = new Map<string, ConversationState>();
  const timers = new Map<string, number>();
  const runningAgents = new Set<string>();
  let disposed = false;
  let messageSeq = 0;
  let conversationSeq = 0;

  function agentList() {
    return Array.from(agents.values());
  }

  function syncAgentCell(agent: CharacterAgentState) {
    const cell = options.getCharacterCell(agent.id);
    if (cell) {
      agent.cell = cell;
    }
  }

  function schedule(agentId: string, ms = THINK_INTERVAL_MS) {
    window.clearTimeout(timers.get(agentId));
    timers.set(
      agentId,
      window.setTimeout(() => {
        void tick(agentId);
      }, ms),
    );
  }

  function activeConversationFor(agent: CharacterAgentState) {
    return agent.conversationId ? conversations.get(agent.conversationId) : undefined;
  }

  function nearbyAgents(agent: CharacterAgentState) {
    return agentList().filter(
      (other) => other.id !== agent.id && manhattanDistance(agent.cell, other.cell) <= TALK_DISTANCE,
    );
  }

  function expireOldConversations(now: number) {
    for (const conversation of conversations.values()) {
      if (
        now - conversation.lastMessageAt > CONVERSATION_IDLE_MS ||
        conversation.turnCount >= MAX_CONVERSATION_TURNS
      ) {
        for (const participantId of conversation.participantIds) {
          const participant = agents.get(participantId);
          if (participant?.conversationId === conversation.id) {
            participant.conversationId = null;
            participant.activity = "idle";
          }
        }
        conversations.delete(conversation.id);
      }
    }
  }

  function startConversation(participants: CharacterAgentState[]) {
    const existing = participants
      .map((agent) => activeConversationFor(agent))
      .find((conversation) => conversation);
    if (existing) {
      for (const agent of participants) {
        agent.conversationId = existing.id;
        if (!existing.participantIds.includes(agent.id)) {
          existing.participantIds.push(agent.id);
        }
      }
      return existing;
    }

    const conversation: ConversationState = {
      id: `conversation:${conversationSeq}`,
      participantIds: participants.map((agent) => agent.id),
      speakerIndex: conversationSeq % participants.length,
      turnCount: 0,
      lastMessageAt: Date.now(),
    };
    conversationSeq += 1;
    conversations.set(conversation.id, conversation);
    for (const agent of participants) {
      agent.conversationId = conversation.id;
    }
    return conversation;
  }

  function nextSpeaker(conversation: ConversationState) {
    const speakerId = conversation.participantIds[conversation.speakerIndex];
    return speakerId ? agents.get(speakerId) : undefined;
  }

  function advanceSpeaker(conversation: ConversationState) {
    conversation.speakerIndex = (conversation.speakerIndex + 1) % conversation.participantIds.length;
  }

  async function runMovement(agent: CharacterAgentState, targetCell: GridCell) {
    const world = options.getWorld();
    syncAgentCell(agent);
    if (!world) {
      return { success: false, reason: "World is not ready." } satisfies ActionResult;
    }

    if (sameCell(agent.cell, targetCell)) {
      return { success: true, message: "Already there." } satisfies ActionResult;
    }

    agent.activity = "moving";
    const path = await findGridPath(agent.cell, targetCell, world);
    if (!path || path.length === 0) {
      agent.activity = "idle";
      return { success: false, reason: "No path to target." } satisfies ActionResult;
    }

    const result = await options.moveAlongPath(agent.id, path);
    syncAgentCell(agent);
    agent.activity = "idle";
    return result;
  }

  async function runDecision(agent: CharacterAgentState, decision: AgentDecision) {
    const world = options.getWorld();
    if (!world) {
      return { success: false, reason: "World is not ready." } satisfies ActionResult;
    }

    if (decision.actionId === "wait") {
      agent.activity = "waiting";
      await delay(WAIT_MS);
      agent.activity = "idle";
      return { success: true, message: "Waited." } satisfies ActionResult;
    }

    if (decision.actionId === "say") {
      const text = decision.message?.trim();
      if (!text) {
        return { success: false, reason: "No message." } satisfies ActionResult;
      }

      agent.activity = "talking";
      agent.lastSpokeAt = Date.now();
      options.onChatMessage({
        id: `message:${messageSeq}`,
        fromCharacterId: agent.id,
        fromName: agent.name,
        target: decision.target ?? messageTarget(text, agentList()),
        text,
        createdAt: agent.lastSpokeAt,
      });
      messageSeq += 1;
      await delay(500);
      agent.activity = "idle";
      return { success: true, message: "Said message." } satisfies ActionResult;
    }

    if (decision.actionId === "leave_conversation") {
      agent.conversationId = null;
      agent.activity = "idle";
      return { success: true, message: "Left conversation." } satisfies ActionResult;
    }

    if (decision.actionId === "move_to_cell" && decision.targetCell) {
      return runMovement(agent, decision.targetCell);
    }

    if (decision.actionId === "move_near_character" && decision.targetCharacterId) {
      const target = agents.get(decision.targetCharacterId);
      if (!target) {
        return { success: false, reason: "Target character not found." } satisfies ActionResult;
      }

      syncAgentCell(target);
      const targetCell = randomItem(nearbyCells(target.cell, TALK_DISTANCE, world));
      if (!targetCell) {
        return { success: false, reason: "No nearby walkable cell." } satisfies ActionResult;
      }
      return runMovement(agent, targetCell);
    }

    if (decision.actionId === "wander") {
      const targetCell = randomItem(wanderCandidates(agent.cell, world));
      if (!targetCell) {
        return { success: false, reason: "No wander target." } satisfies ActionResult;
      }
      agent.activity = "wandering";
      return runMovement(agent, targetCell);
    }

    return { success: false, reason: "Unsupported action." } satisfies ActionResult;
  }

  function chooseDecision(agent: CharacterAgentState): AgentDecision {
    const now = Date.now();
    const conversation = activeConversationFor(agent);
    if (conversation) {
      const speaker = nextSpeaker(conversation);
      if (speaker?.id !== agent.id || now - agent.lastSpokeAt < SPEAK_COOLDOWN_MS) {
        return { actionId: "wait", reason: "Waiting for conversation turn." };
      }

      const line = conversationLines[conversation.turnCount % conversationLines.length];
      return {
        actionId: "say",
        reason: "Taking conversation turn.",
        message: line,
        target: "all",
      };
    }

    const nearby = nearbyAgents(agent);
    if (nearby.length > 0 && Math.random() < 0.65) {
      startConversation([agent, ...nearby]);
      return {
        actionId: "say",
        reason: "Starting nearby conversation.",
        message: `@all Hey, I see ${nearby.map((other) => other.name).join(" and ")} nearby.`,
        target: "all",
      };
    }

    if (nearby.length === 0 && Math.random() < 0.25) {
      const target = randomItem(agentList().filter((other) => other.id !== agent.id));
      if (target) {
        return {
          actionId: "move_near_character",
          reason: "Looking for someone to talk to.",
          targetCharacterId: target.id,
        };
      }
    }

    return Math.random() < 0.75
      ? { actionId: "wander", reason: "Exploring nearby cells." }
      : { actionId: "wait", reason: "Idling." };
  }

  async function tick(agentId: string) {
    if (disposed || runningAgents.has(agentId)) {
      return;
    }

    const agent = agents.get(agentId);
    if (!agent) {
      return;
    }

    runningAgents.add(agentId);
    try {
      syncAgentCell(agent);
      expireOldConversations(Date.now());
      const conversation = activeConversationFor(agent);
      const decision = chooseDecision(agent);
      const result = await runDecision(agent, decision);
      if (conversation && decision.actionId === "say" && result.success) {
        conversation.turnCount += 1;
        conversation.lastMessageAt = Date.now();
        advanceSpeaker(conversation);
      }
    } finally {
      runningAgents.delete(agentId);
      if (!disposed) {
        schedule(agentId);
      }
    }
  }

  function start() {
    for (const agent of agents.values()) {
      schedule(agent.id, 300 + Math.floor(Math.random() * 900));
    }
  }

  function notifyWorldChanged() {
    for (const agent of agents.values()) {
      if (agent.activity === "moving" || agent.activity === "wandering") {
        continue;
      }
      schedule(agent.id, 300);
    }
  }

  function dispose() {
    disposed = true;
    for (const timer of timers.values()) {
      window.clearTimeout(timer);
    }
    timers.clear();
  }

  return { start, notifyWorldChanged, dispose };
}
