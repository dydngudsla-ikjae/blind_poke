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
  if (profile.singlePp) await page.route("**/data/move.json", async route => {
    const response = await route.fetch();
    const moves = await response.json();
    for (const move of moves) {
      if (profile.singlePp.includes(move.moveRowid)) move.details.pp = 1;
    }
    await route.fulfill({ response, json: moves });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const button = name => page.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: true });
  for (let round = 1; round <= 3; round++) {
    await heading(`동료 영입 ${round - 1}/3`).waitFor();
    await page.locator("[data-draft-target]").first().press("Enter");
  }
  await button("본거지로 이동").click();
  const roster = profile.team.map(([id, level, iv = {}]) => ({ pokemon: pokemon.find(mon => mon.pokemonRowid === id), level, iv }));
  await page.evaluate(({ profile, key, roster, rivalId }) => {
    const save = JSON.parse(localStorage.getItem(key));
    save.mapSnapshot = save.mapSnapshot.map(spot => profile.owned.includes(spot.id)
      ? { ...spot, owner: "player", trainerId: null, scouted: true }
      : spot.id === profile.site ? { ...spot, owner: "trainer", trainerId: rivalId, scouted: profile.scouted, active: true }
        : spot.trainerId === rivalId ? { ...spot, owner: "unoccupied", trainerId: null } : spot);
    save.roster = roster.map((member, index) => ({ ...save.roster[index % save.roster.length], ...member,
      id: `mon-${index + 1}`, exp: index === 1 ? profile.exp : 0 }));
    save.nextMemberId = save.roster.length + 1;
    save.entryOrder = save.roster.slice(0, profile.entryCount).map(member => member.id);
    save.resources.candy = profile.candy;
    if (profile.energy !== undefined) save.energy = profile.energy;
    if (profile.gold !== undefined) save.resources.gold = profile.gold;
    if (profile.legacy) {
      save.v = 3;
      localStorage.setItem("blindpoke-map-v1", JSON.stringify(save.mapSnapshot));
      delete save.mapSnapshot;
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, { profile: { site: profile.site, owned: profile.owned, scouted: profile.scouted ?? true, entryCount: profile.entryCount ?? roster.length,
    exp: profile.exp ?? 0, candy: profile.candy ?? 0, energy: profile.energy, gold: profile.gold, legacy: Boolean(profile.legacy) }, roster, key, rivalId });
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

async function verifyReportFocus(page, territory) {
  const heading = page.locator("[data-atlas-report-heading]");
  await heading.waitFor();
  const view = await heading.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { title: element.textContent, active: document.activeElement?.textContent,
      focused: element === document.activeElement, top: bounds.top, bottom: bounds.bottom, height: innerHeight };
  });
  assert.equal(view.title, territory);
  assert.ok(view.focused && view.top >= 0 && view.bottom <= view.height, JSON.stringify(view));
}

async function captureCounter(session, mobile = false) {
  const { page, button } = session;
  const use = action => mobile ? action.tap() : action.press("Enter");
  await use(button(/유효 공격 후보 탐색/));
  const signal = page.locator('.hunt-target[data-counter="true"]');
  await signal.waitFor();
  assert.equal(await signal.count(), 1);
  assert.equal(await page.locator(".hunt-target").count(), 3);
  await use(signal);
  if (mobile) await use(signal);
  await page.getByText("동부 거점 대응 탐색", { exact: true }).waitFor();
  await use(button(/본인확인서 대조/));
  const silhouette = page.locator('[data-mode="silhouette"] .identify-target-art');
  await silhouette.waitFor();
  const id = Number((await silhouette.getAttribute("src")).match(/(\d+)\.png$/)?.[1]);
  const candidate = pokemon.find(mon => mon.pokemonRowid === id);
  assert.ok(candidate && candidate.pokemonRowid !== 261);
  const guess = page.getByRole("textbox", { name: "포켓몬 이름" });
  await guess.fill(candidate.nameKr);
  if (mobile) await use(button("식별"));
  else await guess.press("Enter");
  await page.getByRole("heading", { name: "포획 성공" }).waitFor();
  return candidate;
}

