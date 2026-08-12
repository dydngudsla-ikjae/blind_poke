import type { GameDataBundle } from "../domain/types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 로드 실패 (${response.status})`);
  return response.json() as Promise<T>;
}

export async function loadGameData(): Promise<GameDataBundle> {
  const [pokemon, types, moves, abilities] = await Promise.all([
    fetchJson<GameDataBundle["pokemon"]>("/data/pokemon.json"),
    fetchJson<GameDataBundle["types"]>("/data/type.json"),
    fetchJson<GameDataBundle["moves"]>("/data/move.json"),
    fetchJson<GameDataBundle["abilities"]>("/data/ability.json"),
  ]);
  return { pokemon, types, moves, abilities };
}
