import { worldMapNodes } from "../domain/worldMap";
import type { GameDataBundle } from "../domain/types";
import { unlockRegions } from "./campaign";
import type { TerritoryState } from "./gameTypes";

const factions = [
  { id: "nw-1", name: "북서 1세력", region: 2, outposts: ["nw-02", "nw-03"], leader: "nw-04" },
  { id: "nw-2", name: "북서 2세력", region: 2, outposts: ["nw-07", "nw-08"], leader: "nw-09" },
  { id: "se-1", name: "남동 1세력", region: 3, outposts: ["se-03", "se-04"], leader: "se-05" },
  { id: "se-2", name: "남동 2세력", region: 3, outposts: ["se-08", "se-09"], leader: "se-10" },
  { id: "ne-1", name: "북동 1세력", region: 4, outposts: ["ne-03", "ne-04"], leader: "ne-05" },
  { id: "ne-2", name: "북동 2세력", region: 4, outposts: ["ne-07", "ne-08"], leader: "ne-09" },
].map(faction => ({ ...faction, sites: [...faction.outposts, faction.leader] }));

export function territoryFaction(id: string, factionId?: string) {
  return factions.find(faction => faction.id === factionId && faction.sites.includes(id));
}

export function factionDefenders(data: GameDataBundle) {
  const available = new Set(data.pokemon.map(pokemon => pokemon.pokemonRowid));
  return data.trainers.filter(trainer =>
    new Set(trainer.pokemon.filter(pokemon => available.has(pokemon.id)).map(pokemon => pokemon.id)).size >= 2,
  ).map(trainer => trainer.id);
}

export function openCampaignRegions(
  territories: Record<string, TerritoryState>, playerId: string | null, defenderIds: readonly string[],
) {
  const next = unlockRegions(territories);
  const used = new Set(Object.values(territories).map(spot => spot.trainerId));
  const ids = [...new Set(defenderIds)].filter(id => id.trim() && id !== playerId).sort();
  const seed = Array.from(playerId ?? "").reduce((hash, char) => Math.imul(hash, 31) + char.charCodeAt(0) | 0, 0) >>> 0;

  for (const region of [2, 3, 4]) {
    const nodes = worldMapNodes.filter(node => node.region === region);
    const hasProgress = nodes.some(({ id }) => {
      const spot = territories[id];
      return spot.active || spot.scouted || spot.owner !== "unoccupied";
    });
    if (hasProgress || !nodes.every(({ id }) => next[id].active)) continue;

    const offset = ids.length ? (seed + (region - 2) * 6) % ids.length : 0;
    const pool = [...ids.slice(offset), ...ids.slice(0, offset)].filter(id => !used.has(id));
    for (const faction of factions.filter(faction => faction.region === region)) {
      for (const id of faction.sites) {
        const trainerId = pool.shift();
        if (!trainerId) break;
        used.add(trainerId);
        next[id] = { ...next[id], owner: "trainer", trainerId, factionId: faction.id };
      }
    }
  }
  return next;
}