async function verifyDuplicateReplacements(mobile) {
  const session = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[292, 1, { hp: -15 }], [131, 1, { hp: 15 }], [131, 1, { hp: -15 }]], mobile,
    owned: ["home", "southwest", "south", "southeast"],
  });
  const { page, button } = session;
  const use = action => mobile ? action.tap() : action.press("Enter");
  const player = page.locator('.duel-vitals[data-side="player"]');
  const choices = page.getByRole("group", { name: "교체할 포켓몬" });
  const recap = page.getByRole("status", { name: "직전 배틀 기록" });
  await use(button("교체"));
  await page.getByText("교체로 이 턴을 사용합니다.", { exact: false }).waitFor();
  if (!mobile) await page.keyboard.press("Escape");
  else await use(button("취소"));
  await choices.waitFor({ state: "hidden" });
  assert.ok(await button("교체").evaluate(trigger => document.activeElement === trigger));
  assert.equal(await page.locator(".duel-turn b").textContent(), "01");
  await use(button("교체"));
  const second = choices.getByRole("button", { name: /라프라스 2번 Lv\.1/ });
  assert.equal(await second.count(), 1, "배틀 교체에서도 같은 레벨 두 개체를 번호로 구분해야 합니다.");
  const secondReading = await second.getByText(/물대포 · 명중 시 \d+ 피해 · PP 25\/25/).textContent({ timeout: 3000 });
  await use(second);
  await player.getByRole("heading", { name: "라프라스 2번", exact: true }).waitFor();
  await ready(page);
  assert.equal(Number(await player.locator("meter").getAttribute("max")), 257);
  assert.ok(await hp(player) < 257);
  await recap.getByText(/라프라스 2번, 나서라/).waitFor();
  const activeWaterGun = page.locator('[data-move-id="55"]');
  assert.match(await activeWaterGun.textContent(), new RegExp(secondReading.match(/명중 시 \d+ 피해/)[0]));

  await use(button("교체"));
  await use(choices.getByRole("button", { name: /껍질몬/ }));
  await page.getByRole("heading", { name: "다음 포켓몬 선택", exact: true }).waitFor();
  await page.getByText("껍질몬 기절 · 교체한 뒤 바로 기술을 선택합니다.", { exact: true }).waitFor();
  assert.equal(await button("취소").count(), 0);
  const beforeReplace = await page.locator(".duel-turn b").textContent();
  const incoming = choices.getByRole("button", { name: /라프라스 1번 Lv\.1/ });
  const incomingReading = await incoming.getByText(/물대포 · 명중 시 \d+ 피해 · PP 25\/25/).textContent();
  await incoming.scrollIntoViewIfNeeded();
  const bounds = await incoming.boundingBox();
  const point = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  const activatePoint = () => mobile ? page.touchscreen.tap(...point) : page.mouse.click(...point);
  await activatePoint();
  await player.getByRole("heading", { name: "라프라스 1번", exact: true }).waitFor();
  await ready(page);
  assert.match(await activeWaterGun.textContent(), new RegExp(incomingReading.match(/명중 시 \d+ 피해/)[0]));
  const landingMove = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.dataset.moveId, point);
  assert.ok(landingMove, "The second tap should land on a move after the switch");
  const move = page.locator(`[data-move-id="${landingMove}"]`);
  const beforeMove = await move.textContent();
  await activatePoint();
  await ready(page);
  assert.equal(await hp(player), 287);
  assert.equal(await page.locator(".duel-turn b").textContent(), beforeReplace);
  assert.equal(await move.textContent(), beforeMove);
  assert.match(await page.locator(".duel-record").textContent(), /라프라스 1번, 나서라/);
  if (mobile) await move.tap({ position: { x: 9, y: 9 } });
  else await move.press("Enter");
  await page.locator(`.duel-latest[data-round="${Number(beforeReplace)}"]`).waitFor();
  assert.notEqual(await move.textContent(), beforeMove);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
  assert.deepEqual(session.errors, []);
  await page.close();
}

async function verifyKnockoutRepeat(mobile) {
  const { page, errors } = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[292, 1, { hp: -15 }], [131, 1, { hp: 15 }], [131, 1, { hp: -15 }]], mobile,
    owned: ["home", "southwest", "south", "southeast"],
  });
  const move = page.locator(".duel-move:enabled").last();
  await move.scrollIntoViewIfNeeded();
  const bounds = await move.boundingBox();
  const point = [bounds.x + bounds.width / 4, bounds.y + bounds.height - 5];
  const activatePoint = () => mobile ? page.touchscreen.tap(...point) : page.mouse.click(...point);
  await page.evaluate(() => document.addEventListener("click", event => {
    document.body.dataset.lastSwitchClick = event.target.closest("button")?.dataset.switchIndex ?? "";
  }, true));
  await activatePoint();
  await page.getByRole("heading", { name: "다음 포켓몬 선택", exact: true }).waitFor();
  await ready(page);
  await activatePoint();
  await ready(page);
  assert.equal(await page.locator("body").getAttribute("data-last-switch-click"), "1");
  const player = page.locator('.duel-vitals[data-side="player"]');
  assert.equal(await player.locator("h2").textContent(), "껍질몬");
  assert.equal(await hp(player), 0);
  assert.deepEqual(errors, []);
  await page.close();
}

