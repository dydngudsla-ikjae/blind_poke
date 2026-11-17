import type { JobId } from "./jobs";

export type BuildingStatus = "constructing" | "active";

export interface BuildingState {
  id: string;
  siteId?: string;
  inherited?: true;
  type: string;
  plotIndex: number;
  status: BuildingStatus;
  remainingTurns: number;
}

export interface PokemonRecord {
  pokemonRowid: number;
  nameKr: string;
  type1Rowid?: number;
  type2Rowid?: number;
  hp: number;
  atk: number;
  def: number;
  satk: number;
  sdef: number;
  spd: number;
  heightM?: number;
  weightKg?: number;
  baseRowid?: number;
  details?: Record<string, any>;
}

export interface RosterMember {
  id: string;
  pokemon: PokemonRecord;
  alias: string;
  level: number;
  exp: number;
  favor: number;
  favCeil: number;
  favFloor: number;
  departurePending?: boolean;
  aptitude: number;
  iv: Record<string, number>;
  buildingId?: string | null;
  jobId?: JobId | null;
  jobOrder?: number;
  productionCarry?: Partial<Record<JobId, number>>;
  /** @deprecated legacy save migration only */ inEntry?: boolean;
  heldItem?: string | null;
}

export interface ResourceState {
  seed: number; fruit: number; food: number; material: number; gold: number;
  tool: number; tm: number; candy: number; healItem: number; cureItem: number;
  items: Record<string, number>;
}

export interface GameDataBundle {
  pokemon: PokemonRecord[];
  types: TypeRecord[];
  moves: MoveRecord[];
  abilities: AbilityRecord[];
  trainers: TrainerRecord[];
  battle: BattleData;
}

export type BattleStat = "atk" | "def" | "satk" | "sdef" | "spd";
export const BATTLE_STATUS_KINDS = ["poison", "toxic", "burn", "paralysis", "sleep", "freeze"] as const;
export type BattleStatusKind = (typeof BATTLE_STATUS_KINDS)[number];
export interface BattleBoost {
  target: "actor" | "target";
  changes: Partial<Record<BattleStat, number>>;
}
export interface BattleMoveRule {
  contact?: true;
  priority?: number;
  boosts?: BattleBoost;
  secondary?: { chance: number; flinch?: true; boosts?: BattleBoost; status?: BattleStatusKind };
  status?: BattleStatusKind;
  powder?: true;
  statusTypeCheck?: true;
  requiresSleep?: "actor" | "target";
  drain?: [number, number];
  recoil?: [number, number];
  selfKO?: true;
  weightPower?: true;
}
export interface BattleData {
  learnsets: Record<string, Array<[moveId: number, level: number]>>;
  statusLearnsets?: Record<string, Array<[moveId: number, level: number]>>;
  campaignUnlocks?: Record<string, Array<[moveId: number, level: number]>>;
  inheritedAttacks?: Record<string, Array<[moveId: number, level: number]>>;
  moves: Record<string, BattleMoveRule>;
}

export interface MoveRecord { moveRowid:number; typeRowid:number; nameKr:string; descriptionKr?:string; details:{accuracy:number|null;power:number|null;pp:number;damageClass:number} }
export interface TypeRecord { typeRowid:number; nameKr:string; relation?:{relationMap:Record<string,{damageFrom:number;damageTo:number}>} }
export interface AbilityRecord { abilityRowid:number; nameKr:string; descriptionKr?:string }
export interface TrainerTypeRef { id:number; nameKr:string }
export interface TrainerPokemonRef { id:number; nameKr:string }
export interface TrainerRecord {
  id:string;
  nameKr:string;
  nameEn:string;
  generation:number;
  region:string;
  roles:string[];
  specialtyTypes:TrainerTypeRef[];
  pokemon:TrainerPokemonRef[];
}

export interface SaveEnvelope {
  v: number;
  roster: Array<Record<string, unknown>>;
  resources: Record<string, unknown>;
  buildings?: BuildingState[];
  [key: string]: unknown;
}
