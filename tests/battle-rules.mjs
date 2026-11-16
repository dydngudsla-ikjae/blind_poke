import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";
import { playBattle } from "./battle-play.mjs";

const key = "blindpoke-save-v1";
const pokemon = JSON.parse(await readFile(new URL("../data/pokemon.json", import.meta.url), "utf8"));
const { trainers } = JSON.parse(await readFile(new URL("../data/trainer.json", import.meta.url), "utf8"));
const rivalId = trainers[1].id;
const server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;

async function openBattle(profile) {
  const page = await browser.newPage({
    isMobile: profile.mobile, hasTouch: profile.mobile, viewport: { width: profile.mobile ? 390 : 1440, height: 900 }, reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => window.battleRoll ?? 0; });
  await page.route("**/data/trainer.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    const trainer = data.trainers.find(trainer => trainer.id === rivalId);
    trainer.pokemon = [{ id: profile.enemy, nameKr: pokemon.find(mon => mon.pokemonRowid === profile.enemy).nameKr }];
    await route.fulfill({ response, json: data });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const button = name => page.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: true });
  for (let round = 1; round <= 3; round++) {
    await heading("스타팅 선택 " + round + "/3").waitFor();
    await page.locator("[data-draft-target]").first().press("Enter");
  }
  await button("본거지로 이동").click();
  const roster = profile.team.map(([id, level]) => ({ pokemon: pokemon.find(mon => mon.pokemonRowid === id), level }));
  await page.evaluate(({ profile, key, roster, rivalId }) => {
    const save = JSON.parse(localStorage.getItem(key));
    save.mapSnapshot = save.mapSnapshot.map(spot => profile.owned.includes(spot.id)
      ? { ...spot, owner: "player", trainerId: null, scouted: true }
      : spot.id === profile.site ? { ...spot, owner: "trainer", trainerId: rivalId, scouted: profile.scouted, active: true }
        : spot.trainerId === rivalId ? { ...spot, owner: "unoccupied", trainerId: null } : spot);
    save.roster = save.roster.map((member, index) => ({ ...member, ...roster[index], iv: {}, exp: index === 1 ? profile.exp : 0 }));
    save.entryOrder = save.roster.map(member => member.id);
    save.resources.candy = profile.candy;
    if (profile.legacy) {
      save.v = 3;
      localStorage.setItem("blindpoke-map-v1", JSON.stringify(save.mapSnapshot));
      delete save.mapSnapshot;
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, { profile: { site: profile.site, owned: profile.owned, scouted: profile.scouted ?? true,
    exp: profile.exp ?? 0, candy: profile.candy ?? 0, legacy: Boolean(profile.legacy) }, roster, key, rivalId });
  await page.reload();
  if (profile.produceCure) {
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const turn = async () => {
      const expected = (await read()).turnCount + 1;
      await page.locator("#nextTurn").tap();
      await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key))?.turnCount === expected, { key, expected });
    };
    assert.equal((await read()).resources.cureItem, 0);
    await button("1번 부지 건설").tap();
    const build = page.getByRole("dialog", { name: "건설 · 1번 부지" });
    await build.getByRole("button", { name: "치료소", exact: true }).tap();
    for (const id of (await read()).entryOrder) await build.locator(`[data-install-pick="${id}"]`).tap();
    await build.locator("[data-build-confirm]").tap();
    await turn();
    await button("1번 부지 치료소 관리").tap();
    const clinic = page.getByRole("dialog", { name: "치료소 · 1번 부지" });
    await clinic.getByRole("button", { name: /치료 아이템 생산/ }).tap();
    assert.equal(await clinic.locator("[data-install-pick]").count(), 1);
    await clinic.locator('[data-install-pick="mon-2"]').tap();
    await clinic.getByRole("button", { name: /직무 배치 · 행동력/ }).tap();
    await clinic.getByText("치료 아이템 +1 / 최대 1").waitFor();
    await clinic.getByRole("button", { name: "닫기", exact: true }).tap();
    await turn();
    const { cureItem, healItem } = (await read()).resources;
    assert.equal(cureItem, 1);
    assert.equal(healItem, 0);
    await page.reload();
    await heading("본거지").waitFor();
    assert.equal((await read()).resources.cureItem, 1);
    assert.equal((await read()).roster.find(member => member.id === "mon-2").jobId, "cure");
  }
  await button("지도").click();
  await page.locator('[data-node="' + profile.site + '"]').click();
  const opponent = page.locator('.duel-vitals[data-side="enemy"]');
  const challenge = async () => {
    await button(/거점 도전/).click();
    await heading("거점 배틀").waitFor();
    await opponent.getByRole("heading", { name: pokemon.find(mon => mon.pokemonRowid === profile.enemy).nameKr }).waitFor();
    assert.equal(await opponent.locator("b").textContent(), "Lv." + profile.level);
  };
  if (!profile.mapOnly) await challenge();
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const report = page.getByRole("region", { name: "도전 전 확인" });
  return { page, errors, opponent, button, challenge, read, report };
}

