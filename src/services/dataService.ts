import { BATTLE_STATUS_KINDS, type GameDataBundle } from "../domain/types";
import { z } from "zod";

const positiveInteger = z.number().int().positive();
const ratio = z.tuple([positiveInteger, positiveInteger]);
const boost = z.object({
  target: z.enum(["actor", "target"]),
  changes: z.partialRecord(z.enum(["atk", "def", "satk", "sdef", "spd"]), z.number().int().min(-6).max(6)),
});
const levelMoves = z.record(z.string(), z.array(z.tuple([positiveInteger, positiveInteger])));
const statusKind = z.enum(BATTLE_STATUS_KINDS);
const battleDataSchema = z.object({
  learnsets: levelMoves,
  statusLearnsets: levelMoves.optional(),
  campaignUnlocks: levelMoves.optional(),
  inheritedAttacks: levelMoves.optional(),
  moves: z.record(z.string(), z.object({
    contact: z.literal(true).optional(),
    priority: z.number().int().optional(),
    boosts: boost.optional(),
    secondary: z.object({
      chance: positiveInteger.max(100), flinch: z.literal(true).optional(), boosts: boost.optional(), status: statusKind.optional(),
    }).optional(),
    status: statusKind.optional(),
    powder: z.literal(true).optional(),
    statusTypeCheck: z.literal(true).optional(),
    requiresSleep: z.enum(["actor", "target"]).optional(),
    drain: ratio.optional(),
    recoil: ratio.optional(),
    selfKO: z.literal(true).optional(),
    weightPower: z.literal(true).optional(),
  })),
});

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} 로드 실패 (${response.status})`);
  try { return await response.json(); }
  catch { throw new Error(`${url} 데이터를 읽을 수 없습니다.`); }
}

function hasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && keys.every(key => Object.hasOwn(value, key)));
}

function records<T>(value: unknown, file: string, keys: string[]): T[] {
  if (!Array.isArray(value) || !value.length || !value.every(row => hasKeys(row, keys))) {
    throw new Error(`${file} 데이터 형식이 올바르지 않습니다.`);
  }
  return value as T[];
}

export async function loadGameData(signal?: AbortSignal): Promise<GameDataBundle> {
  const [pokemon, types, moves, abilities, trainerData, battleData] = await Promise.all([
    fetchJson("/data/pokemon.json", signal), fetchJson("/data/type.json", signal), fetchJson("/data/move.json", signal),
    fetchJson("/data/ability.json", signal), fetchJson("/data/trainer.json", signal), fetchJson("/data/battle.json", signal),
  ]);
  const battle = battleDataSchema.safeParse(battleData);
  if (!battle.success) throw new Error("battle.json 데이터 형식이 올바르지 않습니다.");
  return {
    pokemon: records(pokemon, "pokemon.json", ["pokemonRowid", "nameKr", "hp", "atk", "def", "satk", "sdef", "spd"]),
    types: records(types, "type.json", ["typeRowid", "nameKr"]),
    moves: records(moves, "move.json", ["moveRowid", "typeRowid", "nameKr", "details"]),
    abilities: records(abilities, "ability.json", ["abilityRowid", "nameKr"]),
    battle: battle.data,
    trainers: records(hasKeys(trainerData, ["trainers"]) ? trainerData.trainers : null,
      "trainer.json", ["id", "nameKr", "region", "specialtyTypes", "pokemon"]),
  };
}
