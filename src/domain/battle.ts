import type { BattleBoost, BattleMoveRule, BattleStat, GameDataBundle, MoveRecord, PokemonRecord, RosterMember } from "./types";
import { applyStatus, beforeMove, canApplyStatus, statusLabels, statusResidual, type BattleStatus } from "./battleStatus";

export interface BattleMove extends BattleMoveRule {
  id: number;
  name: string;
  power: number;
  accuracy: number;
  damageClass: number;
  typeRowid: number | null;
  typeName: string;
  pp: number;
  maxPp: number;
}
export interface Combatant {
  key: string;
  name: string;
  pokemon: PokemonRecord;
  level: number;
  types: number[];
  stats: Record<BattleStat, number>;
  stages: Partial<Record<BattleStat, number>>;
  maxHp: number;
  curHp: number;
  moves: BattleMove[];
  fainted: boolean;
  status?: BattleStatus;
}

export const TACKLE: BattleMove = {
  id: 33, name: "몸통박치기", power: 40, accuracy: 100, damageClass: 2,
  typeRowid: 1, typeName: "노말", pp: 35, maxPp: 35, contact: true,
};
export const STRUGGLE: BattleMove = {
  id: 165, name: "발버둥", power: 50, accuracy: 0, damageClass: 2,
  typeRowid: null, typeName: "무타입", pp: 0, maxPp: 0, contact: true,
};

const moveCatalogs = new WeakMap<GameDataBundle, { moves: Map<number, MoveRecord>; types: Map<number, string> }>();

type LearnRow = [moveId: number, level: number];

function movePool(ordered: LearnRow[], level: number, data: GameDataBundle) {
  let catalog = moveCatalogs.get(data);
  if (!catalog) {
    catalog = { moves: new Map(data.moves.map(move => [move.moveRowid, move])), types: new Map(data.types.map(type => [type.typeRowid, type.nameKr])) };
    moveCatalogs.set(data, catalog);
  }
  const { moves, types } = catalog;
  const picked = new Map<number, BattleMove>();
  for (const [id, requiredLevel] of ordered) {
    if (requiredLevel > level || picked.has(id)) continue;
    const move = moves.get(id);
    const rule = data.battle.moves[id];
    if (!move || !rule || move.details.pp <= 0 || move.descriptionKr?.includes("사용할 수 없는")) continue;
    const { power, accuracy, damageClass, pp } = move.details;
    picked.set(id, { ...rule, id, name: move.nameKr, power: power ?? 0, accuracy: accuracy ?? 0,
      damageClass, typeRowid: move.typeRowid, typeName: types.get(move.typeRowid) ?? "", pp, maxPp: pp });
  }
  return [...picked.values()];
}

function naturalMoves(id: number, data: GameDataBundle, campaign: boolean) {
  const unlocks = new Map(campaign ? data.battle.campaignUnlocks?.[id] : undefined);
  const order = (rows: LearnRow[]): LearnRow[] => rows
    .map(([move, level]): LearnRow => [move, level === 1 ? unlocks.get(move) ?? level : level])
    .sort((a, b) => b[1] - a[1]);
  return order(data.battle.learnsets[id] ?? []).concat(order(data.battle.statusLearnsets?.[id] ?? []));
}

function ordinaryAttack(move: BattleMove) {
  return move.damageClass !== 1 && (move.power > 0 || move.weightPower) && !move.requiresSleep && !move.selfKO;
}

export function campaignLearnLevels(pokemon: PokemonRecord, data: GameDataBundle) {
  const id = pokemon.pokemonRowid;
  const rows = [...naturalMoves(id, data, true), ...(data.battle.inheritedAttacks?.[id] ?? [])];
  return [...new Set(rows.map(([, level]) => level))].sort((a, b) => a - b);
}

export function pickMoveset(pokemon: PokemonRecord, level: number, data: GameDataBundle): BattleMove[] {
  const id = pokemon.pokemonRowid;
  const rows = naturalMoves(id, data, true);
  const available = movePool(rows, level, data);
  const equipped = available.slice(0, 4);
  if (equipped.some(ordinaryAttack)) return equipped;
  let attack = available.find(ordinaryAttack);
  if (!attack && data.battle.campaignUnlocks?.[id]?.length) {
    const oldAttack = movePool(naturalMoves(id, data, false), level, data).filter(ordinaryAttack)
      .sort((a, b) => (a.weightPower ? 20 : a.power) - (b.weightPower ? 20 : b.power) || a.id - b.id)[0];
    if (oldAttack) {
      const native = new Set(rows.map(([move]) => move));
      const inherited = (data.battle.inheritedAttacks?.[id] ?? []).filter(([move]) => !native.has(move));
      attack = movePool(inherited, level, data).find(ordinaryAttack) ?? oldAttack;
    }
  }
  return attack ? [...equipped.slice(0, 3), attack] : equipped;
}

