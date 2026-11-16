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

async function win(page) {
  assert.equal((await playBattle(page)).won, true);
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  const desktop = await profile({ width: 1440, height: 900 });
  const play = controls(desktop);
  for (let round = 1; round <= 3; round++) {
    await play.heading(`스타팅 선택 ${round}/3`).waitFor();
    await play.use(desktop.locator("[data-draft-target]").first());
  }
  await play.use(play.button("본거지로 이동"));
  await play.openMap();

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

  await play.use(play.button("본거지로"));
  await play.use(play.button("엔트리"));
  const entry = desktop.getByRole("dialog", { name: /전투 엔트리 편성/ });
  for (const member of fresh.roster) await play.use(entry.locator(`[data-pc-member="${member.id}"]`));
  await desktop.keyboard.press("Escape");
  await play.openMap();
  await play.use(play.faction("south"));
  await play.heading("남부 거점").waitFor();
  await desktop.waitForFunction(() => document.activeElement?.textContent === "남부 거점");
  await play.shot("desktop-trainer-report");
  await play.use(play.button(/거점 도전/));
  await play.heading("거점 배틀").waitFor();
  assert.equal(await desktop.locator(".duel-arena .draft-scanner-status").textContent(), rival.nameKr);
  await win(desktop);
  await play.use(play.button("월드맵으로"));
  await play.heading("남부 거점").waitFor();
  assert.equal(await play.node("south").getAttribute("data-status"), "owned");
  assert.equal(await play.faction("south").count(), 0);
  assert.equal(await desktop.locator('[data-route="home|south"]').getAttribute("data-owned-route"), "true");
  const won = await play.read();
  assert.equal(won.energy, scouted.energy - 2);
  assert.equal(won.mapSnapshot.find(spot => spot.id === "south").trainerId, null);
  await desktop.reload();
  await play.openMap();
  assert.deepEqual((await play.read()).mapSnapshot, won.mapSnapshot);
  await play.use(play.node("southeast"));
  await play.use(play.button(/정찰하기/));
  await play.heading("동남 거점").waitFor();
  await play.report.getByText(/선호 타입/).waitFor();
  await play.shot("desktop-owned-route");

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
    await touch.use(touch.node("west"));
    await mobile.locator('[data-node="west"][aria-pressed="true"]').waitFor();
    await touch.use(touch.button(/정찰하기/));
    await touch.heading("서부 거점").waitFor();
    await touch.use(touch.button("지도 전체 보기"));
    await mobile.waitForFunction(() => document.querySelector(".atlas-board").style.transform.endsWith("scale(1)"));
    await touch.use(touch.faction("south"));
    await touch.heading("남부 거점").waitFor();
    await touch.shot(`touch-${viewport.width}-trainer-report`);
    await touch.use(touch.button(/거점 도전/));
    await touch.heading("거점 배틀").waitFor();
    assert.equal(await mobile.locator(".duel-arena .draft-scanner-status").textContent(), rival.nameKr);
    await mobile.close();
  }

  assert.deepEqual(errors, []);
  console.log("Map Chrome smoke passed: new placement, hidden identity, scout, battle and conquest; v3 placement; desktop keyboard and 320/390px touch pan, scout and challenge");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
