import type { AsciiBlock } from "../types";
import { Blacksmith } from "./blacksmith";
import { Chapel } from "./chapel";
import { GuildHall } from "./guild-hall";
import { MarketSquare } from "./market-square";
import { OldForest } from "./old-forest";
import { RowHouses } from "./row-houses";
import { SacredGrove } from "./sacred-grove";

type BuildingConfig = {
  name: string;
  block: AsciiBlock;
};

export const BUILDINGS = [
  { name: "Blacksmith", block: Blacksmith },
  { name: "Old Forest", block: OldForest },
  { name: "Guild Hall", block: GuildHall },
  { name: "Row Houses", block: RowHouses },
  { name: "Market Square", block: MarketSquare },
  { name: "Chapel", block: Chapel },
  { name: "Sacred Grove", block: SacredGrove },
] satisfies BuildingConfig[];
