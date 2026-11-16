import { worldMapNodes } from "./worldMap";
import type { TerritoryState } from "../game/gameTypes";

export const MAX_LOYALTY = 100;
const loyaltyPerTurn = 35;
export const TERRITORY_GOLD = 3;

export function suppliedTerritories(territories: Record<string, Pick<TerritoryState, "owner" | "active">>) {
  const supplied = new Set<string>();
  const queue = ["home"];
  for (const id of queue) {
    const spot = territories[id];
    if (supplied.has(id) || !spot?.active || spot.owner !== "player") continue;
    supplied.add(id);
    queue.push(...(worldMapNodes.find(node => node.id === id)?.neighbors ?? []));
  }
  return supplied;
}

export function territoryIncome(territories: Record<string, Pick<TerritoryState, "owner" | "active">>, excludedId?: string) {
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
