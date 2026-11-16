import type { DarkSabotage, EnemyDefensePreparation, EnemyEspionage, EnemyIntrusion, EnemyObservation,
  FrontierOperations, GameState, TerritoryState } from "../game/gameTypes";
import type { GameDataBundle, PokemonRecord } from "./types";
import { effectiveness } from "./battle";
import { hasPokemonType } from "./jobs";
import { suppliedTerritories, TERRITORY_GOLD } from "./territorySupply";
import { worldMapNodes } from "./worldMap";
import { clearingSiteOf, inheritanceCandidates } from "./settlements";

export const GHOST_TYPE = 8;
export const FLYING_TYPE = 3;
export const DRAGON_TYPE = 16;
export const DARK_TYPE = 17;
export const FRONTIER_ENERGY_COST = 1;
export const INTRUSION_QUIET_TURNS = 3;
export const ESPIONAGE_QUIET_TURNS = 3;
const PREPARATION_TURNS = 3;

const laterNodes = worldMapNodes.filter(node => node.region > 1);
const laterById = new Map(laterNodes.map(node => [node.id, node]));
type Territories = Record<string, TerritoryState>;
type TerritoryOwners = Record<string, Pick<TerritoryState, "owner" | "active">>;

export function hasEnemyWorkshop(territories: TerritoryOwners, siteId: string) {
  const site = territories[siteId];
  return site?.active && site.owner === "trainer" && inheritanceCandidates(siteId).includes("workshop");
}

export function enemyPartsSupply(territories: Territories, stoppedWorkshop?: string) {
  // A single new warning spends one part and nothing carries over. Only reachability needs to survive this calculation.
  const queue = laterNodes.filter(({ id }) => id !== stoppedWorkshop && hasEnemyWorkshop(territories, id)).map(({ id }) => id);
  const supplied = new Set(queue);
  for (const id of queue) {
    const factionId = territories[id].factionId;
    if (!factionId) continue;
    for (const neighbor of laterById.get(id)?.neighbors ?? []) {
      const site = territories[neighbor];
      if (supplied.has(neighbor) || !laterById.has(neighbor) ||
        !site?.active || site.owner !== "trainer" || site.factionId !== factionId) continue;
      supplied.add(neighbor);
      queue.push(neighbor);
    }
  }
  return supplied;
}

export function frontierSources(territories: TerritoryOwners, enemyId: string, supplied = suppliedTerritories(territories)) {
  const enemy = territories[enemyId];
  if (!enemy?.active || enemy.owner !== "trainer") return [];
  return laterById.get(enemyId)?.neighbors.filter(id => laterById.has(id) && supplied.has(id)) ?? [];
}

export function activeIntrusion(territories: TerritoryOwners, intrusion: EnemyIntrusion | null | undefined) {
  return intrusion && frontierSources(territories, intrusion.sourceId).includes(intrusion.targetId) ? intrusion : null;
}

export function activeObservation(territories: Territories, observation: EnemyObservation | undefined,
  supplied?: Set<string>) {
  return observation && territories[observation.sourceId]?.trainerId === observation.trainerId &&
    frontierSources(territories, observation.sourceId, supplied).includes(observation.targetId) ? observation : undefined;
}

function preparationActive(territories: Territories, preparation: EnemyDefensePreparation | undefined, turn: number) {
  if (!preparation || preparation.expiresTurn <= turn) return undefined;
  const site = territories[preparation.territoryId];
  return laterById.has(preparation.territoryId) && site?.active && site.owner === "trainer" &&
    site.trainerId === preparation.trainerId ? preparation : undefined;
}

export function activeDefensePreparation(state: GameState, territoryId: string) {
  const preparation = preparationActive(state.territories, state.frontier.espionage?.preparation, state.turnCount);
  return preparation?.territoryId === territoryId ? preparation : undefined;
}

function pokemonTypes(pokemon: PokemonRecord) {
  return [...new Set([pokemon.type1Rowid, pokemon.type2Rowid])].filter((id): id is number => id != null);
}

export function prefersSecondDefender(territoryId: string, ids: number[], preparation: EnemyDefensePreparation | undefined,
  data: GameDataBundle | undefined) {
  if (!data || preparation?.territoryId !== territoryId || ids.length !== 2) return false;
  const first = data.pokemon.find(pokemon => pokemon.pokemonRowid === ids[0]);
  const second = data.pokemon.find(pokemon => pokemon.pokemonRowid === ids[1]);
  if (!first || !second) return false;
  const matchup = (pokemon: PokemonRecord) => Math.max(0, ...pokemonTypes(pokemon).map(type => effectiveness(type, preparation.leadTypes, data)));
  return matchup(second) > matchup(first);
}