async function verifyEntryAttackReadiness(mobile) {
  const session = await openBattle({
    site: "east", enemy: 769, level: 5, team: [[131, 1], [856, 5], [856, 10], [14, 1]], entryCount: 1,
    mapOnly: true, mobile, owned: ["home", "southwest", "south", "southeast"],
  });
  const { page, button, read } = session;
  const use = action => mobile ? action.tap() : action.press("Enter");
  const before = await read();
  await use(button("엔트리 편성"));
  const dialog = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  const low = dialog.getByRole("button", { name: "몸지브림 1번 Lv.5", exact: true });
  const trained = dialog.getByRole("button", { name: "몸지브림 2번 Lv.10", exact: true });
  const warning = "일반 공격기 없음 · Lv.10 차밍보이스";
  await low.getByText(warning, { exact: true }).waitFor({ timeout: 3000 });
  assert.equal(await low.evaluate(card => document.getElementById(card.getAttribute("aria-describedby"))?.textContent), warning);
  assert.equal(await trained.getByText(/일반 공격기 없음/).count(), 0);
  await dialog.locator('[data-pc-member="mon-4"]').getByText("일반 공격기 없음", { exact: true }).waitFor();
  await use(low);
  await use(dialog.getByRole("button", { name: "몸지브림 1번 앞 순서로 이동", exact: true }));
  await dialog.locator('[data-entry-slot="0"]').getByText(warning, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
  await use(dialog.getByRole("button", { name: "닫기", exact: true }));
  assert.deepEqual(await read(), { ...before, entryOrder: ["mon-2", "mon-1"] });
  await session.challenge();
  const player = page.locator('.duel-vitals[data-side="player"]');
  await player.getByRole("heading", { name: "몸지브림 1번", exact: true }).waitFor();
  await page.locator('[data-move-id="589"]').waitFor();
  assert.equal(await page.locator("[data-move-id]").count(), 1);
  assert.deepEqual(session.errors, []);
  await page.close();
}

async function verifyMoveDamagePreview(mobile) {
  const battle = await openBattle({
    site: "se-02", enemy: 1020, level: 14, team: [[976, 14], [589, 8]], mobile,
    owned: ["home", "southwest", "west", "south", "southeast", "east", "center", "northwest", "northeast", "island",
      ...Array.from({ length: 10 }, (_, index) => "nw-" + String(index + 1).padStart(2, "0")), "se-01", "se-03"],
  });
  const { page, opponent } = battle;
  const commands = page.getByRole("group", { name: "사용할 기술" });
  const jet = commands.locator('[data-move-id="453"]');
  const tackle = commands.locator('[data-move-id="33"]');
  const preview = async move => {
    await move.waitFor();
    assert.equal(await move.getAttribute("data-matchup"), "1");
    assert.match(await move.textContent(), /위력 40/);
    const label = await move.getByText(/명중 시 \d+ 피해/).textContent({ timeout: 3000 });
    return Number(label.match(/명중 시 (\d+) 피해/)[1]);
  };
  const jetDamage = await preview(jet);
  const tackleDamage = await preview(tackle);
  assert.ok(jetDamage > tackleDamage);
  const before = await hp(opponent);
  const saved = await battle.read();
  const use = move => mobile ? move.tap() : move.press("Enter");
  await page.evaluate(() => { window.battleRoll = .5; });
  await use(jet);
  await page.locator('.duel-latest[data-round="1"]').waitFor();
  assert.equal(await hp(opponent), before - jetDamage);
  const afterJet = await hp(opponent);
  const nextTackleDamage = await preview(tackle);
  await use(tackle);
  await page.locator('.duel-latest[data-round="2"]').waitFor();
  assert.equal(await hp(opponent), afterJet - nextTackleDamage);
  assert.deepEqual(await battle.read(), saved);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
  assert.deepEqual(battle.errors, []);
  console.log("Battle damage Chrome: " + JSON.stringify({ mobile, jetDamage, tackleDamage, nextTackleDamage, before, afterJet, after: await hp(opponent) }));
  await page.close();
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  await verifyMoveDamagePreview(false);
  await verifyMoveDamagePreview(true);
  await verifyEntryAttackReadiness(false);
  await verifyEntryAttackReadiness(true);
  console.log("Attack readiness Chrome passed: low level warning, natural unlock, unchanged entry rules and matching equipped moves");
  await verifyDuplicateReplacements(true);
  await verifyDuplicateReplacements(false);
  await verifyKnockoutRepeat(true);
  await verifyKnockoutRepeat(false);
  console.log("Battle switching Chrome passed: duplicate allies, cancel focus, forced replacement, and repeated pointer input across both transitions");
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
  const healingRecap = healing.page.getByRole("status", { name: "직전 배틀 기록" });
  await healingRecap.getByText("직전 1턴", { exact: true }).waitFor({ timeout: 4000 });
  await healingRecap.locator('[data-side="settlement"]').getByText(/독 피해/).waitFor();
  const playerPp = await attackRound.textContent();
  await healing.page.evaluate(() => { window.battleRoll = .99; });
  const combatLog = healing.page.getByRole("region", { name: "전투 기록" });
  await combatLog.locator("summary").tap();
  await treatment.tap();
  await combatLog.getByRole("listitem").filter({ hasText: /독 상태이상을 치료했다/ }).waitFor();
  await ready(healing.page);
  assert.equal(await patient.locator(".duel-condition").count(), 0);
  assert.ok(await hp(patient) < poisonedHp, "The opponent attacks on the cure round");
  await healingRecap.getByText("직전 2턴", { exact: true }).waitFor();
  assert.deepEqual(await healingRecap.locator("[data-side]").evaluateAll(rows => rows.map(row => row.dataset.side)), ["player", "enemy"]);
  await healingRecap.locator('[data-side="player"]').getByText(/독 상태이상을 치료했다/).waitFor();
  await healingRecap.locator('[data-side="enemy"]').getByText(/뿔충이의 독침.*피해/).waitFor();
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

  const toxicBattle = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[169, 1], [630, 1], [68, 1]], mobile: true, mapOnly: true,
    owned: ["home", "southwest", "south", "southeast"],
  });
  await toxicBattle.button("본거지로").tap();
  await toxicBattle.button("포켓몬 3").tap();
  const toxicProfile = toxicBattle.page.getByRole("dialog", { name: /보유 포켓몬/ });
  await toxicProfile.getByText("배틀 능력과 장착 기술", { exact: true }).tap();
  await toxicProfile.locator(".pokemon-move-notes li", { hasText: "맹독" }).getByText(/명중 판정 없음/).waitFor();
  await toxicProfile.getByRole("button", { name: "닫기", exact: true }).tap();
  await toxicBattle.button("지도").tap();
  await toxicBattle.page.locator('[data-node="east"]').tap();
  await toxicBattle.challenge();
  const toxic = toxicBattle.page.locator('[data-move-id="92"]');
  assert.match(await toxic.innerText(), /명중 판정 없음/, "독 타입의 맹독은 실제 명중 판정과 같은 설명을 보여줘야 합니다.");
  await toxicBattle.page.evaluate(() => { window.battleRoll = .99; });
  await toxic.tap();
  await toxicBattle.opponent.locator('[data-condition="toxic"]').waitFor();
  await ready(toxicBattle.page);
  assert.match(await toxic.innerText(), /상대는 이미 상태이상/);
  assert.ok(await toxic.isEnabled());
  await toxic.tap();
  const toxicRecap = toxicBattle.page.getByRole("status", { name: "직전 배틀 기록" });
  await toxicRecap.locator('[data-side="player"]').getByText(/이미 상태이상이 있다/).waitFor();
  assert.match(await toxic.innerText(), /PP 8\/10/);
  await toxicBattle.button("교체").tap();
  await toxicBattle.button(/버랜지나/).tap();
  await ready(toxicBattle.page);
  assert.match(await toxic.innerText(), /명중 90%/);
  await toxic.tap();
  await toxicRecap.locator('[data-side="player"]').getByText("빗나감", { exact: true }).waitFor();
  assert.equal(await toxicBattle.page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(toxicBattle.errors, []);
  await toxicBattle.page.close();

  const poisonImmune = await openBattle({
    site: "northeast", enemy: 884, level: 7, team: [[169, 1], [158, 1], [68, 1]],
    owned: ["home", "southwest", "west", "south", "southeast", "east", "center", "northwest"],
  });
  const blockedToxic = poisonImmune.page.locator('[data-move-id="92"]');
  assert.match(await blockedToxic.innerText(), /상태이상 효과 없음/);
  assert.ok(await blockedToxic.isEnabled());
  await blockedToxic.press("Enter");
  await poisonImmune.page.getByRole("status", { name: "직전 배틀 기록" }).getByText(/상태이상 효과 없음/).waitFor();
  assert.equal(await poisonImmune.opponent.locator(".duel-condition").count(), 0);
  assert.match(await blockedToxic.innerText(), /PP 9\/10/);
  assert.deepEqual(poisonImmune.errors, []);
  await poisonImmune.page.close();
  console.log("Battle status preview Chrome passed: Toxic bypasses accuracy for poison users, marks occupied and immune targets, and consumes PP on an attempt");

  const ghost = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[100, 2], [158, 1], [68, 1]],
    owned: ["home", "southwest", "south", "southeast"],
  });
  const tackle = ghost.page.getByRole("button", { name: /몸통박치기/ });
  const enemyHp = await hp(ghost.opponent);
  const ghostPlayer = ghost.page.locator('.duel-vitals[data-side="player"]');
  const allyHp = await hp(ghostPlayer);
  assert.match(await tackle.textContent(), /효과 없음.*PP 35\/35/);
  assert.doesNotMatch(await tackle.textContent(), /명중 시 \d+ 피해/);
  await ghost.button("교체").press("Enter");
  const ghostBench = ghost.page.getByRole("group", { name: "교체할 포켓몬" });
  assert.equal(await ghostBench.getByText("현재 피해를 줄 기술 없음").count(), 2);
  await ghost.page.keyboard.press("Escape");
  await ghost.page.emulateMedia({ reducedMotion: "no-preference" });
  await tackle.press("Enter");
  await ghost.page.locator('.duel-impact[data-source="player"][data-effect="immune"]').getByText("효과 없음").waitFor();
  await ready(ghost.page);
  await ghost.page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await hp(ghost.opponent), enemyHp);
  assert.match(await tackle.textContent(), /PP 34\/35/);
  const ghostRecap = ghost.page.getByRole("status", { name: "직전 배틀 기록" });
  await ghostRecap.locator('[data-side="player"]').getByText(/몸통박치기.*효과 없음/).waitFor();
  const enemyReading = ghostRecap.locator('[data-side="enemy"]');
  const injury = allyHp - await hp(ghostPlayer);
  assert.ok(injury > 0);
  assert.match(await enemyReading.textContent(), new RegExp(`흔들풍손의 .*${injury} 피해`));
  assert.match(await ghost.page.locator(".duel-record").textContent(), /효과 없음/);
  assert.doesNotMatch(await ghost.page.locator(".duel-record").textContent(), /꿈먹기|코골기|대폭발/);
  const ghostResult = await playBattle(ghost.page, { manualSwitch: true });
  assert.ok(ghostResult.replacements > 0);
  assert.match(await ghost.page.locator(".duel-record").textContent(), /흔들풍손의 바람일으키기/);
  assert.deepEqual(ghost.errors, []);
  console.log("Drifloon replay after one deliberate immune move: " + JSON.stringify(ghostResult));
  await ghost.page.close();

  const stages = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[131, 1], [158, 1], [68, 1]], mobile: true,
    owned: ["home", "southwest", "south", "southeast"],
  });
  const growl = stages.page.locator('[data-move-id="45"]');
  const growlRecap = stages.page.getByRole("status", { name: "직전 배틀 기록" }).locator('[data-side="player"]');
  const beforeGrowl = await hp(stages.opponent);
  assert.match(await growl.innerText(), /상대 공격 1단계 하락/);
  assert.doesNotMatch(await growl.textContent(), /명중 시 \d+ 피해/);
  assert.notEqual(await stages.page.locator("[data-move-id]").first().getAttribute("data-move-id"), "45");
  await growl.focus();
  await stages.page.keyboard.down("Enter");
  await stages.page.locator('.duel-latest[data-round="1"]').waitFor();
  await ready(stages.page);
  assert.ok(await growl.evaluate(button => document.activeElement === button), "기술을 쓴 뒤 같은 기술로 키보드 초점이 돌아와야 합니다.");
  await stages.page.keyboard.down("Enter");
  await stages.page.keyboard.up("Enter");
  await ready(stages.page);
  assert.equal(await stages.page.locator(".duel-latest").getAttribute("data-round"), "1", "Enter를 누르고 있어도 다음 턴 기술이 나가면 안 됩니다.");
  assert.match(await growl.innerText(), /PP 39\/40/);
  for (let round = 2; round <= 6; round++) {
    await growl.tap();
    await stages.page.locator(`.duel-latest[data-round="${round}"]`).waitFor();
    await growlRecap.getByText(/흔들풍손의 공격 하락/).waitFor();
    await ready(stages.page);
  }
  assert.match(await growl.innerText(), /상대 공격 최저/);
  assert.match(await growl.innerText(), /PP 34\/40/);
  assert.ok(await growl.isEnabled());
  await growl.tap();
  await stages.page.locator('.duel-latest[data-round="7"]').waitFor();
  await growlRecap.getByText(/공격은\(는\) 더 변하지 않았다/).waitFor();
  assert.match(await growl.innerText(), /PP 33\/40/);
  assert.equal(await hp(stages.opponent), beforeGrowl);
  assert.equal(await stages.page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(stages.errors, []);
  await stages.page.close();
  console.log("Battle stage preview Chrome passed: Growl effect and floor, keyboard focus and no repeated command, and unchanged PP use at the floor on touch");

  for (const mobile of [false, true]) {
    const secondary = await openBattle({
      site: "east", enemy: 912, level: 5, team: [[337, 1], [131, 1]], mobile,
      owned: ["home", "southwest", "south", "southeast"],
    });
    const use = action => mobile ? action.tap() : action.press("Enter");
    const recap = secondary.page.getByRole("status", { name: "직전 배틀 기록" });
    const moonblast = secondary.page.locator('[data-move-id="585"]');
    const before = await hp(secondary.opponent);
    const initial = await secondary.read();
    await use(moonblast);
    const reading = recap.locator('[data-side="player"]');
    await reading.getByText("꾸왁스의 특수공격 하락!", { exact: true }).waitFor({ timeout: 3000 });
    const damage = before - await hp(secondary.opponent);
    assert.ok(damage > 0);
    await reading.getByText(`${damage} 피해`, { exact: true }).waitFor();
    if (mobile) assert.equal(await secondary.page.locator(".duel-record details").getAttribute("open"), null);
    await secondary.opponent.getByRole("list", { name: "꾸왁스 능력치 변화" })
      .getByText("특수공격 −1", { exact: true }).waitFor();
    await use(moonblast);
    await recap.and(secondary.page.locator('[data-round="2"]')).waitFor();
    await secondary.opponent.getByText("특수공격 −2", { exact: true }).waitFor();
    assert.equal(await secondary.page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
    assert.deepEqual(await secondary.read(), initial);
    assert.deepEqual(secondary.errors, []);
    await secondary.page.close();
  }
  console.log("Battle secondary effects Chrome passed: Moonblast damage, lowered Special Attack, and accumulated stages at desktop and touch widths");

  const exhausted = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[131, 1], [158, 1], [68, 1]], singlePp: [45, 55],
    owned: ["home", "southwest", "south", "southeast"],
  });
  await exhausted.page.locator('[data-move-id="45"]').press("Enter");
  const waterGun = exhausted.page.locator('[data-move-id="55"]');
  await exhausted.page.waitForFunction(() => document.activeElement?.getAttribute("data-move-id") === "55");
  assert.ok(await exhausted.page.locator('[data-move-id="45"]').isDisabled());
  assert.match(await waterGun.textContent(), /PP 1\/1/);
  await exhausted.page.keyboard.press("Enter");
  await exhausted.page.waitForFunction(() => document.activeElement?.getAttribute("data-move-id") === "165");
  assert.match(await exhausted.page.locator('[data-move-id="165"]').textContent(), /반동 HP ¼/);
  assert.match(await exhausted.page.locator('[data-move-id="165"]').textContent(), /\d+ 피해 · 명중 판정 없음/);
  assert.equal(await exhausted.page.locator(".duel-latest").getAttribute("data-round"), "2");
  assert.deepEqual(exhausted.errors, []);
  await exhausted.page.close();
  console.log("Battle keyboard Chrome passed: depleted move → remaining move → Struggle without an automatic round");

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
  const switchRecap = steel.page.getByRole("status", { name: "직전 배틀 기록" });
  await switchRecap.locator('[data-side="player"]').getByText(/앗차프, 나서라/).waitFor();
  await switchRecap.locator('[data-side="enemy"]').getByText(/두랄루돈의 .*피해/).waitFor();
  const summaryBox = await switchRecap.boundingBox();
  const commandsBox = await steel.page.getByRole("group", { name: "사용할 기술" }).boundingBox();
  assert.ok(summaryBox.y + summaryBox.height <= commandsBox.y, "Round report is visible above the controls");
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
  await verifyReportFocus(sand.page, "동부 거점");
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

  const candidate = await captureCounter(sand);
  const caught = await sand.read();
  assert.equal(caught.energy, conceded.energy - 2);
  assert.equal(caught.roster.at(-1).pokemon.pokemonRowid, candidate.pokemonRowid);
  assert.equal(Object.hasOwn(caught, "counterHunt"), false);
  const counterReading = sand.page.getByRole("group", { name: "거점 대응 기술" });
  await counterReading.getByText(/땅 · 고스트.*기술/).waitFor({ timeout: 2000 });
  assert.match(await counterReading.textContent(), /상성 [\d.]+배/);
  const prepare = sand.button("새 동료 편성");
  await prepare.press("Enter");
  const entry = sand.page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  const ally = entry.locator('[data-pc-member="' + caught.roster.at(-1).id + '"]');
  assert.equal(await ally.getAttribute("aria-pressed"), "false");
  assert.ok(await ally.evaluate(card => document.activeElement === card));
  await sand.page.keyboard.press("Escape");
  assert.ok(await prepare.evaluate(button => document.activeElement === button));
  assert.deepEqual(await sand.read(), caught);
  await prepare.press("Enter");
  await ally.press("Enter");
  await entry.getByRole("button", { name: "닫기" }).press("Enter");
  const prepared = await sand.read();
  assert.deepEqual(prepared.entryOrder, [...caught.entryOrder, caught.roster.at(-1).id]);
  assert.equal(prepared.energy, caught.energy);
  await sand.button("월드맵으로").press("Enter");
  await world.waitFor();
  await verifyReportFocus(sand.page, "동부 거점");
  assert.equal(await sand.page.locator('[data-node="east"]').getAttribute("aria-pressed"), "true");
  await sand.report.waitFor({ state: "hidden" });
  assert.deepEqual(await sand.read(), prepared);
  await sand.page.reload();
  await sand.button("지도").press("Enter");
  assert.deepEqual(await sand.read(), prepared);
  assert.deepEqual(sand.errors, []);
  console.log("Sandygast Chrome passed: warning after scout, concede and reload once, 2 energy counter hunt, capture and entry");
  await sand.page.close();

  const aborted = await openBattle({
    site: "east", enemy: 769, level: 6, team: expectedParty, mobile: true, mapOnly: true,
    owned: ["home", "southwest", "west", "south", "southeast", "center"],
  });
  const beforeAbort = await aborted.read();
  await aborted.button(/유효 공격 후보 탐색/).tap();
  await aborted.button("월드맵으로").tap();
  await verifyReportFocus(aborted.page, "동부 거점");
  assert.deepEqual(await aborted.read(), { ...beforeAbort, energy: beforeAbort.energy - 2 });
  assert.deepEqual(aborted.errors, []);
  await aborted.page.close();

  const fullParty = await openBattle({
    site: "east", enemy: 769, level: 6, team: [...expectedParty, ...expectedParty], mobile: true, mapOnly: true,
    owned: ["home", "southwest", "west", "south", "southeast", "center"],
  });
  await fullParty.page.setViewportSize({ width: 390, height: 568 });
  const mobileRecruit = await captureCounter(fullParty, true);
  const mobileReading = fullParty.page.getByRole("group", { name: "거점 대응 기술" });
  const [moveName, multiplier] = (await mobileReading.locator("p").textContent()).split(" · 상성 ");
  const filled = await fullParty.read();
  await fullParty.button("새 동료 편성").tap();
  const mobileEntry = fullParty.page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  await mobileEntry.getByText(/엔트리가 가득 찼습니다/).waitFor();
  const newCard = mobileEntry.locator('[data-pc-member="' + filled.roster.at(-1).id + '"]');
  assert.equal(await mobileEntry.locator("[data-pc-member]").first().getAttribute("data-pc-member"), filled.roster.at(-1).id);
  assert.equal(await newCard.getAttribute("aria-disabled"), "true");
  assert.deepEqual(await fullParty.read(), filled);
  await mobileEntry.locator('[data-entry-slot="5"]').getByRole("button", { name: /엔트리 해제/ }).tap();
  await newCard.tap();
  await mobileEntry.getByRole("button", { name: "닫기" }).tap();
  await fullParty.button("엔트리 확인").waitFor();
  const substituted = await fullParty.read();
  assert.deepEqual(substituted.entryOrder, [...filled.entryOrder.slice(0, -1), filled.roster.at(-1).id]);
  assert.equal(substituted.energy, filled.energy);
  assert.equal(await fullParty.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await fullParty.button("월드맵으로").tap();
  await verifyReportFocus(fullParty.page, "동부 거점");
  assert.equal(await fullParty.page.locator('[data-node="east"]').getAttribute("aria-pressed"), "true");
  const nextCommand = await fullParty.button(/거점 도전/).boundingBox();
  assert.ok(nextCommand.y >= 0 && nextCommand.y + nextCommand.height <= 568, "The battle command should be visible after capture on a short screen");
  await fullParty.button(/거점 도전/).tap();
  await fullParty.opponent.getByRole("heading", { name: "모래꿍" }).waitFor();
  await fullParty.button("교체").tap();
  await fullParty.page.locator('[data-switch-index="5"]').tap();
  await fullParty.page.locator('.duel-vitals[data-side="player"]').getByRole("heading", { name: mobileRecruit.nameKr }).waitFor();
  await ready(fullParty.page);
  const effectiveMove = fullParty.page.locator("[data-move-id]").filter({ has: fullParty.page.getByText(moveName, { exact: true }) });
  assert.equal((await effectiveMove.getAttribute("data-matchup")) + "배", multiplier);
  const beforeAttack = await hp(fullParty.opponent);
  await effectiveMove.tap();
  await fullParty.page.locator('.duel-latest[data-round="2"]').waitFor();
  const afterAttack = await hp(fullParty.opponent);
  assert.ok(afterAttack < beforeAttack);
  assert.deepEqual(fullParty.errors, []);
  console.log(JSON.stringify({ audit: "counter recruit move", name: mobileRecruit.nameKr, moveName, multiplier, beforeAttack, afterAttack }));
  await fullParty.page.close();
  console.log("Counter capture Chrome passed: focused recruit, cancel, explicit registration, full mobile entry and return to original site");

  const growth = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[100, 2], [158, 5], [68, 1]], exp: 80, candy: 1, mapOnly: true, legacy: true,
    owned: ["home", "southwest", "south", "southeast"],
  });
  await growth.report.waitFor();
  const beforeLoss = await growth.read();
  await growth.challenge();
  const lost = await playBattle(growth.page, { manualSwitch: true });
  assert.equal(lost.outcome, "lose");
  await growth.button("월드맵으로").press("Enter");
  await verifyReportFocus(growth.page, "동부 거점");
  assert.match(await growth.report.innerText(), /리아코 Lv\.6.*물대포.*사탕 1개.*행동력 1/);
  const beforeGrowth = await growth.read();
  assert.equal(beforeGrowth.energy, beforeLoss.energy - 2);
  assert.deepEqual(beforeGrowth.resources, beforeLoss.resources);
  assert.deepEqual(beforeGrowth.mapSnapshot, beforeLoss.mapSnapshot);
  await growth.button("PC에서 육성").press("Enter");
  const pc = growth.page.getByRole("dialog", { name: /보유 포켓몬/ });
  await pc.getByRole("heading", { name: /리아코 Lv\.5/ }).waitFor();
  const forecast = pc.locator(".base-weakness").filter({ hasText: "약점 기술 확인" });
  await forecast.waitFor({ timeout: 3000 });
  const ghostTypes = [...new Set(pokemon.filter(mon => mon.pokemonRowid === 425)
    .flatMap(mon => [mon.type1Rowid, mon.type2Rowid]))].sort((a, b) => a - b);
  assert.equal(await forecast.getByLabel("상대 타입").inputValue(), String(ghostTypes[0]));
  assert.equal(await forecast.getByLabel("두 번째 타입").inputValue(), String(ghostTypes[1]));
  await forecast.getByText(/다음 공격 후보.*Lv\.6 물대포.*사탕 1개.*행동력 1/).waitFor();
  assert.ok(await forecast.locator("summary").evaluate(summary => document.activeElement === summary));
  assert.deepEqual(await growth.read(), beforeGrowth);
  await pc.getByRole("button", { name: "사탕 먹이기" }).click();
  await pc.getByRole("heading", { name: /리아코 Lv\.6/ }).waitFor();
  await pc.getByRole("button", { name: "닫기" }).click();
  await growth.report.waitFor({ state: "hidden" });
  await verifyReportFocus(growth.page, "동부 거점");
  const afterGrowth = await growth.read();
  assert.equal(afterGrowth.v, 4);
  assert.equal(afterGrowth.energy, beforeGrowth.energy - 1);
  assert.equal(afterGrowth.resources.candy, beforeGrowth.resources.candy - 1);
  const tactics = growth.page.locator("details.atlas-tactics");
  await tactics.locator("summary").press("Enter");
  const targets = (await tactics.getByLabel("정찰한 상대 후보 타입").inputValue()).split("-");
  await growth.button("PC에서 약점 기술 확인").press("Enter");
  await pc.getByText("약점 기술 확인", { exact: true }).waitFor();
  assert.equal(await pc.getByLabel("상대 타입").inputValue(), targets[0]);
  assert.equal(await pc.getByLabel("두 번째 타입").inputValue(), targets[1] ?? "0");
  await growth.page.keyboard.press("Escape");
  await pc.waitFor({ state: "hidden" });
  assert.deepEqual(await growth.read(), afterGrowth);
  await growth.page.reload();
  await growth.button("지도").click();
  await growth.page.locator('[data-node="east"]').click();
  await growth.report.waitFor({ state: "hidden" });
  assert.deepEqual(await growth.read(), afterGrowth);
  await growth.challenge();
  assert.equal(await growth.button("기권하고 돌아가기").count(), 0);
  assert.match(await growth.page.locator(".duel-counter-note").innerText(), /리아코.*교체/);
  await growth.button("교체").click();
  await growth.button(/리아코/).click();
  const waterGunRetry = growth.page.getByRole("button", { name: /물대포/ });
  const retryHp = await hp(growth.opponent);
  await waterGunRetry.press("Enter");
  await growth.page.locator('.duel-latest[data-round="2"]').waitFor();
  assert.ok(await hp(growth.opponent) < retryHp);
  assert.deepEqual(growth.errors, []);
  console.log("Legacy Chrome passed: loss, scoped growth, reload and retry with Water Gun");
  await growth.page.close();

  const reserve = await openBattle({
    site: "east", enemy: 425, level: 5, team: [[131, 1], [68, 1], [158, 6]], entryCount: 2, mapOnly: true, mobile: true,
    owned: ["home", "southwest", "south", "southeast"],
  });
  await reserve.page.getByText("상성·교대 분석", { exact: true }).tap();
  const reserveTactics = reserve.page.locator("details.atlas-tactics");
  await reserveTactics.getByText("유효 공격 PP 부족 가능", { exact: true }).waitFor();
  const reserveAttacks = reserveTactics.getByRole("list", { name: "아군 공격 상성" });
  const laprasReading = await reserveAttacks.getByText(/라프라스.*물대포.*예상 피해 \d+(?:–\d+)?.*유효 PP 합계 25/).textContent();
  assert.doesNotMatch(await reserveTactics.innerText(), /흔들풍손/);
  const beforeReserve = await reserve.read();
  const reserveDisclosure = reserveTactics.getByText("미편성 동료 · 1마리", { exact: true });
  await reserveDisclosure.waitFor({ timeout: 3000 });
  await reserveDisclosure.tap();
  const reserveOptions = reserveTactics.getByRole("list", { name: "미편성 동료 공격 상성" });
  await reserveOptions.getByText(/리아코.*물대포.*예상 피해 \d+(?:–\d+)?.*유효 PP 합계 25/).waitFor();
  const targetTypes = (await reserveTactics.getByLabel("정찰한 상대 후보 타입").inputValue()).split("-");
  const previewGrowth = reserve.button("리아코 육성 전망");
  await previewGrowth.waitFor({ timeout: 3000 });
  await previewGrowth.tap();
  const reservePc = reserve.page.getByRole("dialog", { name: /보유 포켓몬/ });
  await reservePc.getByRole("heading", { name: "리아코 Lv.6", exact: true }).waitFor();
  const reserveForecast = reservePc.locator(".base-weakness").filter({ hasText: "약점 기술 확인" });
  assert.equal(await reserveForecast.getByLabel("상대 타입").inputValue(), targetTypes[0]);
  assert.equal(await reserveForecast.getByLabel("두 번째 타입").inputValue(), targetTypes[1] ?? "0");
  assert.ok(await reserveForecast.locator("summary").evaluate(summary => document.activeElement === summary));
  await reservePc.getByRole("button", { name: "닫기", exact: true }).tap();
  await reservePc.waitFor({ state: "hidden" });
  assert.ok(await previewGrowth.evaluate(button => document.activeElement === button));
  assert.deepEqual(await reserve.read(), beforeReserve);
  const adjustEntry = reserve.button("리아코 편성에서 보기");
  assert.ok((await adjustEntry.boundingBox())?.height >= 44);
  await adjustEntry.tap();
  const reserveEntry = reserve.page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  const reserveCard = reserveEntry.locator('[data-pc-member="mon-3"]');
  assert.ok(await reserveCard.evaluate(card => document.activeElement === card));
  assert.equal(await reserveCard.getAttribute("data-new-partner"), null);
  assert.deepEqual(await reserve.read(), beforeReserve);
  await reserveCard.tap();
  await reserveEntry.getByRole("button", { name: "닫기", exact: true }).tap();
  await reserveTactics.getByText("유효 공격 PP 부족 가능", { exact: true }).waitFor({ state: "hidden" });
  await reserveTactics.getByText(/리아코.*물대포.*유효 PP 합계 25/).waitFor();
  await reserveOptions.waitFor({ state: "hidden" });
  const afterReserve = await reserve.read();
  assert.deepEqual(afterReserve.entryOrder, [...beforeReserve.entryOrder, "mon-3"]);
  assert.equal(afterReserve.energy, beforeReserve.energy);
  const leadChange = reserveAttacks.getByRole("button", { name: "리아코 선봉으로", exact: true });
  await leadChange.waitFor({ timeout: 3000 });
  assert.ok((await leadChange.boundingBox())?.height >= 44);
  await leadChange.scrollIntoViewIfNeeded();
  const leadBounds = await leadChange.boundingBox();
  const leadPoint = [leadBounds.x + leadBounds.width / 2, leadBounds.y + leadBounds.height / 2];
  await reserve.page.touchscreen.tap(...leadPoint);
  await reserveAttacks.getByRole("button", { name: "리아코 현재 선봉", exact: true }).waitFor();
  await reserve.page.touchscreen.tap(...leadPoint);
  const changedLead = await reserve.read();
  assert.deepEqual(changedLead, { ...afterReserve, entryOrder: ["mon-3", ...beforeReserve.entryOrder] });
  await reserve.page.reload();
  await reserve.button("지도").tap();
  await reserve.page.locator('[data-node="east"]').tap();
  assert.deepEqual(await reserve.read(), changedLead);
  await reserve.challenge();
  await reserve.page.locator('.duel-vitals[data-side="player"]').getByRole("heading", { name: "리아코" }).waitFor();
  assert.ok(await reserve.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  assert.deepEqual(reserve.errors, []);
  console.log("Mobile scout passed: damage prediction, no species disclosure, and PP coverage refreshed after adding a reserve. " + laprasReading);
  await reserve.page.close();

  const neutral = await openBattle({
    site: "nw-04", enemy: 615, level: 8, team: [[984, 1], [158, 1], [68, 1]], mapOnly: true, mobile: true,
    energy: 0, gold: 10, candy: 4,
    owned: ["home", "southwest", "west", "south", "southeast", "east", "center", "northwest", "northeast", "island"],
  });
  const neutralSave = await neutral.read();
  await neutral.page.getByText("상성·교대 분석", { exact: true }).tap();
  const neutralTypes = neutral.page.getByLabel("정찰한 상대 후보 타입");
  await neutralTypes.waitFor();
  assert.equal(await neutralTypes.inputValue(), "15", await neutralTypes.innerText());
  await neutral.button("PC에서 약점 기술 확인").tap();
  const neutralPc = neutral.page.getByRole("dialog", { name: /보유 포켓몬/ });
  await neutralPc.getByRole("heading", { name: "위대한엄니 Lv.1" }).waitFor();
  await neutralPc.getByText(/Lv\.84 양날박치기.*사탕 3486개/).waitFor();
  await neutralPc.getByText(/다음 공격 후보.*Lv\.7 땅고르기.*사탕 21개.*행동력 21/).waitFor();
  await neutralPc.getByText(/명중 시 예상 피해 \d+(?:–\d+)? → \d+(?:–\d+)?/).waitFor();
  assert.doesNotMatch(await neutralPc.innerText(), /프리지오/);
  await neutralPc.getByLabel("두 번째 타입").selectOption("12");
  assert.equal(await neutralPc.getByText(/다음 공격 후보/).count(), 0);
  await neutralPc.getByLabel("두 번째 타입").selectOption("0");
  await neutralPc.getByText(/다음 공격 후보.*땅고르기/).waitFor();
  assert.equal(await neutral.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await neutralPc.getByRole("button", { name: "닫기", exact: true }).tap();
  assert.deepEqual(await neutral.read(), neutralSave);
  await neutral.button(/^충전권 구매/).tap();
  const mapCharged = await neutral.read();
  assert.deepEqual(mapCharged, { ...neutralSave, energy: 2, resources: { ...neutralSave.resources, gold: 5 } });

  await neutral.page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key, save: neutralSave });
  await neutral.page.reload();
  await neutral.button("지도").tap();
  await neutral.page.locator('[data-node="nw-04"]').tap();
  await neutral.page.getByText("상성·교대 분석", { exact: true }).tap();
  await neutral.button("PC에서 약점 기술 확인").tap();
  await neutralPc.locator('[data-install-pick="mon-2"]').tap();
  await neutralPc.getByLabel("두 번째 타입").selectOption("12");
  const candyAction = neutralPc.getByRole("button", { name: "사탕 먹이기", exact: true });
  assert.ok(await candyAction.isDisabled());
  const pcCharge = neutralPc.getByRole("button", { name: /^충전권 구매.*자금 5.*행동력 \+2/ });
  assert.equal(await pcCharge.count(), 1, "Charging is available inside the scout PC");
  assert.ok((await pcCharge.boundingBox())?.height >= 44);
  await pcCharge.evaluate(button => { button.click(); button.click(); });
  await pcCharge.waitFor({ state: "hidden" });
  assert.deepEqual(await neutral.read(), mapCharged);
  assert.ok(await candyAction.evaluate(button => document.activeElement === button));
  await neutralPc.getByRole("heading", { name: "리아코 Lv.1" }).waitFor();
  assert.equal(await neutralPc.getByLabel("두 번째 타입").inputValue(), "12");
  await candyAction.tap();
  await neutralPc.getByRole("heading", { name: "리아코 Lv.2" }).waitFor();
  const trained = await neutral.read();
  assert.equal(trained.energy, 1);
  assert.equal(trained.resources.gold, 5);
  assert.equal(trained.resources.candy, 3);
  assert.equal(trained.turnCount, neutralSave.turnCount);
  await neutral.page.reload();
  await neutral.page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
  assert.deepEqual(await neutral.read(), trained);
  assert.deepEqual(neutral.errors, []);
  await neutral.page.close();
  console.log("Mobile growth scout passed: neutral level 7 unlock, map and PC charge parity, selection retained, guarded double-click and reload");

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
