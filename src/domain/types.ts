export type BuildingStatus = "constructing" | "active";

export interface BuildingState {
  id: string;
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
  aptitude: number;
  iv: Record<string, number>;
  buildingId?: string | null;
  job?: string | null;
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