export function isOnFrontierDuty(frontier: FrontierOperations, memberId: string) {
  return frontier.intrusion?.defenderId === memberId || frontier.sabotage?.memberId === memberId ||
    frontier.espionage?.observation?.detectorId === memberId ||
    Object.values(frontier.intel).some(order => order.memberId === memberId);
}

export function availableFrontierWorkers(state: GameState, typeId: number) {
  return state.roster.filter(member => !member.buildingId && !member.jobId && !clearingSiteOf(state, member.id) &&
    !isOnFrontierDuty(state.frontier, member.id) && hasPokemonType(member.pokemon, typeId));
}

export function validIntelRoster(ids: number[]) {
  return ids.length > 0 && ids.length <= 2 && new Set(ids).size === ids.length && ids.every(id => Number.isSafeInteger(id) && id > 0);
}

function hasSameDefender(territories: Territories, targetId: string, trainerId: string | null) {
  const target = territories[targetId];
  return laterById.has(targetId) && target?.active && target.owner === "trainer" && target.scouted && target.trainerId === trainerId;
}

export function activeSabotage(territories: Territories, order: DarkSabotage | undefined, supplied = suppliedTerritories(territories)) {
  return order && hasSameDefender(territories, order.targetId, order.trainerId) && hasEnemyWorkshop(territories, order.targetId) &&
    frontierSources(territories, order.targetId, supplied).includes(order.sourceId) ? order : undefined;
}

export function restoreFrontier(state: GameState, saved: FrontierOperations | undefined): FrontierOperations {
  if (!saved) return state.frontier;
  const reserved = new Set<string>();
  const canWork = (id: string, type: number) => !reserved.has(id) &&
    availableFrontierWorkers(state, type).some(member => member.id === id);
  let { intrusion } = saved;
  if (intrusion && (!laterById.has(intrusion.targetId) || !laterById.get(intrusion.sourceId)?.neighbors.includes(intrusion.targetId))) intrusion = null;
  if (intrusion?.defenderId) {
    if (canWork(intrusion.defenderId, DRAGON_TYPE)) reserved.add(intrusion.defenderId);
    else intrusion = { sourceId: intrusion.sourceId, targetId: intrusion.targetId };
  }
  const intel: FrontierOperations["intel"] = {};
  for (const [id, order] of Object.entries(saved.intel)) {
    if (!hasSameDefender(state.territories, id, order.trainerId) || !validIntelRoster(order.pokemonIds) ||
      !laterById.has(order.sourceId) || !laterById.get(id)?.neighbors.includes(order.sourceId)) continue;
    if (order.memberId) {
      if (!canWork(order.memberId, GHOST_TYPE)) continue;
      reserved.add(order.memberId);
    }
    intel[id] = order;
  }
  const order = saved.sabotage;
  const sabotage = order && inheritanceCandidates(order.targetId).includes("workshop") && laterById.has(order.sourceId) &&
    laterById.get(order.targetId)?.neighbors.includes(order.sourceId) && canWork(order.memberId, DARK_TYPE) ? order : undefined;
  if (sabotage) reserved.add(sabotage.memberId);
  const savedEspionage = saved.espionage;
  let observation = savedEspionage?.observation;
  if (observation && (!laterById.has(observation.targetId) || !laterById.get(observation.sourceId)?.neighbors.includes(observation.targetId))) {
    observation = undefined;
  }
  if (observation?.detectorId && !canWork(observation.detectorId, FLYING_TYPE)) {
    const { detectorId: _invalid, ...undetected } = observation;
    observation = undetected;
  }
  const preparation = preparationActive(state.territories, savedEspionage?.preparation, state.turnCount);
  const quiet = observation ? 0 : savedEspionage?.quietTurns ?? 0;
  const espionage = observation || preparation || quiet ? { quietTurns: quiet, observation, preparation } : undefined;
  return { intel, intrusion, quietTurns: intrusion ? 0 : saved.quietTurns, ...(sabotage ? { sabotage } : {}),
    ...(espionage ? { espionage } : {}) };
}

function advanceIntrusion(state: GameState, territories: Territories, supplied: Set<string>, stoppedWorkshop: string | undefined,
  log: string[]) {
  const { intrusion, quietTurns } = state.frontier;
  if (intrusion) {
    const target = laterById.get(intrusion.targetId)!;
    const result = !activeIntrusion(state.territories, intrusion) ? "침투 위협 해소"
      : intrusion.defenderId ? "침투 차단" : `적 침투 성공 · 턴당 수입 ${TERRITORY_GOLD} 제외`;
    log.push(`${target.name} · ${result}`);
    return { intrusion: null, quietTurns: INTRUSION_QUIET_TURNS };
  }
  if (quietTurns > 0) return { intrusion: null, quietTurns: quietTurns - 1 };

  const enemySupply = enemyPartsSupply(territories, stoppedWorkshop);
  for (const target of laterNodes) {
    if (!supplied.has(target.id)) continue;
    const sourceId = target.neighbors.find(id => enemySupply.has(id));
    if (!sourceId) continue;
    log.push(`${target.name} · 적 침투 예고 · 다음 턴 정산`);
    return { intrusion: { sourceId, targetId: target.id }, quietTurns: 0 };
  }
  return { intrusion: null, quietTurns: 0 };
}

