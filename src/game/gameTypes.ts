import type { BuildingState, ResourceState, RosterMember } from "../domain/types";

export type Screen = "draft" | "trainerReveal" | "base" | "hunt" | "identify" | "map" | "battle";

export interface BattleSetup {
  territoryId: string;
  enemyName: string;
  enemyTeam: Array<{pokemonId:number;level:number}>;
}

export type TerritoryOwner = "player" | "trainer" | "unoccupied";
export interface TerritoryState {
  owner: TerritoryOwner;
  trainerId: string | null;
  scouted: boolean;
  active: boolean;
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
  energy: number;
  nextMemberId: number;
  nextBuildingId: number;
  draftRound: number;
  selectedPokemonId: number | null;
  territories: Record<string, TerritoryState>;
  battle: BattleSetup | null;
  message: string;
  lastLog: string[];
  trainerId: string | null;
}

export type GameAction =
  | { type: "PATCH"; patch: Partial<GameState> }
  | { type: "ADD_MEMBER"; member: RosterMember }
  | { type: "SET_ENTRY_ORDER"; memberIds: string[] }
  | { type: "START_BUILDING"; building: BuildingState; memberIds: string[] }
  | { type: "ADD_BUILDERS"; buildingId: string; memberIds: string[]; remainingTurns: number }
  | { type: "REMOVE_BUILDER"; buildingId: string; memberId: string }
  | { type: "CANCEL_BUILDING"; buildingId: string }
  | { type: "NEXT_TURN" }
  | { type: "SCOUT_TERRITORY"; territoryId: string }
  | { type: "CLAIM_TERRITORY"; territoryId: string };
