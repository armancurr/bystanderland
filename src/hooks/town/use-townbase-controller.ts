import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import Phaser from "phaser";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	buildWorldModel,
	cellsAreInBounds,
	findGridPath,
	footprintCells,
	getPlacedTileFootprint,
	intersectsPlacedTile,
	tileAtCell,
} from "../../game/grid-world";
import type { IsometricMovementScene } from "../../game/isometric-movement-scene";
import { createMovementGameConfig } from "../../game/movement-game-config";
import {
	placeableAssets,
	placeableAssetsById,
	placeableSpriteKey,
} from "../../game/placed-assets";
import {
	createSpriteStore,
	ensurePlaceableSprites,
	getPlaceableSprite,
} from "../../game/sprite-cache";
import {
	CHARACTER_CONFIGS,
	DEFAULT_TILE_ROTATION,
	PLAYER_ROTATIONS,
} from "../../lib/game/character-configs";
import {
	convexTileToPlacedTile,
	labelFromAssetId,
	nearestWalkableCell,
	nextRotation,
	placeKindFromAsset,
} from "../../lib/game/tile-utils";
import {
	LOCAL_IMPORT_DONE_KEY,
	loadLocalPlacedTiles,
} from "../../lib/storage/local-tiles";
import type {
	BakedPlaceableSprite,
	BakedPlaceableSprites,
	EditorTool,
	GridCell,
	PlaceKind,
	PlaceableAsset,
	PlacedTile,
	SidebarTab,
	SimulationMode,
	TileRotation,
	ToolTestStatus,
	ToolTestStep,
	TownState,
	WorldModel,
} from "../../types";

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return Boolean(
		target.closest(
			"input, textarea, select, [contenteditable='true'], [contenteditable='']",
		),
	);
}

