import type { BattleStatusKind } from "./types";
import type { BattleMove, Combatant } from "./battle";

export type BattleStatus =
  | { kind: Exclude<BattleStatusKind, "sleep" | "toxic"> }
  | { kind: "sleep"; remaining: number }
  | { kind: "toxic"; stage: number };

export const statusLabels: Record<BattleStatusKind, string> = {
  poison: "독", toxic: "맹독", burn: "화상", paralysis: "마비", sleep: "잠듦", freeze: "얼음",
};

const immuneTypes: Record<BattleStatusKind, number[]> = {
  poison: [4, 9], toxic: [4, 9], burn: [10], paralysis: [13], sleep: [], freeze: [15],
};

export function canApplyStatus(target: Combatant, kind: BattleStatusKind, move: BattleMove) {
  return !target.types.some(type => immuneTypes[kind].includes(type) || (move.powder && type === 12));
}

export function applyStatus(target: Combatant, kind: BattleStatusKind, move: BattleMove, lines: string[], random: () => number) {
  if (target.fainted) return target;
  if (!canApplyStatus(target, kind, move)) {
    if (move.status) lines.push("상태이상 효과 없음");
    return target;
  }
  if (target.status) {
    if (move.status) lines.push(`${target.name}에게 이미 상태이상이 있다!`);
    return target;
  }
  const status: BattleStatus = kind === "sleep" ? { kind, remaining: 1 + Math.floor(random() * 3) }
    : kind === "toxic" ? { kind, stage: 0 } : { kind };
  lines.push(`${target.name}에게 ${statusLabels[kind]} 상태이상 발생!`);
  return { ...target, status };
}

export function beforeMove(mon: Combatant, move: BattleMove, lines: string[], random: () => number) {
  const status = mon.status;
  if (status?.kind === "sleep") {
    if (status.remaining > 0) {
      if (move.requiresSleep !== "actor") lines.push(`${mon.name}은(는) 잠들어 있다!`);
      return { mon: { ...mon, status: { ...status, remaining: status.remaining - 1 } }, blocked: move.requiresSleep !== "actor" };
    }
    lines.push(`${mon.name}이(가) 잠에서 깨어났다!`);
    return { mon: { ...mon, status: undefined }, blocked: false };
  }
  if (status?.kind === "freeze") {
    if (random() < .2) {
      lines.push(`${mon.name}의 얼음이 녹았다!`);
      return { mon: { ...mon, status: undefined }, blocked: false };
    }
    lines.push(`${mon.name}이(가) 얼어서 움직이지 못했다!`);
    return { mon, blocked: true };
  }
  const blocked = status?.kind === "paralysis" && random() < .25;
  if (blocked) lines.push(`${mon.name}이(가) 마비되어 움직이지 못했다!`);
  return { mon, blocked };
}

export function statusResidual(mon: Combatant) {
  if (mon.fainted || !mon.status) return null;
  if (mon.status.kind === "toxic") {
    const stage = Math.min(15, mon.status.stage + 1);
    return { status: { ...mon.status, stage }, damage: Math.max(1, Math.floor(mon.maxHp * stage / 16)) };
  }
  const divisor = mon.status.kind === "poison" ? 8 : mon.status.kind === "burn" ? 16 : 0;
  return divisor ? { status: mon.status, damage: Math.max(1, Math.floor(mon.maxHp / divisor)) } : null;
}
