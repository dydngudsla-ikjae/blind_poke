import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";
import { playBattle, useHistoricalBattleData } from "./battle-play.mjs";

const key = "blindpoke-save-v1";
const route = ["southwest", "west", "south", "southeast", "east", "center", "northwest", "northeast", "island"];
const scenarios = [
  { seed: 7, picks: [0, 1, 2] },
  { seed: 19, picks: [1, 2, 0] },
  { seed: 83, picks: [2, 0, 1] },
  { seed: 121, picks: [0, 2, 1] },
  { seed: 226, picks: [1, 0, 2] },
];
const usePreparation = process.argv.includes("--prepare");
const reviewPp = process.argv.includes("--review-pp");
const holdEncounter = process.argv.includes("--hold-encounter");
const baselineData = holdEncounter || process.argv.includes("--baseline-data");
const requestedSeeds = process.argv.slice(2).filter(arg => !["--prepare", "--review-pp", "--hold-encounter", "--baseline-data"].includes(arg)).map(Number);
assert.ok(!holdEncounter || usePreparation, "Use --hold-encounter with --prepare");
assert.ok(!reviewPp || usePreparation && !baselineData && requestedSeeds.length === 1 && requestedSeeds[0] === 19, "Use --review-pp with --prepare 19 on current battle data");
assert.ok(requestedSeeds.every(seed => scenarios.some(scenario => scenario.seed === seed)), "Unknown campaign seed");
const selected = requestedSeeds.length ? scenarios.filter(scenario => requestedSeeds.includes(scenario.seed)) : scenarios;
const readData = async file => JSON.parse(await readFile(new URL(`../data/${file}.json`, import.meta.url), "utf8"));
const [pokemon, { trainers }] = await Promise.all([readData("pokemon"), readData("trainer")]);
const speciesById = new Map(pokemon.map(record => [record.pokemonRowid, record]));

const server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
let browser;
const ppReplay = {};