export function useTownbaseController() {
	const state = useQuery(api.town.getState) as TownState | null | undefined;
	const ensureWorld = useMutation(api.town.ensureWorld);
	const importLocalTiles = useMutation(api.town.importLocalTiles);
	const setMode = useMutation(api.town.setMode);
	const upsertTile = useMutation(api.town.upsertTile);
	const deleteTile = useMutation(api.town.deleteTile);
	const updateTileMetadata = useMutation(api.town.updateTileMetadata);
	const enqueueAction = useMutation(api.town.enqueueAction);
	const setActionStatus = useMutation(api.town.setActionStatus);
	const runAgentTurn = useAction(api.agents.runAgentTurn);
	const runPopulationStep = useAction(api.agents.runPopulationStep);

	const gameRef = useRef<Phaser.Game | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const placeableSpritesRef = useRef<BakedPlaceableSprites | null>(null);
	const worldModelRef = useRef<WorldModel | null>(null);
	const selectedAssetIdRef = useRef(placeableAssets[0]?.id ?? "");
	const toolRef = useRef<EditorTool>("explore");
	const rotationRef = useRef<TileRotation>(DEFAULT_TILE_ROTATION);
	const placedTilesRef = useRef<PlacedTile[]>([]);
	const modeRef = useRef<SimulationMode>("auto");
	const runningActionsRef = useRef(new Set<string>());
	const [selectedAssetId, setSelectedAssetId] = useState(
		selectedAssetIdRef.current,
	);
	const [tool, setTool] = useState<EditorTool>("explore");
	const [rotation, setRotation] = useState<TileRotation>(DEFAULT_TILE_ROTATION);
	const [isBaking, setIsBaking] = useState(true);
	const [activeSidebarTab, setActiveSidebarTab] =
		useState<SidebarTab>("assets");
	const [selectedTileStableId, setSelectedTileStableId] = useState<
		string | null
	>(null);
	const [isRunningLlm, setIsRunningLlm] = useState(false);
	const [toolTestStepIndex, setToolTestStepIndex] = useState(0);
	const [toolTestStatus, setToolTestStatus] = useState<ToolTestStatus>({
		tone: "idle",
		text: "Ready to run the next tool test step.",
	});

	const convexTiles = state?.tiles ?? [];
	const placedTiles = useMemo(
		() => convexTiles.map(convexTileToPlacedTile),
		[convexTiles],
	);
	const characters = state?.characters ?? [];
	const places = state?.places ?? [];
	const mode = state?.world.mode ?? "auto";
	const isWorldReady = state !== undefined && state !== null;
	const selectedTile = convexTiles.find(
		(tile) => tile.stableId === selectedTileStableId,
	);
	const toolTestPlan = useMemo<ToolTestStep[]>(
		() =>
			characters.map((character) => ({
				characterId: character.characterId,
				toolName: "required agent tool",
				task: `Run one agent turn for ${character.label}.`,
			})),
		[characters],
	);

	useEffect(() => {
		void ensureWorld();
	}, [ensureWorld]);

	useEffect(() => {
		if (
			state === undefined ||
			!state?.world ||
			state.world.importedLocalStorage
		) {
			return;
		}
		if (window.localStorage.getItem(LOCAL_IMPORT_DONE_KEY)) {
			return;
		}

		const localTiles = loadLocalPlacedTiles();
		window.localStorage.setItem(LOCAL_IMPORT_DONE_KEY, "1");
		void importLocalTiles({
			tiles: localTiles.map((tile) => ({
				stableId: tile.id,
				assetId: tile.assetId,
				col: tile.col,
				row: tile.row,
				rotation: tile.rotation,
			})),
		});
	}, [importLocalTiles, state]);

	useEffect(() => {
		selectedAssetIdRef.current = selectedAssetId;
	}, [selectedAssetId]);

	useEffect(() => {
		toolRef.current = tool;
	}, [tool]);

	useEffect(() => {
		rotationRef.current = rotation;
	}, [rotation]);

	useEffect(() => {
		placedTilesRef.current = placedTiles;
	}, [placedTiles]);

	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !isWorldReady || gameRef.current) {
			return;
		}

		let disposed = false;
		const store = createSpriteStore();
		placeableSpritesRef.current = store;

		const initialRequests = new Map<
			string,
			{ asset: PlaceableAsset; rotation: TileRotation }
		>();
		for (const tile of placedTiles) {
			const asset = placeableAssetsById.get(tile.assetId);
			if (!asset) {
				continue;
			}
			initialRequests.set(placeableSpriteKey(tile.assetId, tile.rotation), {
				asset,
				rotation: tile.rotation,
			});
		}

		void Promise.all([
			ensurePlaceableSprites(store, Array.from(initialRequests.values())),
			Promise.all(
				CHARACTER_CONFIGS.map(async (character) => {
					const sprites = await Promise.all(
						PLAYER_ROTATIONS.map(
							async (rotation) =>
								[
									rotation,
									await getPlaceableSprite(character.asset, rotation),
								] as const,
						),
					);
					const savedCharacter = characters.find(
						(candidate: Doc<"characters">) =>
							candidate.characterId === character.id,
					);
					return {
						id: character.id,
						name: character.name,
						cell: savedCharacter?.cell ?? { col: 20, row: 20 },
						sprites: new Map<TileRotation, BakedPlaceableSprite>(sprites),
					};
				}),
			),
		]).then(([, sceneCharacters]) => {
			if (disposed) {
				return;
			}

			const game = new Phaser.Game(
				createMovementGameConfig(container, {
					placedTiles,
					placeableSprites: store,
					characters: sceneCharacters,
					allowKeyboardMovement: modeRef.current === "mock_manual",
					getPlacementPreview: (col, row) => {
						if (toolRef.current === "remove") {
							const tile = tileAtCell(placedTilesRef.current, store, col, row);
							if (!tile) {
								return {
									cells: [{ col, row }],
									isValid: false,
									intent: "remove",
								};
							}
							return {
								cells: footprintCells(
									{ col: tile.col, row: tile.row },
									getPlacedTileFootprint(tile, store),
								),
								isValid: true,
								intent: "remove",
							};
						}

						if (toolRef.current !== "asset") {
							return null;
						}

						const assetId = selectedAssetIdRef.current;
						const selectedRotation = rotationRef.current;
						const sprite = store.sprites.get(
							placeableSpriteKey(assetId, selectedRotation),
						);
						if (!sprite) {
							return null;
						}

						const cells = footprintCells({ col, row }, sprite.footprint);
						return {
							cells,
							isValid:
								cellsAreInBounds(cells) &&
								!placedTilesRef.current.some((tile) =>
									intersectsPlacedTile(cells, tile, store),
								),
							intent: "place",
							assetId,
							rotation: selectedRotation,
							textureKey: placeableSpriteKey(assetId, selectedRotation),
							footprint: sprite.footprint,
						};
					},
					onCellClick: (col, row, action) => {
						const clickedTile = tileAtCell(
							placedTilesRef.current,
							store,
							col,
							row,
						);
						if (toolRef.current === "remove") {
							if (clickedTile) {
								void deleteTile({ stableId: clickedTile.id });
								setSelectedTileStableId(null);
							}
							return;
						}

						if (action === "erase") {
							return;
						}

						if (toolRef.current !== "asset") {
							setSelectedTileStableId(clickedTile?.id ?? null);
							return;
						}

						const assetId = selectedAssetIdRef.current;
						const asset = placeableAssetsById.get(assetId);
						if (!asset) {
							return;
						}

						const selectedRotation = rotationRef.current;
						void getPlaceableSprite(asset, selectedRotation).then((sprite) => {
							if (disposed) {
								return;
							}

							store.sprites.set(
								placeableSpriteKey(assetId, selectedRotation),
								sprite,
							);
							const cells = footprintCells({ col, row }, sprite.footprint);
							if (
								!cellsAreInBounds(cells) ||
								placedTilesRef.current.some((tile) =>
									intersectsPlacedTile(cells, tile, store),
								)
							) {
								return;
							}

							const stableId = `tile:${col}:${row}`;
							void upsertTile({
								tile: {
									stableId,
									assetId,
									col,
									row,
									rotation: selectedRotation,
									label: labelFromAssetId(assetId),
									placeKind: placeKindFromAsset(asset),
									ownerCharacterId: null,
								},
							});
							setSelectedTileStableId(stableId);
						});
					},
				}),
			);
			gameRef.current = game;
			worldModelRef.current = buildWorldModel(placedTilesRef.current, store);
			setIsBaking(false);
		});

		return () => {
			disposed = true;
			placeableSpritesRef.current = null;
			gameRef.current?.destroy(true);
			gameRef.current = null;
		};
	}, [deleteTile, isWorldReady, upsertTile]);

	useEffect(() => {
		const store = placeableSpritesRef.current;
		const game = gameRef.current;
		if (!store || !game) {
			return;
		}

		const scene = game.scene.getScene("isometric-movement-scene") as
			| IsometricMovementScene
			| undefined;
		scene?.setPlacedTiles(placedTiles);
		scene?.setCharacterCells(
			Object.fromEntries(
				characters.map((character) => [character.characterId, character.cell]),
			),
		);
		worldModelRef.current = buildWorldModel(placedTiles, store);
	}, [characters, placedTiles]);

	useEffect(() => {
		const game = gameRef.current;
		if (!game) {
			return;
		}

		const scene = game.scene.getScene("isometric-movement-scene") as
			| IsometricMovementScene
			| undefined;
		scene?.setAllowKeyboardMovement(mode === "mock_manual");
	}, [mode]);

	useEffect(() => {
		const store = placeableSpritesRef.current;
		const asset = placeableAssetsById.get(selectedAssetId);
		if (!store || !asset || tool !== "asset") {
			refreshPlacementPreview();
			return;
		}

		let cancelled = false;
		void getPlaceableSprite(asset, rotation).then((sprite) => {
			if (cancelled) {
				return;
			}
			store.sprites.set(placeableSpriteKey(asset.id, rotation), sprite);
			refreshPlacementPreview();
		});
		refreshPlacementPreview();

		return () => {
			cancelled = true;
		};
	}, [selectedAssetId, rotation, tool]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const key = event.key.toLowerCase();
			const commandModifier = event.metaKey || event.ctrlKey;

			if (commandModifier && key === "b") {
				event.preventDefault();
				togglePlaceMode();
				return;
			}
			if (isEditableTarget(event.target)) {
				return;
			}
			if (key === "r") {
				event.preventDefault();
				toggleRemoveMode();
				return;
			}
			if (key === "q") {
				event.preventDefault();
				if (toolRef.current === "asset") {
					rotatePlacement(-1);
				}
				return;
			}
			if (key === "e") {
				event.preventDefault();
				if (toolRef.current === "asset") {
					rotatePlacement(1);
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	useEffect(() => {
		if (!state) {
			return;
		}

		const pending = state.actions.filter(
			(action) => action.status === "pending",
		);
		for (const action of pending) {
			if (runningActionsRef.current.has(action._id)) {
				continue;
			}
			runningActionsRef.current.add(action._id);
			void executeAction(action).finally(() => {
				runningActionsRef.current.delete(action._id);
			});
		}
	}, [state]);

	async function executeAction(action: Doc<"agentActions">) {
		const game = gameRef.current;
		const scene = game?.scene.getScene("isometric-movement-scene") as
			| IsometricMovementScene
			| undefined;
		const world = worldModelRef.current;
		if (!scene || !world) {
			await setActionStatus({
				actionId: action._id as Id<"agentActions">,
				status: "failed",
				result: "Movement scene is not ready.",
				characterCell: null,
			});
			return;
		}

		await setActionStatus({
			actionId: action._id as Id<"agentActions">,
			status: "running",
			result: null,
			characterCell: null,
		});

		const startCell = scene.getCharacterCell(action.characterId);
		if (!startCell) {
			await setActionStatus({
				actionId: action._id as Id<"agentActions">,
				status: "failed",
				result: "Character is not ready.",
				characterCell: null,
			});
			return;
		}

		let targetCell: GridCell | null = null;
		if (
			action.actionId === "move_to_place" ||
			action.actionId === "inspect_place"
		) {
			const place = places.find(
				(candidate) => candidate.stableId === action.targetPlaceStableId,
			);
			if (!place) {
				await setActionStatus({
					actionId: action._id as Id<"agentActions">,
					status: "failed",
					result: `Unknown place target: ${action.targetPlaceStableId ?? "none"}.`,
					characterCell: startCell,
				});
				return;
			}
			targetCell = nearestWalkableCell(place.entryCell, world);
		} else if (action.actionId === "move_to_cell") {
			targetCell = action.targetCell
				? nearestWalkableCell(action.targetCell, world)
				: null;
		}

		if (targetCell) {
			const path = await findGridPath(startCell, targetCell, world);
			if (!path || path.length === 0) {
				await setActionStatus({
					actionId: action._id as Id<"agentActions">,
					status: "failed",
					result: "No path to target.",
					characterCell: startCell,
				});
				return;
			}
			if (path.length <= 1) {
				await setActionStatus({
					actionId: action._id as Id<"agentActions">,
					status: "completed",
					result: action.reason || "Already at target.",
					characterCell: startCell,
				});
				return;
			}
			const result = await scene.moveCharacterAlongPath(
				action.characterId,
				path,
			);
			const cell = scene.getCharacterCell(action.characterId) ?? startCell;
			await setActionStatus({
				actionId: action._id as Id<"agentActions">,
				status: result.success ? "completed" : "failed",
				result: result.success
					? action.reason || (result.message ?? "Done.")
					: result.reason,
				characterCell: cell,
			});
			return;
		}

		window.setTimeout(
			() => {
				void setActionStatus({
					actionId: action._id as Id<"agentActions">,
					status: "completed",
					result: action.reason || "Done.",
					characterCell: startCell,
				});
			},
			action.actionId === "wait" ? 700 : 250,
		);
	}

	function selectAsset(assetId: string) {
		setSelectedAssetId(assetId);
		setTool("asset");
	}

	function rotatePlacement(direction: 1 | -1) {
		setRotation((current) => nextRotation(current, direction));
	}

	function toggleRemoveMode() {
		setTool((current) => (current === "remove" ? "explore" : "remove"));
	}

	function togglePlaceMode() {
		if (toolRef.current === "asset") {
			setTool("explore");
			return;
		}
		setTool("asset");
		setActiveSidebarTab("assets");
	}

	function refreshPlacementPreview() {
		const game = gameRef.current;
		if (!game) {
			return;
		}
		const scene = game.scene.getScene("isometric-movement-scene") as
			| IsometricMovementScene
			| undefined;
		scene?.refreshPlacementPreview();
	}

	async function runMockStep() {
		const character = characters[0];
		const target =
			places.find(
				(place: Doc<"places">) =>
					place.stableId === character?.homePlaceStableId,
			) ?? places[0];
		if (!character || !target) {
			return;
		}
		await enqueueAction({
			characterId: character.characterId,
			source: "mock",
			actionId: "move_to_place",
			targetPlaceStableId: target.stableId,
			targetCell: null,
			message: null,
			task: "mock_visit_home",
			reason: `Mock step toward ${target.label}.`,
		});
	}

	async function handleRunPopulationStep() {
		if (mode === "mock_manual") {
			await runMockStep();
			return;
		}

		setIsRunningLlm(true);
		try {
			const result = await runPopulationStep();
			console.info("Population step result:", result);
			for (const turn of result.results ?? []) {
				if (!turn.ok) {
					console.warn("Character turn failed:", turn.characterId, turn.reason);
				}
			}
			if (!result.ok) {
				console.warn("Population step failed:", result.reason ?? result);
			}
		} catch (error) {
			console.error("Population step action failed:", error);
		} finally {
			setIsRunningLlm(false);
		}
	}

	async function handleRunToolTestStep() {
		const step = toolTestPlan[toolTestStepIndex];
		if (!step || mode !== "auto") {
			return;
		}

		setIsRunningLlm(true);
		setToolTestStatus({
			tone: "running",
			text: `Running ${step.characterId} tool call...`,
		});
		try {
			const result = await runAgentTurn({ characterId: step.characterId });
			if (!result.ok) {
				setToolTestStatus({
					tone: "error",
					text:
						result.reason ??
						`${step.characterId} did not complete a tool call.`,
				});
				return;
			}
			setToolTestStatus({
				tone: "success",
				text: `${step.characterId} called ${result.toolName ?? "a fallback tool"}.`,
			});
			setToolTestStepIndex((current) => current + 1);
		} catch (error) {
			console.error("Tool test step failed:", error);
			setToolTestStatus({
				tone: "error",
				text: "Tool test step failed. See console for details.",
			});
		} finally {
			setIsRunningLlm(false);
		}
	}

	function resetToolTest() {
		setToolTestStepIndex(0);
		setToolTestStatus({
			tone: "idle",
			text: "Ready to run the next tool test step.",
		});
	}

	function saveTileMetadata(
		stableId: string,
		label: string,
		kind: PlaceKind,
		ownerCharacterId: string | null,
	) {
		void updateTileMetadata({
			stableId,
			label,
			placeKind: kind,
			ownerCharacterId,
		});
	}

	return {
		containerRef,
		isLoading: isBaking || state === undefined,
		sidebarProps: {
			activeTab: activeSidebarTab,
			onActiveTabChange: setActiveSidebarTab,
			assets: placeableAssets,
			selectedAssetId,
			onSelectAsset: selectAsset,
			selectedTile,
			actions: state?.actions ?? [],
			characters,
			places,
			messages: state?.chatMessages ?? [],
			toolTestPlan,
			toolTestStepIndex,
			toolTestStatus,
			isRunning: isRunningLlm,
			mode,
			onSetMode: (nextMode: SimulationMode) => void setMode({ mode: nextMode }),
			onRunPopulationStep: () => void handleRunPopulationStep(),
			onRunToolTestStep: () => void handleRunToolTestStep(),
			onResetToolTest: resetToolTest,
			onSaveTileMetadata: saveTileMetadata,
		},
	};
}
