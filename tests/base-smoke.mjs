import assert from "node:assert/strict";
import { chromium } from "playwright";
import { preview } from "vite";
import { worldMapNodes } from "../src/domain/worldMap.ts";

const saveKey = "blindpoke-save-v1";
const server = await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: true }, logLevel: "error" });
let browser;
const errors = [];

function baseControls(page, touch) {
  const use = locator => touch ? locator.tap() : locator.press("Enter");
  const button = (name, root = page) => root.getByRole("button", { name, exact: typeof name === "string" });
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  async function open(name, title) {
    await use(button(name));
    const dialog = page.getByRole("dialog", { name: title, exact: typeof title === "string" });
    await dialog.waitFor();
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
    return dialog;
  }
  async function close(dialog) {
    if (touch) await use(button("닫기", dialog));
    else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  async function tools(memberId) {
    const dialog = await open("자원", /자원 현황/);
    await use(dialog.getByText("지닌 도구", { exact: true }));
    if (memberId) await dialog.getByLabel("장착할 포켓몬").selectOption(memberId);
    return dialog;
  }
  async function turn() {
    const next = (await read()).turnCount + 1;
    await page.locator("#nextTurn").press("Enter");
    await page.waitForFunction(({ key, next }) => JSON.parse(localStorage.getItem(key))?.turnCount === next, { key: saveKey, next });
  }
  async function build(plot, facility, crew, checkEstimate = false) {
    const dialog = await open(`${plot}번 부지 건설`, `건설 · ${plot}번 부지`);
    await use(button(facility, dialog));
    for (const [index, id] of crew.entries()) {
      await use(dialog.locator(`[data-install-pick="${id}"]`));
      if (checkEstimate) {
        await dialog.getByText(new RegExp(`완공까지 ${3 - index}턴`)).waitFor();
        await dialog.getByText(/행동력 1 필요 · 현재/).waitFor();
        if (index < 2) await dialog.getByText("한 마리 더 투입하면 1턴 단축").waitFor();
      }
    }
    const confirm = dialog.locator("[data-build-confirm]");
    // Send both clicks in one browser task to exercise a repeated order on the same plot.
    if (checkEstimate) await confirm.evaluate(element => { element.click(); element.click(); });
    else await use(confirm);
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: new RegExp(`${facility} 공사 관리`) }).waitFor();
  }
  async function assign(dialog, job, memberId, cost, repeat = false) {
    await use(button(new RegExp(job), dialog));
    await use(dialog.locator(`[data-install-pick="${memberId}"]`));
    const order = button(`직무 배치 · 행동력 ${cost}`, dialog);
    if (repeat) await order.evaluate(element => { element.click(); element.click(); });
    else await use(order);
    assert.ok(await button(/직무 배치 · 행동력/, dialog).isDisabled());
  }
  async function capture(dialog, huntButton) {
    await use(button(huntButton, dialog));
    await page.getByRole("heading", { name: "야생 탐험" }).waitFor();
    const target = page.locator(".hunt-target").first();
    if (touch) await target.tap();
    else await page.keyboard.press("Tab");
    await page.getByRole("complementary", { name: "관측 패널" }).getByRole("heading", { name: "미확인 개체 1" }).waitFor();
    await use(target);
    await use(button(/본인확인서 대조/));
    const art = page.locator(".identify-target-art");
    await page.locator('[data-mode="silhouette"]').waitFor();
    const pokemonId = Number((await art.getAttribute("src")).match(/(\d+)\.png/)?.[1]);
    const pokemon = await page.evaluate(async id => (await fetch("/data/pokemon.json").then(response => response.json()))
      .find(entry => entry.pokemonRowid === id), pokemonId);
    await page.getByRole("textbox", { name: "포켓몬 이름" }).fill(pokemon.nameKr);
    await use(button("식별"));
    await page.getByRole("heading", { name: "포획 성공" }).waitFor();
    await use(button("본거지로"));
    await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    return (await read()).roster.at(-1);
  }
  return { use, button, read, open, close, tools, turn, build, assign, capture };
}

async function openProfile({ touch = false } = {}) {
  const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: "reduce" });
  page.setDefaultTimeout(12000);
  await page.addInitScript(() => { Math.random = () => 0; });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  return page;
}

async function repeatActivation(page, action, touch, committed, physicalPointer = false) {
  if (physicalPointer) {
    await action.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await action.boundingBox();
    const point = [x + width / 2, y + height / 2];
    const activate = () => touch ? page.touchscreen.tap(...point) : page.mouse.click(...point);
    await activate();
    await committed();
    await activate();
  } else if (touch) await action.evaluate(button => { button.click(); button.click(); });
  else {
    await action.focus();
    await page.keyboard.down("Enter");
    await committed();
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
  }
  await committed();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function verifyRepeatedOrders(touch, physicalPointer = false) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  await page.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [{ id: "mon-1", pokemon: records.find(pokemon => pokemon.pokemonRowid === 1), level: 1, exp: 0,
      favor: 22, favFloor: 20, favCeil: 85, aptitude: 50, iv: {}, buildingId: "building-1", jobId: "seed" }];
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, turnCount: 8, energy: 0, resources: { gold: 30, seed: 0 },
      introPending: false, nextMemberId: 2, nextBuildingId: 2, entryOrder: ["mon-1"],
      buildings: [{ id: "building-1", type: "farm", plotIndex: 0, status: "active", remainingTurns: 0 }] }));
  }, saveKey);
  await page.reload();

  async function repeat(action, field, previous) {
    const acted = () => page.waitForFunction(({ key, field, previous }) => JSON.parse(localStorage.getItem(key))[field] > previous,
      { key: saveKey, field, previous });
    await repeatActivation(page, action, touch, acted, physicalPointer);
    return base.read();
  }

  const shop = await base.open("상점", /상점 · 자금/);
  const purchased = await repeat(base.button("구매", shop), "energy", 0);
  await base.close(shop);
  const turnAction = page.locator("#nextTurn");
  const settled = await repeat(turnAction, "turnCount", 8);
  assert.deepEqual({ purchase: [purchased.resources.gold, purchased.energy], settlement: [settled.turnCount, settled.resources.seed],
    waiting: settled.roster[0]?.departurePending }, { purchase: [25, 2], settlement: [9, 3], waiting: true },
    "한 번의 명령으로 충전권과 턴을 중복 정산하면 안 됩니다.");
  const warning = page.locator("#base-departure-warning");
  await warning.getByText(/다음 턴 이탈 예정/).waitFor();
  await page.reload();
  await warning.getByText(/다음 턴 이탈 예정/).waitFor();
  assert.deepEqual(await base.read(), settled);
  await base.turn();
  const next = await base.read();
  assert.equal(next.turnCount, 10);
  assert.deepEqual(next.roster, []);
  assert.ok(next.lastLog.some(line => /이상해씨.*이탈/.test(line)));
  await page.close();
}