export function battleMoves(mon: Combatant) {
  return mon.moves.some(move => move.pp > 0) ? mon.moves : [STRUGGLE];
}

export function buildCombatant(entry: RosterMember | { pokemon: PokemonRecord; level: number; iv?: Record<string, number> },
  data: GameDataBundle, key: string): Combatant {
  const { level = 1, iv = {} } = entry;
  const pokemon = entry.pokemon.weightKg == null
    ? { ...entry.pokemon, weightKg: data.pokemon.find(record => record.pokemonRowid === entry.pokemon.pokemonRowid)?.weightKg }
    : entry.pokemon;
  const stat = (key: BattleStat) => Math.max(1, Math.round(pokemon[key] + (iv[key] ?? 0) + level));
  const maxHp = Math.max(1, Math.round(pokemon.hp * 2 + (iv.hp ?? 0) + level * 2 + 10));
  const types = [...new Set([pokemon.type1Rowid, pokemon.type2Rowid])].filter((id): id is number => id != null);
  return { key, name: pokemon.nameKr, pokemon, level, types,
    stats: { atk: stat("atk"), def: stat("def"), satk: stat("satk"), sdef: stat("sdef"), spd: stat("spd") },
    stages: {}, maxHp, curHp: maxHp, moves: pickMoveset(pokemon, level, data), fainted: false };
}

export function effectiveness(moveType: number | null, defenderTypes: number[], data: GameDataBundle) {
  const table = data.types.find(type => type.typeRowid === moveType)?.relation?.relationMap;
  return defenderTypes.reduce((multiplier, id) => multiplier * (table?.[id]?.damageTo ?? 1), 1);
}

export function effectiveAttack(moves: BattleMove[], defenderTypes: number[], data: GameDataBundle, minimum = 0,
  sleep: { actor?: boolean; target?: boolean } = {}) {
  return moves.find(move => {
    if (move.pp <= 0 || move.id === STRUGGLE.id || move.selfKO || move.damageClass === 1 ||
      (move.requiresSleep && !sleep[move.requiresSleep]) || (move.power <= 0 && !move.weightPower)) return false;
    const matchup = effectiveness(move.typeRowid, defenderTypes, data);
    return matchup > 0 && matchup >= minimum;
  });
}

function combatStat(mon: Combatant, key: BattleStat) {
  const stage = mon.stages[key] ?? 0;
  const speed = key === "spd" && mon.status?.kind === "paralysis" ? .5 : 1;
  return Math.max(1, Math.floor(mon.stats[key] * (2 + Math.max(0, stage)) / (2 + Math.max(0, -stage)) * speed));
}

export function calculateDamage(actor: Combatant, target: Combatant, move: BattleMove, data: GameDataBundle, random = .925) {
  const multiplier = effectiveness(move.typeRowid, target.types, data);
  const power = movePower(move, target);
  if (power <= 0 || multiplier === 0) return 0;
  const physical = move.damageClass === 2;
  const attack = combatStat(actor, physical ? "atk" : "satk");
  const defense = combatStat(target, physical ? "def" : "sdef");
  const stab = move.typeRowid !== null && actor.types.includes(move.typeRowid) ? 1.5 : 1;
  const damage = (2 * actor.level / 5 + 2) * power * attack / defense / 50 + 2;
  const burn = physical && actor.status?.kind === "burn" ? .5 : 1;
  return Math.max(1, Math.round(damage * stab * multiplier * random * burn));
}

const weightThresholds = [10, 25, 50, 100, 200, Infinity];

export function movePower(move: BattleMove, target: Combatant) {
  if (move.damageClass === 1) return 0;
  if (!move.weightPower) return move.power;
  const weight = target.pokemon.weightKg ?? 0;
  return 20 * (weightThresholds.findIndex(threshold => weight < threshold) + 1);
}

