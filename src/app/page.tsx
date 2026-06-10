import { BUILDINGS } from "./town/buildings/config";

export default function Home() {
  return (
    <main className="min-h-screen overflow-auto bg-black px-6 py-8 text-white">
      <header className="mb-10 flex w-full flex-col items-center py-14 text-center">
        <h1 className="text-2xl font-normal text-white">bystanderland</h1>
        <p className="mt-4 max-w-md text-center text-sm text-white/70">
          An ascii civilization living, aging and rebuilding. Coming soon to
          your browsers.
        </p>
      </header>
      <div className="mx-auto grid w-fit grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 md:grid-cols-4">
        {BUILDINGS.map((building) => (
          <figure
            key={building.name}
            className="flex w-[min(86vw,360px)] min-w-[280px] flex-col items-center p-5 sm:w-[min(46vw,360px)]"
          >
            <pre className="whitespace-pre font-mono text-[13px] leading-[1.45] text-white">
              {building.block.length > 0
                ? building.block.join("\n")
                : "[ empty lot ]"}
            </pre>
            <figcaption className="mt-4 text-center text-[11px] uppercase tracking-[0.4em] text-white">
              {building.name}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
