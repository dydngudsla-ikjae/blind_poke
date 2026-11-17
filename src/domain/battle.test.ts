import { describe, expect, it } from "vitest";
import { battleMoves, buildCombatant, calculateDamage, createBattle, effectiveness, movePower, pickMoveset, resolveBattleTurn, STRUGGLE, TACKLE } from "./battle";
import type { GameDataBundle, MoveRecord, PokemonRecord } from "./types";
import battleCatalog from "../../data/battle.json";
import species from "../../data/pokemon.json";
import moves from "../../data/move.json";

const base: PokemonRecord = { pokemonRowid: 1, nameKr: "선봉", type1Rowid: 1, hp: 50, atk: 60, def: 50, satk: 70, sdef: 50, spd: 60 };
const ghost = { ...base, pokemonRowid: 2, nameKr: "흔들풍손", type1Rowid: 8, type2Rowid: 3, spd: 40 };
const ally = { ...base, pokemonRowid: 3, nameKr: "동료", type1Rowid: 10 };
const move = (moveRowid: number, typeRowid: number, power: number, pp = 10, accuracy = 100): MoveRecord =>
  ({ moveRowid, typeRowid, nameKr: String(moveRowid), details: { power, accuracy, pp, damageClass: 2 } });

const data: GameDataBundle = {
  pokemon: [base, ghost, ally], abilities: [], trainers: [],
  types: [
    { typeRowid: 1, nameKr: "노말", relation: { relationMap: { "8": { damageFrom: 0, damageTo: 0 } } } },
    { typeRowid: 5, nameKr: "땅", relation: { relationMap: { "3": { damageFrom: 1, damageTo: 0 } } } },
    { typeRowid: 12, nameKr: "풀", relation: { relationMap: { "9": { damageFrom: 1, damageTo: .5 }, "16": { damageFrom: 1, damageTo: .5 } } } },
  ],
  moves: [move(33, 1, 40, 1), move(89, 5, 100), move(138, 14, 100), move(173, 1, 50), move(153, 1, 250), move(22, 12, 45), move(51, 4, 40, 1, 50)],
  battle: {
    learnsets: { "1": [[33, 1], [138, 1], [173, 1], [153, 7]], "2": [[33, 1]], "3": [[51, 1]] },
    moves: { "33": {}, "89": {}, "153": { selfKO: true }, "22": {}, "51": {} },
  },
};
const combatant = (pokemon: PokemonRecord, key: string, level = 5) => buildCombatant({ pokemon, level }, data, key);
const roll = () => 0;
const attack = (moveId: number) => ({ kind: "move" as const, moveId });
it("uses the earlier evolution's unlock level and inherits its starter attack when needed", () => {
  const volcarona = { ...base, pokemonRowid: 637 };
  const ninetales = { ...base, pokemonRowid: 38 };
  const catalog = { ...data, battle: battleCatalog as unknown as GameDataBundle["battle"], moves: moves as MoveRecord[] };
  expect(pickMoveset(volcarona, 1, catalog).map(slot => slot.id)).not.toContain(38);
  expect(pickMoveset(volcarona, 60, catalog).map(slot => slot.id)).toContain(38);
  expect(pickMoveset(ninetales, 1, catalog).map(slot => slot.id)).toContain(52);
});

it("prefers a damaging attack over an immune attack", () => {
  const player = combatant(ghost, "p");
  const enemy = { ...combatant(base, "e"), moves: [TACKLE, { ...TACKLE, id: 52, typeRowid: 10 }] };
  const steps = resolveBattleTurn(createBattle([player], [enemy]), attack(33), data, roll);
  expect(steps.find(step => step.strike?.side === "enemy")?.strike?.move.id).toBe(52);
});

