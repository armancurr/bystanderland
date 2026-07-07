import type { Doc } from "../../../convex/_generated/dataModel";

type ChatPanelProps = {
	messages: Doc<"chatMessages">[];
};

const colorByCharacter: Record<string, string> = {
	aria: "#4cc9f0",
	milo: "#f6a04d",
	nora: "#f7d84a",
};

export function ChatPanel({ messages }: ChatPanelProps) {
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label="Character chat"
		>
			<div className="mb-3">
				<h2 className="text-sm font-semibold text-[#f7fbf2]">Chat</h2>
				<p className="mt-1 text-xs text-[#cdd8c4]/70">Character messages.</p>
			</div>
			<div className="min-h-0 flex-1 overflow-auto rounded-md bg-[#17201d]/72 p-3 scrollbar-none">
				{messages.length === 0 ? (
					<p className="text-xs text-[#cdd8c4]/70">...</p>
				) : (
					<ol className="flex flex-col gap-1.5 font-['Geist_Mono'] text-xs">
						{messages.map((message) => (
							<li key={message._id} className="min-w-0 leading-5">
								<span
									className="font-semibold"
									style={{
										color: colorByCharacter[message.characterId] ?? "#d9e4cd",
									}}
								>
									{message.label}:
								</span>{" "}
								<span className="break-words text-[#f7fbf2]">
									{message.text}
								</span>
							</li>
						))}
					</ol>
				)}
			</div>
		</section>
	);
}