export type BattleSide = "player" | "enemy";
export type BattleResult = "win" | "lose" | "draw";
export interface BattleState {
  teams: Record<BattleSide, Combatant[]>;
  active: Record<BattleSide, number>;
  round: number;
  phase: "command" | "replacement" | BattleResult;
}
export type BattleAction = { kind: "move"; moveId: number } | { kind: "switch"; index: number } | { kind: "cure" };
export interface BattleStep {
  state: BattleState;
  lines: string[];
  actor?: BattleSide;
  strike?: { side: BattleSide; move: BattleMove; damage: number; outcome: "hit" | "miss" | "immune" | "blocked"; fainted?: boolean };
}

export function createBattle(players: Combatant[], enemies: Combatant[]): BattleState {
  return { teams: { player: players, enemy: enemies }, active: { player: 0, enemy: 0 }, round: 1, phase: "command" };
}

const other = (side: BattleSide) => side === "player" ? "enemy" : "player";
const active = (state: BattleState, side: BattleSide) => state.teams[side][state.active[side]];

function updateActive(state: BattleState, side: BattleSide, mon: Combatant): BattleState {
  const team = [...state.teams[side]];
  team[state.active[side]] = mon;
  return { ...state, teams: { ...state.teams, [side]: team } };
}

function switchTo(state: BattleState, side: BattleSide, index: number): BattleState {
  const outgoing = active(state, side);
  const status = outgoing.status?.kind === "toxic" ? { ...outgoing.status, stage: 0 } : outgoing.status;
  return { ...updateActive(state, side, { ...outgoing, stages: {}, status }), active: { ...state.active, [side]: index } };
}

const statNames: Record<BattleStat, string> = { atk: "공격", def: "방어", satk: "특수공격", sdef: "특수방어", spd: "스피드" };

function changeStats(mon: Combatant, changes: BattleBoost["changes"], lines: string[]) {
  if (mon.fainted) return mon;
  const stages = { ...mon.stages };
  for (const stat of Object.keys(changes) as BattleStat[]) {
    const from = stages[stat] ?? 0;
    const next = Math.min(6, Math.max(-6, from + (changes[stat] ?? 0)));
    const label = mon.name + "의 " + statNames[stat];
    lines.push(label + (next === from ? "은(는) 더 변하지 않았다." : next > from ? " 상승!" : " 하락!"));
    stages[stat] = next;
  }
  return { ...mon, stages };
}

function withHp(mon: Combatant, hp: number) {
  const curHp = Math.min(mon.maxHp, Math.max(0, hp));
  return { ...mon, curHp, fainted: curHp === 0 };
}

function ratioHp(amount: number, [numerator, denominator]: [number, number]) {
  return Math.max(1, Math.round(amount * numerator / denominator));
}