async function verifyRepeatedInventoryActions(touch, physicalPointer = false) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  await page.evaluate(async ({ key, physicalPointer }) => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [{ id: "mon-1", pokemon: records.find(pokemon => pokemon.pokemonRowid === 1), level: 1, exp: 0,
      favor: physicalPointer ? 20 : 30, favFloor: 20, favCeil: 85, aptitude: 50, iv: {}, departurePending: physicalPointer }];
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, energy: 5, resources: { candy: 3, healItem: 3, tool: 6 },
      introPending: false, nextMemberId: 2, entryOrder: ["mon-1"] }));
  }, { key: saveKey, physicalPointer });
  await page.reload();

  const used = (resource, previous) => () => page.waitForFunction(({ key, resource, previous }) =>
    JSON.parse(localStorage.getItem(key)).resources[resource] < previous, { key: saveKey, resource, previous });
  const pc = await base.open(physicalPointer ? "우호도 관리" : "포켓몬 1", /보유 포켓몬/);
  const candy = base.button("사탕 먹이기", pc);
  await repeatActivation(page, candy, touch, used("candy", 3), physicalPointer);
  await repeatActivation(page, base.button("회복 아이템 사용", pc), touch, used("healItem", 3), physicalPointer);
  const growth = await base.read();
  await base.close(pc);
  assert.equal(await page.locator("#base-departure-warning").count(), 0);
  const equipment = await base.tools();
  const craft = base.button("제작 3", equipment.locator("li", { hasText: "구애머리띠" }));
  await repeatActivation(page, craft, touch, used("tool", 6), physicalPointer);
  const crafted = await base.read();
  assert.deepEqual({ growth: [growth.resources.candy, growth.resources.healItem, growth.roster[0].level,
    growth.roster[0].exp, growth.roster[0].favor, growth.energy], crafted: [crafted.resources.tool, crafted.resources.items.choice_band] },
  { growth: [2, 2, 2, 0, physicalPointer ? 35 : 45, 3], crafted: [3, 1] }, "사탕·회복·제작을 한 번씩만 처리해야 합니다.");
  assert.equal(growth.roster[0].departurePending, undefined);
  if (physicalPointer) await page.waitForTimeout(360);
  await base.use(craft);
  assert.equal((await base.read()).resources.items.choice_band, 2);
  await base.close(equipment);
  await base.open("포켓몬 1", /보유 포켓몬/);
  await base.use(candy);
  const afterCandy = await base.read();
  assert.equal(afterCandy.roster[0].exp, 20);
  assert.equal(afterCandy.energy, 2);
  if (physicalPointer) {
    await repeatActivation(page, base.button("회복 아이템 사용", pc), touch, used("healItem", 2), true);
    const secondRecovery = await base.read();
    assert.equal(secondRecovery.resources.healItem, 1);
    assert.equal(secondRecovery.roster[0].favor, 50);
    assert.equal(secondRecovery.energy, 1);
  }
  const finished = await base.read();
  await page.reload();
  await base.button("포켓몬 1").waitFor();
  assert.deepEqual(await base.read(), finished);
  await page.close();
}

async function verifyRosterSearch(touch) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  await page.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [...Array.from({ length: 23 }, (_, index) => index + 1), 445, 445].map((pokemonRowid, index) => ({
      id: `mon-${index + 1}`, pokemon: records.find(pokemon => pokemon.pokemonRowid === pokemonRowid),
      level: index === 24 ? 7 : 1, exp: index === 24 ? 120 : 0, favor: 55, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
    }));
    localStorage.setItem(key, JSON.stringify({ v: 3, roster, energy: 5, resources: { healItem: 1, candy: 1 }, introPending: false,
      nextMemberId: 26, entryOrder: ["mon-1", "mon-2", "mon-3"] }));
  }, saveKey);
  await page.reload();
  const dialog = await base.open("포켓몬 25", /보유 포켓몬/);
  const before = await base.read();
  const roster = dialog.getByRole("group", { name: "동료 선택" });
  const cards = roster.locator("[data-install-pick]");
  assert.equal(await cards.count(), 25);
  if (touch) assert.ok(await roster.evaluate(list => list.scrollWidth > list.clientWidth));
  const search = dialog.getByRole("searchbox", { name: "동료 찾기" });
  assert.equal(await search.count(), 1, "25마리의 로스터에서는 이름이나 타입으로 동료를 찾아야 합니다.");
  assert.ok((await search.boundingBox()).height >= 44);
  await search.fill("드래곤");
  assert.equal(await cards.count(), 2);
  const first = roster.getByRole("button", { name: "한카리아스 1번 Lv.1", exact: true });
  const second = roster.getByRole("button", { name: "한카리아스 2번 Lv.7", exact: true });
  assert.equal(await second.count(), 1, "같은 종도 번호와 레벨로 원하는 개체를 찾을 수 있어야 합니다.");
  assert.equal(await first.count(), 1);
  await search.fill("땅");
  assert.equal(await cards.count(), 2);
  await dialog.getByRole("heading", { name: "이상해씨 Lv.1" }).waitFor();
  await search.fill("  카리  ");
  assert.equal(await second.count(), 1);
  await base.use(second);
  const individual = dialog.getByRole("heading", { name: "한카리아스 2번 Lv.7" });
  await individual.waitFor();
  await search.fill("존재하지 않는 이름");
  await roster.getByText("일치하는 동료가 없습니다.").waitFor();
  await individual.waitFor();
  await search.fill("");
  assert.equal(await cards.count(), 25);
  assert.equal(await second.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await base.read(), before);
  await base.use(base.button("회복 아이템 사용", dialog));
  const recovered = await base.read();
  assert.equal(recovered.roster.at(-1).favor, before.roster.at(-1).favor + 15);
  assert.deepEqual(recovered.roster.slice(0, -1), before.roster.slice(0, -1));
  assert.equal(recovered.resources.healItem, 0);
  assert.equal(recovered.energy, 4);
  await base.use(base.button("사탕 먹이기", dialog));
  await dialog.getByRole("heading", { name: "한카리아스 2번 Lv.8" }).waitFor();
  const trained = await base.read();
  assert.equal(trained.energy, 3);
  assert.equal(trained.resources.candy, 0);
  assert.deepEqual(trained.roster.slice(0, -1), before.roster.slice(0, -1));
  await base.close(dialog);
  await page.reload();
  await base.button("포켓몬 25").waitFor();
  assert.deepEqual(await base.read(), trained);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  const entry = await base.open("엔트리", /전투 엔트리 편성/);
  const entryCards = entry.getByRole("region", { name: "PC" });
  await base.use(entryCards.getByRole("button", { name: "한카리아스 2번 Lv.8", exact: true }));
  const positions = entry.getByRole("region", { name: "출전 순서" });
  await positions.getByText("한카리아스 2번 Lv.8", { exact: true }).waitFor();
  const earlier = positions.getByRole("button", { name: "한카리아스 2번 앞 순서로 이동", exact: true });
  await base.use(earlier);
  assert.deepEqual((await base.read()).entryOrder, ["mon-1", "mon-2", "mon-25", "mon-3"]);
  assert.equal(await entryCards.getByRole("button", { name: "한카리아스 1번 Lv.1", exact: true }).getAttribute("aria-pressed"), "false");
  if (!touch) {
    assert.ok(await earlier.evaluate(button => button === document.activeElement), "순서를 바꿔도 초점은 같은 포켓몬을 따라가야 합니다.");
    await page.keyboard.down("Enter");
    assert.deepEqual((await base.read()).entryOrder, ["mon-1", "mon-25", "mon-2", "mon-3"]);
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.deepEqual((await base.read()).entryOrder, ["mon-1", "mon-25", "mon-2", "mon-3"]);
    await page.keyboard.press("Enter");
    assert.deepEqual((await base.read()).entryOrder, ["mon-25", "mon-1", "mon-2", "mon-3"]);
    assert.ok(await positions.locator('[data-entry-slot="0"]').evaluate(row => row === document.activeElement));
    await positions.getByRole("button", { name: "한카리아스 2번 엔트리 해제" }).press("Enter");
    assert.deepEqual((await base.read()).entryOrder, ["mon-1", "mon-2", "mon-3"]);
    const removed = entryCards.getByRole("button", { name: "한카리아스 2번 Lv.8", exact: true, pressed: false });
    assert.ok(await removed.evaluate(button => button === document.activeElement));
  }
  await page.close();
}