function advanceEspionage(state: GameState, territories: Territories, supplied: Set<string>, financialWarning: boolean,
  log: string[]): EnemyEspionage | undefined {
  const current = state.frontier.espionage;
  const nextTurn = state.turnCount + 1;
  const preparation = preparationActive(territories, current?.preparation, nextTurn);
  const lead = state.entryOrder.map(id => state.roster.find(member => member.id === id)).find(Boolean);
  const leadTypes = lead ? pokemonTypes(lead.pokemon) : [];
  const observation = current?.observation;
  if (observation) {
    const target = laterById.get(observation.targetId)!.name;
    const carry = { quietTurns: ESPIONAGE_QUIET_TURNS, ...(preparation ? { preparation } : {}) };
    if (observation.detectorId) {
      const source = laterById.get(observation.sourceId)!.name;
      log.push(`${target} · 적 첩보 차단 · 출처 ${source}`);
      return carry;
    }
    if (!activeObservation(territories, observation, supplied) || !leadTypes.length) {
      log.push(`${target} · 적 첩보 취소`);
      return carry;
    }
    const source = laterById.get(observation.sourceId)!.name;
    const report = state.frontier.intel[observation.sourceId];
    const fixed = report && !report.memberId && report.trainerId === observation.trainerId;
    log.push(`${target} · 적 첩보 성공 · ${source} ${fixed ? "공개 순서 유지" : "수비 선봉 준비"}`);
    return { ...carry, preparation: { territoryId: observation.sourceId, trainerId: observation.trainerId,
      leadTypes, expiresTurn: nextTurn + PREPARATION_TURNS } };
  }
  if (current && current.quietTurns > 0) {
    const quietTurns = current.quietTurns - 1;
    return quietTurns || preparation ? { quietTurns, ...(preparation ? { preparation } : {}) } : undefined;
  }
  if (!financialWarning && leadTypes.length) {
    for (const target of laterNodes) {
      if (!supplied.has(target.id)) continue;
      const sourceId = target.neighbors.find(id => laterById.has(id) && territories[id]?.active && territories[id]?.owner === "trainer");
      if (!sourceId) continue;
      log.push(`${target.name} · 적 첩보 신호 · 다음 턴 정산`);
      return { quietTurns: 0, observation: { sourceId, targetId: target.id, trainerId: territories[sourceId].trainerId },
        ...(preparation ? { preparation } : {}) };
    }
  }
  return preparation ? { quietTurns: 0, preparation } : undefined;
}

export function advanceFrontier(state: GameState, territories: Territories, data?: GameDataBundle) {
  const log: string[] = [];
  const supplied = suppliedTerritories(territories);
  const sabotage = activeSabotage(territories, state.frontier.sabotage, supplied);
  if (state.frontier.sabotage) {
    const target = laterById.get(state.frontier.sabotage.targetId)?.name ?? state.frontier.sabotage.targetId;
    log.push(sabotage ? `${target} · 악 타입 방해 · 제작소 이번 턴 생산 중단` : `${target} · 접경 또는 제작소 상실 · 시설 방해 취소`);
  }
  const financial = advanceIntrusion(state, territories, supplied, sabotage?.targetId, log);
  const espionage = advanceEspionage(state, territories, supplied, Boolean(financial.intrusion), log);
  const intel: FrontierOperations["intel"] = {};
  const ghostLog: string[] = [];
  for (const [id, order] of Object.entries(state.frontier.intel)) {
    if (!hasSameDefender(territories, id, order.trainerId)) continue;
    if (!order.memberId) {
      intel[id] = order;
      continue;
    }
    const target = laterById.get(id)!;
    if (frontierSources(territories, id, supplied).includes(order.sourceId)) {
      const { memberId: _worker, ...revealed } = order;
      intel[id] = prefersSecondDefender(id, order.pokemonIds, espionage?.preparation, data)
        ? { ...revealed, pokemonIds: [...order.pokemonIds].reverse(), reversed: true } : revealed;
      ghostLog.push(`${target.name} · 고스트 첩보 완료`);
    } else ghostLog.push(`${target.name} · 보급된 접경 상실 · 첩보 취소`);
  }
  return { frontier: { intel, ...financial, ...(espionage ? { espionage } : {}) }, log: [...ghostLog, ...log] };
}
