import { buildCombatant, calculateDamage, campaignLearnLevels, effectiveAttack, effectiveness, pickMoveset, TACKLE, type Combatant } from "../domain/battle";
import { candyCostToLevel, candyMember } from "../domain/economy";
import type { GameDataBundle, PokemonRecord, RosterMember } from "../domain/types";
import type { GameState } from "./gameTypes";
import { hasFirstVictory } from "./campaign";
import { battleEntries, canSearchForCounter, FIRST_BATTLE_LEVEL, territoryEnemyLevel, territoryOpponents } from "./territoryBattle";

export function preparedTypeLabel(typeIds: number[], data: GameDataBundle) {
  return typeIds.map(id => data.types.find(type => type.typeRowid === id)?.nameKr ?? "미확인").join(" · ");
}

function pokemonTypes(pokemon: PokemonRecord) {
  const types = [pokemon.type1Rowid, pokemon.type2Rowid].filter((id): id is number => id != null);
  return [...new Set(types)].sort((a, b) => a - b);
}

export function firstBattleBrief(state: GameState, data: GameDataBundle, territoryId: string) {
  if (hasFirstVictory(state) || !canSearchForCounter(state, territoryId)) return null;
  const pokemon = territoryOpponents(state, data, territoryId)?.pool[0];
  if (!pokemon) return null;
  const enemy = buildCombatant({ pokemon, level: FIRST_BATTLE_LEVEL }, data, "first-opponent");
  const entries = battleEntries(state).map(member => {
    const ally = buildCombatant(member, data, member.id);
    const attacks = ally.moves.filter(move => effectiveAttack([move], enemy.types, data)).map(move => {
      const damage = Math.min(enemy.maxHp, calculateDamage(ally, enemy, move, data));
      return { move, damage, expected: damage * (move.accuracy || 100) };
    });
    const best = attacks.sort((a, b) => b.expected - a.expected || b.damage - a.damage)[0] ?? null;
    return { member, best };
  });
  return { enemy, entries };
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

function scoutedOpponents(state: GameState, data: GameDataBundle, territoryId: string) {
  if (!canSearchForCounter(state, territoryId)) return null;
  const opponents = territoryOpponents(state, data, territoryId);
  if (!opponents) return null;
  const level = territoryEnemyLevel(state, opponents.node.region, territoryId);
  return { ...opponents, pool: opponents.revealedTeam?.members ?? opponents.pool,
    levels: opponents.firstVictory ? [FIRST_BATTLE_LEVEL] : [level, level + 1] };
}

function scoutCombatants(members: PokemonRecord[], levels: number[], data: GameDataBundle) {
  return members.flatMap(pokemon => levels.map(level => buildCombatant({ pokemon, level }, data, "scout")));
}

function forecastAttacks(actor: Combatant, foes: Combatant[], typeIds: number[], data: GameDataBundle, ppDamage?: number[]) {
  let effectivePp = 0;
  const options = actor.moves.filter(move => effectiveAttack([move], [], data)).map(move => {
    const multiplier = effectiveness(move.typeRowid, typeIds, data);
    if (multiplier > 0) effectivePp += move.pp;
    const hits = foes.map((foe, index) => {
      const damage = multiplier > 0 ? Math.min(foe.maxHp, calculateDamage(actor, foe, move, data)) : 0;
      if (ppDamage) ppDamage[index] += move.pp * damage;
      return damage;
    });
    const score = hits.reduce((sum, damage) => sum + damage, 0) * (move.accuracy || 100);
    return { move, multiplier, minDamage: Math.min(...hits), maxDamage: Math.max(...hits), score };
  });
  const best = options.sort((a, b) => b.score - a.score || b.multiplier - a.multiplier)[0];
  return { best, effectivePp };
}

function scoutedMatchup(state: GameState, data: GameDataBundle, territoryId: string, typeIds: number[]) {
  const opponents = scoutedOpponents(state, data, territoryId);
  if (!opponents || !typeIds.length) return [];
  const typeKey = [...typeIds].sort((a, b) => a - b).join("-");
  const candidates = opponents.pool.filter(pokemon => pokemonTypes(pokemon).join("-") === typeKey);
  return scoutCombatants(candidates, opponents.levels, data);
}

export function reserveAttackForecast(state: GameState, data: GameDataBundle, territoryId: string, typeIds: number[]) {
  const reserves = state.roster.filter(member => !state.entryOrder.includes(member.id));
  if (!reserves.length) return [];
  const foes = scoutedMatchup(state, data, territoryId, typeIds);
  if (!foes.length) return [];

  return reserves.flatMap(member => {
    const actor = buildCombatant(member, data, member.id);
    const { best, effectivePp } = forecastAttacks(actor, foes, typeIds, data);
    return best && effectivePp > 0 ? [{ member, best, effectivePp }] : [];
  }).sort((a, b) => b.best.score - a.best.score || b.effectivePp - a.effectivePp);
}

export function nextLevelScoutedAttack(state: GameState, data: GameDataBundle, territoryId: string, member: RosterMember, typeIds: number[]) {
  const foes = scoutedMatchup(state, data, territoryId, typeIds);
  if (!foes.length) return null;
  const { best: current } = forecastAttacks(buildCombatant(member, data, member.id), foes, typeIds, data);
  if (!current || current.multiplier <= 0) return null;
  const candy = candyCostToLevel(member, member.level + 1);
  const trained = buildCombatant(candyMember(member, candy), data, member.id);
  const sameMove = trained.moves.filter(move => move.id === current.move.id);
  const { best: attack } = forecastAttacks({ ...trained, moves: sameMove }, foes, typeIds, data);
  return attack && attack.score > current.score ? { level: trained.level, candy, current, attack } : null;
}

export function nextStrongerScoutedMove(state: GameState, data: GameDataBundle, territoryId: string, member: RosterMember, typeIds: number[]) {
  const foes = scoutedMatchup(state, data, territoryId, typeIds);
  if (!foes.length) return null;
  const actor = buildCombatant(member, data, member.id);
  const { best: current } = forecastAttacks(actor, foes, typeIds, data);
  const currentMoves = new Set(actor.moves.map(move => move.id));
  for (const level of campaignLearnLevels(member.pokemon, data)) {
    if (level <= member.level) continue;
    const candy = candyCostToLevel(member, level);
    const trained = candyMember(member, candy);
    const { best: attack } = forecastAttacks(buildCombatant(trained, data, member.id), foes, typeIds, data);
    if (attack && !currentMoves.has(attack.move.id) && attack.score > (current?.score ?? 0)) {
      return { level: trained.level, candy, current, attack };
    }
  }
  return null;
}

export function territoryTactics(state: GameState, data: GameDataBundle, territoryId: string) {
  const opponents = scoutedOpponents(state, data, territoryId);
  if (!opponents) return [];
  const entries = battleEntries(state).map(member => ({
    member, actor: buildCombatant(member, data, member.id),
  }));
  if (!entries.length) return [];
  const forecastPp = !opponents.firstVictory && opponents.node.region === 1;
  const candidates = new Map<string, { typeIds: number[]; attackTypes: Set<number>; members: PokemonRecord[] }>();
  for (const pokemon of opponents.pool) {
    const typeIds = pokemonTypes(pokemon);
    if (!typeIds.length) continue;
    const key = typeIds.join("-");
    const group = candidates.get(key) ?? { typeIds, attackTypes: new Set<number>(), members: [] };
    group.members.push(pokemon);
    const moves = opponents.firstVictory ? [TACKLE] : opponents.levels.flatMap(level => pickMoveset(pokemon, level, data));
    for (const move of moves) {
      if (move.typeRowid !== null && (move.power > 0 || move.weightPower)) group.attackTypes.add(move.typeRowid);
    }
    candidates.set(key, group);
  }
  return [...candidates].map(([key, { typeIds, attackTypes, members }]) => {
    const foes = scoutCombatants(members, opponents.levels, data);
    const ppDamage = forecastPp ? foes.map(() => 0) : undefined;
    const attacks = entries.map(({ member, actor }) => ({ member, ...forecastAttacks(actor, foes, typeIds, data, ppDamage) }));
    const ppShortfall = ppDamage !== undefined && attacks.some(({ effectivePp }) => effectivePp > 0) &&
      foes.some((foe, index) => ppDamage[index] < foe.maxHp);
    const threats = [...attackTypes].flatMap(typeId => {
      const matchups = entries.map(({ member, actor }) => ({ member, multiplier: effectiveness(typeId, actor.types, data) }));
      const weak = matchups.filter(({ multiplier }) => multiplier > 1).map(({ member }) => member);
      if (!weak.length) return [];
      const switches = matchups.filter(({ multiplier }) => multiplier <= 1).sort((a, b) => a.multiplier - b.multiplier);
      return [{ typeId, weak, switches }];
    }).sort((a, b) => b.weak.length - a.weak.length || a.typeId - b.typeId);
    return { key, typeIds, attacks, ppShortfall, threats, reported: Boolean(opponents.revealedTeam) };
  }).sort((a, b) => (b.threats[0]?.weak.length ?? 0) - (a.threats[0]?.weak.length ?? 0) || a.key.localeCompare(b.key));
}

export function uncoveredTerritoryTypes(state: GameState, data: GameDataBundle, territoryId: string) {
  const opponents = scoutedOpponents(state, data, territoryId);
  if (!opponents) return [];
  const entries = battleEntries(state);
  if (!entries.length) return [];
  const moves = entries.flatMap(member => pickMoveset(member.pokemon, member.level, data));
  const groups = new Map<string, { key: string; typeIds: number[] }>();
  for (const pokemon of opponents.pool) {
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
