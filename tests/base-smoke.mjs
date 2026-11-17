import assert from "node:assert/strict";
import { chromium } from "playwright";
import { preview } from "vite";

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
    await use(page.locator("#nextTurn"));
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

try {
  browser = await chromium.launch({ channel: "chrome" });
  const page = await openProfile();
  const fresh = baseControls(page, false);
  for (let round = 1; round <= 3; round++) {
    await page.getByRole("heading", { name: `스타팅 선택 ${round}/3` }).waitFor();
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
      await fresh.use(dialog.locator(`[data-install-pick="${tracked.id}"]`));
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
  dialog = await legacy.tools();
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  const coin = dialog.locator("li", { hasText: "부적금화" });
  await legacy.use(legacy.button("제작 3", coin));
  await coin.getByText(/보관 1/).waitFor();
  assert.equal((await legacy.read()).resources.tool, 0);
  assert.ok(await legacy.button("제작 3", coin).isDisabled());
  await legacy.close(dialog);

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
  dialog = await legacy.open("우호도 관리", /보유 포켓몬/);
  await dialog.getByRole("heading", { name: "이상해씨 Lv.1" }).waitFor();
  await dialog.getByText(/다음 턴 이탈 예정/).waitFor();
  await legacy.close(dialog);
  dialog = await legacy.tools("mon-12");
  const sash = dialog.locator("li", { hasText: "기합의띠" });
  await legacy.use(legacy.button("제작 3", sash));
  await legacy.use(legacy.button("장착", sash));
  await legacy.close(dialog);
  dialog = await legacy.open("우호도 관리", /보유 포켓몬/);
  await legacy.use(dialog.locator('[data-install-pick="mon-12"]'));
  await dialog.getByText("기합의띠로 이탈 방지 중").waitFor();
  await legacy.use(dialog.locator('[data-install-pick="mon-13"]'));
  await legacy.use(legacy.button("회복 아이템 사용", dialog));
  await legacy.close(dialog);
  await mobile.getByText("다음 턴 이탈 예정 · 이상해씨", { exact: true }).waitFor();
  const beforeDeparture = await legacy.read();
  await legacy.turn();
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

  await verifyLegacyResearchStaff();
  assert.deepEqual(errors, []);
  console.log("Base Chrome smoke passed: new game with keyboard and migrated v1 with touch; construction, production, growth, expansion and a fresh game's clinic recovery");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
