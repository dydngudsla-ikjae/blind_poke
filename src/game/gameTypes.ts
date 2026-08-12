import type { BuildingState, ResourceState, RosterMember } from "../domain/types";

export type Screen = "draft" | "base" | "hunt" | "identify" | "map" | "battle";

export interface BattleSetup {
  territoryId: string;
  enemyName: string;
  enemyTeam: Array<{pokemonId:number;level:number}>;
}

export interface GameState {
  screen: Screen;
  roster: RosterMember[];
  buildings: BuildingState[];
  resources: ResourceState;
  plotCap: number;
  storageCap: number;
  entryCap: number;
  turnCount: number;
  energy: number;
  nextMemberId: number;
  nextBuildingId: number;
  draftRound: number;
  selectedPokemonId: number | null;
  territories: Record<string, "player" | "wild">;
  battle: BattleSetup | null;
  message: string;
  lastLog: string[];
}

export type GameAction =
  | { type: "PATCH"; patch: Partial<GameState> }
  | { type: "ADD_MEMBER"; member: RosterMember }
  | { type: "START_BUILDING"; building: BuildingState; memberIds: string[] }
  | { type: "ADD_BUILDERS"; buildingId: string; memberIds: string[]; remainingTurns: number }
  | { type: "REMOVE_BUILDER"; buildingId: string; memberId: string }
  | { type: "CANCEL_BUILDING"; buildingId: string }
  | { type: "NEXT_TURN" }
  | { type: "CLAIM_TERRITORY"; territoryId: string };
