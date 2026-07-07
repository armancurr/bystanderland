import type { Doc } from "../../../convex/_generated/dataModel";
import type { PlaceKind } from "../../types";

const placeKindOptions: PlaceKind[] = [
	"home",
	"market",
	"diner",
	"school",
	"work",
	"nature",
	"road",
	"building",
];

type MetadataPanelProps = {
	tile: Doc<"tiles"> | undefined;
	characters: Doc<"characters">[];
	onSave: (
		stableId: string,
		label: string,
		placeKind: PlaceKind,
		ownerCharacterId: string | null,
	) => void;
};

export function MetadataPanel({
	tile,
	characters,
	onSave,
}: MetadataPanelProps) {
	if (!tile) {
		return (
			<section className="mt-3 rounded-md bg-[#17201d]/72 p-3 text-xs text-[#cdd8c4]/70">
				Select a placed asset to edit metadata.
			</section>
		);
	}

	return (
		<MetadataForm
			key={tile._id}
			tile={tile}
			characters={characters}
			onSave={onSave}
		/>
	);
}

type MetadataFormProps = Omit<MetadataPanelProps, "tile"> & {
	tile: Doc<"tiles">;
};

function MetadataForm({ tile, characters, onSave }: MetadataFormProps) {
	return (
		<form
			className="mt-3 flex flex-col gap-2 rounded-md bg-[#17201d]/72 p-3 text-xs text-[#eef4ea]"
			onSubmit={(event) => {
				event.preventDefault();
				const formData = new FormData(event.currentTarget);
				onSave(
					tile.stableId,
					String(formData.get("label") ?? tile.label),
					String(formData.get("placeKind") ?? tile.placeKind) as PlaceKind,
					String(formData.get("ownerCharacterId") ?? "") || null,
				);
			}}
			aria-label="Place metadata"
		>
			<div className="flex items-center justify-between gap-3">
				<span className="font-semibold">Place Metadata</span>
				<span className="truncate text-[#cdd8c4]/75">{tile.assetId}</span>
			</div>
			<input
				name="label"
				defaultValue={tile.label}
				className="h-9 rounded border border-[#53635b] bg-[#101820] px-2 text-[#eef4ea] outline-none"
				aria-label="Place label"
			/>
			<div className="grid grid-cols-2 gap-2">
				<select
					name="placeKind"
					defaultValue={tile.placeKind}
					className="h-9 rounded border border-[#53635b] bg-[#101820] px-2 text-[#eef4ea] outline-none"
					aria-label="Place kind"
				>
					{placeKindOptions.map((kind) => (
						<option key={kind} value={kind}>
							{kind}
						</option>
					))}
				</select>
				<select
					name="ownerCharacterId"
					defaultValue={tile.ownerCharacterId ?? ""}
					className="h-9 rounded border border-[#53635b] bg-[#101820] px-2 text-[#eef4ea] outline-none"
					aria-label="Owner character"
				>
					<option value="">No owner</option>
					{characters.map((character) => (
						<option key={character.characterId} value={character.characterId}>
							{character.label}
						</option>
					))}
				</select>
			</div>
			<button
				type="submit"
				className="h-9 rounded bg-[#d9e4cd] px-3 text-[#17201d]"
			>
				Save
			</button>
		</form>
	);
}
