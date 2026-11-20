import { playBattle, setBattleRandom } from "./battle-play.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { preview } from "vite";

const key = "blindpoke-save-v1";
const compareFirstWin = process.argv.includes("--compare-first-win");
const compareFirstLead = process.argv.includes("--compare-first-lead");
const compare = compareFirstWin || compareFirstLead;
const scenarios = [
  { seed: 7, picks: [0, 1, 2] },
  { seed: 19, picks: [1, 2, 0], advanceTurn: true },
  { seed: 83, picks: [2, 0, 1] },
  { seed: 121, picks: [0, 2, 1], advanceTurn: true },
  { seed: 226, picks: [1, 0, 2], nearCapacity: true },
];
const server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
let browser;

async function play({ seed, picks, advanceTurn, nearCapacity }, route = "direct") {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name, parent = page) => parent.getByRole("button", { name, exact: typeof name === "string" });
  const heading = (name, parent = page) => parent.getByRole("heading", { name, exact: typeof name === "string" });
  const save = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const node = id => page.locator(`[data-node="${id}"]`);
  const owner = (snapshot, id) => snapshot.mapSnapshot.find(spot => spot.id === id)?.owner;
  const challenge = () => button(/거점 도전/);
  const reward = () => page.getByText(/^첫 승리 보상/);
  let spentBeforeWin = 0;
  const spend = async (action, cost) => {
    const before = (await save()).energy;
    await action();
    assert.equal((await save()).energy, before - cost);
    spentBeforeWin += cost;
  };
  const openMap = async () => {
    await button("지도").click();
    await heading("월드맵").waitFor();
  };

  async function produceSeed(starters) {
    await button("1번 부지 건설").click();
    const build = page.getByRole("dialog", { name: "건설 · 1번 부지" });
    await button("밭", build).click();
    for (const member of starters) await build.locator(`[data-install-pick="${member.id}"]`).click();
    await spend(async () => {
      await build.locator("[data-build-confirm]").click();
      await build.waitFor({ state: "hidden" });
    }, 1);
    await page.locator("#nextTurn").click();
    const farm = page.getByRole("dialog", { name: "밭 · 1번 부지" });
    const openSeedJob = async () => {
      await button("1번 부지 밭 관리").click();
      await button(/씨앗 생성/, farm).click();
    };
    let worker;
    let hunts = 0;
    while (!worker && hunts < 4) {
      if ((await save()).energy < 2) await page.locator("#nextTurn").click();
      await openSeedJob();
      await spend(async () => {
        await button(/풀 타입 탐색/, farm).click();
        await heading("야생 탐험").waitFor();
      }, 2);
      hunts++;
      const observation = page.getByRole("complementary", { name: "관측 패널" });
      for (const target of await page.locator(".hunt-target").all()) {
        await target.hover();
        if (await observation.locator(".draft-detected-type dd").textContent() !== "풀") continue;
        await target.click();
        break;
      }
      await button(/본인확인서 대조/).click();
      const silhouette = page.locator('[data-mode="silhouette"] .identify-target-art');
      const source = await silhouette.getAttribute("src");
      const id = Number(source.match(/(\d+)\.png$/)?.[1]);
      const name = await page.evaluate(async id => (await fetch("/data/pokemon.json").then(response => response.json()))
        .find(pokemon => pokemon.pokemonRowid === id).nameKr, id);
      await page.getByRole("textbox", { name: "포켓몬 이름" }).fill(name);
      await button("식별").click();
      const outcome = page.locator(".identify-outcome");
      await outcome.waitFor();
      if (await outcome.getAttribute("data-result") === "captured") {
        worker = (await save()).roster.at(-1);
        assert.equal(worker.pokemon.pokemonRowid, id);
      }
      await button("본거지로").click();
      await heading("본거지").waitFor();
    }
    assert.ok(worker, "The type search produced a grass worker in at most four attempts");
    if ((await save()).energy < 1) await page.locator("#nextTurn").click();
    await openSeedJob();
    await farm.locator(`[data-install-pick="${worker.id}"]`).click();
    await spend(() => button(/직무 배치 · 행동력/, farm).click(), 1);
    assert.equal((await save()).roster.find(member => member.id === worker.id).jobId, "seed");
    await button("닫기", farm).click();
    const stockBefore = (await save()).resources.seed;
    await page.locator("#nextTurn").click();
    const produced = (await save()).resources.seed - stockBefore;
    assert.ok(produced > 0);
    return { worker, hunts, produced };
  }

  try {
    await page.addInitScript(seed => {
      Math.random = () => {
        seed = (seed + 0x6D2B79F5) | 0;
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
    assert.equal(draft.roster.length, 3);

    // Restore a valid, nearly full store to check the first-win preview and actual award.
    if (nearCapacity) {
      await page.evaluate(key => {
        const snapshot = JSON.parse(localStorage.getItem(key));
        snapshot.resources.gold = snapshot.storageCap - 2;
        snapshot.resources.candy = snapshot.storageCap;
        localStorage.setItem(key, JSON.stringify(snapshot));
      }, key);
      await page.reload();
    }

    const production = route === "production" ? await produceSeed(draft.roster) : null;
    const members = production ? [...draft.roster, production.worker] : draft.roster;
    await openMap();
    await node("southwest").click();
    await button(/정찰하기/).click();
    await button("엔트리 편성").click();
    const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    for (const member of members) await entry.locator(`[data-pc-member="${member.id}"]`).click();
    await button("닫기", entry).click();
    const initialOrder = members.map(member => member.id);
    const arranged = await save();
    assert.deepEqual(arranged.entryOrder, initialOrder);
    let opening = [];
    let leadIndex = 0;
    if (compareFirstLead) {
      const brief = page.getByRole("region", { name: "첫 도전 준비" });
      await brief.getByText("캐터피 Lv.2", { exact: true }).waitFor();
      await brief.getByText(/선봉 비교/).click();
      const rows = brief.getByRole("list", { name: "선봉별 공격" }).getByRole("listitem");
      assert.equal(await rows.count(), members.length);
      opening = (await rows.allTextContents()).map((row, index) => ({
        member: members[index].pokemon.nameKr,
        damage: Number(row.match(/(\d+) 피해/)?.[1] ?? 0),
        accuracy: Number(row.match(/명중 (\d+)%/)?.[1] ?? 100),
      }));
      if (route === "lead") {
        const score = ({ damage, accuracy }) => damage * accuracy;
        leadIndex = opening.reduce((best, attack, index) => score(attack) > score(opening[best]) ? index : best, 0);
        if (leadIndex !== 0) await button(`${opening[leadIndex].member} 선봉으로`, brief).click();
        await button(`${opening[leadIndex].member} 현재 선봉`, brief).waitFor();
      }
    }
    const before = await save();
    assert.deepEqual(before.entryOrder, [initialOrder[leadIndex], ...initialOrder.filter((_, index) => index !== leadIndex)]);
    assert.equal(before.energy, arranged.energy);

    const previewText = await reward().textContent();
    if (nearCapacity) {
      assert.match(previewText, /자금 \+2/);
      assert.match(previewText, /저장 공간 부족/);
    }
    const opponent = page.locator('.duel-vitals[data-side="enemy"]');
    let actions = 0;
    let retries = 0;
    let won = false;
    let replacements = 0;
    const moves = new Map();
    while (!won && retries <= 2) {
      if (compare) await setBattleRandom(page, seed + retries);
      await spend(async () => {
        await challenge().click();
        await heading("캐터피", opponent).waitFor();
        await opponent.getByText("Lv.2", { exact: true }).waitFor();
      }, 2);
      if (compareFirstLead) {
        await heading(members[leadIndex].pokemon.nameKr, page.locator('.duel-vitals[data-side="player"]')).waitFor();
      }
      const battle = await playBattle(page, { recordMoves: compare });
      won = battle.won;
      actions += battle.choices;
      replacements += battle.replacements;
      for (const move of battle.moveOrder ?? []) moves.set(move, (moves.get(move) ?? 0) + 1);
      if (won || !compare) break;
      retries++;
      await button("월드맵으로").click();
      if ((await save()).energy < 2) {
        await button("본거지로").click();
        await page.locator("#nextTurn").click();
        await openMap();
        await node("southwest").click();
      }
    }
    assert.equal(won, true, "First territory is won within three challenges");
    assert.equal(await reward().textContent(), previewText);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).mapSnapshot.some(spot => spot.id === "southwest" && spot.owner === "player"), key);
    const victory = await save();
    if (retries === 0) assert.equal(victory.energy, before.energy - 2);
    assert.equal(victory.resources.gold - before.resources.gold, nearCapacity ? 2 : 5);
    assert.equal(victory.resources.candy - before.resources.candy, nearCapacity ? 0 : 1);

    await page.reload();
    await heading("본거지").waitFor();
    const restored = await save();
    assert.deepEqual(restored.resources, victory.resources);
    assert.deepEqual(restored.mapSnapshot, victory.mapSnapshot);
    assert.equal(restored.trainerId, draft.trainerId);
    assert.deepEqual(restored.entryOrder, before.entryOrder);

    const waitForGrowth = advanceTurn || compare && victory.energy < 1;
    if (waitForGrowth) await page.locator("#nextTurn").click();
    const beforeGrowth = await save();
    const growth = page.getByRole("dialog", { name: /보유 포켓몬/ });
    await button(/포켓몬 \d/).click();
    const lead = members[leadIndex];
    await growth.locator(`[data-install-pick="${lead.id}"]`).click();
    await button("사탕 먹이기", growth).click();
    await button("닫기", growth).click();
    const fed = await save();
    assert.equal(fed.roster.find(member => member.id === lead.id).level, lead.level + 1);
    assert.equal(fed.resources.candy, victory.resources.candy - 1);
    assert.equal(fed.resources.gold, victory.resources.gold + (waitForGrowth ? 3 : 0));
    assert.equal(fed.energy, (waitForGrowth ? 5 : victory.energy) - 1);

    await button("상점").click();
    const shop = page.getByRole("dialog", { name: /상점/ });
    await button("구매", shop).click();
    await button("닫기", shop).click();
    const spent = await save();
    assert.equal(spent.resources.gold, fed.resources.gold - 5);
    assert.equal(spent.energy, Math.min(5, fed.energy + 2));

    await openMap();
    const next = ["west", "south", "southeast"].find(id => owner(spent, id) === "trainer");
    assert.ok(next, "starting frontier has a trainer to challenge");
    await node(next).click();
    await button(/정찰하기/).click();
    const rival = await page.locator('.atlas-faction-card[data-status="trainer"] strong').textContent();
    assert.equal(await reward().count(), 0);
    assert.equal(await page.getByRole("region", { name: "첫 도전 준비" }).count(), 0);
    await challenge().click();
    await heading("거점 배틀").waitFor();
    assert.equal((await page.locator(".duel-opponent").textContent()).trim(), rival);
    await page.locator('.duel-vitals[data-side="player"]').getByText("Lv.2", { exact: true }).waitFor();
    const nextChallenge = await save();
    assert.equal(nextChallenge.turnCount, victory.turnCount + (waitForGrowth ? 1 : 0));
    assert.equal(nextChallenge.energy, spent.energy - 2);
    assert.deepEqual(errors, []);
    const names = draft.roster.map(member => member.pokemon.nameKr);
    if (compare) {
      console.log(JSON.stringify({
        seed, route, starters: names, firstWinTurn: victory.turnCount, spentBeforeWin, actions, retries, replacements,
        moves: Object.fromEntries(moves),
        ...(compareFirstLead && { lead: lead.pokemon.nameKr, opening }),
        firstProduction: production ? { worker: production.worker.pokemon.nameKr, hunts: production.hunts, seeds: production.produced } : null,
        seedsSpent: before.resources.seed - victory.resources.seed + beforeGrowth.resources.seed - nextChallenge.resources.seed,
      }));
    } else {
      console.log(`Seed ${seed} · ${draft.trainerId} / ${names.join(", ")} · ${actions} attacks · next challenge on turn ${nextChallenge.turnCount}`);
    }
    if (compare) return { trainer: draft.trainerId, starters: draft.roster.map(({ pokemon, iv, level }) => [pokemon.pokemonRowid, iv, level]) };
    return { trainer: draft.trainerId, starters: draft.roster.map(member => member.pokemon.pokemonRowid).sort((a, b) => a - b).join(",") };
  } catch (error) {
    throw new Error(`Early campaign failed for seed ${seed} (${route})`, { cause: error });
  } finally {
    await page.close();
  }
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  if (compare) {
    for (const scenario of scenarios.filter(({ seed }) => seed === 19 || seed === 83)) {
      assert.deepEqual(await play(scenario), await play(scenario, compareFirstLead ? "lead" : "production"));
    }
    console.log("First-win comparison passed: same starters and battle random sequence for both routes");
  } else {
    const results = [];
    for (const scenario of scenarios) results.push(await play(scenario));
    assert.equal(new Set(results.map(scenario => scenario.trainer)).size, scenarios.length);
    assert.equal(new Set(results.map(scenario => scenario.starters)).size, scenarios.length);
    console.log("Early campaign Chrome passed: five distinct drafts, first-win growth, spending and next challenge");
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
