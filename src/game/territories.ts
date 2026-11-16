import { STARTING_TERRITORY_IDS, worldMapNodes } from "../domain/worldMap";
import { MAX_LOYALTY } from "../domain/territorySupply";
import type { ParsedMapSave } from "../services/saveSchemas";
import { openCampaignRegions, territoryFaction } from "./territoryFactions";
import type { TerritoryState } from "./gameTypes";

const opponentLimit = 6;
const opponentSlots = STARTING_TERRITORY_IDS.filter(id => id !== "home" && id !== "southwest");
const legacyIds = new Map([
  ["field", "southwest"], ["hill", "south"], ["forest", "west"],
  ["cave", "southeast"], ["lake", "northwest"], ["peak", "east"],
]);

function draw<T>(pool: readonly T[], count: number, random: () => number) {
  const available = [...pool];
  return Array.from({ length: Math.min(count, pool.length) }, () => available.splice(Math.floor(random() * available.length), 1)[0]);
}

function fillStartingSlots(
  territories: Record<string, TerritoryState>, pools: readonly string[], slots: string[], playerId: string | null, random: () => number,
) {
  const occupied = new Set(Object.values(territories).map(spot => spot.trainerId));
  const count = STARTING_TERRITORY_IDS.filter(id => territories[id].owner === "trainer").length;
  const available = [...new Set(pools)].filter(id => id.trim() && id !== playerId && !occupied.has(id));
  const trainers = draw(available, Math.min(slots.length, Math.max(0, opponentLimit - count)), random);
  draw(slots, trainers.length, random).forEach((id, index) => {
    territories[id] = { ...territories[id], owner: "trainer", trainerId: trainers[index] };
  });
  return territories;
}

function blankTerritories(): Record<string, TerritoryState> {
  return Object.fromEntries(worldMapNodes.map(node => [node.id, {
    owner: node.id === "home" ? "player" : "unoccupied",
    trainerId: null,
    scouted: node.id === "home",
    active: node.region === 1,
  }]));
}

export function createTerritories(playerId: string | null, opponents: readonly string[], random = Math.random) {
  return fillStartingSlots(blankTerritories(), opponents, opponentSlots, playerId, random);
}

export function restoreTerritories(
  saved: ParsedMapSave | null, playerId: string | null, opponents?: readonly string[],
  random = Math.random, defenderIds = opponents ?? [],
) {
  const territories = blankTerritories();
  const records = new Map<string, ParsedMapSave[number]>();
  for (const spot of saved ?? []) {
    const existing = records.get(spot.id);
    if (!existing || (spot.owner === "player" && existing.owner !== "player")) records.set(spot.id, spot);
  }
  for (const [legacy, current] of legacyIds) {
    if (records.get(legacy)?.owner === "player" && !records.has(current)) {
      records.set(current, { id: current, owner: "player" });
    }
  }

  const catalog = opponents && new Set(opponents);
  const used = new Set<string>();
  // Keep a revealed identity when a damaged save assigns the same trainer to two places.
  const ordered = worldMapNodes.slice().sort((a, b) => Number(records.get(b.id)?.scouted === true) - Number(records.get(a.id)?.scouted === true));
  for (const node of ordered) {
    const spot = records.get(node.id);
    if (!spot || node.id === "home") continue;
    const owner = spot.owner === "wild" ? "unoccupied" : spot.owner;
    const savedId = spot.trainerId;
    const trainerId = owner === "trainer" && savedId && savedId !== playerId && !used.has(savedId) && (!catalog || catalog.has(savedId))
      ? savedId : null;
    if (trainerId) used.add(trainerId);
    territories[node.id] = { owner, trainerId, scouted: owner === "player" || spot.scouted === true,
      active: spot.active ?? spot.unlocked ?? territories[node.id].active };
    if (territoryFaction(node.id, spot.factionId)) territories[node.id].factionId = spot.factionId;
    if (node.region > 1 && owner === "player") territories[node.id].loyalty = spot.loyalty || MAX_LOYALTY;
    if (node.region > 1 && owner === "unoccupied" && spot.loyalty === 0) territories[node.id].loyalty = 0;
  }

  const missing = opponentSlots.filter(id => !records.has(id));
  fillStartingSlots(territories, opponents ?? [], missing, playerId, random);
  return openCampaignRegions(territories, playerId, defenderIds);
}
