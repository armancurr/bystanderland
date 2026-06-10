import { BUILDINGS } from "./town/buildings/config";

export default function Home() {
  return (
    <main className="min-h-screen overflow-auto bg-black p-8 text-white">
      <div className="mx-auto grid w-fit grid-cols-4 items-start justify-items-center gap-x-16 gap-y-14">
        {BUILDINGS.map((building) => (
          <figure key={building.name} className="min-w-max">
            <figcaption className="mb-3 text-[11px] uppercase tracking-[0.4em] text-white">
              {building.name}
            </figcaption>
            <pre className="whitespace-pre font-mono text-[13px] leading-[1.45] text-white">
              {building.block.length > 0
                ? building.block.join("\n")
                : "[ empty lot ]"}
            </pre>
          </figure>
        ))}
      </div>
    </main>
  );
}