function strike(state: BattleState, side: BattleSide, move: BattleMove, data: GameDataBundle, random: () => number) {
  const targetSide = other(side);
  const lines: string[] = [];
  const { mon: actor, blocked } = beforeMove(active(state, side), move, lines, random);
  if (blocked) return { state: updateActive(state, side, actor), lines, flinch: false,
    strike: { side, move, damage: 0, outcome: "blocked" as const } };
  const target = active(state, targetSide);
  lines.push(actor.name + "의 " + move.name + "!");
  const prerequisite = !move.requiresSleep || (move.requiresSleep === "actor" ? actor : target).status?.kind === "sleep";
  const certain = move.status === "toxic" && actor.types.includes(4);
  const missed = prerequisite && !certain && move.accuracy > 0 && random() * 100 >= move.accuracy;
  const matchup = movePower(move, target) > 0 || move.statusTypeCheck ? effectiveness(move.typeRowid, target.types, data) : 1;
  const statusImmune = Boolean(move.status && movePower(move, target) === 0 && !canApplyStatus(target, move.status, move));
  const immune = matchup === 0 || statusImmune;
  const damage = missed || immune || !prerequisite ? 0 : Math.min(target.curHp, calculateDamage(actor, target, move, data));
  let nextActor = move.id === STRUGGLE.id ? actor : {
    ...actor, moves: actor.moves.map(slot => slot.id === move.id ? { ...slot, pp: slot.pp - 1 } : slot),
  };
  let nextTarget = withHp(target, target.curHp - damage);
  let flinch = false;

  if (!prerequisite) lines.push(move.requiresSleep === "actor" ? "잠들어 있을 때만 쓸 수 있다!" : "잠든 상대에게만 쓸 수 있다!");
  else if (immune) lines.push(statusImmune ? "상태이상 효과 없음" : "효과 없음");
  else if (missed) lines.push("하지만 빗나갔다!");
  else {
    if (damage) lines.push(damage + " 피해" + (matchup > 1 ? " · 효과가 굉장했다!" : matchup < 1 ? " · 효과가 별로였다." : ""));
    const secondary = move.secondary;
    const effect = secondary && (!nextTarget.fainted || secondary.boosts?.target === "actor") &&
      random() * 100 < secondary.chance ? secondary : undefined;
    const boost = move.boosts ?? effect?.boosts;
    if (boost?.target === "actor") nextActor = changeStats(nextActor, boost.changes, lines);
    if (boost?.target === "target") nextTarget = changeStats(nextTarget, boost.changes, lines);
    flinch = effect?.flinch === true;
    if (damage && move.typeRowid === 10 && nextTarget.status?.kind === "freeze" && !nextTarget.fainted) {
      nextTarget = { ...nextTarget, status: undefined };
      lines.push(`${target.name}의 얼음이 녹았다!`);
    }
    const status = move.status ?? effect?.status;
    if (status) nextTarget = applyStatus(nextTarget, status, move, lines, random);
    if (damage && move.drain) {
      const healed = withHp(nextActor, nextActor.curHp + ratioHp(damage, move.drain));
      if (healed.curHp > nextActor.curHp) lines.push(actor.name + "의 HP 회복!");
      nextActor = healed;
    }
    if (damage && move.recoil) {
      nextActor = withHp(nextActor, nextActor.curHp - ratioHp(damage, move.recoil));
      lines.push(actor.name + "이(가) 반동을 받았다!");
    }
  }
  if (move.id === STRUGGLE.id) {
    nextActor = withHp(nextActor, nextActor.curHp - Math.max(1, Math.floor(actor.maxHp / 4)));
    lines.push(actor.name + "이(가) 반동을 받았다!");
  }
  if (move.selfKO) nextActor = withHp(nextActor, 0);
  if (nextTarget.fainted) lines.push(target.name + "이(가) 쓰러졌다!");
  if (nextActor.fainted) lines.push(actor.name + "이(가) 쓰러졌다!");

  return { state: updateActive(updateActive(state, side, nextActor), targetSide, nextTarget),
    lines, strike: { side, move, damage, outcome: !prerequisite ? "blocked" as const : immune ? "immune" as const :
      missed ? "miss" as const : "hit" as const, fainted: nextTarget.fainted }, flinch };
}

function act(state: BattleState, side: BattleSide, move: BattleMove | undefined, data: GameDataBundle, random: () => number) {
  if (move) return strike(state, side, move, data, random);
  const lines: string[] = [];
  const { mon } = beforeMove(active(state, side), STRUGGLE, lines, random);
  if (!lines.length) lines.push(mon.name + "은(는) 기술을 쓰지 않았다.");
  return { state: updateActive(state, side, mon), lines, actor: side, flinch: false };
}

function finishRound(state: BattleState): BattleStep {
  const lines: string[] = [];
  for (const side of ["player", "enemy"] as const) {
    const mon = active(state, side);
    const residual = statusResidual(mon);
    if (!residual) continue;
    const next = withHp({ ...mon, status: residual.status }, mon.curHp - residual.damage);
    lines.push(`${mon.name} · ${statusLabels[residual.status.kind]} 피해 ${mon.curHp - next.curHp}!`);
    if (next.fainted) lines.push(`${mon.name}이(가) 쓰러졌다!`);
    state = updateActive(state, side, next);
  }
  const player = state.teams.player.findIndex(mon => !mon.fainted);
  const enemy = state.teams.enemy.findIndex(mon => !mon.fainted);
  if (player < 0 || enemy < 0) {
    const phase = player < 0 && enemy < 0 ? "draw" : enemy < 0 ? "win" : "lose";
    return { state: { ...state, phase }, lines };
  }

  if (active(state, "enemy").fainted) {
    state = switchTo(state, "enemy", enemy);
    lines.push("상대의 " + active(state, "enemy").name + "이(가) 나왔다!");
  }
  const phase = active(state, "player").fainted ? "replacement" : "command";
  return { state: { ...state, round: state.round + 1, phase }, lines };
}

