import type { AsciiBlock } from "../types";
import { Bank } from "./bank";
import { Cafe } from "./cafe";
import { CommunityFarm } from "./community-farm";
import { Diner } from "./diner";
import { Hospital } from "./hospital";
import { HydroDam } from "./hydro-dam";
import { LargeHouse } from "./large-house";
import { MediumHouse } from "./medium-house";
import { School } from "./school";
import { TownHall } from "./town-hall";
import { PumpStation } from "./water-pumping-station";

type BuildingConfig = {
  name: string;
  block: AsciiBlock;
};

export const BUILDINGS = [
  { name: "Town Hall", block: TownHall },
  { name: "Bank", block: Bank },
  { name: "Hospital", block: Hospital },
  { name: "School", block: School },
  { name: "Large House", block: LargeHouse },
  { name: "Medium House", block: MediumHouse },
  { name: "Community Farm", block: CommunityFarm },
  { name: "Hydro Dam", block: HydroDam },
  { name: "Water Pumping Station", block: PumpStation },
  { name: "Cafe", block: Cafe },
  { name: "Diner", block: Diner },
] satisfies BuildingConfig[];
