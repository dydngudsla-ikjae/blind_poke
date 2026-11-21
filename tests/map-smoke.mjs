import { playBattle } from "./battle-play.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

const key = "blindpoke-save-v1";
const mapKey = "blindpoke-map-v1";
const screenshots = process.env.BLINDPOKE_MAP_SHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const server = await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: true }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
let browser;
const errors = [];

async function profile(viewport, touch = false) {
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: "reduce" });
  page.setDefaultTimeout(12000);
  await page.addInitScript(() => { Math.random = () => 0; });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  return page;
}

function controls(page, touch = false) {
  const use = locator => touch ? locator.tap() : locator.press("Enter");
  const button = (name, parent = page) => parent.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: typeof name === "string" });
  const node = id => page.locator(`[data-node="${id}"]`);
  const faction = id => page.locator(`[data-faction-site="${id}"]`);
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const report = page.getByRole("complementary", { name: "정찰 기록" });
  async function openMap() {
    await use(button("지도"));
    await heading("월드맵").waitFor();
  }
  async function shot(name) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    if (!screenshots) return;
    await report.locator("img").evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true });
  }
  return { use, button, heading, node, faction, report, read, openMap, shot };
}

async function win(page, { use }) {
  assert.equal((await playBattle(page, { activate: use })).won, true);
}

async function reviewFirstReward(page, play, { touch = false, spend = false } = {}) {
  const outcome = page.locator('.duel-outcome[data-result="win"]');
  const open = play.button("포켓몬 살피기", outcome);
  const proceed = play.button("월드맵으로", outcome);
  await outcome.getByText(/정찰한 뒤 써도 됩니다/).waitFor();
  const before = await play.read();
  const [pcBox, mapBox] = await Promise.all([open.boundingBox(), proceed.boundingBox()]);
  assert.ok(pcBox?.height >= 44 && mapBox?.height >= 44);
  assert.ok(mapBox.x - pcBox.x - pcBox.width >= 7.95 || mapBox.y - pcBox.y - pcBox.height >= 7.95);
  if (screenshots) await outcome.screenshot({ path: join(screenshots, `first-reward-${page.viewportSize().width}.png`) });
  await play.use(open);
  const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
  await pc.waitFor();
  assert.equal(await play.button("사탕 먹이기", pc).isDisabled(), before.energy === 0);
  if (touch) await play.use(play.button("닫기", pc));
  else await page.keyboard.press("Escape");
  await pc.waitFor({ state: "hidden" });
  assert.ok(await open.evaluate(button => button === document.activeElement));
  assert.deepEqual(await play.read(), before);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));

  if (spend) {
    const member = before.roster.at(-1);
    await play.use(open);
    await play.use(pc.locator(`[data-install-pick="${member.id}"]`));
    await play.use(play.button("사탕 먹이기", pc));
    await play.use(play.button("닫기", pc));
    const trained = await play.read();
    assert.equal(trained.roster.find(candidate => candidate.id === member.id).level, member.level + 1);
    assert.equal(trained.energy, before.energy - 1);
    assert.equal(trained.resources.candy, before.resources.candy - 1);
    assert.deepEqual(trained.mapSnapshot, before.mapSnapshot);
    assert.equal(trained.resources.gold, before.resources.gold);
  }
}

