import type { AsciiBlock } from "../types";
import { TownHall } from "./town-hall";
import { Hospital } from "./hospital";
import { School } from "./school";
import { College } from "./college";

type BuildingConfig = {
  name: string;
  block: AsciiBlock;
};

export const BUILDINGS = [
  { name: "Town Hall", block: TownHall },
  { name: "Hospital", block: Hospital },
  { name: "School", block: School },
  { name: "College", block: College },
] satisfies BuildingConfig[];