it("declines an unsafe last-mon Explosion without skipping PP to Struggle", () => {
  const player = combatant(ghost, "p");
  const bomber = combatant(base, "e", 7);
  const enemy = { ...bomber, moves: bomber.moves.filter(move => move.selfKO) };
  const steps = resolveBattleTurn(createBattle([player], [enemy]), attack(33), data, roll);
  expect(steps.find(step => step.strike?.side === "enemy")).toBeUndefined();
  expect(steps.at(-1)?.state.teams.enemy[0].moves).toEqual(enemy.moves);
  expect(steps.at(-1)?.state.teams.enemy[0].fainted).toBe(false);
});

it("uses applicable status when attacks cannot hit and marks innate status immunity", () => {
  const powder = { ...TACKLE, id: 77, damageClass: 1, power: 0, status: "poison" as const, powder: true as const };
  const ghostPlayer = combatant(ghost, "p");
  const enemy = { ...combatant(base, "e"), moves: [TACKLE, powder] };
  const round = resolveBattleTurn(createBattle([ghostPlayer], [enemy]), attack(33), data, roll);
  expect(round.find(step => step.strike?.side === "enemy")?.strike?.move.id).toBe(77);
  expect(round.at(-1)?.state.teams.player[0].status?.kind).toBe("poison");
  const grassTarget = { ...enemy, types: [12], moves: [TACKLE] };
  const immuneRound = resolveBattleTurn(createBattle([{ ...ghostPlayer, moves: [powder] }], [grassTarget]), attack(77), data, roll);
  expect(immuneRound.find(step => step.strike?.side === "player")?.strike?.outcome).toBe("immune");
});
const replace = (index: number) => ({ kind: "switch" as const, index });
const play = (state: ReturnType<typeof createBattle>, action: ReturnType<typeof attack> | ReturnType<typeof replace>, random = roll) =>
  resolveBattleTurn(state, action, data, random).at(-1)!.state;

