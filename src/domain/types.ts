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
  inEntry?: boolean;
  heldItem?: string | null;
}

export interface ResourceState {
  seed: number; fruit: number; food: number; material: number; gold: number;
  tool: number; tm: number; candy: number; healItem: number; cureItem: number;
  items: Record<string, number>;
}

export interface GameDataBundle {
  pokemon: PokemonRecord[];
  types: Array<Record<string, unknown>>;
  moves: Array<Record<string, unknown>>;
  abilities: Array<Record<string, unknown>>;
}

export interface SaveEnvelope {
  v: number;
  roster: Array<Record<string, unknown>>;
  resources: Record<string, unknown>;
  buildings?: BuildingState[];
  [key: string]: unknown;
}