async function prepareEntry(page, play, roster, { touch = false, energyShort = false } = {}) {
  const challenge = play.button(/거점 도전/, play.report);
  const opener = play.button("엔트리 편성", play.report);
  const reportHeading = play.report.locator("[data-atlas-report-heading]");
  const selected = await reportHeading.textContent();
  const close = async entry => {
    if (touch) await play.use(play.button("닫기", entry));
    else await page.keyboard.press("Escape");
    await entry.waitFor({ state: "hidden" });
    assert.equal(await reportHeading.textContent(), selected);
  };

  assert.ok(await challenge.isDisabled());
  await play.use(opener);
  const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  await entry.waitFor();
  await close(entry);
  assert.deepEqual((await play.read()).entryOrder, []);
  assert.ok(await opener.evaluate(button => button === document.activeElement));
  assert.equal(await opener.locator("small").textContent(), "편성 0/6");
  await play.use(opener);
  for (const member of roster) await play.use(entry.locator(`[data-pc-member="${member.id}"]`));
  await close(entry);
  await opener.waitFor({ timeout: 3000 });
  assert.ok(await opener.evaluate(button => button === document.activeElement));
  assert.equal(await opener.locator("small").textContent(), `편성 ${roster.length}/6`);
  assert.equal(await challenge.isDisabled(), energyShort);
  if (energyShort) await play.report.getByText("행동력이 부족합니다.", { exact: true }).waitFor();
  assert.deepEqual((await play.read()).entryOrder, roster.map(member => member.id));
  const arranged = await play.read();
  await play.use(opener);
  await close(entry);
  assert.deepEqual(await play.read(), arranged);
}

async function chooseOpeningLead(page, play, [first, lead, ...reserves]) {
  const report = play.report.getByRole("region", { name: "첫 도전 준비" });
  const before = await play.read();
  await report.getByText("캐터피 Lv.2", { exact: true }).waitFor();
  const comparison = report.getByText(/선봉 비교/);
  await play.use(comparison);
  const attacks = report.getByRole("list", { name: "선봉별 공격" });
  assert.equal(await attacks.getByRole("listitem").count(), before.entryOrder.length);
  const target = play.button(`${lead.pokemon.nameKr} 선봉으로`, report);
  const bounds = await target.boundingBox();
  assert.ok(bounds?.height >= 44);
  await play.use(target);
  const current = play.button(`${lead.pokemon.nameKr} 현재 선봉`, report);
  await current.waitFor();
  assert.ok(await current.evaluate(button => document.activeElement === button));
  const changed = await play.read();
  assert.deepEqual(changed.entryOrder, [lead, first, ...reserves].map(member => member.id));
  assert.equal(changed.energy, before.energy);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await play.use(comparison);
  await attacks.waitFor({ state: "hidden" });
  return lead.pokemon.nameKr;
}

async function verifyDuplicateOpeningLead(touch) {
  const page = await profile(touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, touch);
  const play = controls(page, touch);
  await page.evaluate(async key => {
    const lapras = (await fetch("/data/pokemon.json").then(response => response.json())).find(record => record.pokemonRowid === 131);
    const roster = [15, -15, 0].map((hp, index) => ({ id: `mon-${index + 1}`, pokemon: lapras, level: 1,
      exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: 50, iv: { hp } }));
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, entryOrder: ["mon-1", "mon-2"], energy: 5,
      nextMemberId: 4, introPending: false }));
  }, key);
  await page.reload();
  await play.openMap();
  await play.use(play.node("southwest"));
  await play.use(play.button(/정찰하기/));
  const opening = play.report.getByRole("region", { name: "첫 도전 준비" });
  await play.use(opening.getByText(/선봉 비교/));
  const second = play.button("라프라스 2번 선봉으로", opening);
  await second.waitFor({ timeout: 2500 });
  await opening.getByRole("listitem").filter({ hasText: "라프라스 2번" }).getByText("Lv.1", { exact: true }).waitFor();
  assert.equal(await opening.getByText("라프라스 3번", { exact: false }).count(), 0);
  const before = await play.read();
  if (touch) {
    await second.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await second.boundingBox();
    const point = [x + width / 2, y + height / 2];
    await page.touchscreen.tap(...point);
    await play.button("라프라스 2번 현재 선봉", opening).waitFor();
    assert.equal(await page.evaluate(([clientX, clientY]) => document.elementFromPoint(clientX, clientY)
      ?.closest("button")?.getAttribute("aria-label"), point), "라프라스 1번 선봉으로");
    await page.touchscreen.tap(...point);
  } else await play.use(second);
  const selected = await play.read();
  assert.deepEqual(selected.entryOrder, ["mon-2", "mon-1"]);
  assert.equal(selected.energy, before.energy);
  await play.use(play.report.getByText("상성·교대 분석", { exact: true }));
  const attacks = play.report.getByRole("list", { name: "아군 공격 상성" });
  await attacks.getByText(/^라프라스 2번 ·/).waitFor();
  await attacks.getByText(/^라프라스 1번 ·/).waitFor();
  await page.reload();
  await play.openMap();
  await play.use(play.node("southwest"));
  assert.deepEqual(await play.read(), selected);
  await play.use(play.button(/거점 도전/, play.report));
  const player = page.locator('.duel-vitals[data-side="player"]');
  await player.getByRole("heading", { name: "라프라스 2번", exact: true }).waitFor();
  assert.equal(await player.locator("meter").getAttribute("max"), "257");
  await page.close();
}