describe("battle engine", () => {
  it("distinguishes immunity from double resistance", () => {
    const attacker = combatant(base, "p");
    const target = combatant(ghost, "e");
    expect(calculateDamage(attacker, target, TACKLE, data)).toBe(0);
    expect(calculateDamage(attacker, target, { ...TACKLE, typeRowid: 5 }, data)).toBe(0);
    expect(effectiveness(12, [9, 16], data)).toBe(.25);
    expect(calculateDamage(attacker, { ...target, types: [9, 16] }, { ...TACKLE, typeRowid: 12 }, data)).toBe(1);
  });

  it("selects the latest supported moves within the current level", () => {
    expect(pickMoveset(base, 5, data).map(move => move.id)).toEqual([33]);
    expect(pickMoveset(base, 7, data).map(move => move.id)).toEqual([153, 33]);
    expect(battleMoves(combatant({ ...base, pokemonRowid: 99 }, "p"))).toEqual([STRUGGLE]);
  });

  it("attacks the incoming ally on a voluntary switch and preserves the previous member", () => {
    const player = combatant(base, "p");
    const incoming = combatant(ally, "p2");
    const enemy = combatant(ghost, "e");
    const initial = createBattle([player, incoming], [enemy]);
    const after = play(initial, replace(1));
    expect(after.round).toBe(2);
    expect(after.active.player).toBe(1);
    expect(after.teams.player[0]).toEqual(player);
    expect(after.teams.player[1].curHp).toBeLessThan(incoming.curHp);
    expect(after.teams.enemy[0].moves[0].pp).toBe(0);
  });

  it("requires a choice after a knockout without an extra enemy action or round", () => {
    const player = { ...combatant(base, "p"), curHp: 1 };
    const incoming = combatant(ally, "p2");
    const enemy = { ...combatant(ghost, "e"), stats: { ...player.stats, spd: 100 } };
    const initial = createBattle([player, incoming], [enemy]);
    const knockedOut = play(initial, attack(33));
    expect(knockedOut.phase).toBe("replacement");
    expect(knockedOut.teams.player[0].moves[0].pp).toBe(1);
    expect(resolveBattleTurn(knockedOut, attack(33), data)).toEqual([]);
    const after = play(knockedOut, replace(1));
    expect(after.round).toBe(knockedOut.round);
    expect(after.phase).toBe("command");
    expect(after.teams).toEqual(knockedOut.teams);
  });

  it("spends PP on immune and missed attacks, then uses typeless Struggle with recoil", () => {
    const player = combatant(base, "p");
    const enemy = combatant(ghost, "e");
    const immune = resolveBattleTurn(createBattle([player], [enemy]), attack(33), data, roll);
    expect(immune.flatMap(step => step.lines)).toContain("효과 없음");
    const lowAccuracy = { ...player, moves: [{ ...player.moves[0], accuracy: 1 }] };
    const stillImmune = resolveBattleTurn(createBattle([lowAccuracy], [enemy]), attack(33), data, () => .99);
    expect(stillImmune[0].lines).toContain("효과 없음");
    const afterImmune = immune.at(-1)!.state;
    expect(afterImmune.teams.enemy[0].curHp).toBe(enemy.curHp);
    expect(battleMoves(afterImmune.teams.player[0])).toEqual([STRUGGLE]);
    const after = play(afterImmune, attack(STRUGGLE.id));
    expect(after.teams.enemy[0].curHp).toBeLessThan(enemy.curHp);
    expect(after.teams.player[0].curHp).toBeLessThanOrEqual(afterImmune.teams.player[0].curHp - Math.floor(player.maxHp / 4));
    const miss = play(createBattle([combatant(ally, "p2")], [enemy]), attack(51), () => .99);
    expect(miss.teams.player[0].moves[0].pp).toBe(0);
    expect(miss.teams.enemy[0].curHp).toBe(enemy.curHp);
  });

  it("faints the user of Explosion even against an immune target and settles dual knockouts", () => {
    const bomber = combatant(base, "p", 7);
    const enemy = combatant(ghost, "e");
    const immune = play(createBattle([bomber], [enemy]), attack(153));
    expect(immune.phase).toBe("lose");
    expect(immune.teams.enemy[0].curHp).toBe(enemy.curHp);
    const draw = play(createBattle([bomber], [{ ...enemy, types: [1], curHp: 1 }]), attack(153));
    expect(draw.phase).toBe("draw");
  });

  it("applies priority and flinch without consuming the interrupted move's PP", () => {
    const player = combatant(base, "p");
    const quick = { ...TACKLE, typeRowid: 10, priority: 1, secondary: { chance: 100, flinch: true as const } };
    const slow = { ...player, moves: [quick], stats: { ...player.stats, spd: 1 } };
    const enemy = combatant(ghost, "e");
    const steps = resolveBattleTurn(createBattle([slow], [enemy]), attack(quick.id), data, roll);
    expect(steps.filter(step => step.strike).map(step => step.strike?.side)).toEqual(["player"]);
    expect(steps.at(-1)!.state.teams.enemy[0].moves[0].pp).toBe(1);
    expect(steps.flatMap(step => step.lines).join(" ")).toContain("풀죽어");
  });

  it("ticks poison at the end of a round and spends a cure turn while the foe can attack", () => {
    const player = combatant(base, "p");
    const enemy = { ...combatant(ally, "e"), moves: [{ ...TACKLE, typeRowid: 4, secondary: { chance: 30, status: "poison" as const } }] };
    const poisoned = play(createBattle([player], [enemy]), attack(33));
    const sick = poisoned.teams.player[0];
    expect(sick.status).toEqual({ kind: "poison" });
    expect(sick.curHp).toBe(player.maxHp - calculateDamage(enemy, player, enemy.moves[0], data) - Math.floor(player.maxHp / 8));
    const cure = { kind: "cure" as const };
    expect(resolveBattleTurn(createBattle([player], [enemy]), cure, data)).toEqual([]);
    const cured = resolveBattleTurn(poisoned, cure, data, () => .99);
    expect(cured[0].state.teams.player[0]).toMatchObject({ curHp: sick.curHp, moves: sick.moves });
    expect(cured.at(-1)?.state.teams.player[0].status).toBeUndefined();
    expect(cured.at(-1)?.state.teams.player[0].curHp).toBe(sick.curHp - calculateDamage(enemy, sick, enemy.moves[0], data));
    expect(cured.at(-1)?.state.round).toBe(poisoned.round + 1);
  });

  it("keeps conditions on the bench, resets a toxic counter on withdrawal and rejects status immunities", () => {
    const player = { ...combatant(base, "p"), status: { kind: "toxic" as const, stage: 3 } };
    const incoming = { ...combatant(ally, "p2"), types: [9] };
    const enemy = { ...combatant(ally, "e"), moves: [{ ...TACKLE, typeRowid: 4, secondary: { chance: 30, status: "poison" as const } }] };
    const switched = play(createBattle([player, incoming], [enemy]), replace(1));
    expect(switched.teams.player[0]).toMatchObject({ status: { kind: "toxic", stage: 0 }, curHp: player.curHp });
    expect(switched.teams.player[1].status).toBeUndefined();
  });

  it("requires sleep for Dream Eater and Snore and interrupts a sleeping attacker without using PP", () => {
    const dreams = { ...TACKLE, typeRowid: 14, requiresSleep: "target" as const };
    const player = { ...combatant(base, "p"), moves: [dreams] };
    const enemy = combatant(ally, "e");
    const awake = resolveBattleTurn(createBattle([player], [enemy]), attack(dreams.id), data, roll);
    expect(awake[0].strike?.damage).toBe(0);
    const asleep = { ...player, status: { kind: "sleep" as const, remaining: 1 } };
    const sleeping = resolveBattleTurn(createBattle([asleep], [enemy]), attack(dreams.id), data, roll);
    expect(sleeping.at(-1)?.state.teams.player[0].moves[0].pp).toBe(dreams.pp);
    const snore = { ...dreams, requiresSleep: "actor" as const };
    const snoring = resolveBattleTurn(createBattle([{ ...asleep, moves: [snore] }], [enemy]), attack(snore.id), data, roll);
    expect(snoring[0].strike?.damage).toBeGreaterThan(0);
    const drain = { ...dreams, drain: [1, 2] as [number, number] };
    const dream = resolveBattleTurn(createBattle([{ ...player, curHp: 40, moves: [drain] }],
      [{ ...enemy, status: asleep.status }]), attack(drain.id), data, roll);
    expect(dream[0].strike?.damage).toBeGreaterThan(0);
    expect(dream[0].state.teams.player[0].curHp).toBeGreaterThan(40);
  });

  it("applies burn to physical damage and paralysis to speed and the move attempt", () => {
    const player = combatant(base, "p");
    const enemy = { ...combatant(ally, "e"), stats: { ...player.stats, spd: 50 } };
    const burned = { ...player, status: { kind: "burn" as const } };
    expect(calculateDamage(burned, enemy, TACKLE, data)).toBeLessThan(calculateDamage(player, enemy, TACKLE, data));
    const special = { ...TACKLE, damageClass: 3 };
    expect(calculateDamage(burned, enemy, special, data)).toBe(calculateDamage(player, enemy, special, data));
    const paralyzed = { ...player, status: { kind: "paralysis" as const } };
    const steps = resolveBattleTurn(createBattle([paralyzed], [enemy]), attack(33), data, roll);
    expect(steps[0].strike?.side).toBe("enemy");
    expect(steps.at(-1)?.state.teams.player[0].moves[0].pp).toBe(1);
    expect(steps.flatMap(step => step.lines).join(" ")).toContain("마비되어");
  });

  it("blocks frozen moves, unfreezes on a fire hit and respects powder immunity", () => {
    const player = combatant(base, "p");
    const frozen = { ...player, status: { kind: "freeze" as const } };
    const enemy = combatant(ally, "e");
    const stuck = play(createBattle([frozen], [enemy]), attack(33), () => .99);
    expect(stuck.teams.player[0].moves[0].pp).toBe(1);
    const fire = { ...TACKLE, typeRowid: 10 };
    const thaw = resolveBattleTurn(createBattle([{ ...player, moves: [fire] }], [frozen]), attack(fire.id), data, () => .99);
    expect(thaw[0].state.teams.enemy[0].status).toBeUndefined();
    const powder = { ...TACKLE, typeRowid: 12, power: 0, damageClass: 1, status: "sleep" as const, powder: true as const };
    expect(play(createBattle([{ ...player, moves: [powder] }], [{ ...enemy, types: [12] }]), attack(powder.id))
      .teams.enemy[0].status).toBeUndefined();
  });

  it("keeps a returned ally's damage and PP, and clears its temporary stat changes", () => {
    const player = combatant(base, "p");
    const worn = { ...player, curHp: 23, moves: [{ ...player.moves[0], pp: 0 }], stages: { atk: 3 } };
    const initial = createBattle([worn, combatant(ally, "p2")], [combatant(ghost, "e")]);
    const after = play(initial, replace(1));
    const returning = resolveBattleTurn(after, replace(0), data, roll)[0].state;
    expect(returning.teams.player[0]).toMatchObject({ curHp: 23, moves: [{ pp: 0 }], stages: {} });
  });

  it("uses the pinned level data and only registered effects for every species", () => {
    const publishedMoves = new Set(moves.map(move => move.moveRowid));
    expect(Object.keys(battleCatalog.learnsets)).toHaveLength(species.length);
    for (const rows of [...Object.values(battleCatalog.learnsets), ...Object.values(battleCatalog.statusLearnsets)]) {
      expect(rows.every(([id, level]) => publishedMoves.has(id) && Object.hasOwn(battleCatalog.moves, id) && level >= 1)).toBe(true);
    }
    expect(battleCatalog.moves["138"]).toMatchObject({ requiresSleep: "target", drain: [1, 2] });
    expect(battleCatalog.moves["173"]).toMatchObject({ requiresSleep: "actor", secondary: { flinch: true } });
    expect(battleCatalog.statusLearnsets["13"]).toContainEqual([40, 1]);
    expect(battleCatalog.learnsets["100"]).toContainEqual([153, 41]);
    expect(battleCatalog.learnsets["425"]).toContainEqual([16, 4]);
  });

  it("gives a level-one Machamp its legal weight-based attack and respects immunities", () => {
    const machamp = species.find(mon => mon.pokemonRowid === 68)!;
    const light = combatant({ ...base, weightKg: 4.1 }, "light");
    const heavy = combatant({ ...base, weightKg: 200 }, "heavy");
    expect(battleCatalog.learnsets["68"]).toContainEqual([67, 1]);
    expect(Object.hasOwn(battleCatalog.moves, 67)).toBe(true);
    const catalog: GameDataBundle = { ...data, moves: [move(67, 2, 0, 20)],
      battle: { learnsets: { "68": [[67, 1]] }, moves: { "67": { weightPower: true } } } };
    const actor = buildCombatant({ pokemon: machamp, level: 1 }, catalog, "p");
    const kick = actor.moves.find(move => move.id === 67)!;
    expect(kick?.pp).toBe(20);
    expect(movePower(kick, light)).toBe(20);
    expect(movePower(kick, heavy)).toBe(120);
    expect(calculateDamage(actor, heavy, kick, catalog)).toBeGreaterThan(calculateDamage(actor, light, kick, catalog));
    expect(calculateDamage(actor, combatant(ghost, "e"), kick, { ...catalog, types: [
      { typeRowid: 2, nameKr: "격투", relation: { relationMap: { "8": { damageFrom: 1, damageTo: 0 } } } },
    ] })).toBe(0);
  });
});