async function verifyEntryPointerBurst(touch) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  const initial = ["mon-1", "mon-2", "mon-3", "mon-4", "mon-5"];
  await page.evaluate(async ({ key, initial }) => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = records.slice(0, 7).map((pokemon, index) => ({
      id: `mon-${index + 1}`, pokemon, level: 1, exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
    }));
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, energy: 5, resources: { gold: 12 }, introPending: false,
      nextMemberId: 8, entryOrder: initial }));
  }, { key: saveKey, initial });
  await page.reload();

  async function repeatAt(action, expected, message) {
    await action.scrollIntoViewIfNeeded();
    const rect = await action.boundingBox();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const activate = () => touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
    await activate();
    assert.deepEqual((await base.read()).entryOrder, expected);
    await activate();
    assert.deepEqual((await base.read()).entryOrder, expected, message);
  }

  const modal = await base.open("엔트리", /전투 엔트리 편성/);
  const full = [...initial, "mon-6"];
  const spare = modal.locator('[data-pc-member="mon-7"]');
  await repeatAt(modal.locator('[data-pc-member="mon-6"]'), full, "A second tap must not undo entry registration");
  assert.equal(await spare.getAttribute("aria-disabled"), "true");
  const third = modal.locator('[data-entry-slot="2"]');
  const moved = ["mon-1", "mon-3", "mon-2", "mon-4", "mon-5", "mon-6"];
  await repeatAt(third.locator('[data-entry-direction="up"]'), moved, "A second tap must not move a different Pokémon");
  const removed = moved.filter(id => id !== "mon-2");
  await repeatAt(third.getByRole("button", { name: /엔트리 해제/ }), removed, "A second tap must not remove the next Pokémon");
  await base.close(modal);

  const pc = await base.open("포켓몬 7", /보유 포켓몬/);
  await base.use(pc.locator('[data-install-pick="mon-7"]'));
  const final = [...removed, "mon-7"];
  await repeatAt(pc.getByRole("button", { name: "엔트리 등록", exact: true }), final, "A second tap must not undo PC registration");
  await base.close(pc);
  const saved = await base.read();
  assert.equal(saved.energy, 5);
  assert.equal(saved.resources.gold, 12);
  await page.reload();
  await base.open("엔트리", /전투 엔트리 편성/);
  assert.deepEqual(await base.read(), saved);
  await page.close();
}

async function verifyDuplicateDeparture(touch) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  await page.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const pokemon = records.find(record => record.pokemonRowid === 65);
    const researcher = { pokemon, exp: 0, favFloor: 20, favCeil: 85, aptitude: 50, iv: {}, buildingId: "building-1", jobId: "research" };
    localStorage.setItem(key, JSON.stringify({ v: 4, energy: 5, resources: { healItem: 1 }, introPending: false,
      roster: [{ ...researcher, id: "mon-1", level: 4, favor: 20, heldItem: "focus_sash" },
        { ...researcher, id: "mon-2", level: 7, favor: 22 }], entryOrder: ["mon-1", "mon-2"], nextMemberId: 3,
      buildings: [{ id: "building-1", type: "dojo", plotIndex: 0, status: "active", remainingTurns: 0 }] }));
  }, saveKey);
  await page.reload();
  const turn = page.locator("#nextTurn");
  const warning = page.locator("#base-departure-warning");
  await turn.waitFor();
  await warning.getByText("이탈 경고까지 1턴 · 후딘 2번", { exact: true }).waitFor();
  assert.deepEqual(await turn.evaluate(button => (button.getAttribute("aria-describedby") ?? "").split(/\s+/)
    .filter(id => id && !document.getElementById(id))), [], "Turn descriptions must point to visible notices");

  await base.turn();
  const warned = await base.read();
  await warning.getByText("다음 턴 이탈 예정 · 후딘 2번", { exact: true }).waitFor();
  assert.match(await turn.getAttribute("aria-describedby"), /base-departure-warning/);
  await page.reload();
  await warning.getByText("다음 턴 이탈 예정 · 후딘 2번", { exact: true }).waitFor();
  const pc = await base.open("우호도 관리", /보유 포켓몬/);
  await pc.getByRole("heading", { name: "후딘 2번 Lv.7", exact: true }).waitFor();
  assert.equal(await pc.locator('[data-install-pick="mon-2"]').getAttribute("aria-pressed"), "true");
  await base.close(pc);
  const turnLog = await base.open(/턴 기록/, "턴 기록");
  await turnLog.getByText(/육성 연구 · 후딘 1번 · 경험치 사탕/).waitFor();
  await turnLog.getByText(/육성 연구 · 후딘 2번 · 경험치 사탕/).waitFor();
  await turnLog.getByText("후딘 2번 · 우호도 하한 · 다음 턴 이탈 예정", { exact: true }).waitFor();
  await turnLog.getByText("후딘 1번 · 기합의띠로 이탈 방지", { exact: true }).waitFor();
  await base.close(turnLog);
  assert.deepEqual(await base.read(), warned);

  await base.use(base.button("우호도 관리"));
  await base.use(base.button("회복 아이템 사용", pc));
  await base.close(pc);
  const saved = await base.read();
  assert.deepEqual(saved.roster.map(member => member.favor), [20, 35]);
  assert.equal(saved.resources.healItem, 0);
  await warning.waitFor({ state: "hidden" });

  // Restore the same warned checkpoint to verify the alternative without recovery.
  await page.evaluate(({ key, snapshot }) => localStorage.setItem(key, JSON.stringify(snapshot)), { key: saveKey, snapshot: warned });
  await page.reload();
  await base.turn();
  const departed = await base.read();
  assert.deepEqual(departed.roster.map(member => member.id), ["mon-1"]);
  assert.deepEqual(departed.entryOrder, ["mon-1"]);
  await page.reload();
  const departureLog = await base.open(/턴 기록/, "턴 기록");
  await departureLog.getByText("후딘 2번 · 우호도 하한 · 이탈", { exact: true }).waitFor();
  assert.deepEqual(await base.read(), departed);
  await page.close();
}

async function verifyDuplicateWorkers(touch) {
  const page = await openProfile({ touch });
  const base = baseControls(page, touch);
  await page.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [65, 65, 445, 445].map((pokemonRowid, index) => ({
      id: `mon-${index + 1}`, pokemon: records.find(pokemon => pokemon.pokemonRowid === pokemonRowid),
      level: [1, 8, 1, 6][index], exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
      ...(index === 0 ? { buildingId: "building-1", jobId: "research", jobOrder: 1 } : {}),
    }));
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, energy: 5, resources: { items: { choice_band: 1 } },
      plotCap: 2, introPending: false, nextMemberId: 5, nextBuildingId: 2,
      buildings: [{ id: "building-1", type: "dojo", plotIndex: 0, status: "active", remainingTurns: 0 }] }));
  }, saveKey);
  await page.reload();
  let dialog = await base.tools();
  const equipment = dialog.getByLabel("장착할 포켓몬");
  const workerLabel = "후딘 2번 · Lv.8";
  assert.equal(await equipment.locator("option").filter({ hasText: workerLabel }).count(), 1,
    "같은 종의 도구 장착 대상에 PC의 개체 번호가 표시되어야 합니다.");
  await equipment.selectOption({ label: workerLabel });
  await base.use(base.button("장착", dialog.locator("li", { hasText: "구애머리띠" })));
  await base.close(dialog);
  const equipped = await base.read();
  assert.equal(equipped.roster[1].heldItem, "choice_band");
  assert.equal(equipped.roster[0].heldItem ?? null, null);
  assert.equal(equipped.resources.items.choice_band, 0);
  assert.equal(equipped.energy, 5);

  dialog = await base.open("1번 부지 훈련소 관리", "훈련소 · 1번 부지");
  await base.use(dialog.getByRole("group", { name: "시설 직무" }).getByRole("button", { name: /육성 연구/ }));
  await base.use(dialog.getByRole("button", { name: "후딘 2번 Lv.8", exact: true }));
  await dialog.getByText(/특수능력 50\/100.*구애머리띠/).waitFor();
  await dialog.getByText("후보 기본 산출 2.16 · 다음 턴 2개 · 소수점 이월", { exact: true }).waitFor();
  await base.use(base.button("직무 배치 · 행동력 1", dialog));
  await dialog.getByRole("button", { name: "후딘 2번 회수", exact: true }).waitFor();
  await base.use(dialog.getByRole("button", { name: "후딘 1번 회수", exact: true }));
  await base.close(dialog);
  const staffed = await base.read();
  assert.deepEqual(staffed.roster.map(member => member.jobId ?? null), [null, "research", null, null]);
  assert.equal(staffed.energy, 4);

  dialog = await base.open("2번 부지 건설", "건설 · 2번 부지");
  await base.use(dialog.getByRole("button", { name: "한카리아스 1번 Lv.1", exact: true }));
  await base.use(dialog.getByRole("button", { name: "한카리아스 2번 Lv.6", exact: true }));
  await base.use(dialog.locator("[data-build-confirm]"));
  dialog = await base.open(/밭 공사 관리/, "밭 · 공사 관리");
  await base.use(dialog.getByRole("button", { name: "한카리아스 2번 회수", exact: true }));
  await base.close(dialog);
  assert.equal((await base.read()).roster[2].buildingId, "building-2");

  dialog = await base.open("3번 미개척 부지", "땅 평탄화 · 3번 부지");
  assert.equal(await dialog.locator("[data-install-pick]").count(), 1);
  const unavailable = dialog.getByText("현재 배치할 수 없는 포켓몬 1마리", { exact: true });
  await base.use(unavailable);
  await dialog.getByText("한카리아스 1번 · 본거지 2번 부지 공사 중", { exact: true }).waitFor();
  await base.use(dialog.getByRole("button", { name: "한카리아스 2번 Lv.6", exact: true }));
  await base.use(base.button("땅 평탄화 시작", dialog));
  await dialog.getByText(/한카리아스 2번 작업 중/).waitFor();
  await base.close(dialog);
  const queued = await base.read();
  assert.equal(queued.clearing.memberId, "mon-4");
  assert.equal(queued.energy, 2);
  await page.reload();
  await base.button("포켓몬 4").waitFor();
  assert.deepEqual(await base.read(), queued);
  await base.turn();
  const completed = await base.read();
  assert.equal(completed.plotCap, 3);
  assert.equal(completed.clearing, null);
  assert.equal(completed.resources.candy - queued.resources.candy, 2);
  await page.close();
}