function chargeForecast(shop) {
  return Promise.all(["다음 턴 자금", "구매 후 다음 턴 자금"].map(name =>
    shop.getByRole("group", { name, exact: true }).innerText()));
}

async function chargeFromReport(page, play, { buy = true, touch = false } = {}) {
  const before = await play.read();
  const challenge = play.button(/거점 도전/, play.report);
  const title = play.report.locator("[data-atlas-report-heading]");
  const selected = await title.textContent();
  const open = play.button("충전권 확인", play.report);
  await open.waitFor();
  assert.ok((await open.boundingBox())?.height >= 44);
  assert.ok(await challenge.isDisabled());
  await play.use(open);
  const shop = page.getByRole("dialog", { name: /상점/ });
  const purchase = play.button("구매", shop);
  await shop.waitFor();
  assert.deepEqual(await play.read(), before);
  let reading;
  if (buy) {
    reading = await chargeForecast(shop);
    await play.use(purchase);
  } else {
    assert.ok(await purchase.isDisabled());
    await shop.getByText(/구매에 필요한 자금이 부족합니다/).waitFor();
  }
  if (touch) await play.use(play.button("닫기", shop));
  else await page.keyboard.press("Escape");
  await shop.waitFor({ state: "hidden" });
  assert.equal(await title.textContent(), selected);
  assert.equal(await challenge.isEnabled(), buy);
  assert.ok(await (buy ? title : open).evaluate(button => document.activeElement === button));
  const after = await play.read();
  assert.deepEqual(after, buy ? { ...before, energy: before.energy + 2, resources: { ...before.resources, gold: before.resources.gold - 5 } } : before);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  return { reading, after };
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  await verifyDuplicateOpeningLead(false);
  await verifyDuplicateOpeningLead(true);
  console.log("Duplicate lead Chrome passed: numbered scout comparisons, one reorder, reload and selected IV in battle");
  const desktop = await profile({ width: 1440, height: 900 });
  const play = controls(desktop);
  for (let round = 1; round <= 3; round++) {
    await play.heading(`동료 영입 ${round - 1}/3`).waitFor();
    await play.use(desktop.locator("[data-draft-target]").first());
  }
  await play.use(play.button("본거지로 이동"));
  await play.openMap();
  assert.ok(await play.heading("월드맵").evaluate(heading => heading === document.activeElement));

  const fresh = await play.read();
  const trainers = fresh.mapSnapshot.filter(spot => spot.owner === "trainer").map(spot => spot.trainerId);
  assert.equal(trainers.length, 6);
  assert.equal(new Set(trainers).size, 6);
  assert.ok(!trainers.includes(fresh.trainerId));
  assert.equal(fresh.mapSnapshot.filter(spot => spot.active && spot.owner === "unoccupied").length, 3);
  assert.equal(await desktop.locator(".atlas-node:disabled").count(), 30);
  assert.equal(await desktop.locator(".atlas-node[data-status=trainer]").count(), 0);
  assert.equal(await desktop.locator("[data-faction-site]").count(), 1);
  const roster = await desktop.evaluate(async () => (await fetch("/data/trainer.json").then(response => response.json())).trainers);
  const southId = fresh.mapSnapshot.find(spot => spot.id === "south").trainerId;
  const rival = roster.find(trainer => trainer.id === southId);
  assert.ok(rival);

  const atlas = desktop.getByRole("group", { name: "섬 지도" });
  const board = desktop.locator(".atlas-board");
  await atlas.press("+");
  assert.match(await board.getAttribute("style"), /scale\(1.25\)/);
  const centered = await board.getAttribute("style");
  await atlas.press("ArrowRight");
  assert.notEqual(await board.getAttribute("style"), centered);
  await atlas.press("0");
  await play.use(play.node("west"));
  assert.equal(await play.button(/정찰하기/).count(), 0);
  await play.use(play.node("south"));
  await play.heading("미확인 거점").waitFor();
  assert.equal(await play.report.getByRole("region", { name: "첫 도전 준비" }).count(), 0);
  assert.ok(!(await play.report.innerText()).includes(rival.nameKr));
  await play.shot("desktop-unscouted");
  await play.use(play.button(/정찰하기/));
  await play.heading("남부 거점").waitFor();
  await play.report.getByText(rival.nameKr, { exact: true }).first().waitFor();
  assert.ok(await play.button(/거점 도전/).isDisabled());
  assert.equal(await play.node("south").getAttribute("data-status"), "trainer");
  assert.ok((await play.node("south").getAttribute("aria-label")).includes(rival.nameKr));
  assert.match(await play.faction("south").innerText(), /남부 거점/);
  const scouted = await play.read();

  await prepareEntry(desktop, play, fresh.roster);
  const desktopLead = await chooseOpeningLead(desktop, play, fresh.roster);
  await play.shot("desktop-trainer-report");
  await play.use(play.button(/거점 도전/));
  await play.heading("거점 배틀").waitFor();
  assert.equal(await desktop.locator(".duel-opponent").textContent(), rival.nameKr);
  await desktop.locator('.duel-vitals[data-side="player"]').getByRole("heading", { name: desktopLead, exact: true }).waitFor();
  await win(desktop, play);
  await reviewFirstReward(desktop, play);
  await desktop.emulateMedia({ reducedMotion: "no-preference" });
  await play.use(play.button("월드맵으로"));
  await play.heading("남부 거점").waitFor();
  await desktop.waitForFunction(() => !document.documentElement.hasAttribute("data-field-transition"));
  assert.ok(await play.heading("남부 거점").evaluate(heading => heading === document.activeElement));
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await play.node("south").getAttribute("data-status"), "owned");
  assert.equal(await play.faction("south").count(), 0);
  assert.equal(await desktop.locator('[data-route="home|south"]').getAttribute("data-owned-route"), "true");
  const won = await play.read();
  assert.equal(won.energy, scouted.energy - 2);
  assert.equal(won.resources.gold - scouted.resources.gold, 5);
  assert.equal(won.resources.candy - scouted.resources.candy, 1);
  assert.equal(won.mapSnapshot.find(spot => spot.id === "south").trainerId, null);
  await desktop.reload();
  await play.openMap();
  const restored = await play.read();
  for (const field of ["mapSnapshot", "entryOrder", "resources"]) assert.deepEqual(restored[field], won[field]);
  await play.use(play.node("southeast"));
  await play.use(play.button(/정찰하기/));
  await play.heading("동남 거점").waitFor();
  await play.report.getByText(/선호 타입/).waitFor();
  await play.shot("desktop-owned-route");

  const checkpoint = await play.read();
  const short = { ...checkpoint, energy: 1, resources: { ...checkpoint.resources, gold: checkpoint.storageCap - 1 } };
  async function openShortReport() {
    await desktop.evaluate(({ key, short }) => localStorage.setItem(key, JSON.stringify(short)), { key, short });
    await desktop.reload();
    await play.openMap();
    await play.use(play.node("southeast"));
    await play.heading("동남 거점").waitFor();
  }

  await openShortReport();
  await play.use(play.button("본거지로"));
  await play.use(play.button("상점"));
  const baseShop = desktop.getByRole("dialog", { name: /상점/ });
  const baseReading = await chargeForecast(baseShop);
  assert.match(baseReading[0], /받을 자금 \+1[\s\S]*상한으로 못 받는 자금 2/);
  assert.match(baseReading[1], /받을 자금 \+3[\s\S]*상한으로 못 받는 자금 0/);
  await play.use(play.button("구매", baseShop));
  await play.use(play.button("닫기", baseShop));
  await play.openMap();
  assert.equal(await play.node("southeast").getAttribute("aria-pressed"), "true", "Return from the shop to the selected site");
  await play.heading("동남 거점").waitFor();
  assert.ok(await play.button(/거점 도전/, play.report).isEnabled());
  const baseCharge = await play.read();

  await openShortReport();
  const mapCharge = await chargeFromReport(desktop, play);
  assert.deepEqual(mapCharge.after, baseCharge);
  assert.deepEqual(mapCharge.reading, baseReading);

  await openShortReport();
  await play.use(play.button("본거지로"));
  const baseShortcut = play.button(/충전권 구매.*자금 5.*행동력 \+2/);
  await baseShortcut.evaluate(button => { button.click(); button.click(); });
  await baseShortcut.waitFor({ state: "hidden" });
  assert.deepEqual(await play.read(), baseCharge);
  assert.ok(await desktop.locator('[data-action="hunt"]').evaluate(button => document.activeElement === button));

  await openShortReport();
  const shortcut = play.button(/충전권 구매.*자금 5.*행동력 \+2/, play.report);
  await shortcut.waitFor({ timeout: 4000 });
  await play.use(shortcut);
  await shortcut.waitFor({ state: "hidden" });
  assert.deepEqual(await play.read(), baseCharge);
  assert.ok(await play.button(/거점 도전/, play.report).evaluate(button => document.activeElement === button));
  await play.use(play.button(/거점 도전/, play.report));
  await play.heading("거점 배틀").waitFor();
  assert.equal((await play.read()).energy, baseCharge.energy - 2);

  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
    const mobile = await profile(viewport, true);
    const touch = controls(mobile, true);
    const { mapSnapshot, ...save } = scouted;
    const snapshot = mapSnapshot.map(spot => spot.id === "southwest" ? { ...spot, owner: "player", scouted: true } : spot);
    await mobile.evaluate(({ key, mapKey, save, snapshot }) => {
      localStorage.setItem(key, JSON.stringify({ ...save, v: 3, entryOrder: [save.roster[0].id] }));
      localStorage.setItem(mapKey, JSON.stringify(snapshot));
    }, { key, mapKey, save, snapshot });
    await mobile.reload();
    await touch.openMap();
    assert.deepEqual((await touch.read()).mapSnapshot, snapshot);
    assert.equal(await touch.node("southwest").getAttribute("data-status"), "owned");
    assert.equal(await touch.node("south").getAttribute("data-status"), "trainer");
    const view = mobile.locator(".atlas-viewport");
    const mobileBoard = mobile.locator(".atlas-board");
    const reportToggle = touch.button(/보고 접기/);
    await touch.use(reportToggle);
    assert.equal(await touch.button(/보고 펴기/).getAttribute("aria-expanded"), "false");
    await mobile.locator(".atlas-report-detail").waitFor({ state: "hidden" });
    await touch.use(touch.button("지도 확대"));
    await mobile.locator('.atlas-viewport[data-zoomed="true"]').waitFor();
    const before = await mobileBoard.getAttribute("style");
    const box = await view.boundingBox();
    assert.ok(box);
    const cdp = await mobile.context().newCDPSession(mobile);
    const start = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.4 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 34, y: start.y + 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await mobile.waitForFunction(before => document.querySelector(".atlas-board").getAttribute("style") !== before, before);

    const marker = await touch.node("island").boundingBox();
    assert.ok(marker);
    const markerStart = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 };
    assert.equal(await mobile.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-node]")?.getAttribute("data-node"), markerStart), "island");
    const beforeMarkerDrag = await mobileBoard.getAttribute("style");
    const selectedBeforeDrag = await mobile.locator('.atlas-node[aria-pressed="true"]').getAttribute("data-node");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [markerStart] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: markerStart.x, y: markerStart.y - 18 }] });
    await mobile.waitForFunction(before => document.querySelector(".atlas-board").getAttribute("style") !== before, beforeMarkerDrag);
    const firstMarkerMove = await mobileBoard.getAttribute("style");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: markerStart.x, y: markerStart.y - 28 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.notEqual(await mobileBoard.getAttribute("style"), beforeMarkerDrag, "확대 지도는 거점 위에서 밀어도 이동해야 합니다.");
    assert.notEqual(await mobileBoard.getAttribute("style"), firstMarkerMove, "거점에서 시작한 드래그를 중간에 놓치면 안 됩니다.");
    assert.equal(await view.getAttribute("data-dragging"), null);
    assert.equal(await mobile.locator('.atlas-node[aria-pressed="true"]').getAttribute("data-node"), selectedBeforeDrag);
    assert.equal(await touch.button(/보고 펴기/).getAttribute("aria-expanded"), "false");

    await touch.use(touch.node("west"));
    await mobile.locator('[data-node="west"][aria-pressed="true"]').waitFor();
    assert.equal(await reportToggle.getAttribute("aria-expanded"), "true");
    await touch.use(touch.button(/정찰하기/));
    await touch.heading("서부 거점").waitFor();
    const viewBeforeReturn = await mobileBoard.getAttribute("style");
    const reportBeforeReturn = await touch.read();
    await touch.use(touch.button("본거지로"));
    await touch.openMap();
    await touch.heading("서부 거점").waitFor();
    assert.ok(await touch.heading("월드맵").evaluate(heading => heading === document.activeElement));
    assert.equal(await mobileBoard.getAttribute("style"), viewBeforeReturn, "본거지에서 돌아오면 확대 배율과 위치가 유지되어야 합니다.");
    assert.equal(await touch.node("west").getAttribute("aria-pressed"), "true");
    assert.deepEqual(await touch.read(), reportBeforeReturn);
    await touch.use(touch.button("지도 전체 보기"));
    await mobile.waitForFunction(() => document.querySelector(".atlas-board").style.transform.endsWith("scale(1)"));
    await touch.use(touch.faction("south"));
    await touch.heading("남부 거점").waitFor();
    const legacyEntry = touch.button("엔트리 편성", touch.report);
    const legacyBefore = await touch.read();
    await legacyEntry.waitFor({ timeout: 3000 });
    await touch.use(legacyEntry);
    const formation = mobile.getByRole("dialog", { name: /전투 엔트리 편성/ });
    const reserve = save.roster[1];
    await touch.use(formation.locator(`[data-pc-member="${reserve.id}"]`));
    await touch.use(formation.locator('[data-entry-slot="1"] [data-entry-direction="up"]'));
    await touch.use(touch.button("닫기", formation));
    await formation.waitFor({ state: "hidden" });
    assert.ok(await legacyEntry.evaluate(button => button === document.activeElement));
    assert.deepEqual(await touch.read(), { ...legacyBefore, entryOrder: [reserve.id, save.roster[0].id] });
    await touch.shot(`touch-${viewport.width}-trainer-report`);
    await touch.use(touch.button(/거점 도전/));
    await touch.heading("거점 배틀").waitFor();
    assert.equal(await mobile.locator(".duel-opponent").textContent(), rival.nameKr);
    await mobile.locator('.duel-vitals[data-side="player"]').getByRole("heading", { name: reserve.pokemon.nameKr, exact: true }).waitFor();
    assert.equal(await touch.button("포켓몬 살피기").count(), 0);

    const firstBattle = { ...fresh, energy: viewport.width === 320 ? 2 : fresh.energy };
    await mobile.evaluate(({ key, firstBattle }) => localStorage.setItem(key, JSON.stringify(firstBattle)), { key, firstBattle });
    await mobile.reload();
    await touch.openMap();
    await touch.use(touch.node("south"));
    await touch.use(touch.button(/정찰하기/));
    await touch.heading("남부 거점").waitFor();
    await prepareEntry(mobile, touch, fresh.roster, { touch: true });
    const mobileLead = await chooseOpeningLead(mobile, touch, fresh.roster);
    await touch.use(touch.button("지도 확대"));
    const beforeBattleView = await mobileBoard.getAttribute("style");
    await touch.use(touch.button(/거점 도전/));
    await mobile.locator('.duel-vitals[data-side="player"]').getByRole("heading", { name: mobileLead, exact: true }).waitFor();
    await win(mobile, touch);
    const spend = viewport.width === 390;
    await reviewFirstReward(mobile, touch, { touch: true, spend });
    await touch.use(touch.button("월드맵으로"));
    await touch.heading("남부 거점").waitFor();
    assert.ok(await touch.heading("남부 거점").evaluate(heading => heading === document.activeElement));
    assert.equal(await mobileBoard.getAttribute("style"), beforeBattleView);
    assert.equal(await touch.node("south").getAttribute("aria-pressed"), "true");
    const victory = await touch.read();
    assert.equal(victory.energy, firstBattle.energy - 2 - Number(spend));
    assert.equal(victory.resources.gold - fresh.resources.gold, 5);
    assert.equal(victory.resources.candy - fresh.resources.candy, 1 - Number(spend));
    await mobile.reload();
    await touch.openMap();
    const resumed = await touch.read();
    for (const field of ["mapSnapshot", "roster", "entryOrder", "resources", "energy"]) assert.deepEqual(resumed[field], victory[field]);

    if (!spend) {
      await touch.use(touch.node("southeast"));
      await touch.use(touch.button(/정찰하기/));
      await touch.heading("동남 거점").waitFor();
      assert.equal((await touch.read()).resources.candy, resumed.resources.candy);
      assert.equal((await touch.read()).energy, 0);
      const short = await touch.read();
      const shortcut = touch.button(/충전권 구매.*자금 5.*행동력 \+2/, touch.report);
      await shortcut.waitFor();
      assert.ok((await shortcut.boundingBox())?.height >= 44);
      await touch.use(shortcut);
      await shortcut.waitFor({ state: "hidden" });
      const charged = await touch.read();
      assert.deepEqual(charged, { ...short, energy: 2, resources: { ...short.resources, gold: short.resources.gold - 5 } });
      await touch.use(touch.button(/거점 도전/, touch.report));
      await touch.heading("거점 배틀").waitFor();
      assert.equal((await touch.read()).energy, 0);
      await mobile.reload();
      await touch.heading("본거지").waitFor();
      const savedCharge = await touch.read();
      assert.deepEqual(savedCharge.resources, charged.resources);
      assert.deepEqual(savedCharge.mapSnapshot, charged.mapSnapshot);
      assert.equal(savedCharge.energy, 0);
      await touch.openMap();
      await touch.use(touch.node("southeast"));
      await touch.use(touch.button("본거지로"));
      await touch.use(mobile.locator("#nextTurn"));
      assert.equal((await touch.read()).turnCount, savedCharge.turnCount + 1);
      assert.equal((await touch.read()).energy, 5);
      await touch.openMap();
      assert.equal(await touch.node("southeast").getAttribute("aria-pressed"), "true", "Return to the selected site after a turn");
      assert.ok(await touch.button(/거점 도전/, touch.report).isEnabled());
    } else {
      await mobile.evaluate(({ key, fresh }) => localStorage.setItem(key, JSON.stringify({ ...fresh, energy: 1 })), { key, fresh });
      await mobile.reload();
      await touch.openMap();
      await touch.use(touch.node("south"));
      await touch.use(touch.button(/정찰하기/));
      await touch.heading("남부 거점").waitFor();
      await prepareEntry(mobile, touch, fresh.roster, { touch: true, energyShort: true });
      assert.equal((await touch.read()).energy, 1);
      assert.equal(await touch.button(/충전권 구매/, touch.report).count(), 0);
      await chargeFromReport(mobile, touch, { buy: false, touch: true });
    }
    await mobile.close();
  }

  assert.deepEqual(errors, []);
  console.log("Map Chrome smoke passed: scout → entry → first victory, review, spend or defer candy, reload; keyboard and 320/390px touch; v3 placement and insufficient energy");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
