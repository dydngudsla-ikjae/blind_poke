import { campaignLearnLevels, effectiveAttack, effectiveness, pickMoveset, TACKLE } from "../domain/battle";
import { candyCostToLevel, candyMember } from "../domain/economy";
import type { GameDataBundle, PokemonRecord, RosterMember } from "../domain/types";
import type { GameState } from "./gameTypes";
import { battleEntries, canSearchForCounter, territoryEnemyLevel, territoryOpponents } from "./territoryBattle";

export function preparedTypeLabel(typeIds: number[], data: GameDataBundle) {
  return typeIds.map(id => data.types.find(type => type.typeRowid === id)?.nameKr ?? "미확인").join(" · ");
}

function pokemonTypes(pokemon: PokemonRecord) {
  const types = [pokemon.type1Rowid, pokemon.type2Rowid].filter((id): id is number => id != null);
  return [...new Set(types)].sort((a, b) => a - b);
}

export function nextWeaknessMove(member: RosterMember, data: GameDataBundle, targetTypes: number[]) {
  if (!targetTypes.length) return null;
  const current = new Set(pickMoveset(member.pokemon, member.level, data).map(move => move.id));
  const levels = campaignLearnLevels(member.pokemon, data).filter(level => level > member.level);
  for (const level of levels) {
    const candy = candyCostToLevel(member, level);
    const trained = candyMember(member, candy);
    const moves = pickMoveset(member.pokemon, trained.level, data).filter(move => !current.has(move.id));
    const move = effectiveAttack(moves, targetTypes, data, 2);
    if (move) return { level: trained.level, candy, move };
  }
  return null;
}

export function territoryTactics(state: GameState, data: GameDataBundle, territoryId: string) {
  if (!canSearchForCounter(state, territoryId)) return [];
  const opponents = territoryOpponents(state, data, territoryId);
  const entries = battleEntries(state).map(member => ({
    member, types: pokemonTypes(member.pokemon), moves: pickMoveset(member.pokemon, member.level, data),
  }));
  if (!opponents || !entries.length) return [];
  const level = territoryEnemyLevel(state, opponents.node.region, territoryId);
  const candidates = new Map<string, { typeIds: number[]; attackTypes: Set<number> }>();
  for (const pokemon of opponents.pool) {
    const typeIds = pokemonTypes(pokemon);
    if (!typeIds.length) continue;
    const key = typeIds.join("-");
    const group = candidates.get(key) ?? { typeIds, attackTypes: new Set<number>() };
    const moves = opponents.firstVictory ? [TACKLE] : [...pickMoveset(pokemon, level, data), ...pickMoveset(pokemon, level + 1, data)];
    for (const move of moves) {
      if (move.typeRowid !== null && (move.power > 0 || move.weightPower)) group.attackTypes.add(move.typeRowid);
    }
    candidates.set(key, group);
  }
  return [...candidates].map(([key, { typeIds, attackTypes }]) => ({
    key,
    typeIds,
    attacks: entries.map(({ member, moves }) => {
      const ordinary = moves.filter(move => effectiveAttack([move], [], data));
      const options = ordinary.map(move => ({ move, multiplier: effectiveness(move.typeRowid, typeIds, data) }));
      return { member, best: options.sort((a, b) => b.multiplier - a.multiplier)[0] };
    }),
    threats: [...attackTypes].flatMap(typeId => {
      const matchups = entries.map(({ member, types }) => ({ member, multiplier: effectiveness(typeId, types, data) }));
      const weak = matchups.filter(({ multiplier }) => multiplier > 1).map(({ member }) => member);
      if (!weak.length) return [];
      const switches = matchups.filter(({ multiplier }) => multiplier <= 1).sort((a, b) => a.multiplier - b.multiplier);
      return [{ typeId, weak, switches }];
    }).sort((a, b) => b.weak.length - a.weak.length || a.typeId - b.typeId),
  })).sort((a, b) => (b.threats[0]?.weak.length ?? 0) - (a.threats[0]?.weak.length ?? 0) || a.key.localeCompare(b.key));
}

export function uncoveredTerritoryTypes(state: GameState, data: GameDataBundle, territoryId: string) {
  if (!canSearchForCounter(state, territoryId)) return [];
  const entries = battleEntries(state);
  if (!entries.length) return [];
  const moves = entries.flatMap(member => pickMoveset(member.pokemon, member.level, data));
  const groups = new Map<string, { key: string; typeIds: number[] }>();
  for (const pokemon of territoryOpponents(state, data, territoryId)?.pool ?? []) {
    const typeIds = pokemonTypes(pokemon);
    const key = typeIds.join("-");
    if (key && !groups.has(key) && !effectiveAttack(moves, typeIds, data)) groups.set(key, { key, typeIds });
  }
  return [...groups.values()].sort((a, b) => Number(b.typeIds.includes(8)) - Number(a.typeIds.includes(8)));
}

export function territoryPreparation(state: GameState, data: GameDataBundle, targetTypes: number[]) {
  for (const member of state.roster) {
    if (state.entryOrder.includes(member.id)) continue;
    const move = effectiveAttack(pickMoveset(member.pokemon, member.level, data), targetTypes, data);
    if (move) return { kind: "entry" as const, member, move };
  }

  const limit = state.resources.candy;
  let best: { kind: "growth"; member: GameState["roster"][number]; level: number; candy: number; move: NonNullable<ReturnType<typeof effectiveAttack>> } | null = null;
  for (const member of state.roster) {
    let grown = member;
    for (let used = 1; used <= limit && (!best || used < best.candy); used++) {
      const next = candyMember(grown);
      if (next.level > grown.level) {
        const move = effectiveAttack(pickMoveset(next.pokemon, next.level, data), targetTypes, data);
        if (move) {
          best = { kind: "growth", member, level: next.level, candy: used, move };
          break;
        }
      }
      grown = next;
    }
  }
  return best;
}

export function counterHuntPool(data: GameDataBundle, targetTypes: number[]) {
  const neutral: PokemonRecord[] = [];
  const resisted: PokemonRecord[] = [];
  for (const pokemon of data.pokemon) {
    if (pokemon.details?.isLegendary || pokemon.details?.isMythical) continue;
    const moves = pickMoveset(pokemon, 1, data);
    if (effectiveAttack(moves, targetTypes, data, 1)) neutral.push(pokemon);
    else if (effectiveAttack(moves, targetTypes, data)) resisted.push(pokemon);
  }
  return neutral.length ? neutral : resisted;
}