async function verifyLegacyResearchStaff() {
  const page = await openProfile({ touch: true });
  const base = baseControls(page, true);
  await page.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [63, 96, 124, 280, 605].map((pokemonRowid, index) => ({
      id: `mon-${index + 1}`, pokemon: records.find(pokemon => pokemon.pokemonRowid === pokemonRowid),
      level: 1, exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: index === 0 ? 90 : 50, iv: {},
      ...(index < 4 ? { buildingId: "building-1", jobId: "research", jobOrder: index + 1 } : {}),
    }));
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, energy: 5, plotCap: 1, introPending: false,
      resources: { candy: 0 }, nextBuildingId: 2, nextMemberId: 6,
      buildings: [{ id: "building-1", type: "dojo", plotIndex: 0, status: "active", remainingTurns: 0 }] }));
  }, saveKey);
  await page.reload();
  const staff = state => state.roster.filter(member => member.buildingId === "building-1" && member.jobId === "research").map(member => member.id);
  const original = ["mon-1", "mon-2", "mon-3", "mon-4"];
  const openDojo = () => base.open("1번 부지 훈련소 관리", "훈련소 · 1번 부지");
  const observe = (dialog, count) => dialog.getByRole("status").getByText(`육성 연구 ${count}/3마리`, { exact: true }).waitFor();
  const checkFull = async (dialog, count) => {
    await observe(dialog, count);
    await base.use(base.button(/육성 연구/, dialog));
    await base.use(dialog.locator('[data-install-pick="mon-5"]'));
    assert.ok(await base.button("직무 배치 · 행동력 1", dialog).isDisabled());
  };

  let current = await base.read();
  for (let turn = 0; turn < 2; turn++) {
    const expected = [5, 4][turn];
    if (turn === 1) await page.reload();
    const dialog = await openDojo();
    assert.deepEqual(staff(await base.read()), original);
    await checkFull(dialog, 4);
    const forecasts = await dialog.getByText(/경험치 사탕 \+\d+ \/ 최대 \d+/).allTextContents();
    assert.equal(forecasts.length, 4);
    assert.equal(forecasts.reduce((sum, line) => sum + Number(line.match(/\+(\d+)/)[1]), 0), expected);
    await base.close(dialog);
    await base.turn();
    const next = await base.read();
    assert.deepEqual(staff(next), original);
    assert.equal(next.resources.candy - current.resources.candy, expected);
    current = next;
  }
  const dialog = await openDojo();
  const names = new Map(current.roster.map(member => [member.id, member.pokemon.nameKr]));
  await base.use(base.button(`${names.get("mon-4")} 회수`, dialog));
  await checkFull(dialog, 3);
  assert.deepEqual(staff(await base.read()), original.slice(0, 3));
  await base.use(base.button(`${names.get("mon-3")} 회수`, dialog));
  await observe(dialog, 2);
  assert.equal((await base.read()).energy, current.energy);
  await base.assign(dialog, "육성 연구", "mon-5", 1);
  await observe(dialog, 3);
  const reassigned = await base.read();
  assert.deepEqual(staff(reassigned), ["mon-1", "mon-2", "mon-5"]);
  assert.equal(reassigned.energy, current.energy - 1);
  await page.close();
  console.log("Research staffing Chrome smoke passed: v4 and reload preserve 4 researchers and settle 5 then 4 candies; admit at 2, block at 3");
}

async function verifySharedStaffing() {
  const page = await openProfile({ touch: true });
  await page.setViewportSize({ width: 320, height: 640 });
  const base = baseControls(page, true);
  const mapSnapshot = worldMapNodes.map(({ id, region }) => ({
    id, active: region <= 2, owner: region === 1 || id === "nw-01" ? "player" : "unoccupied", scouted: true, trainerId: null,
  }));
  await page.evaluate(async ({ key, mapSnapshot }) => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [54, 7, 4, 1].map((id, index) => ({
      id: `mon-${index + 1}`, pokemon: records.find(mon => mon.pokemonRowid === id),
      level: 1, exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
      ...(index === 1 ? { buildingId: "building-3", jobId: "fruit" } : {}),
      ...(index === 2 ? { buildingId: "building-2", jobId: "cook" } : {}),
    }));
    const buildings = [
      { id: "building-1", type: "farm", plotIndex: 0 },
      { id: "building-2", type: "restaurant", plotIndex: 1 },
      { id: "building-3", type: "farm", plotIndex: 0, siteId: "nw-01" },
    ].map(item => ({ ...item, status: "active", remainingTurns: 0 }));
    localStorage.setItem(key, JSON.stringify({ v: 4, roster, energy: 5, plotCap: 2, storageCap: 50,
      resources: { seed: 1, fruit: 0, food: 0 }, nextMemberId: 5, buildings, mapSnapshot }));
  }, { key: saveKey, mapSnapshot });
  await page.reload();
  const openFarm = () => base.open("1번 부지 밭 관리", "밭 · 1번 부지");
  let farm = await openFarm();
  const before = await base.read();
  await base.use(base.button(/열매 재배/, farm));
  await base.use(farm.locator('[data-install-pick="mon-1"]'));
  const stock = farm.getByRole("group", { name: "다음 턴 공동 재고" });
  await stock.getByText("배치 전후 차이 없음", { exact: true }).waitFor({ timeout: 4000 });
  const otherFacilities = farm.locator("details").filter({ hasText: /함께 바뀌는 시설/ });
  await base.use(otherFacilities.getByText("함께 바뀌는 시설 1곳", { exact: true }));
  await otherFacilities.getByText("북서 1거점 · 밭 · 1번 부지", { exact: true }).waitFor();
  await otherFacilities.getByText(/열매 산출 1 → 0/).waitFor();
  await base.close(farm);
  assert.deepEqual(await base.read(), before);

  farm = await openFarm();
  await base.use(farm.locator('[data-install-pick="mon-4"]'));
  for (const change of [/씨앗 0 → 2/, /열매 1 → 0/, /음식 0 → 1/]) await stock.getByText(change).waitFor();
  await base.use(otherFacilities.getByText("함께 바뀌는 시설 2곳", { exact: true }));
  await otherFacilities.getByText("본거지 · 레스토랑 · 2번 부지", { exact: true }).waitFor();
  await otherFacilities.getByText(/음식 산출 0 → 1/).waitFor();
  await otherFacilities.getByText(/열매 산출 1 → 2/).waitFor();
  assert.ok(await farm.evaluate(element => element.scrollWidth <= element.clientWidth));
  await base.use(base.button("직무 배치 · 행동력 1", farm));
  await base.close(farm);
  assert.equal((await base.read()).energy, before.energy - 1);
  await base.turn();
  const after = await base.read();
  assert.equal(after.resources.seed, 2);
  assert.equal(after.resources.fruit, 0);
  assert.equal(after.resources.food, 1);
  await page.reload();
  await base.button("1번 부지 밭 관리").waitFor();
  assert.deepEqual(await base.read(), after);
  await page.close();
  console.log("Shared staffing Chrome smoke passed: seed priority, outpost and kitchen forecasts, recorded stock and reload");
}

