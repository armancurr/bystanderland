import type {
	AssetPack,
	BakedAssetPack,
	PlaceableAsset,
	PlaceableAssetCategory,
	TileRotation,
} from "../types";

const assetPackLabels: Record<AssetPack, string> = {
	roads: "Roads",
	commercial: "Commercial",
	industrial: "Industrial",
	suburban: "Suburban",
	nature: "Nature",
	characters: "Characters",
};

const assetPackOrder: AssetPack[] = [
	"roads",
	"commercial",
	"industrial",
	"suburban",
	"nature",
];

// Packs whose GLB models get baked into isometric sprites at runtime (see
// sprite-cache.ts). "nature" is excluded because Kenney already ships
// pre-rendered isometric sprites for it (see natureIsoModules below), so we
// skip the GLTF/WebGL baking step entirely for that pack.
const bakedAssetPacks: AssetPack[] = [
	"roads",
	"commercial",
	"industrial",
	"suburban",
];

const emptyPreview =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const modelModules = {
	roads: import.meta.glob(
		"../../assets/kenney_city-kit-roads/Models/GLB format/*.glb",
		{
			query: "?url",
			import: "default",
			eager: true,
		},
	) as Record<string, string>,
	commercial: import.meta.glob(
		"../../assets/kenney_city-kit-commercial_2.1/Models/GLB format/*.glb",
		{ query: "?url", import: "default", eager: true },
	) as Record<string, string>,
	industrial: import.meta.glob(
		"../../assets/kenney_city-kit-industrial_1.0/Models/GLB format/*.glb",
		{ query: "?url", import: "default", eager: true },
	) as Record<string, string>,
	suburban: import.meta.glob(
		"../../assets/kenney_city-kit-suburban_20/Models/GLB format/*.glb",
		{
			query: "?url",
			import: "default",
			eager: true,
		},
	) as Record<string, string>,
	characters: {} as Record<string, string>,
} satisfies Record<BakedAssetPack, Record<string, string>>;

const previewModules = {
	roads: import.meta.glob("../../assets/kenney_city-kit-roads/Previews/*.png", {
		query: "?url",
		import: "default",
		eager: true,
	}) as Record<string, string>,
	commercial: import.meta.glob(
		"../../assets/kenney_city-kit-commercial_2.1/Previews/*.png",
		{
			query: "?url",
			import: "default",
			eager: true,
		},
	) as Record<string, string>,
	industrial: import.meta.glob(
		"../../assets/kenney_city-kit-industrial_1.0/Previews/*.png",
		{
			query: "?url",
			import: "default",
			eager: true,
		},
	) as Record<string, string>,
	suburban: import.meta.glob(
		"../../assets/kenney_city-kit-suburban_20/Previews/*.png",
		{
			query: "?url",
			import: "default",
			eager: true,
		},
	) as Record<string, string>,
	characters: {} as Record<string, string>,
} satisfies Record<BakedAssetPack, Record<string, string>>;

// Kenney's nature kit ships pre-rendered isometric sprites for every model,
// at four rotations (compass-suffixed). We use these directly instead of
// baking the GLTF models with three.js at runtime.
export const natureIsoModules = import.meta.glob(
	"../../assets/kenney_nature-kit/Isometric/*.png",
	{
		query: "?url",
		import: "default",
		eager: true,
	},
) as Record<string, string>;

const NATURE_ROTATION_SUFFIX: Record<TileRotation, string> = {
	0: "SW",
	90: "SE",
	180: "NE",
	270: "NW",
};

export function natureIsoUrl(assetName: string, rotation: TileRotation) {
	const suffix = NATURE_ROTATION_SUFFIX[rotation];
	const path = Object.keys(natureIsoModules).find((candidate) =>
		candidate.endsWith(`/${assetName}_${suffix}.png`),
	);
	return path ? natureIsoModules[path] : undefined;
}

function fileStem(path: string, extension: string) {
	return (
		path
			.split("/")
			.pop()
			?.replace(new RegExp(`\\.${extension}$`), "") ?? ""
	);
}

function titleCase(asset: string) {
	return asset
		.replace(/[_-]/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function categoryForPack(pack: AssetPack): PlaceableAssetCategory {
	if (pack === "roads") {
		return "road";
	}

	if (pack === "nature") {
		return "nature";
	}

	return "building";
}

function previewUrlFor(pack: BakedAssetPack, assetName: string) {
	const previews = previewModules[pack];
	const expectedPath = Object.keys(previews).find((path) =>
		path.endsWith(`/${assetName}.png`),
	);
	if (expectedPath) {
		return previews[expectedPath];
	}

	const fallbackPath = Object.keys(previews).find((path) =>
		path.split("/").pop()?.startsWith(assetName),
	);
	return fallbackPath ? previews[fallbackPath] : emptyPreview;
}

function assetsForBakedPack(pack: BakedAssetPack): PlaceableAsset[] {
	return Object.entries(modelModules[pack])
		.map(([path, modelUrl]) => {
			const assetName = fileStem(path, "glb");
			return {
				id: `${pack}:${assetName}`,
				label: titleCase(assetName),
				category: categoryForPack(pack),
				pack,
				modelUrl,
				previewUrl: previewUrlFor(pack, assetName),
			};
		})
		.sort((a, b) => a.label.localeCompare(b.label));
}

function natureAssetNames() {
	const names = new Set<string>();
	for (const path of Object.keys(natureIsoModules)) {
		const stem = fileStem(path, "png").replace(/_(NE|NW|SE|SW)$/, "");
		if (stem) {
			names.add(stem);
		}
	}
	return names;
}

function assetsForNaturePack(): PlaceableAsset[] {
	return Array.from(natureAssetNames())
		.map((assetName) => ({
			id: `nature:${assetName}`,
			label: titleCase(assetName),
			category: "nature" as const,
			pack: "nature" as const,
			modelUrl: natureIsoUrl(assetName, 0) ?? emptyPreview,
			previewUrl: natureIsoUrl(assetName, 0) ?? emptyPreview,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

function assetsForPack(pack: AssetPack): PlaceableAsset[] {
	if (pack === "nature") {
		return assetsForNaturePack();
	}

	return assetsForBakedPack(pack);
}

export const placeableAssets: PlaceableAsset[] =
	assetPackOrder.flatMap(assetsForPack);

export const placeableAssetsById = new Map(
	placeableAssets.map((asset) => [asset.id, asset]),
);

export function placeableSpriteKey(
	assetId: string,
	rotation: TileRotation = 0,
) {
	return `placeable-sprite:${assetId}@${rotation}`;
}
