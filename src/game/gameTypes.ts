import type { BuildingState, ResourceState, RosterMember } from "../domain/types";
import type { JobId } from "../domain/jobs";
import type { GrowthItem, HeldItemId } from "../domain/economy";
import type { BuildingType } from "../domain/construction";

export type Screen = "draft" | "trainerReveal" | "base" | "hunt" | "identify" | "map" | "battle";

export type FacilityOpening = { buildingId: string; memberId: string; jobId: JobId };

export interface BattleSetup {
  territoryId: string;
  enemyName: string;
  enemyTeam: Array<{pokemonId:number;level:number}>;
  firstVictory?: boolean;
  lastCureRound?: number;
}

export type TerritoryOwner = "player" | "trainer" | "unoccupied";
export interface TerritoryState {
  owner: TerritoryOwner;
  trainerId: string | null;
  scouted: boolean;
  active: boolean;
  factionId?: string;
  loyalty?: number;
}

export interface GhostIntel {
  sourceId: string;
  trainerId: string | null;
  pokemonIds: number[];
  memberId?: string;
  reversed?: true;
}

export interface EnemyIntrusion {
  sourceId: string;
  targetId: string;
  defenderId?: string;
}

export interface DarkSabotage {
  sourceId: string;
  targetId: string;
  trainerId: string | null;
  memberId: string;
}

export interface EnemyObservation {
  sourceId: string;
  targetId: string;
  trainerId: string | null;
  detectorId?: string;
}

export interface EnemyDefensePreparation {
  territoryId: string;
  trainerId: string | null;
  leadTypes: number[];
  expiresTurn: number;
}

export interface EnemyEspionage {
  quietTurns: number;
  observation?: EnemyObservation;
  preparation?: EnemyDefensePreparation;
}

export interface FrontierOperations {
  intel: Record<string, GhostIntel>;
  intrusion: EnemyIntrusion | null;
  quietTurns: number;
  sabotage?: DarkSabotage;
  espionage?: EnemyEspionage;
}

export interface ClearingOrder { plotIndex: number; memberId: string }

export interface OutpostState {
  plotCap: number;
  clearing: ClearingOrder | null;
  inheritancePending: boolean;
}

export interface GameState {
  screen: Screen;
  roster: RosterMember[];
  buildings: BuildingState[];
  resources: ResourceState;
  plotCap: number;
  storageCap: number;
  entryCap: number;
  entryOrder: string[];
  turnCount: number;
  regionOpenedTurns: Partial<Record<number, number>>;
  energy: number;
  nextMemberId: number;
  nextBuildingId: number;
  draftRound: number;
  introPending?: boolean;
  caughtSpeciesIds: number[];
  claimedDexRewards: number[];
  legacyOutpostResearch: boolean;
  inheritedResearchCompleted?: true;
  inheritedResearchRewardClaimed?: true;
  endingSeen: boolean;
  selectedPokemonId: number | null;
  selectedTypeName: string | null;
  selectedScan: { x: number; y: number; number: number } | null;
  huntTypeId: number | null;
  counterHunt: { territoryId: string; typeIds: number[] } | null;
  clearing: ClearingOrder | null;
  outposts: Record<string, OutpostState>;
  siteViewId: string | null;
  facilityOpening?: FacilityOpening;
  territories: Record<string, TerritoryState>;
  frontier: FrontierOperations;
  battle: BattleSetup | null;
  mapFocusId: string | null;
  message: string;
  lastLog: string[];
  trainerId: string | null;
  factionDefenderIds: readonly string[];
}

export type GameAction =
  | { type: "PATCH"; patch: Partial<GameState> }
  | { type: "PICK_STARTER"; member: RosterMember; expectedRound: number }
  | { type: "ADD_MEMBER"; member: RosterMember }
  | { type: "SET_ENTRY_ORDER"; memberIds: string[] }
  | { type: "START_BUILDING"; building: BuildingState; memberIds: string[] }
  | { type: "ADD_BUILDERS"; buildingId: string; memberIds: string[] }
  | { type: "REMOVE_BUILDER"; buildingId: string; memberId: string }
  | { type: "CANCEL_BUILDING"; buildingId: string }
  | { type: "ASSIGN_JOB"; buildingId: string; memberId: string; jobId: JobId }
  | { type: "RELEASE_WORKER"; buildingId: string; memberId: string }
  | { type: "START_CLEARING"; plotIndex: number; memberId: string; siteId?: string }
  | { type: "RECALL_CLEARER"; siteId: string; memberId: string }
  | { type: "OPEN_OUTPOST"; siteId: string }
  | { type: "RESOLVE_INHERITANCE"; siteId: string; buildingType: BuildingType | null }
  | { type: "START_HUNT"; typeId?: number }
  | { type: "CONTINUE_HUNT" }
  | { type: "START_COUNTER_HUNT"; territoryId: string; typeIds: number[] }
  | { type: "END_HUNT"; opening?: FacilityOpening }
  | { type: "USE_GROWTH_ITEM"; memberId: string; item: GrowthItem; count?: number; expectedEnergy?: number }
  | { type: "CRAFT_HELD_ITEM"; item: HeldItemId; expectedParts?: number }
  | { type: "EQUIP_HELD_ITEM"; memberId: string; item: HeldItemId }
  | { type: "BUY_ENERGY_CHARGE"; expectedEnergy?: number }
  | { type: "NEXT_TURN"; expectedTurn?: number }
  | { type: "CLAIM_DEX_REWARD"; threshold: number }
  | { type: "CLAIM_INHERITED_RESEARCH_REWARD" }
  | { type: "CONTINUE_AFTER_ENDING" }
  | { type: "SCOUT_TERRITORY"; territoryId: string }
  | { type: "SEND_GHOST_RECON"; sourceId: string; targetId: string; memberId: string; pokemonIds: number[] }
  | { type: "SEND_DARK_SABOTAGE"; sourceId: string; targetId: string; memberId: string }
  | { type: "BLOCK_INTRUSION"; targetId: string; memberId: string }
  | { type: "DETECT_ENEMY_OBSERVATION"; targetId: string; memberId: string }
  | { type: "START_TERRITORY_BATTLE"; setup: BattleSetup }
  | { type: "USE_BATTLE_CURE"; territoryId: string; round: number }
  | { type: "CONCEDE_TERRITORY"; territoryId: string }
  | { type: "CLAIM_TERRITORY"; territoryId: string };