async function verifyRecoveryCharge(touch) {
  const page = await openProfile({ touch });
  if (touch) await page.setViewportSize({ width: 320, height: 568 });
  const base = baseControls(page, touch);
  const item = touch ? "healItem" : "food";
  const actionName = touch ? "회복 아이템 사용" : "음식 주기";
  await page.evaluate(async ({ key, item }) => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [976, 194].map((id, index) => ({
      id: `mon-${index + 1}`, pokemon: records.find(record => record.pokemonRowid === id),
      level: 1, exp: 0, favor: 18, favFloor: 18, favCeil: 75, aptitude: 50, iv: {}, departurePending: true,
    }));
    localStorage.setItem(key, JSON.stringify({ v: 4, introPending: false, roster, nextMemberId: 3,
      entryOrder: roster.map(member => member.id), energy: 0, resources: { gold: 5, [item]: 2 } }));
  }, { key: saveKey, item });
  await page.reload();
  await base.button("포켓몬 2").waitFor();
  const before = await base.read();
  const openRecovery = () => base.open("우호도 관리", /보유 포켓몬/);
  const dialog = await openRecovery();
  const action = base.button(actionName, dialog);
  await dialog.getByRole("heading", { name: "가비루사 Lv.1", exact: true }).waitFor();
  assert.ok(await action.isDisabled());
  const charge = base.button(/충전권 구매.*자금 5.*행동력 \+2/, dialog);
  await charge.waitFor({ timeout: 3000 });
  let focusChecked = false;
  const charged = async () => {
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).energy === 2, saveKey);
    if (!focusChecked) {
      await page.waitForFunction(item => document.activeElement?.getAttribute("data-growth-item") === item, item);
      focusChecked = true;
    }
  };
  await repeatActivation(page, charge, touch, charged, touch);
  assert.deepEqual(await base.read(), { ...before, energy: 2, resources: { ...before.resources, gold: 0 } });
  await base.use(action);
  const afterFirstRecovery = await base.read();
  assert.deepEqual(afterFirstRecovery.roster.map(member => member.favor), [33, 18]);
  const nextDeparture = base.button("다음 이탈 예정 · 우파", dialog);
  await nextDeparture.waitFor({ timeout: 3000 });
  const target = dialog.getByText("회복 대상 · 우파", { exact: true });
  let targetFocusChecked = false;
  await repeatActivation(page, nextDeparture, touch, async () => {
    await target.waitFor();
    if (!targetFocusChecked) {
      assert.ok(await target.evaluate(element => element === document.activeElement));
      targetFocusChecked = true;
    }
  }, touch);
  assert.deepEqual(await base.read(), afterFirstRecovery);
  await base.use(action);
  assert.equal(await base.button(/다음 이탈 예정 ·/, dialog).count(), 0);
  await base.close(dialog);
  const recovered = await base.read();
  assert.deepEqual(recovered.roster.map(member => member.favor), [33, 33]);
  assert.equal(recovered.resources[item], 0);
  assert.equal(recovered.energy, 0);
  assert.equal(recovered.turnCount, before.turnCount);
  await page.reload();
  await base.button("포켓몬 2").waitFor();
  assert.deepEqual(await base.read(), recovered);
  await base.turn();
  assert.deepEqual((await base.read()).entryOrder, before.entryOrder);

  async function restore(resources) {
    await page.evaluate(({ key, before, resources }) => localStorage.setItem(key, JSON.stringify({ ...before, resources })),
      { key: saveKey, before, resources });
    await page.reload();
    return openRecovery();
  }
  const noGold = await restore({ ...before.resources, gold: 4, candy: 1 });
  assert.equal(await base.button(/충전권 구매/, noGold).count(), 0);
  await noGold.getByText("행동력이 부족합니다. 충전권 구매에 자금 5가 필요합니다.", { exact: true }).waitFor();
  await base.close(noGold);
  const noItems = await restore({ ...before.resources, [item]: 0 });
  assert.equal(await base.button(/충전권 구매/, noItems).count(), 0);
  assert.ok(await base.button(actionName, noItems).isDisabled());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await page.close();
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  await verifyRecoveryCharge(true);
  await verifyRecoveryCharge(false);
  console.log("Recovery charge Chrome passed: zero candy, manual treatment of two imminent departures, no duplicate purchase, reload");
  await verifyRepeatedOrders(true);
  await verifyRepeatedOrders(false);
  await verifyRepeatedOrders(true, true);
  await verifyRepeatedOrders(false, true);
  console.log("Base repeat Chrome passed: one charge, one turn, production once, departure warning restored before a separate turn");
  await verifyRepeatedInventoryActions(true);
  await verifyRepeatedInventoryActions(false);
  await verifyRepeatedInventoryActions(true, true);
  await verifyRepeatedInventoryActions(false, true);
  console.log("Inventory repeat Chrome passed: one candy, recovery and craft per input, separate use still works and restores");
  await verifyDuplicateWorkers(true);
  await verifyDuplicateWorkers(false);
  console.log("Duplicate worker Chrome passed: named construction, recall, tool, research, clearing, and reload");
  await verifyRosterSearch(true);
  await verifyRosterSearch(false);
  console.log("PC search Chrome passed: 25 members, name and dual type, same-species recovery and candy, and entry with a restored save");
  await verifyEntryPointerBurst(true);
  await verifyEntryPointerBurst(false);
  console.log("Entry pointer Chrome passed: registration, reorder, removal, full party and reload");
  await verifyDuplicateDeparture(true);
  await verifyDuplicateDeparture(false);
  console.log("Duplicate departure Chrome passed: named warning, targeted recovery, turn log and reload");
  const page = await openProfile();
  const fresh = baseControls(page, false);
  for (let round = 1; round <= 3; round++) {
    await page.getByRole("heading", { name: `동료 영입 ${round - 1}/3` }).waitFor();
    await fresh.use(page.locator("[data-draft-target]").first());
  }
  await fresh.use(fresh.button("본거지로 이동"));
  const initial = await fresh.read();
  const starters = initial.roster.map(member => member.id);
  assert.ok(initial.roster.every(member => ![member.pokemon.type1Rowid, member.pokemon.type2Rowid].some(type => type === 5 || type === 14)));
  await fresh.build(1, "훈련소", starters, true);
  assert.equal((await fresh.read()).buildings.length, 1);
  assert.equal((await fresh.read()).energy, 4);
  let dialog = await fresh.open(/공사 관리/, "훈련소 · 공사 관리");
  await fresh.use(fresh.button("공사 취소", dialog));
  await fresh.button("1번 부지 건설").waitFor();
  assert.equal((await fresh.read()).energy, 4);
  assert.ok((await fresh.read()).roster.every(member => !member.buildingId));
  await fresh.build(1, "훈련소", starters.slice(0, 1));
  dialog = await fresh.open(/공사 관리/, "훈련소 · 공사 관리");
  await fresh.use(fresh.button("회수", dialog));
  await dialog.getByText(/일시정지/).waitFor();
  await fresh.close(dialog);
  await fresh.turn();
  await page.reload();
  dialog = await fresh.open(/공사 관리/, "훈련소 · 공사 관리");
  await dialog.getByText(/3턴 남음.*일시정지/).waitFor();
  for (const id of starters) await fresh.use(dialog.locator(`[data-install-pick="${id}"]`));
  await fresh.use(fresh.button("추가 배치", dialog));
  await dialog.getByText(/3마리 배치 · 1턴 남음/).waitFor();
  await fresh.close(dialog);
  await fresh.turn();
  dialog = await fresh.open("1번 부지 훈련소 관리", "훈련소 · 1번 부지");
  await fresh.use(fresh.button(/육성 연구/, dialog));
  const psychic = await fresh.capture(dialog, /에스퍼 타입 탐색/);
  assert.ok([psychic.pokemon.type1Rowid, psychic.pokemon.type2Rowid].includes(14));
  dialog = await fresh.open("1번 부지 훈련소 관리", "훈련소 · 1번 부지");
  await fresh.assign(dialog, "육성 연구", psychic.id, 1, true);
  await dialog.getByText(/경험치 사탕 \+1 \/ 최대 1/).waitFor();
  assert.equal((await fresh.read()).energy, 2);
  await fresh.close(dialog);
  await fresh.turn();
  dialog = await fresh.open(/포켓몬 \d/, /보유 포켓몬/);
  await fresh.use(dialog.locator(`[data-install-pick="${psychic.id}"]`));
  await dialog.getByText(/경험치 사탕 \+0 \/ 최대 0.*기본 산출/).waitFor();
  await fresh.button("사탕 먹이기", dialog).evaluate(element => { element.click(); element.click(); });
  await dialog.getByRole("heading", { name: /Lv\.2/ }).waitFor();
  assert.equal((await fresh.read()).energy, 4);
  assert.equal((await fresh.read()).resources.candy, 0);
  assert.ok(await fresh.button("사탕 먹이기", dialog).isDisabled());
  await fresh.close(dialog);
  const ground = await fresh.capture(await fresh.open("2번 미개척 부지", /땅 평탄화/), /땅 타입 탐색/);
  dialog = await fresh.open("2번 미개척 부지", /땅 평탄화/);
  await fresh.use(dialog.locator(`[data-install-pick="${ground.id}"]`));
  await fresh.button("땅 평탄화 시작", dialog).evaluate(element => { element.click(); element.click(); });
  await dialog.getByText(/다음 턴에 개척 완료/).waitFor();
  await page.reload();
  await page.getByText("개척 중", { exact: true }).waitFor();
  assert.equal((await fresh.read()).energy, 1);
  assert.equal((await fresh.read()).roster.find(member => member.id === psychic.id).level, 2);
  await fresh.turn();
  assert.equal((await fresh.read()).plotCap, 2);
  assert.equal((await fresh.read()).clearing, null);
  await fresh.build(2, "치료소", [ground.id]);
  dialog = await fresh.open("1번 부지 훈련소 관리", "훈련소 · 1번 부지");
  await fresh.use(fresh.button(/육성 연구/, dialog));
  const beforeRecruitment = await fresh.read();
  assert.ok(await fresh.button(/에스퍼 타입 탐색/, dialog).count(), "A staffed job can still search for its type");
  const reinforcement = await fresh.capture(dialog, /에스퍼 타입 탐색/);
  const withReinforcement = await fresh.read();
  assert.ok([reinforcement.pokemon.type1Rowid, reinforcement.pokemon.type2Rowid].includes(14));
  assert.equal(withReinforcement.energy, beforeRecruitment.energy - 2);
  assert.equal(withReinforcement.roster.find(member => member.id === psychic.id).jobId, "research");
  for (let turn = 0; turn < 3; turn++) await fresh.turn();
  dialog = await fresh.open("2번 부지 치료소 관리", "치료소 · 2번 부지");
  await fresh.use(fresh.button(/회복 아이템 생산/, dialog));
  const medic = await fresh.capture(dialog, /페어리 타입 탐색/);
  dialog = await fresh.open("2번 부지 치료소 관리", "치료소 · 2번 부지");
  await fresh.assign(dialog, "회복 아이템 생산", medic.id, 1);
  await fresh.close(dialog);

  const tracked = initial.roster.reduce((soonest, member) =>
    member.favor - member.favFloor < soonest.favor - soonest.favFloor ? member : soonest);
  const warningTurn = Math.ceil((tracked.favor - tracked.favFloor) / 2);
  let sawEarlyWarning = false;
  for (let turn = (await fresh.read()).turnCount; turn < warningTurn; turn++) {
    sawEarlyWarning ||= await page.getByText(/이탈 경고까지 [1-5]턴/).isVisible();
    if (turn === warningTurn - 5) {
      dialog = await fresh.open(/포켓몬 \d/, /보유 포켓몬/);
      const trackedCard = dialog.locator(`[data-install-pick="${tracked.id}"]`);
      await trackedCard.getByText("5턴 뒤 경고", { exact: true }).waitFor();
      await fresh.use(trackedCard);
      await dialog.getByText(/이탈 경고까지 5턴/).waitFor();
      await fresh.close(dialog);
    }
    await fresh.turn();
  }
  assert.ok(sawEarlyWarning, "The base shows an early warning when no departure is imminent");
  let freshSave = await fresh.read();
  assert.ok(freshSave.roster.find(member => member.id === tracked.id).departurePending);
  assert.ok(freshSave.resources.healItem > 0);
  dialog = await fresh.open("우호도 관리", /보유 포켓몬/);
  await fresh.use(dialog.locator(`[data-install-pick="${tracked.id}"]`));
  await fresh.use(fresh.button("회복 아이템 사용", dialog));
  await fresh.close(dialog);
  await fresh.turn();
  freshSave = await fresh.read();
  assert.equal(freshSave.roster.find(member => member.id === tracked.id).favor, tracked.favFloor + 13);
  await page.close();

  const mobile = await openProfile({ touch: true });
  const legacy = baseControls(mobile, true);
  await mobile.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [1, 63, 27, 81, 74].map(pokemonRowid => ({
      pokemon: records.find(pokemon => pokemon.pokemonRowid === pokemonRowid),
      level: 1, exp: 0, favor: 70, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
      building: pokemonRowid === 1 ? "farm" : null, job: pokemonRowid === 1 ? "seed" : null,
    }));
    localStorage.setItem(key, JSON.stringify({ v: 1, roster, underConstruction: { dojo: 2 }, plotCap: 2, energy: 3,
      storageCap: 5, resources: { seed: 5, tool: 3, gold: 5, items: { lucky_egg: 1 } } }));
  }, saveKey);
  await mobile.reload();
  const first = await legacy.open("1번 부지 밭 관리", "밭 · 1번 부지");
  await first.getByText(/씨앗 \+0.*저장 공간 부족/).waitFor();
  await legacy.close(first);
  dialog = await legacy.open(/공사 관리/, "훈련소 · 공사 관리");
  await dialog.getByText(/0마리 배치 · 2턴 남음.*일시정지/).waitFor();
  await legacy.use(legacy.button("공사 취소", dialog));
  assert.equal((await legacy.read()).energy, 3);
  await legacy.build(2, "훈련소", ["mon-2", "mon-3", "mon-4"]);
  await legacy.turn();
  dialog = await legacy.open("2번 부지 훈련소 관리", "훈련소 · 2번 부지");
  await legacy.assign(dialog, "육성 연구", "mon-2", 0);
  await legacy.close(dialog);
  await legacy.turn();
  dialog = await legacy.tools("mon-2");
  const egg = dialog.locator("li", { hasText: "행복의알" });
  await legacy.use(legacy.button("장착", egg));
  await legacy.close(dialog);
  dialog = await legacy.open(/포켓몬 \d/, /보유 포켓몬/);
  await legacy.use(dialog.locator('[data-install-pick="mon-2"]'));
  await legacy.use(legacy.button("사탕 먹이기", dialog));
  assert.equal(await dialog.locator(".base-partner-summary dl > div").filter({ hasText: "경험치" }).locator("dd").textContent(), "20/40");
  await legacy.close(dialog);
  dialog = await legacy.tools("mon-2");
  const band = dialog.locator("li", { hasText: "구애머리띠" });
  await legacy.button("제작 3", band).evaluate(element => { element.click(); element.click(); });
  await legacy.use(legacy.button("장착", band));
  assert.ok(await legacy.button("장착 중", band).isDisabled());
  assert.deepEqual((await legacy.read()).resources.items, { lucky_egg: 1, choice_band: 0 });
  await legacy.close(dialog);
  dialog = await legacy.open("상점", /상점/);
  await legacy.button("구매", dialog).evaluate(element => { element.click(); element.click(); });
  assert.equal((await legacy.read()).resources.gold, 0);
  assert.ok(await legacy.button("구매", dialog).isDisabled());
  await legacy.close(dialog);
  dialog = await legacy.open("2번 부지 훈련소 관리", "훈련소 · 2번 부지");
  await legacy.use(legacy.button("모래두지 회수", dialog));
  await legacy.use(legacy.button("코일 회수", dialog));
  await legacy.close(dialog);
  dialog = await legacy.open("3번 미개척 부지", /땅 평탄화/);
  await legacy.use(dialog.locator('[data-install-pick="mon-3"]'));
  await legacy.use(legacy.button("땅 평탄화 시작", dialog));
  await legacy.close(dialog);
  await legacy.turn();
  await legacy.build(3, "제작소", ["mon-3", "mon-4"]);
  await legacy.turn();
  await legacy.turn();
  dialog = await legacy.open("3번 부지 제작소 관리", "제작소 · 3번 부지");
  await legacy.assign(dialog, "부품 제작", "mon-4", 0);
  await dialog.getByText(/부품 \+0.*재료 부족/).waitFor();
  assert.equal((await legacy.read()).resources.seed, 5);
  assert.equal((await legacy.read()).resources.tool, 0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await mobile.reload();
  dialog = await legacy.open("3번 부지 제작소 관리", "제작소 · 3번 부지");
  await dialog.getByText(/부품 \+0.*재료 부족/).waitFor();
  await legacy.assign(dialog, "재료 채취", "mon-5", 1);
  await dialog.getByText(/부품 \+1 \/ 최대 1/).waitFor();
  await legacy.close(dialog);
  for (let turn = 0; turn < 3; turn++) await legacy.turn();
  assert.equal((await legacy.read()).resources.tool, 3);

  await mobile.setViewportSize({ width: 320, height: 640 });
  const toolReady = legacy.button("자원").getByText("제작 1개", { exact: true });
  await toolReady.waitFor({ timeout: 3000 });
  dialog = await legacy.tools();
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  await dialog.getByText("보유 부품 3개 · 도구 1개 제작 가능 · 다음 턴 부품 +1", { exact: true }).waitFor({ timeout: 3000 });
  const coin = dialog.locator("li", { hasText: "부적금화" });
  await legacy.use(legacy.button("제작 3", coin));
  await coin.getByText(/보관 1/).waitFor();
  assert.equal((await legacy.read()).resources.tool, 0);
  assert.ok(await legacy.button("제작 3", coin).isDisabled());
  await dialog.getByText("보유 부품 0개 · 제작까지 부품 3개 부족 · 다음 턴 부품 +1", { exact: true }).waitFor();
  await legacy.close(dialog);
  await toolReady.waitFor({ state: "hidden" });
  await legacy.turn();
  assert.equal((await legacy.read()).resources.tool, 1);
  dialog = await legacy.tools();
  const updatedParts = await dialog.locator(".base-held-items [aria-live]").textContent();
  const nextParts = updatedParts.match(/^보유 부품 1개 · 제작까지 부품 2개 부족 · 다음 턴 부품 \+(\d+)$/);
  assert.ok(nextParts, updatedParts);
  await legacy.close(dialog);
  await legacy.turn();
  assert.equal((await legacy.read()).resources.tool, 1 + Number(nextParts[1]));
  for (let turn = 0; (await legacy.read()).resources.tool < 3; turn++) {
    assert.ok(turn < 4, "The staffed workshop should refill the crafting badge");
    await legacy.turn();
  }
  await toolReady.waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 320);
  await mobile.reload();
  await toolReady.waitFor();

  await mobile.evaluate(async key => {
    const records = await fetch("/data/pokemon.json").then(response => response.json());
    const roster = [1, 10, 4].map((pokemonRowid, index) => ({
      id: `mon-${11 + index}`, pokemon: records.find(pokemon => pokemon.pokemonRowid === pokemonRowid),
      level: 1, exp: 0, favor: 20, favFloor: 20, favCeil: 85, aptitude: 50, iv: {},
      ...(index === 0 ? { buildingId: "building-1", jobId: "seed", heldItem: "choice_band" } : {}),
    }));
    localStorage.setItem(key, JSON.stringify({ v: 3, roster, entryOrder: roster.map(member => member.id),
      nextMemberId: 14, resources: { tool: 3, healItem: 1, items: { soothe_bell: 1 } },
      buildings: [{ id: "building-1", type: "farm", plotIndex: 0, status: "active", remainingTurns: 0 }] }));
  }, saveKey);
  await mobile.reload();
  await legacy.button("포켓몬 3").waitFor();
  assert.deepEqual((await legacy.read()).roster.map(member => member.departurePending), [undefined, undefined, undefined]);
  await legacy.turn();
  await mobile.getByText("다음 턴 이탈 예정 · 이상해씨 외 2마리", { exact: true }).waitFor();
  await mobile.reload();
  const nextTurnNotice = mobile.getByRole("region", { name: "다음 턴 경고" });
  const nextTurnAction = mobile.getByRole("button", { name: "다음 턴", exact: true });
  await nextTurnNotice.getByText("다음 턴 이탈 예정 · 이상해씨 외 2마리", { exact: true }).waitFor();
  assert.ok(await nextTurnNotice.getByRole("button", { name: "우호도 관리" }).evaluate(button => {
    const { top, bottom, height } = button.getBoundingClientRect();
    return top >= 0 && bottom <= innerHeight && height >= 44;
  }));
  const noticePosition = await nextTurnNotice.boundingBox();
  const actionPosition = await nextTurnAction.boundingBox();
  assert.ok(noticePosition.y - (actionPosition.y + actionPosition.height) <= 32);
  assert.ok((await nextTurnAction.getAttribute("aria-describedby")).split(/\s+/).includes("base-departure-warning"));
  dialog = await legacy.open("우호도 관리", /보유 포켓몬/);
  await dialog.getByRole("heading", { name: "이상해씨 Lv.1" }).waitFor();
  await dialog.getByText(/다음 턴 이탈 예정/).waitFor();
  const pick = dialog.getByRole("group", { name: "동료 선택" });
  assert.equal(await pick.getByText("다음 턴 이탈", { exact: true }).count(), 3);
  await legacy.close(dialog);
  dialog = await legacy.tools("mon-12");
  const sash = dialog.locator("li", { hasText: "기합의띠" });
  await legacy.use(legacy.button("제작 3", sash));
  await legacy.use(legacy.button("장착", sash));
  await legacy.close(dialog);
  dialog = await legacy.open("우호도 관리", /보유 포켓몬/);
  const cards = pick.locator("[data-install-pick]");
  const order = () => cards.evaluateAll(buttons => buttons.map(button => button.dataset.installPick));
  assert.deepEqual(await order(), ["mon-11", "mon-13", "mon-12"]);
  assert.equal(await pick.getByText("다음 턴 이탈", { exact: true }).count(), 2);
  await legacy.use(pick.getByRole("button", { name: "캐터피", exact: true }));
  await dialog.getByText("기합의띠로 이탈 방지 중").waitFor();
  const threatenedCharmander = pick.getByRole("button", { name: "파이리 다음 턴 이탈", exact: true });
  assert.ok((await threatenedCharmander.boundingBox())?.height >= 44);
  await legacy.use(threatenedCharmander);
  const beforeRecovery = await legacy.read();
  await legacy.use(legacy.button("회복 아이템 사용", dialog));
  await pick.getByRole("button", { name: "파이리", exact: true, pressed: true }).waitFor();
  assert.equal(await pick.getByText("다음 턴 이탈", { exact: true }).count(), 1);
  assert.deepEqual(await order(), ["mon-11", "mon-12", "mon-13"]);
  const afterRecovery = await legacy.read();
  assert.equal(afterRecovery.energy, beforeRecovery.energy - 1);
  assert.equal(afterRecovery.resources.healItem, beforeRecovery.resources.healItem - 1);
  assert.deepEqual(afterRecovery.roster.map(member => member.id), beforeRecovery.roster.map(member => member.id));
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await legacy.close(dialog);
  await mobile.getByText("다음 턴 이탈 예정 · 이상해씨", { exact: true }).waitFor();
  await nextTurnNotice.getByText("다음 턴 이탈 예정 · 이상해씨", { exact: true }).waitFor();
  const beforeDeparture = await legacy.read();
  await legacy.turn();
  assert.equal(await nextTurnNotice.count(), 0);
  let departureSave = await legacy.read();
  assert.deepEqual(departureSave.roster.map(member => [member.id, member.favor, member.heldItem]),
    [["mon-12", 20, "focus_sash"], ["mon-13", 33, undefined]]);
  assert.deepEqual(departureSave.entryOrder, ["mon-12", "mon-13"]);
  assert.deepEqual(departureSave.caughtSpeciesIds, [1, 10, 4]);
  assert.ok(departureSave.resources.seed > beforeDeparture.resources.seed);
  const seedsAtDeparture = departureSave.resources.seed;
  assert.deepEqual(departureSave.resources.items, { soothe_bell: 1, focus_sash: 0, choice_band: 1 });
  dialog = await legacy.open(/턴 기록/, "턴 기록");
  await dialog.getByText("이상해씨 · 우호도 하한 · 이탈").waitFor();
  await dialog.getByText("캐터피 · 기합의띠로 이탈 방지").waitFor();
  await legacy.close(dialog);

  await mobile.reload();
  await legacy.turn();
  departureSave = await legacy.read();
  assert.equal(departureSave.roster[0].heldItem, "focus_sash");
  assert.equal(departureSave.resources.seed, seedsAtDeparture);
  dialog = await legacy.tools("mon-12");
  await legacy.use(legacy.button("장착", dialog.locator("li", { hasText: "평온의방울" })));
  await legacy.close(dialog);
  await legacy.turn();
  await mobile.getByText("다음 턴 이탈 예정 · 캐터피", { exact: true }).waitFor();
  await legacy.turn();
  await legacy.button("포켓몬 1").waitFor();

  for (let turn = 0; turn < 5; turn++) await legacy.turn();
  await legacy.button("포켓몬 0").waitFor();
  const emptyRoster = await legacy.read();
  assert.deepEqual(emptyRoster.entryOrder, []);
  assert.equal(emptyRoster.resources.items.focus_sash, 1);
  assert.equal(emptyRoster.resources.items.soothe_bell, 1);
  await mobile.reload();
  await legacy.button("포켓몬 0").waitFor();
  assert.deepEqual(await legacy.read(), emptyRoster);
  dialog = await legacy.open("포켓몬 0", /보유 포켓몬/);
  await dialog.getByText(/탐험에서 새 동료를 포획할 수 있습니다/).waitFor();
  await legacy.close(dialog);
  const replacement = await legacy.capture(mobile, /탐험 행동력 2/);
  assert.equal(replacement.id, "mon-14");
  assert.ok((await legacy.read()).caughtSpeciesIds.includes(1));
  console.log("Departure Chrome smoke passed: migrated warning, recovery, departure, reusable Focus Sash, empty save and recruitment");

  const recruited = await legacy.read();
  const candySave = { ...recruited, energy: 5, resources: { ...recruited.resources, gold: 10, candy: 5 },
    roster: [{ ...recruited.roster[0], level: 2, exp: 35, heldItem: "lucky_egg" }] };
  async function openCandySave(snapshot = candySave) {
    await mobile.evaluate(({ saveKey, snapshot }) => localStorage.setItem(saveKey, JSON.stringify(snapshot)), { saveKey, snapshot });
    await mobile.reload();
    return legacy.open("포켓몬 1", /보유 포켓몬/);
  }
  async function chooseAmount(candyDialog, count) {
    await legacy.use(candyDialog.getByText("사탕 여러 개 먹이기", { exact: true }));
    const quantity = candyDialog.getByRole("combobox", { name: "사탕 수량" });
    assert.equal(await quantity.inputValue(), "5");
    assert.deepEqual(await quantity.getByRole("option").allTextContents(), ["선택", "2개", "3개", "4개", "5개"]);
    assert.ok((await quantity.boundingBox())?.height >= 44);
    if (count !== 5) await quantity.selectOption(String(count));
    return quantity;
  }

  dialog = await openCandySave();
  const initialCandy = await legacy.read();
  await dialog.getByText("행복의알 장착 중 · 사탕 1개당 경험치 +40", { exact: true }).waitFor({ timeout: 3000 });
  await chooseAmount(dialog, 5);
  await dialog.getByText("행동력 5 · 사용 후 Lv.5 · 경험치 55/100", { exact: true }).waitFor();
  await legacy.close(dialog);
  assert.deepEqual(await legacy.read(), initialCandy);
  dialog = await legacy.open("포켓몬 1", /보유 포켓몬/);
  for (let count = 0; count < 5; count++) {
    if (count > 0) await mobile.waitForTimeout(360);
    await legacy.use(legacy.button("사탕 먹이기", dialog));
  }
  await legacy.close(dialog);
  const singleApplications = await legacy.read();

  dialog = await openCandySave();
  await chooseAmount(dialog, 5);
  await legacy.use(legacy.button("사탕 5개 먹이기", dialog));
  await dialog.getByRole("heading", { name: /Lv\.5$/ }).waitFor();
  assert.equal(await dialog.getByText("사탕 여러 개 먹이기", { exact: true }).count(), 0);
  assert.equal(await legacy.button(/^충전권 구매/, dialog).count(), 0);
  await legacy.close(dialog);
  assert.deepEqual(await legacy.read(), singleApplications);
  await mobile.reload();
  await legacy.button("포켓몬 1").waitFor();
  assert.deepEqual(await legacy.read(), singleApplications);

  dialog = await openCandySave();
  const quantity = await chooseAmount(dialog, 2);
  await dialog.getByText("행동력 2 · 사용 후 Lv.4 · 경험치 15/80", { exact: true }).waitFor();
  await legacy.button("사탕 2개 먹이기", dialog).evaluate(element => { element.click(); element.click(); });
  await dialog.getByRole("heading", { name: /Lv\.4$/ }).waitFor();
  const partial = await legacy.read();
  assert.equal(partial.energy, 3);
  assert.equal(partial.resources.candy, 3);
  assert.equal(await quantity.inputValue(), "0");
  assert.deepEqual(await quantity.getByRole("option").allTextContents(), ["선택", "2개", "3개"]);
  assert.ok(await legacy.button("선택한 사탕 먹이기", dialog).isDisabled());
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  await legacy.close(dialog);
  dialog = await openCandySave({ ...candySave, energy: 0, resources: { ...candySave.resources, gold: 4 } });
  await dialog.getByText("행동력이 부족합니다. 다음 턴에 회복하세요.", { exact: true }).waitFor();
  assert.equal(await legacy.button(/^충전권 구매/, dialog).count(), 0);
  assert.ok(await legacy.button("사탕 먹이기", dialog).isDisabled());
  await legacy.close(dialog);

  dialog = await openCandySave({ ...candySave, roster: [{ ...candySave.roster[0], heldItem: undefined }] });
  assert.equal(await dialog.getByText(/행복의알 장착 중/).count(), 0);
  await chooseAmount(dialog, 5);
  await dialog.getByText("행동력 5 · 사용 후 Lv.4 · 경험치 35/80", { exact: true }).waitFor();
  await legacy.close(dialog);

  dialog = await openCandySave({ ...candySave, energy: 2 });
  const batchSummary = dialog.getByText("사탕 여러 개 먹이기", { exact: true });
  await legacy.use(batchSummary);
  await legacy.use(legacy.button("사탕 2개 먹이기", dialog));
  await batchSummary.waitFor({ state: "hidden" });
  await legacy.use(legacy.button(/^충전권 구매/, dialog));
  await legacy.use(batchSummary);
  assert.equal(await dialog.getByRole("combobox", { name: "사탕 수량" }).inputValue(), "2", "A new batch starts with its usable amount after charging");
  await legacy.use(legacy.button("사탕 2개 먹이기", dialog));
  const refilled = await legacy.read();
  assert.equal(refilled.energy, 0);
  assert.equal(refilled.resources.candy, 1);
  assert.equal(refilled.resources.gold, 5);
  await legacy.close(dialog);
  console.log("Candy Chrome smoke passed: five single taps match one five-item batch, live estimate, cancel, double-activation guard and reload");

  await verifyLegacyResearchStaff();
  await verifySharedStaffing();
  assert.deepEqual(errors, []);
  console.log("Base Chrome smoke passed: new game with keyboard and migrated v1 with touch; construction, production, growth, expansion and a fresh game's clinic recovery");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
