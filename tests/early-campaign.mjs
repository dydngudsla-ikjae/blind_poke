import { playBattle } from "./battle-play.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { preview } from "vite";

const key = "blindpoke-save-v1";
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

async function play({ seed, picks, advanceTurn, nearCapacity }) {
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
  const openMap = async () => {
    await button("지도").click();
    await heading("월드맵").waitFor();
  };

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

    await button("엔트리").click();
    const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    for (const member of draft.roster) await entry.locator(`[data-pc-member="${member.id}"]`).click();
    await button("닫기", entry).click();
    const before = await save();
    assert.deepEqual(before.entryOrder, draft.roster.map(member => member.id));

    await openMap();
    await node("southwest").click();
    await button(/정찰하기/).click();
    const previewText = await reward().textContent();
    if (nearCapacity) {
      assert.match(previewText, /자금 \+2/);
      assert.match(previewText, /저장 공간 부족/);
    }
    await challenge().click();
    const opponent = page.locator('.duel-vitals[data-side="enemy"]');
    await heading("캐터피", opponent).waitFor();
    await opponent.getByText("Lv.2", { exact: true }).waitFor();

    const { won, choices: actions } = await playBattle(page);
    assert.equal(won, true);
    assert.equal(await reward().textContent(), previewText);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).mapSnapshot.some(spot => spot.id === "southwest" && spot.owner === "player"), key);
    const victory = await save();
    assert.equal(victory.energy, before.energy - 2);
    assert.equal(victory.resources.gold - before.resources.gold, nearCapacity ? 2 : 5);
    assert.equal(victory.resources.candy - before.resources.candy, nearCapacity ? 0 : 1);

    await page.reload();
    await heading("본거지").waitFor();
    const restored = await save();
    assert.deepEqual(restored.resources, victory.resources);
    assert.deepEqual(restored.mapSnapshot, victory.mapSnapshot);
    assert.equal(restored.trainerId, draft.trainerId);
    assert.deepEqual(restored.entryOrder, before.entryOrder);

    if (advanceTurn) await page.locator("#nextTurn").click();
    const growth = page.getByRole("dialog", { name: /보유 포켓몬/ });
    await button(/포켓몬 \d/).click();
    await growth.locator(`[data-install-pick="${draft.roster[0].id}"]`).click();
    await button("사탕 먹이기", growth).click();
    await button("닫기", growth).click();
    const fed = await save();
    assert.equal(fed.roster[0].level, draft.roster[0].level + 1);
    assert.equal(fed.resources.candy, victory.resources.candy - 1);
    assert.equal(fed.resources.gold, victory.resources.gold + (advanceTurn ? 3 : 0));
    assert.equal(fed.energy, (advanceTurn ? 5 : victory.energy) - 1);

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
    await challenge().click();
    await heading("거점 배틀").waitFor();
    assert.equal((await page.locator(".duel-arena .draft-scanner-status").textContent()).trim(), rival);
    await page.locator('.duel-vitals[data-side="player"]').getByText("Lv.2", { exact: true }).waitFor();
    assert.equal((await save()).turnCount, advanceTurn ? 1 : 0);
    assert.equal((await save()).energy, spent.energy - 2);
    assert.deepEqual(errors, []);
    const names = draft.roster.map(member => member.pokemon.nameKr);
    console.log(`Seed ${seed} · ${draft.trainerId} / ${names.join(", ")} · ${actions} attacks · next challenge on turn ${(await save()).turnCount}`);
    return { trainer: draft.trainerId, starters: draft.roster.map(member => member.pokemon.pokemonRowid).sort((a, b) => a - b).join(",") };
  } catch (error) {
    throw new Error(`Early campaign failed for seed ${seed}`, { cause: error });
  } finally {
    await page.close();
  }
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  for (const scenario of scenarios) results.push(await play(scenario));
  assert.equal(new Set(results.map(scenario => scenario.trainer)).size, scenarios.length);
  assert.equal(new Set(results.map(scenario => scenario.starters)).size, scenarios.length);
  console.log("Early campaign Chrome passed: five distinct drafts, first-win growth, spending and next challenge");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