async function play({ seed, picks }, saveFirstCandy = false) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  if (baselineData) await useHistoricalBattleData(page);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: true });
  const save = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const turn = () => page.locator("#nextTurn").click();
  const map = () => button("지도").click();
  const base = () => button("본거지로").click();
  const challenge = () => button(/거점 도전/);
  const node = id => page.locator(`[data-node="${id}"]`);
  const spot = (state, id) => state.mapSnapshot.find(territory => territory.id === id);
  const battles = [];
  let charges = 0;
  let hunts = 0;
  let preparationEnergy = 0;
  let counter;

  async function recruit(ids) {
    await button("엔트리").click();
    const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    for (const id of ids) await entry.locator(`[data-pc-member="${id}"]`).click();
    await button("닫기", entry).click();
  }

  async function recharge() {
    await button("상점").click();
    const shop = page.getByRole("dialog", { name: /상점/ });
    await button("구매", shop).click();
    await button("닫기", shop).click();
    charges++;
  }

  async function capture(target, returnButton) {
    await target.click();
    await button(/본인확인서 대조/).click();
    const silhouette = page.locator('[data-mode="silhouette"] .identify-target-art');
    await silhouette.waitFor();
    const id = Number((await silhouette.getAttribute("src")).match(/(\d+)\.png$/)?.[1]);
    const guess = page.getByRole("textbox", { name: "포켓몬 이름" });
    await guess.fill(speciesById.get(id).nameKr);
    await guess.press("Enter");
    await page.locator('.identify-outcome[data-result="captured"], .identify-outcome[data-result="fled"]').waitFor();
    await returnButton.click();
  }

  async function reinforce() {
    const state = await save();
    if (state.energy < 2) await turn();
    await button(/탐험/).click();
    await capture(page.locator(".hunt-target").first(), button("본거지로"));
    hunts++;
    const after = await save();
    if (after.roster.length > state.roster.length) await recruit([after.roster.at(-1).id]);
  }

  try {
    await page.addInitScript(seed => {
      window.campaignRngState = seed;
      Math.random = () => {
        seed = window.campaignRngState = (window.campaignRngState + 0x6D2B79F5) | 0;
        let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
        value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      };
    }, seed);
    await page.goto(url);
    for (const [round, pick] of picks.entries()) {
      await heading(`스타팅 선택 ${round + 1}/3`).waitFor();
      await page.locator("[data-draft-target]").nth(pick).press("Enter");
    }
    await button("본거지로 이동").click();
    const draft = await save();
    await recruit(draft.roster.map(member => member.id));

    for (const [index, id] of route.entries()) {
      for (let attempt = 1; ; attempt++) {
        assert.ok(attempt <= 8, `${id} still held by the opponent after eight attempts`);
        const initial = await save();
        if (initial.energy < 2) {
          if (initial.resources.gold >= 5) await recharge();
          else await turn();
        }
        let ready = await save();
        await map();
        await node(id).click();
        if (!spot(ready, id).scouted) await button(/정찰하기/).click();
        if (usePreparation && seed === 19 && id === "east" && !counter) {
          const encounterRng = holdEncounter ? await page.evaluate(() => window.campaignRngState) : null;
          if (reviewPp) {
            if (saveFirstCandy) await page.evaluate(draw => { window.campaignRngState = draw; }, ppReplay.huntDraw);
            else ppReplay.huntDraw = await page.evaluate(() => window.campaignRngState);
          }
          const readiness = page.getByRole("region", { name: "도전 전 확인" });
          await readiness.getByText(/고스트/).first().waitFor();
          const combos = readiness.locator("select");
          if (await combos.count()) {
            const groundGhost = combos.getByRole("option", { name: /땅.*고스트|고스트.*땅/ });
            if (await groundGhost.count()) await combos.selectOption(await groundGhost.getAttribute("value"));
          }
          await button(/유효 공격 후보 탐색/, readiness).click();
          await capture(page.locator('.hunt-target[data-counter="true"]'), button("월드맵으로"));
          await heading("월드맵").waitFor();
          const captured = await save();
          preparationEnergy += ready.energy - captured.energy;
          assert.equal(captured.roster.length, ready.roster.length + 1);
          counter = captured.roster.at(-1);
          if (reviewPp) {
            if (saveFirstCandy) assert.deepEqual(counter, ppReplay.counter);
            else ppReplay.counter = counter;
          }
          await button("엔트리 편성", readiness).click();
          const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
          await entry.locator(`[data-pc-member="${counter.id}"]`).click();
          await button("닫기", entry).click();
          ready = await save();
          if (ready.energy < 2) {
            await base();
            if (ready.resources.gold >= 5) await recharge();
            else await turn();
            ready = await save();
            await map();
            await node(id).click();
          }
          // The comparison holds the encounter draw fixed while all preparation runs through the UI.
          if (encounterRng !== null) await page.evaluate(value => { window.campaignRngState = value; }, encounterRng);
        }
        const watchPp = reviewPp && id === "east";
        if (watchPp) {
          const tactics = page.locator(".atlas-tactics").filter({ hasText: "상성·교대 분석" });
          await tactics.getByText("상성·교대 분석", { exact: true }).press("Enter");
          const types = tactics.getByLabel("정찰한 상대 후보 타입");
          const flyingGhost = types.locator('optgroup[label="유효 공격 PP 부족 가능"]').getByRole("option", { name: /비행.*고스트|고스트.*비행/ });
          await types.selectOption(await flyingGhost.getAttribute("value"));
          const attacks = tactics.getByRole("list", { name: "아군 공격 상성" });
          await attacks.getByText(/라프라스.*물대포.*유효 PP 합계 25/).waitFor();
          assert.equal(await attacks.getByText(/유효 PP 합계 0$/).count(), 3);
          assert.ok(!(await tactics.innerText()).includes("흔들풍손"));
          const warning = tactics.getByRole("status");
          await warning.getByText("유효 공격 PP 부족 가능").waitFor();
          await types.selectOption({ label: "얼음" });
          assert.equal(await tactics.getByRole("status").count(), 0);
          await types.selectOption(await flyingGhost.getAttribute("value"));
          const warningText = await warning.innerText();
          const readings = await attacks.getByRole("listitem").allTextContents();
          await button("PC에서 약점 기술 확인", tactics).press("Enter");
          const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
          await pc.getByRole("heading", { name: "라프라스 Lv.1" }).waitFor();
          const forecast = await pc.locator('.base-weakness [aria-live="polite"]').innerText();
          if (saveFirstCandy) {
            assert.equal(ready.resources.candy, 1);
            await button("사탕 먹이기", pc).click();
            await pc.getByRole("heading", { name: "라프라스 Lv.2" }).waitFor();
          }
          await page.keyboard.press("Escape");
          const prepared = await save();
          assert.equal(prepared.energy, ready.energy - Number(saveFirstCandy));
          assert.equal(prepared.resources.candy, ready.resources.candy - Number(saveFirstCandy));
          assert.equal(prepared.turnCount, ready.turnCount);
          assert.deepEqual(prepared.entryOrder, ready.entryOrder);
          ready = prepared;
          if (saveFirstCandy) {
            assert.equal(ready.turnCount, ppReplay.turn);
            await page.evaluate(draw => { window.campaignRngState = draw; }, ppReplay.battleDraw);
          } else {
            ppReplay.turn = ready.turnCount;
            ppReplay.battleDraw = await page.evaluate(() => window.campaignRngState);
          }
          console.log(JSON.stringify({ saveFirstCandy, ppScout: readings, warning: warningText, forecast, energy: ready.energy, candy: ready.resources.candy }));
        }
        await challenge().click();
        if (watchPp && !saveFirstCandy) {
          await page.locator('.duel-vitals[data-side="enemy"] meter').evaluate(foe => {
            window.ppReview = { startHp: foe.value };
            const observer = new MutationObserver(() => {
              const waterGun = document.querySelector('[data-move-id="55"]');
              if (!waterGun?.textContent.includes("PP 0/25")) return;
              const note = document.querySelector(".duel-counter-note");
              if (!note) return;
              window.ppReview.exhaustedHp = foe.value;
              window.ppReview.note = note.textContent;
              window.ppReview.struggle = Boolean(document.querySelector('[data-move-id="165"]'));
              observer.disconnect();
            });
            observer.observe(document.querySelector(".duel-console"), { subtree: true, childList: true, characterData: true });
          });
        }
        const { moveOrder, ...battle } = await playBattle(page, { manualSwitch: true, recordMoves: watchPp && saveFirstCandy });
        if (watchPp && saveFirstCandy) {
          assert.equal(battle.enemy, ppReplay.enemy);
          assert.ok(battle.won && battle.choices < ppReplay.choices);
          assert.ok(moveOrder.every(move => move === "라프라스 · 물대포"));
          console.log(JSON.stringify({ saveFirstCandy, choices: battle.choices, switches: battle.switches,
            replacements: battle.replacements, enemy: battle.enemy }));
        } else if (watchPp) {
          const read = await page.evaluate(() => window.ppReview);
          assert.equal(read.startHp, 202);
          assert.equal(read.exhaustedHp, 2);
          assert.match(read.note, /기권하고 돌아가기/);
          assert.equal(read.struggle, false);
          ppReplay.enemy = battle.enemy;
          ppReplay.choices = battle.choices;
          console.log(JSON.stringify({ saveFirstCandy, ppBattle: read, battle }));
        }
        battles.push({ site: id, turn: ready.turnCount, ...battle });
        await button("월드맵으로").click();
        await heading("월드맵").waitFor();
        const resolved = await save();
        assert.equal(resolved.energy, ready.energy - 2);
        assert.equal(spot(resolved, id).owner, battle.won ? "player" : spot(ready, id).owner);
        assert.equal(resolved.resources.gold - ready.resources.gold, battle.won && index === 0 ? 5 : 0);
        assert.equal(resolved.resources.candy - ready.resources.candy, battle.won && index === 0 ? 1 : 0);
        assert.equal(await page.locator(".atlas-node:disabled").count(), battle.won && index === route.length - 1 ? 20 : 30);
        if (battle.won && index === route.length - 1) break;
        await base();
        if (battle.won) {
          if (index === 0 && !saveFirstCandy) {
            await button(/포켓몬 \d/).click();
            const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
            await pc.locator(`[data-install-pick="${draft.roster[0].id}"]`).click();
            await button("사탕 먹이기", pc).click();
            await button("닫기", pc).click();
          }
          break;
        }
        if (resolved.entryOrder.length < 6) await reinforce();
      }
    }

    const cleared = await save();
    assert.ok(["home", ...route].every(id => spot(cleared, id).owner === "player"));
    assert.equal(cleared.mapSnapshot.filter(territory => territory.owner === "player").length, 10);
    assert.equal(cleared.mapSnapshot.filter(territory => territory.active && territory.id.startsWith("nw-")).length, 10);
    await page.reload();
    await heading("본거지").waitFor();
    const restored = await save();
    for (const field of ["mapSnapshot", "roster", "entryOrder", "energy", "resources", "turnCount", "trainerId"]) {
      assert.deepEqual(restored[field], cleared[field], `Changed after reload: ${field}`);
    }
    await map();
    await heading("월드맵").waitFor();
    assert.equal(await page.locator('.atlas-node[data-status="owned"]').count(), 10);
    assert.equal(await page.locator(".atlas-node:disabled").count(), 20);
    assert.deepEqual(errors, []);
    const trainer = trainers.find(record => record.id === draft.trainerId).nameKr;
    const starters = draft.roster.map(member => member.pokemon.nameKr).join(", ");
    const losses = battles.filter(battle => battle.outcome === "lose").length;
    const draws = battles.filter(battle => battle.outcome === "draw").length;
    const choices = battles.reduce((count, battle) => count + battle.choices, 0);
    const switches = battles.reduce((count, battle) => count + battle.switches, 0);
    const replacements = battles.reduce((count, battle) => count + battle.replacements, 0);
    const immuneChoices = battles.reduce((count, battle) => count + battle.immuneChoices, 0);
    const longest = battles.reduce((max, battle) => battle.choices > max.choices ? battle : max);
    if (usePreparation && seed === 19) {
      assert.equal(preparationEnergy, 2);
      assert.ok(counter && cleared.entryOrder.includes(counter.id));
      const preparedBattle = battles.find(battle => battle.site === "east");
      if (holdEncounter) {
        assert.equal(preparedBattle.enemy, "모래꿍 Lv.6");
        assert.equal(preparedBattle.immuneChoices, 0);
      }
    }
    console.log(JSON.stringify({ seed, trainer, starters, turns: cleared.turnCount, losses, draws, choices, switches, replacements, immuneChoices, longest, charges, hunts,
      ...(counter && { preparationEnergy, counter: counter.pokemon.nameKr, preparedBattle: battles.find(battle => battle.site === "east") }) }));
    if (losses || draws) console.log(JSON.stringify({ seed, retries: battles.filter(battle => !battle.won) }));
    return { trainer, starters };
  } catch (error) {
    console.error(`Seed ${seed}: ${JSON.stringify(battles)}`);
    throw new Error(`Starting region failed for seed ${seed}`, { cause: error });
  } finally {
    await page.close();
  }
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  for (const scenario of selected) results.push(await play(scenario));
  if (reviewPp) assert.deepEqual(await play(selected[0], true), results[0]);
  assert.equal(new Set(results.map(result => result.trainer)).size, selected.length);
  assert.equal(new Set(results.map(result => result.starters)).size, selected.length);
  console.log("Starting region Chrome passed: " + selected.length + " fresh campaigns secured all ten sites and restored the clear after reload");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
