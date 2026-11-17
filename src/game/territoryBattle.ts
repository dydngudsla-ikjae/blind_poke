import type { GameDataBundle, PokemonRecord } from "../domain/types";
import { STARTING_TERRITORY_IDS, worldMapNodes } from "../domain/worldMap";
import { activeDefensePreparation, prefersSecondDefender } from "../domain/frontierOperations";
import { rnd, samplePokemon } from "./gameHelpers";
import type { BattleSetup, GameState } from "./gameTypes";
import { hasFirstVictory, regionProgress } from "./campaign";

export const BATTLE_ENERGY_COST = 2;
export const TRAINER_GROWTH = { interval: 5, limit: 3 };

export function battleEntries(state: GameState) {
  const roster = new Map(state.roster.map(member => [member.id, member]));
  return state.entryOrder.flatMap(id => {
    const member = roster.get(id);
    return member ? [member] : [];
  });
}

export function isEnemyFrontier(state: GameState, id: string) {
  const territory = state.territories[id];
  return Boolean(territory?.active && territory.owner !== "player" &&
    worldMapNodes.find(node => node.id === id)?.neighbors.some(neighbor => state.territories[neighbor]?.owner === "player"));
}

export function canTargetTerritory(state: GameState, id: string) {
  const spot = state.territories[id];
  if (!spot?.active || spot.owner === "player") return false;
  return !STARTING_TERRITORY_IDS.includes(id) || (spot.scouted && isEnemyFrontier(state, id));
}

export function canBattle(state: GameState, id: string) {
  return state.screen === "map" && canTargetTerritory(state, id) &&
    state.energy >= BATTLE_ENERGY_COST && battleEntries(state).length > 0;
}

export function canScoutTerritory(state: GameState, id: string) {
  const spot = state.territories[id];
  return state.screen === "map" && Boolean(spot?.active && spot.owner !== "player" && !spot.scouted &&
    (!STARTING_TERRITORY_IDS.includes(id) || isEnemyFrontier(state, id)));
}

function earlyWild(pokemon: PokemonRecord) {
  return !pokemon.details?.isLegendary && !pokemon.details?.isMythical &&
    pokemon.hp + pokemon.atk + pokemon.def + pokemon.satk + pokemon.sdef + pokemon.spd <= 320;
}

export function canSearchForCounter(state: GameState, id: string) {
  return state.screen === "map" && state.territories[id]?.scouted && canTargetTerritory(state, id);
}

export function territoryOpponents(state: GameState, data: GameDataBundle, id: string) {
  const node = worldMapNodes.find(item => item.id === id);
  if (!node) return null;
  const territory = state.territories[id];
  const trainer = territory.owner === "trainer" ? data.trainers.find(entry => entry.id === territory.trainerId) : undefined;
  const enemyName = trainer?.nameKr ?? (territory.owner === "trainer" ? "거점 트레이너" : "야생 포켓몬");
  const firstVictory = !hasFirstVictory(state);
  const easyWild = data.pokemon.filter(earlyWild);
  if (firstVictory) {
    const pokemon = data.pokemon.find(entry => entry.pokemonRowid === 10) ?? easyWild[0] ?? data.pokemon[0];
    return pokemon ? { node, enemyName, firstVictory, pool: [pokemon] } : null;
  }
  const trainerIds = new Set(trainer?.pokemon.map(pokemon => pokemon.id));
  const trainerTeam = data.pokemon.filter(pokemon => trainerIds.has(pokemon.pokemonRowid));
  const wild = node.region === 1 ? easyWild : data.pokemon.filter(pokemon => !pokemon.details?.isLegendary && !pokemon.details?.isMythical);
  const pool = trainerTeam.length ? trainerTeam : wild.length ? wild : data.pokemon;
  return { node, enemyName, firstVictory, pool };
}

export function trainerGrowth(state: GameState, territoryId: string, region: number) {
  if (state.territories[territoryId]?.owner !== "trainer" || !hasFirstVictory(state)) return { bonus: 0, nextIn: null };
  const elapsed = Math.max(0, state.turnCount - (state.regionOpenedTurns[region] ?? state.turnCount));
  const bonus = Math.min(TRAINER_GROWTH.limit, Math.floor(elapsed / TRAINER_GROWTH.interval));
  return { bonus, nextIn: bonus < TRAINER_GROWTH.limit ? TRAINER_GROWTH.interval - elapsed % TRAINER_GROWTH.interval : null };
}

export function territoryEnemyLevel(state: GameState, region: number, territoryId: string) {
  return 3 + (region - 1) * 5 + Math.floor(regionProgress(state.territories)[region - 1].owned / 2) +
    trainerGrowth(state, territoryId, region).bonus;
}

export function drawGhostIntel(state: GameState, data: GameDataBundle, id: string) {
  const opponents = territoryOpponents(state, data, id);
  return opponents ? samplePokemon(opponents.pool, 2).map(pokemon => pokemon.pokemonRowid) : [];
}

export function prepareTerritoryBattle(state: GameState, data: GameDataBundle, id: string): BattleSetup | null {
  if (!canBattle(state, id)) return null;
  const opponents = territoryOpponents(state, data, id);
  if (!opponents) return null;
  const { node, enemyName, firstVictory, pool } = opponents;
  if (firstVictory) {
    return { territoryId: id, enemyName, firstVictory, enemyTeam: [{ pokemonId: pool[0].pokemonRowid, level: 2 }] };
  }
  const intel = state.frontier.intel[id];
  const revealed = intel && !intel.memberId ? intel.pokemonIds.map(pokemonId => pool.find(pokemon => pokemon.pokemonRowid === pokemonId)) : [];
  const reportAvailable = revealed.length > 0 && revealed.every(pokemon => pokemon !== undefined);
  // Draw levels in the original order so a prepared lead only changes deployment order.
  const team = reportAvailable ? (intel.reversed ? [...revealed].reverse() : revealed)
    : samplePokemon(pool, node.region === 1 ? 1 : 2);
  const level = territoryEnemyLevel(state, node.region, id);
  if (!team.length) return null;
  const enemyTeam = team.map(pokemon => ({ pokemonId: pokemon.pokemonRowid, level: rnd(level, level + 1) }));
  if (reportAvailable ? intel.reversed : prefersSecondDefender(id, enemyTeam.map(entry => entry.pokemonId),
    activeDefensePreparation(state, id), data)) enemyTeam.reverse();
  return {
    territoryId: id,
    enemyName,
    enemyTeam,
  };
}
