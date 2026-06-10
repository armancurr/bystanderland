import { MediumHouse } from "../town/buildings/medium-house";
import { MapCanvas } from "./map-canvas";

export const metadata = {
  title: "bystanderland map",
  description: "A zoomable canvas map of bystanderland buildings.",
};

export default function MapPage() {
  return (
    <MapCanvas
      buildings={[
        { name: "House", block: MediumHouse },
        { name: "House", block: MediumHouse },
        { name: "House", block: MediumHouse },
        { name: "House", block: MediumHouse },
      ]}
    />
  );
}
