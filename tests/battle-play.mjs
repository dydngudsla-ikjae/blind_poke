import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = name => readFile(new URL("../data/" + name + ".json", import.meta.url), "utf8").then(JSON.parse);
const [pokemon, types, moves, battle] = await Promise.all([data("pokemon"), data("type"), data("move"), data("battle")]);
const species = new Map(pokemon.map(mon => [mon.nameKr, mon]));
const typeChart = new Map(types.map(type => [type.typeRowid, type.relation?.relationMap]));
const catalog = new Map(moves.map(move => [move.moveRowid, move]));
const typeIds = mon => [...new Set([mon.type1Rowid, mon.type2Rowid])].filter(id => id != null);

export async function useHistoricalBattleData(page) {
  const { statusLearnsets, ...baseline } = battle;
  await page.route("**/data/battle.json", route => route.fulfill({ json: baseline }));
}

export async function fixBattleDraws(button, draws) {
  await button.evaluate((element, sequence) => {
    element.addEventListener("click", () => {
      let index = 0;
      const ordinary = Math.random;
      Math.random = () => index < sequence.length ? sequence[index++] : ordinary();
    }, { capture: true, once: true });
  }, draws);
}

export async function setBattleRandom(page, seed) {
  await page.evaluate(initial => {
    let randomState = initial;
    Math.random = () => {
      randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
  }, seed);
}

function damageScore(id, attacker, defender, level, enemyLevel) {
  const move = catalog.get(id);
  const struggle = id === 165;
  const power = battle.moves[id]?.weightPower
    ? 20 * ([10, 25, 50, 100, 200, Infinity].findIndex(threshold => (defender.weightKg ?? 0) < threshold) + 1)
    : move?.details.power;
  if (!power) return 0;
  const attackKey = move.details.damageClass === 2 ? "atk" : "satk";
  const defenseKey = move.details.damageClass === 2 ? "def" : "sdef";
  const matchup = struggle ? 1 : typeIds(defender).reduce((value, type) =>
    value * (typeChart.get(move.typeRowid)?.[type]?.damageTo ?? 1), 1);
  if (!matchup) return 0;
  const stab = !struggle && typeIds(attacker).includes(move.typeRowid) ? 1.5 : 1;
  const scaling = (2 * level / 5 + 2) * power * (attacker[attackKey] + level) / (defender[defenseKey] + enemyLevel) / 50;
  const expected = Math.max(1, Math.round((2 + scaling) * matchup * stab * .925)) * (move.details.accuracy || 100) / 100;
  return struggle || battle.moves[id]?.selfKO ? expected * .4 : expected;
}

export function memberScore(member, defender, enemyLevel) {
  const eligible = playableMoves(member);
  return Math.max(...(eligible.length ? eligible : [165]).map(id =>
    damageScore(id, member.pokemon, defender, member.level, enemyLevel)));
}

function playableMoves(member) {
  return [...new Set((battle.learnsets[member.pokemon.pokemonRowid] ?? [])
    .filter(([, level]) => level <= member.level).map(([id]) => id))].slice(0, 4);
}

export function campaignMemberScore(member, level) {
  const attacks = playableMoves({ ...member, level }).filter(id => !battle.moves[id]?.selfKO);
  const ratings = types.map(type => {
    const opponent = { def: 70, sdef: 70, weightKg: 50, type1Rowid: type.typeRowid };
    return Math.max(0, ...attacks.map(id => damageScore(id, member.pokemon, opponent, level, level)));
  });
  return ratings.reduce((sum, score) => sum + Math.min(30, score), 0);
}

export async function playCampaignBattle(page, limit = 240, trace = false, tactics) {
  const recordRounds = trace === "rounds";
  if (trace) await page.locator(".duel-record ol").evaluate((record, recordRounds) => {
    window.campaignBattleLog = [];
    const entries = () => Array.from(record.children, line => line.textContent);
    let previous = entries();
    new MutationObserver(() => {
      const current = entries();
      const prepended = current.length === Math.min(8, previous.length + 1) &&
        current.slice(1).every((line, index) => previous[index] === line);
      if (current[0] && (recordRounds ? prepended : current[0] !== previous[0])) window.campaignBattleLog.push(current[0]);
      previous = current;
    }).observe(record, { subtree: true, childList: true, characterData: true });
  }, recordRounds);
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  const team = save.entryOrder.map(id => save.roster.find(member => member.id === id));
  const reserve = team.findIndex(member => member.id === tactics?.reserve);
  let openingUses = 0;
  const result = { choices: 0, switches: 0, replacements: 0, immuneChoices: 0, struggleChoices: 0, noAttack: 0, enemies: [] };
  const defeated = new Set();
  const boosted = new Set();
  const availableMoves = new Map();
  const chosenMoves = new Map();
  const rounds = [];
  let pendingRound;
  async function finish(outcome) {
    const final = { ...result, outcome, won: outcome === "win",
      ...((trace || result.choices >= 50) && { chosenMoves: Object.fromEntries(chosenMoves) }) };
    if (!trace || outcome === "concede") return final;
    const observed = await page.evaluate(() => ({
      lines: window.campaignBattleLog,
      enemy: document.querySelector('.duel-vitals[data-side="enemy"] h2').textContent,
      enemyHp: document.querySelector('.duel-vitals[data-side="enemy"] meter').value,
    }));
    const moves = {};
    const defeats = [];
    for (const line of observed.lines) {
      const action = line.match(/^(.+?의 .+?)!/);
      if (action && !line.startsWith("상대의 ")) {
        const reading = moves[action[1]] ??= { hits: 0, damage: 0, misses: 0, unable: 0, maxHit: 0 };
        const damage = Number(line.match(/(\d+) 피해/)?.[1] ?? 0);
        reading.hits += Number(damage > 0);
        reading.damage += damage;
        reading.maxHit = Math.max(reading.maxHit, damage);
        reading.misses += Number(line.includes("빗나갔다"));
        reading.unable += Number(line.includes("효과 없음"));
      }
      if (line.includes("쓰러졌다") || line.includes("나왔다!")) defeats.push(line);
    }
    return { ...final, finish: { enemy: observed.enemy, hp: observed.enemyHp },
      trace: { moves, defeats, ...(recordRounds && { rounds }) } };
  }
  let active = 0;
  let lastEnemy = "";
  let switched = false;

  for (let round = 0; round < limit; round++) {
    const screen = await page.waitForFunction(({ recordRounds, logStart }) => {
      const outcome = document.querySelector(".duel-outcome")?.dataset.result;
      if (outcome && !recordRounds) return { outcome };
      const actions = [...document.querySelectorAll(".duel-move:not(:disabled)")];
      if (!outcome && !actions.length) return false;
      const foe = document.querySelector('.duel-vitals[data-side="enemy"]');
      const ally = document.querySelector('.duel-vitals[data-side="player"]');
      const meter = ally.querySelector("meter");
      const battleLog = window.campaignBattleLog;
      return {
        outcome,
        enemy: foe.querySelector("h2").textContent, level: Number(foe.querySelector("b").textContent.slice(3)),
        enemyHp: foe.querySelector("meter").value, playerHp: meter.value,
        ...(recordRounds && { round: Number(document.querySelector(".duel-turn b").textContent), player: ally.querySelector("h2").textContent,
          playerMaxHp: meter.max, logIndex: battleLog.length, roundLines: battleLog.slice(logStart) }),
        canSwitch: [...document.querySelectorAll(".duel-switch")].some(button => button.textContent === "교체" && !button.disabled),
        canConcede: [...document.querySelectorAll(".duel-switch")].some(button => button.textContent === "기권하고 돌아가기"),
        slots: actions.filter(button => button.dataset.switchIndex != null).map(button => Number(button.dataset.switchIndex)),
        moves: actions.filter(button => button.dataset.moveId).map(button => ({
          id: Number(button.dataset.moveId), immune: button.dataset.matchup === "0",
        })),
      };
    }, { recordRounds, logStart: pendingRound?.logIndex ?? 0 }, { polling: "raf" }).then(async handle => {
      const value = await handle.jsonValue();
      await handle.dispose();
      return value;
    });
    if (pendingRound) {
      const { logIndex, ...started } = pendingRound;
      rounds.push({ ...started, playerHpAfter: screen.playerHp, enemyAfter: screen.enemy, enemyHpAfter: screen.enemyHp, lines: screen.roundLines });
      pendingRound = undefined;
    }
    if (screen.outcome) return finish(screen.outcome);

    const label = screen.enemy + " Lv." + screen.level;
    if (label !== lastEnemy) {
      result.enemies.push(label);
      lastEnemy = label;
      switched = false;
    }
    const foe = species.get(screen.enemy);
    assert.ok(foe);
    const score = index => {
      const member = team[index];
      const options = availableMoves.get(index) ?? playableMoves(member);
      return Math.max(0, ...options.filter(id => !battle.moves[id]?.selfKO)
        .map(id => damageScore(id, member.pokemon, foe, member.level, screen.level)));
    };
    const choose = slots => {
      const front = result.enemies.length === 1 ? slots.filter(index => index !== reserve) : slots;
      return (front.length ? front : slots).reduce((best, index) => score(index) > score(best) ? index : best);
    };
    if (screen.slots.length) {
      defeated.add(active);
      active = choose(screen.slots);
      await page.locator(`[data-switch-index="${active}"]`).evaluate(button => button.click());
      result.replacements++;
      continue;
    }

    const member = team[active];
    availableMoves.set(active, screen.moves.map(({ id }) => id));
    const damage = ({ id }) => damageScore(id, member.pokemon, foe, member.level, screen.level);
    const normalMoves = screen.moves.filter(({ id }) => !battle.moves[id]?.selfKO);
    let move = (normalMoves.length ? normalMoves : screen.moves)
      .reduce((best, candidate) => damage(candidate) > damage(best) ? candidate : best);
    const best = damage(move);
    const bench = team.map((_, index) => index).filter(index => index !== active && !defeated.has(index));
    const eligibleBench = result.enemies.length === 1 ? bench.filter(index => index !== reserve) : bench;
    const next = eligibleBench.length ? choose(eligibleBench) : null;
    if (screen.canSwitch && (!switched || !best) && next !== null && score(next) > best * 1.6 + 1 && best < screen.enemyHp) {
      await page.getByRole("button", { name: "교체", exact: true }).evaluate(button => button.click());
      active = next;
      switched = true;
      await page.locator(`[data-switch-index="${active}"]`).evaluate(button => button.click());
      result.switches++;
      continue;
    }
    if (!best) {
      result.noAttack++;
      if (screen.canConcede && result.noAttack >= 2) {
        await page.getByRole("button", { name: "기권하고 돌아가기" }).click();
        return finish("concede");
      }
      move = normalMoves.find(({ immune }) => !immune) ?? move;
    } else if (screen.playerHp > 35 && screen.enemyHp > best * 5 && !boosted.has(active)) {
      const stat = catalog.get(move.id).details.damageClass === 2 ? "atk" : "satk";
      const boost = screen.moves.find(({ id }) => (battle.moves[id]?.boosts?.target === "actor" &&
        battle.moves[id].boosts.changes[stat] >= 2));
      if (boost) {
        move = boost;
        boosted.add(active);
      }
    }
    if (tactics?.opening && result.enemies.length === 1 && member.id === tactics.opening.memberId && openingUses < 3) {
      const openingMove = normalMoves.find(({ id, immune }) => !immune && catalog.get(id).nameKr === tactics.opening.move);
      if (openingMove) {
        move = openingMove;
        openingUses++;
      }
    }
    if (move.immune) result.immuneChoices++;
    if (move.id === 165) result.struggleChoices++;
    const action = member.pokemon.nameKr + " · " + catalog.get(move.id).nameKr;
    chosenMoves.set(action, (chosenMoves.get(action) ?? 0) + 1);
    if (recordRounds) pendingRound = { round: screen.round, player: screen.player, enemy: screen.enemy, choice: action,
      playerHp: screen.playerHp, playerMaxHp: screen.playerMaxHp, enemyHp: screen.enemyHp, logIndex: screen.logIndex };
    await page.locator(`[data-move-id="${move.id}"]`).evaluate(button => button.click());
    result.choices++;
  }
  throw new Error(`Battle exceeded ${limit} commands: ${JSON.stringify(result)}`);
}

export async function playBattle(page, { limit = 220, manualSwitch = false, recordMoves = false } = {}) {
  const enemy = page.locator('.duel-vitals[data-side="enemy"]');
  const player = page.locator('.duel-vitals[data-side="player"]');
  const result = page.locator(".duel-outcome");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  const team = saved.entryOrder.map(id => saved.roster.find(member => member.id === id));
  const enemyLabel = await enemy.locator("h2").textContent() + " " + await enemy.locator("b").textContent();
  let choices = 0;
  let switches = 0;
  let replacements = 0;
  let immuneChoices = 0;
  let struggleChoices = 0;
  const chosenMoves = new Map();
  const moveOrder = [];

  for (let step = 0; step < limit; step++) {
    await page.waitForFunction(() => document.querySelector(".duel-outcome, .duel-move:not(:disabled)"));
    if (await result.count()) {
      const outcome = await result.getAttribute("data-result");
      return { won: outcome === "win", outcome, choices, switches, replacements, immuneChoices, struggleChoices, enemy: enemyLabel,
        ...(recordMoves && { moveOrder }),
        ...(choices >= 50 && { chosenMoves: Object.fromEntries(chosenMoves) }) };
    }

    const defender = species.get(await enemy.locator("h2").textContent());
    const enemyLevel = Number((await enemy.locator("b").textContent()).replace("Lv.", ""));
    assert.ok(defender && enemyLevel > 0);
    const available = page.locator("[data-switch-index]:enabled");
    async function chooseAlly() {
      const slots = await available.evaluateAll(buttons => buttons.map(button => Number(button.dataset.switchIndex)));
      assert.ok(slots.length);
      const ratings = slots.map(slot => memberScore(team[slot], defender, enemyLevel));
      await available.nth(ratings.indexOf(Math.max(...ratings))).click();
    }

    if (await available.count()) {
      await chooseAlly();
      replacements++;
      continue;
    }
    const commands = page.locator("[data-move-id]:enabled");
    const legal = await commands.evaluateAll(buttons => buttons.map(button => ({
      id: Number(button.dataset.moveId), immune: button.dataset.matchup === "0",
    })));
    const name = await player.locator("h2").textContent();
    const level = Number((await player.locator("b").textContent()).replace("Lv.", ""));
    const ratings = legal.map(({ id }) => damageScore(id, species.get(name), defender, level, enemyLevel));
    const best = Math.max(...ratings);

    const switchButton = page.getByRole("button", { name: "교체", exact: true });
    if (manualSwitch && !switches && !replacements && await switchButton.count() &&
      team.slice(1).some(member => memberScore(member, defender, enemyLevel) > best * 1.6 + .5)) {
      await switchButton.click();
      await chooseAlly();
      switches++;
      continue;
    }

    let selected = ratings.indexOf(best);
    assert.ok(selected >= 0, "Battle has no enabled command");
    if (!best) {
      const boost = legal.findIndex(({ id }) => battle.moves[id]?.boosts);
      if (boost >= 0) selected = boost;
    }
    if (legal[selected].immune) immuneChoices++;
    const id = legal[selected].id;
    if (id === 165) struggleChoices++;
    const action = name + " · " + catalog.get(id).nameKr;
    if (recordMoves) moveOrder.push(action);
    chosenMoves.set(action, (chosenMoves.get(action) ?? 0) + 1);
    await commands.nth(selected).click();
    choices++;
  }
  throw new Error("Battle exceeded " + limit + " commands against " + enemyLabel);
}
