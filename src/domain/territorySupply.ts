import { worldMapNodes } from "./worldMap";
import type { TerritoryState } from "../game/gameTypes";

export const MAX_LOYALTY = 100;
const loyaltyPerTurn = 35;
export const TERRITORY_GOLD = 3;
const nodesById = new Map(worldMapNodes.map(node => [node.id, node]));
type TerritoryNetwork = Record<string, Pick<TerritoryState, "owner" | "active">>;

export function suppliedTerritories(territories: TerritoryNetwork) {
  const supplied = new Set<string>();
  const queue = ["home"];
  for (const id of queue) {
    const spot = territories[id];
    if (supplied.has(id) || !spot?.active || spot.owner !== "player") continue;
    supplied.add(id);
    queue.push(...(nodesById.get(id)?.neighbors ?? []));
  }
  return supplied;
}

export function forecastSupplyRoute(territories: TerritoryNetwork, targetId: string, supplied = suppliedTerritories(territories)) {
  if (!territories[targetId]?.active) return null;
  const pending: { id: string; path: string[]; missing: string[] }[] = [...supplied].map(id => ({ id, path: [id], missing: [] }));
  const visited = new Set<string>();
  while (pending.length) {
    // Minimize additional captures first, then favor the shorter route.
    pending.sort((a, b) => a.missing.length - b.missing.length || a.path.length - b.path.length);
    const current = pending.shift()!;
    if (visited.has(current.id)) continue;
    if (current.id === targetId) return { path: current.path, missing: current.missing };
    visited.add(current.id);
    for (const id of nodesById.get(current.id)?.neighbors ?? []) {
      const spot = territories[id];
      if (visited.has(id) || !spot?.active) continue;
      const needsCapture = id !== targetId && spot.owner !== "player";
      pending.push({ id, path: [...current.path, id], missing: needsCapture ? [...current.missing, id] : current.missing });
    }
  }
  return null;
}

export function isolatedTurnsRemaining(loyalty = MAX_LOYALTY) {
  return Math.max(1, Math.ceil(loyalty / loyaltyPerTurn));
}

export function territoryIncome(territories: TerritoryNetwork, excludedId?: string) {
  const supplied = suppliedTerritories(territories);
  return TERRITORY_GOLD * worldMapNodes.filter(({ id, region }) =>
    id !== "home" && id !== excludedId && territories[id]?.owner === "player" && (region === 1 || supplied.has(id))).length;
}

export function advanceTerritoryLoyalty(territories: Record<string, TerritoryState>) {
  const supplied = suppliedTerritories(territories);
  const next = { ...territories };
  const lost: string[] = [];
  for (const node of worldMapNodes) {
    const spot = territories[node.id];
    if (node.region === 1 || !spot?.active || spot.owner !== "player") continue;
    const loyalty = spot.loyalty ?? MAX_LOYALTY;
    const updated = supplied.has(node.id) ? Math.min(MAX_LOYALTY, loyalty + loyaltyPerTurn) : Math.max(0, loyalty - loyaltyPerTurn);
    if (updated === 0) {
      next[node.id] = { ...spot, loyalty: 0, owner: "unoccupied", trainerId: null };
      lost.push(node.name);
    } else if (updated !== spot.loyalty) {
      next[node.id] = { ...spot, loyalty: updated };
    }
  }
  return { territories: next, lost };
}
