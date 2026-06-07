import { ShovelIcon } from "@phosphor-icons/react/dist/ssr";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-black">
      <div className="text-left">
        <div className="flex items-center gap-3">
          <ShovelIcon size={30} weight="fill" aria-hidden="true" />
          <h1 className="text-3xl font-semibold tracking-normal">
            bystanderland
          </h1>
        </div>
        <p className="mt-4 text-xl text-zinc-600">
          Watch a civilization run in your browser.
        </p>
      </div>
    </main>
  );
}