function selectEnemyMove(state: BattleState, data: GameDataBundle, random: () => number) {
  const enemy = active(state, "enemy");
  const player = active(state, "player");
  const available = battleMoves(enemy).filter(move => move.pp > 0 || move.id === STRUGGLE.id);
  const valid = available.filter(move => {
    if (enemy.status?.kind === "sleep" && enemy.status.remaining > 0 && move.requiresSleep !== "actor") return false;
    if (move.requiresSleep === "actor") return enemy.status?.kind === "sleep" && enemy.status.remaining > 0;
    return move.requiresSleep !== "target" || player.status?.kind === "sleep";
  });
  const reserve = state.teams.enemy.some((mon, index) => index !== state.active.enemy && !mon.fainted);
  const attacks = valid.filter(move => movePower(move, player) > 0).map(move => {
    const damage = calculateDamage(enemy, player, move, data);
    const accuracy = move.accuracy ? move.accuracy / 100 : 1;
    const recoil = move.recoil && damage ? ratioHp(Math.min(player.curHp, damage), move.recoil) : 0;
    const ko = damage >= player.curHp;
    return { move, damage, ko, score: (Math.min(damage, player.curHp) + (ko ? player.maxHp : 0) - recoil / 2) * accuracy };
  }).filter(attack => attack.damage > 0);
  const regular = attacks.filter(attack => !attack.move.selfKO);
  const finishing = regular.filter(attack => attack.ko);
  const pool = finishing.length ? finishing : [...regular, ...attacks.filter(attack => attack.move.selfKO && reserve && attack.ko)];
  if (pool.length) {
    pool.sort((a, b) => b.score - a.score);
    const best = pool.filter(attack => attack.score === pool[0].score);
    return best[Math.floor(random() * best.length)].move;
  }
  const useful = valid.find(move => {
    if (move.status && !player.status && canApplyStatus(player, move.status, move) &&
      (!move.statusTypeCheck || effectiveness(move.typeRowid, player.types, data) > 0)) return true;
    const boost = move.boosts;
    if (!boost || movePower(move, player) > 0) return false;
    const target = boost.target === "actor" ? enemy : player;
    return (Object.entries(boost.changes) as [BattleStat, number][]).some(([stat, change]) => {
      const current = target.stages[stat] ?? 0;
      return change > 0 ? current < 6 : current > -6;
    });
  });
  return useful ?? valid.find(move => !move.selfKO) ?? available.find(move => !move.selfKO);
}

export function resolveBattleTurn(state: BattleState, action: BattleAction, data: GameDataBundle, random = Math.random): BattleStep[] {
  const steps: BattleStep[] = [];
  if (state.phase !== "command" && state.phase !== "replacement") return steps;
  if (action.kind === "switch") {
    const incoming = state.teams.player[action.index];
    if (!incoming || incoming.fainted || action.index === state.active.player) return steps;
    const switched = switchTo(state, "player", action.index);
    steps.push({ state: { ...switched, phase: "command" }, lines: [incoming.name + ", 나서라!"], actor: "player" });
    if (state.phase === "replacement") return steps;
    const response = act(switched, "enemy", selectEnemyMove(switched, data, random), data, random);
    return [...steps, response, finishRound(response.state)];
  }

  if (state.phase !== "command") return steps;
  if (action.kind === "cure") {
    const player = active(state, "player");
    if (player.fainted || !player.status) return steps;
    const treated = updateActive(state, "player", { ...player, status: undefined });
    const response = act(treated, "enemy", selectEnemyMove(treated, data, random), data, random);
    return [{ state: treated, lines: [`${player.name}의 ${statusLabels[player.status.kind]} 상태이상을 치료했다!`], actor: "player" },
      response, finishRound(response.state)];
  }
  const playerMove = battleMoves(active(state, "player")).find(move => move.id === action.moveId && (move.pp > 0 || move.id === STRUGGLE.id));
  if (!playerMove) return steps;

  const enemyMove = selectEnemyMove(state, data, random);
  const playerPriority = playerMove.priority ?? 0;
  const enemyPriority = enemyMove?.priority ?? 0;
  const enemyFirst = enemyMove && (enemyPriority > playerPriority || (enemyPriority === playerPriority &&
    combatStat(active(state, "enemy"), "spd") > combatStat(active(state, "player"), "spd")));
  const first: BattleSide = enemyFirst ? "enemy" : "player";
  const second = other(first);
  const moves = { player: playerMove, enemy: enemyMove };
  const hit = act(state, first, moves[first], data, random);
  steps.push(hit);
  state = hit.state;
  if (!active(state, first).fainted && !active(state, second).fainted) {
    if (hit.flinch) steps.push({ state, lines: [active(state, second).name + "이(가) 풀죽어 움직이지 못했다!"], actor: second });
    else {
      const response = act(state, second, moves[second], data, random);
      state = response.state;
      steps.push(response);
    }
  }
  return [...steps, finishRound(state)];
}