const hp = vitals => vitals.locator("meter").evaluate(meter => meter.value);
const ready = page => page.waitForFunction(() => document.querySelector(".duel-outcome, .duel-move:not(:disabled)"));

try {
  browser = await chromium.launch({ channel: "chrome" });
  const healing = await openBattle({
    site: "south", enemy: 13, level: 4, team: [[19, 2], [23, 1], [68, 1]],
    owned: ["home", "southwest"], mobile: true, legacy: true, produceCure: true,
  });
  const patient = healing.page.locator('.duel-vitals[data-side="player"]');
  const treatment = healing.button(/치료 아이템 사용/);
  const attackRound = healing.page.locator('[data-move-id="33"]');
  await attackRound.tap();
  await patient.locator('[data-condition="poison"]').waitFor();
  await treatment.waitFor();
  await ready(healing.page);
  const poisoned = await healing.read();
  const poisonedHp = await hp(patient);
  const playerPp = await attackRound.textContent();
  await healing.page.evaluate(() => { window.battleRoll = .99; });
  await treatment.tap();
  await healing.page.getByText(/독 상태이상을 치료했다/).waitFor();
  await ready(healing.page);
  assert.equal(await patient.locator(".duel-condition").count(), 0);
  assert.ok(await hp(patient) < poisonedHp, "The opponent attacks on the cure round");
  const combatLog = healing.page.getByRole("region", { name: "전투 기록" });
  assert.match(await combatLog.getByRole("listitem").first().textContent(), /뿔충이의 독침/);
  assert.doesNotMatch(await combatLog.getByRole("listitem").first().textContent(), /독 피해/);
  assert.equal(await attackRound.textContent(), playerPp);
  const cured = await healing.read();
  assert.equal(cured.resources.cureItem, 0);
  assert.equal(cured.energy, poisoned.energy);
  assert.equal(await healing.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await healing.page.evaluate(() => { window.battleRoll = 0; });
  await attackRound.tap();
  await patient.locator('[data-condition="poison"]').waitFor();
  assert.ok(await treatment.isDisabled());
  await healing.page.reload();
  await healing.page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
  const restoredCure = await healing.read();
  assert.equal(restoredCure.v, 4);
  assert.equal(restoredCure.resources.cureItem, 0);
  for (const field of ["energy", "mapSnapshot", "roster", "entryOrder", "turnCount"]) assert.deepEqual(restoredCure[field], cured[field]);
  assert.deepEqual(healing.errors, []);
  await healing.page.close();
  console.log("Battle cure Chrome passed: clinic construction and poison worker, production and reload, Poison Sting, one enemy action on the cure turn, and consumed stock after reload");

  const ghost = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[100, 2], [158, 1], [68, 1]],
    owned: ["home", "southwest", "south", "southeast"],
  });
  const tackle = ghost.page.getByRole("button", { name: /몸통박치기/ });
  const enemyHp = await hp(ghost.opponent);
  assert.match(await tackle.textContent(), /효과 없음.*PP 35\/35/);
  await tackle.press("Enter");
  await ready(ghost.page);
  assert.equal(await hp(ghost.opponent), enemyHp);
  assert.match(await tackle.textContent(), /PP 34\/35/);
  assert.match(await ghost.page.locator(".duel-record").textContent(), /효과 없음/);
  assert.doesNotMatch(await ghost.page.locator(".duel-record").textContent(), /꿈먹기|코골기|대폭발/);
  const ghostResult = await playBattle(ghost.page, { manualSwitch: true });
  assert.ok(ghostResult.replacements > 0);
  assert.match(await ghost.page.locator(".duel-record").textContent(), /흔들풍손의 발버둥/);
  assert.deepEqual(ghost.errors, []);
  console.log("Drifloon replay after one deliberate immune move: " + JSON.stringify(ghostResult));
  await ghost.page.close();

  const steel = await openBattle({
    site: "northeast", enemy: 884, level: 7, team: [[711, 2], [847, 1], [515, 1]], mobile: true,
    owned: ["home", "southwest", "west", "south", "southeast", "east", "center", "northwest"],
  });
  const player = steel.page.locator('.duel-vitals[data-side="player"]');
  assert.equal(await steel.opponent.locator(".duel-types").textContent(), "강철 · 드래곤");
  assert.equal(await steel.page.locator('[data-move-id="438"]').count(), 0);
  await steel.button("교체").tap();
  await steel.button(/앗차프/).tap();
  await player.getByRole("heading", { name: "앗차프" }).waitFor();
  await ready(steel.page);
  assert.ok(await hp(player) < Number(await player.locator("meter").getAttribute("max")));
  assert.equal(await hp(steel.opponent), Number(await steel.opponent.locator("meter").getAttribute("max")));
  assert.match(await steel.page.locator(".duel-turn").getAttribute("aria-label"), /^2턴/);
  assert.equal(await steel.page.locator('[data-move-id="58"]').count(), 0);
  assert.equal(await steel.page.evaluate(() => document.documentElement.scrollWidth), 390);
  const steelResult = await playBattle(steel.page);
  assert.deepEqual(steel.errors, []);
  console.log("Duraludon replay after a voluntary switch: " + JSON.stringify(steelResult));
  console.log("Battle Chrome passed: real immunity, legal moves, PP, and touch switching with an enemy attack");
  await steel.page.close();

  const expectedParty = [[100, 2], [158, 1], [68, 1]];
  const sand = await openBattle({
    site: "east", enemy: 769, level: 6, team: expectedParty, mapOnly: true, scouted: false,
    owned: ["home", "southwest", "west", "south", "southeast", "center"],
  });
  const world = sand.page.getByRole("heading", { name: "월드맵", exact: true });
  assert.equal(await sand.report.count(), 0);
  await sand.button(/정찰하기/).click();
  await sand.report.waitFor();
  assert.match(await sand.report.innerText(), /땅.*고스트.*유효 공격 없음/);
  assert.ok(!(await sand.report.innerText()).includes("모래꿍"));
  const baseline = await sand.read();
  await sand.challenge();
  const concede = sand.button("기권하고 돌아가기");
  await concede.press("Enter");
  await world.waitFor();
  assert.equal(await sand.page.locator('[data-node="east"]').getAttribute("aria-pressed"), "true");
  const conceded = await sand.read();
  assert.equal(conceded.energy, baseline.energy - 2);
  assert.deepEqual(conceded.resources, baseline.resources);
  assert.deepEqual(conceded.mapSnapshot, baseline.mapSnapshot);
  await sand.page.reload();
  await sand.button("지도").click();
  await sand.page.locator('[data-node="east"]').click();
  await sand.report.waitFor();
  const restored = await sand.read();
  assert.equal(restored.energy, conceded.energy);
  assert.deepEqual(restored.resources, baseline.resources);
  assert.deepEqual(restored.mapSnapshot, baseline.mapSnapshot);

  await sand.button(/유효 공격 후보 탐색/).click();
  const signal = sand.page.locator('.hunt-target[data-counter="true"]');
  await signal.waitFor();
  assert.equal(await signal.count(), 1);
  assert.equal(await sand.page.locator(".hunt-target").count(), 3);
  await signal.press("Enter");
  await sand.button(/본인확인서 대조/).click();
  const silhouette = sand.page.locator('[data-mode="silhouette"] .identify-target-art');
  await silhouette.waitFor();
  const id = Number((await silhouette.getAttribute("src")).match(/(\d+)\.png$/)?.[1]);
  const candidate = pokemon.find(mon => mon.pokemonRowid === id);
  assert.ok(candidate && candidate.pokemonRowid !== 261);
  const guess = sand.page.getByRole("textbox", { name: "포켓몬 이름" });
  await guess.fill(candidate.nameKr);
  await guess.press("Enter");
  await sand.page.getByRole("heading", { name: "포획 성공" }).waitFor();
  await sand.button("월드맵으로").click();
  await sand.button("엔트리 편성").click();
  const entry = sand.page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  const caught = await sand.read();
  assert.equal(caught.energy, conceded.energy - 2);
  assert.equal(caught.roster.at(-1).pokemon.pokemonRowid, id);
  assert.equal(Object.hasOwn(caught, "counterHunt"), false);
  await entry.locator('[data-pc-member="' + caught.roster.at(-1).id + '"]').click();
  await entry.getByRole("button", { name: "닫기" }).click();
  await sand.report.waitFor({ state: "hidden" });
  await sand.page.waitForFunction(() => document.activeElement?.hasAttribute("data-atlas-report-heading"));
  assert.deepEqual(sand.errors, []);
  console.log("Sandygast Chrome passed: warning after scout, concede and reload once, 2 energy counter hunt, capture and entry");
  await sand.page.close();

  const growth = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[100, 2], [158, 5], [68, 1]], exp: 80, candy: 1, mapOnly: true, legacy: true,
    owned: ["home", "southwest", "south", "southeast"],
  });
  await growth.report.waitFor();
  assert.match(await growth.report.innerText(), /리아코 Lv\.6.*물대포.*사탕 1개/);
  const beforeGrowth = await growth.read();
  await growth.button("PC에서 육성").click();
  const pc = growth.page.getByRole("dialog", { name: /보유 포켓몬/ });
  await pc.getByRole("heading", { name: /리아코 Lv\.5/ }).waitFor();
  await pc.getByRole("button", { name: "사탕 먹이기" }).click();
  await pc.getByRole("heading", { name: /리아코 Lv\.6/ }).waitFor();
  await pc.getByRole("button", { name: "닫기" }).click();
  await growth.report.waitFor({ state: "hidden" });
  const afterGrowth = await growth.read();
  assert.equal(afterGrowth.v, 4);
  assert.equal(afterGrowth.energy, beforeGrowth.energy - 1);
  assert.equal(afterGrowth.resources.candy, beforeGrowth.resources.candy - 1);
  await growth.challenge();
  assert.equal(await growth.button("기권하고 돌아가기").count(), 0);
  assert.match(await growth.page.locator(".duel-counter-note").innerText(), /리아코.*교체/);
  await growth.button("교체").click();
  await growth.button(/리아코/).click();
  await growth.page.getByRole("button", { name: /물대포/ }).waitFor();
  assert.deepEqual(growth.errors, []);
  console.log("Legacy Chrome passed: scoped growth, useful switch and no concede while the bench can attack");
  await growth.page.close();

  const remote = await openBattle({
    site: "nw-04", enemy: 769, level: 8, team: expectedParty, mapOnly: true, scouted: false,
    owned: ["home", "southwest", "west", "south", "southeast", "east", "center", "northwest", "northeast", "island"],
  });
  const remoteBefore = await remote.read();
  await remote.challenge();
  const remoteConcede = remote.button("기권하고 돌아가기");
  assert.equal(await remoteConcede.count(), 1, "A later battle with no effective attack offers the same concession");
  await remoteConcede.press("Enter");
  await remote.page.getByRole("heading", { name: "월드맵", exact: true }).waitFor();
  const remoteAfter = await remote.read();
  assert.equal(remoteAfter.energy, remoteBefore.energy - 2);
  assert.deepEqual(remoteAfter.resources, remoteBefore.resources);
  assert.deepEqual(remoteAfter.mapSnapshot, remoteBefore.mapSnapshot);
  assert.equal(await remote.page.locator('[data-node="nw-04"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(remote.errors, []);
  console.log("Later region Chrome passed: concede from an unscouted battle without changing occupation, rewards or energy costs");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
