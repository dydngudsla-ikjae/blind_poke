import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";
import { fixBattleDraws, playBattle, setBattleRandom } from "./battle-play.mjs";

const saveKey = "blindpoke-save-v1";
const mapKey = "blindpoke-map-v1";
const species = JSON.parse(await readFile(new URL("../data/pokemon.json", import.meta.url), "utf8"));
const testTeam = [248, 445, 658].map(id => species.find(pokemon => pokemon.pokemonRowid === id));
const server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
const errors = [];
const spot = (save, id) => save.mapSnapshot.find(site => site.id === id);
let browser;

async function visit({ mobile = false, save, legacy = false } = {}) {
  const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.addInitScript(({ save, legacy, saveKey, mapKey }) => {
    Math.random = () => 0;
    if (!save || localStorage.getItem(saveKey)) return;
    if (legacy) {
      const { mapSnapshot, ...previous } = save;
      localStorage.setItem(saveKey, JSON.stringify({ ...previous, v: 3 }));
      localStorage.setItem(mapKey, JSON.stringify(mapSnapshot));
    } else {
      localStorage.setItem(saveKey, JSON.stringify(save));
    }
  }, { save, legacy, saveKey, mapKey });
  await page.goto(server.resolvedUrls.local[0]);

  const use = locator => mobile ? locator.tap() : locator.press("Enter");
  const button = name => page.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: true });
  const node = id => page.locator(`[data-node="${id}"]`);
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  const report = page.getByRole("complementary", { name: "정찰 기록" });
  async function map() {
    await use(button("지도"));
    await heading("월드맵").waitFor();
  }
  async function turn() {
    if (await heading("월드맵").count()) await use(button("본거지로"));
    const before = await read();
    await use(page.locator("#nextTurn"));
    await page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key)).turnCount === count,
      { key: saveKey, count: before.turnCount + 1 });
    return read();
  }
  async function battle(id, { draws, seed, recordMoves = false } = {}) {
    const before = await read();
    await use(node(id));
    const challenge = button(/거점 도전/);
    assert.ok(await challenge.isEnabled(), `${id} challenge unavailable with ${before.energy} energy`);
    if (draws) await fixBattleDraws(challenge, draws);
    await use(challenge);
    await heading("거점 배틀").waitFor();
    await page.waitForFunction(({ key, energy }) => JSON.parse(localStorage.getItem(key)).energy === energy,
      { key: saveKey, energy: before.energy - 2 });
    await page.locator('.duel-vitals[data-side="enemy"] h2').waitFor();
    await page.locator(".duel-arena").evaluate(arena => {
      const lineup = new Map();
      const remember = () => {
        const name = arena.querySelector('.duel-vitals[data-side="enemy"] h2')?.textContent;
        const level = arena.querySelector('.duel-vitals[data-side="enemy"] b')?.textContent;
        if (name && level) lineup.set(name, Number(level.slice(3)));
        arena.dataset.testLineup = JSON.stringify([...lineup]);
      };
      remember();
      new MutationObserver(remember).observe(arena, { childList: true, subtree: true, characterData: true });
    });
    if (seed !== undefined) await setBattleRandom(page, seed);
    const result = await playBattle(page, { manualSwitch: true, limit: 30, recordMoves });
    const lineup = JSON.parse(await page.locator(".duel-arena").getAttribute("data-test-lineup"));
    return { ...result, lineup };
  }
  async function win(id, { teamSize = 2, receipt, expectedTeam, expectedLineup, inheritance, draws } = {}) {
    const result = await battle(id, { draws });
    assert.equal(result.won, true, JSON.stringify(result));
    assert.equal(result.lineup.length, teamSize);
    if (expectedTeam) assert.deepEqual(result.lineup.map(([name]) => name), expectedTeam);
    if (expectedLineup) assert.deepEqual(result.lineup, expectedLineup);
    if (receipt) await page.locator(".duel-outcome").getByText(receipt).waitFor();
    await page.waitForFunction(({ id, key }) =>
      JSON.parse(localStorage.getItem(key)).mapSnapshot.find(site => site.id === id).owner === "player", { id, key: saveKey });
    if (inheritance) {
      const choice = page.getByRole("region", { name: "AI 건물 승계" });
      if (inheritance === "none") assert.equal(await choice.count(), 0);
      else {
        await choice.waitFor();
        assert.equal(await choice.getByRole("button").count(), 3);
        await use(choice.getByRole("button", { name: inheritance, exact: true }));
        await choice.waitFor({ state: "hidden" });
      }
    }
    await use(button("월드맵으로"));
    await heading("월드맵").waitFor();
    return result.choices;
  }
  return { page, use, button, heading, node, read, report, map, turn, win, battle };
}

async function verifyWorkshopSabotage(border, opened) {
  const worker = { ...border.roster[0], id: "mon-5", pokemon: species.find(pokemon => pokemon.pokemonRowid === 197) };
  const { "nw-04": _formerOutpost, ...outposts } = border.outposts;
  const intact = { ...border, outposts, roster: [...border.roster, worker], nextMemberId: 6,
    mapSnapshot: border.mapSnapshot.map(site => site.id === "nw-04" ? spot(opened, "nw-04") : site) };
  const facilities = session => session.report.getByRole("region", { name: "적 시설 생산" });
  async function scout(session, id) {
    await session.use(session.node(id));
    const scan = session.button(/정찰하기/);
    if (await scan.count()) await session.use(scan);
    await facilities(session).waitFor();
  }
  async function send(session) {
    await scout(session, "nw-04");
    const before = await session.read();
    await facilities(session).getByText("제작소 · 가동 중", { exact: true }).waitFor();
    assert.equal(await session.report.getByRole("region", { name: "AI 건물 승계" }).count(), 0);
    await session.page.getByLabel("파견할 악 타입").selectOption(worker.id);
    await session.use(session.button(/악 타입 시설 방해/));
    await facilities(session).getByText(/악 타입 시설 방해 파견 완료/).waitFor();
    await facilities(session).getByText("제작소 · 다음 턴 생산 중단", { exact: true }).waitFor();
    const queued = await session.read();
    assert.equal(queued.energy, before.energy - 1);
    assert.deepEqual(queued.frontier.sabotage, { sourceId: "nw-01", targetId: "nw-04",
      trainerId: spot(before, "nw-04").trainerId, memberId: worker.id });
    return queued;
  }

  const severed = await visit({ save: intact });
  await severed.map();
  await severed.use(severed.node("nw-04"));
  assert.equal(await facilities(severed).count(), 0);
  await scout(severed, "nw-02");
  await facilities(severed).getByText("다음 턴 부품 공급 가능", { exact: true }).waitFor();
  await severed.win("nw-03", { inheritance: "승계 포기" });
  await scout(severed, "nw-02");
  await facilities(severed).getByText("다음 턴 부품 공급 없음", { exact: true }).waitFor();
  const afterCut = await severed.read();
  const warned = await severed.turn();
  assert.deepEqual(warned.frontier.intrusion, { sourceId: "nw-04", targetId: "nw-01" });
  await severed.page.close();

  const prevented = await visit({ save: afterCut, mobile: true });
  await prevented.map();
  const queued = await send(prevented);
  await prevented.page.reload();
  await prevented.map();
  await scout(prevented, "nw-04");
  await facilities(prevented).getByText(/악 타입 시설 방해 파견 완료/).waitFor();
  assert.deepEqual(await prevented.read(), queued);
  assert.ok(await prevented.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  const blocked = await prevented.turn();
  assert.equal(blocked.frontier.intrusion, null);
  assert.equal(blocked.frontier.sabotage, undefined);
  assert.ok(blocked.lastLog.includes("북서 4거점 · 악 타입 방해 · 제작소 이번 턴 생산 중단"));
  assert.deepEqual((await prevented.turn()).frontier.intrusion, { sourceId: "nw-04", targetId: "nw-01" });
  await prevented.page.close();

  const backup = await visit({ save: intact });
  await backup.map();
  await send(backup);
  await scout(backup, "nw-02");
  await facilities(backup).getByText("다음 턴 부품 공급 가능", { exact: true }).waitFor();
  const supplied = await backup.turn();
  assert.deepEqual(supplied.frontier.intrusion, { sourceId: "nw-02", targetId: "nw-01" });
  await backup.page.close();

  const scheduled = await visit({ save: warned });
  await scheduled.map();
  await send(scheduled);
  const hit = await scheduled.turn();
  assert.equal(hit.resources.gold - warned.resources.gold, 27);
  assert.equal(hit.frontier.quietTurns, 3);
  assert.ok(hit.lastLog.includes("북서 1거점 · 적 침투 성공 · 턴당 수입 3 제외"));
  assert.ok(hit.lastLog.includes("북서 4거점 · 악 타입 방해 · 제작소 이번 턴 생산 중단"));
  await scheduled.page.close();
  console.log(JSON.stringify({ audit: "AI workshop and Dark sabotage", captured: "nw-03",
    cutSource: warned.frontier.intrusion.sourceId, suppressedNewWarning: true, alternateSource: supplied.frontier.intrusion.sourceId,
    scheduledGold: hit.resources.gold - warned.resources.gold, quietTurns: hit.frontier.quietTurns, mobileReload: true }));
}

async function verifyEnemyObservation(border) {
  const challengerId = "nw-02";
  const detector = { ...border.roster[0], id: "mon-5", pokemon: species.find(pokemon => pokemon.pokemonRowid === 18) };
  const snapshot = { ...border, frontier: { intel: {}, intrusion: null, quietTurns: 3 },
    roster: [{ ...border.roster[0], pokemon: species.find(pokemon => pokemon.pokemonRowid === 254) }, ...border.roster.slice(1), detector],
    nextMemberId: 6, mapSnapshot: border.mapSnapshot.map(site => site.id === challengerId ? { ...site, trainerId: "shauna", scouted: true } : site) };
  const initial = await visit({ save: snapshot });
  const warned = await initial.turn();
  const signal = initial.page.locator("#base-espionage-warning");
  await signal.getByText(/북서 1거점/).waitFor();
  assert.doesNotMatch(await signal.textContent(), /북서 2거점|사나/);
  assert.equal(warned.frontier.intrusion, null);
  assert.deepEqual(warned.frontier.espionage.observation, { sourceId: challengerId, targetId: "nw-01", trainerId: "shauna" });
  await initial.page.close();

  // Shauna's sampled team is Froakie then Fennekin with distinct levels for the same four draws.
  const draws = [.7, .6, 0, .99];
  async function replaceLead(session) {
    await session.use(session.button("엔트리"));
    const dialog = session.page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    const earlier = dialog.getByRole("button", { name: "개굴닌자 앞 순서로 이동", exact: true });
    await session.use(earlier);
    await session.use(earlier);
    await session.use(dialog.getByRole("button", { name: "닫기", exact: true }));
    assert.equal((await session.read()).entryOrder[0], snapshot.roster[2].id);
  }
  const observed = await visit({ save: warned });
  await observed.heading("본거지").waitFor();
  assert.deepEqual(await observed.read(), warned);
  const prepared = await observed.turn();
  assert.deepEqual(prepared.frontier.espionage.preparation, { territoryId: challengerId, trainerId: "shauna",
    leadTypes: [12], expiresTurn: prepared.turnCount + 3 });
  await observed.page.reload();
  await observed.heading("본거지").waitFor();
  assert.deepEqual(await observed.read(), prepared);
  await replaceLead(observed);
  await observed.map();
  await observed.use(observed.node(challengerId));
  await observed.report.getByText(/적 수비 선봉 준비.*3턴 남음/).waitFor();
  const baseline = [["개구마르", 9], ["푸호꼬", 10]];
  const changed = [...baseline].reverse();
  await observed.win(challengerId, { expectedLineup: changed, draws, inheritance: "승계 포기" });
  assert.equal((await observed.read()).frontier.espionage.preparation, undefined);
  await observed.page.close();

  const watched = await visit({ mobile: true, save: warned });
  await watched.heading("본거지").waitFor();
  assert.deepEqual(await watched.read(), warned);
  await watched.use(watched.button("첩보 탐지 대응"));
  const response = watched.report.getByRole("region", { name: "비행 탐지 대응" });
  await response.getByText("적 첩보 신호 · 다음 턴 정산", { exact: true }).waitFor();
  assert.doesNotMatch(await response.textContent(), /북서 2거점|사나/);
  await response.getByLabel("탐지할 비행 타입").selectOption(detector.id);
  await watched.use(response.getByRole("button", { name: /비행 탐지/ }));
  await response.getByText("적 첩보 차단 · 출처 북서 2거점", { exact: true }).waitFor();
  const queued = await watched.read();
  assert.equal(queued.energy, warned.energy - 1);
  assert.equal(queued.frontier.espionage.observation.detectorId, detector.id);
  assert.equal(await response.getByRole("button", { name: /비행 탐지/ }).count(), 0);
  assert.ok(await watched.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await watched.page.reload();
  await watched.map();
  await watched.use(watched.node("nw-01"));
  await response.getByText("적 첩보 차단 · 출처 북서 2거점", { exact: true }).waitFor();
  assert.deepEqual(await watched.read(), queued);
  const blocked = await watched.turn();
  assert.deepEqual(blocked.frontier.espionage, { quietTurns: 3 });
  assert.deepEqual(blocked.resources, prepared.resources);
  assert.deepEqual(blocked.mapSnapshot, prepared.mapSnapshot);
  await replaceLead(watched);
  await watched.map();
  await watched.win(challengerId, { expectedLineup: baseline, draws, inheritance: "승계 포기" });
  await watched.page.close();

  function battleInputs({ lastLog, frontier, ...save }) {
    const { espionage, ...otherOperations } = frontier;
    return { ...save, frontier: otherOperations };
  }
  assert.deepEqual(battleInputs(prepared), battleInputs(blocked));
  const comparison = [];
  let entry;
  for (const seed of [7, 19, 226]) {
    const pair = { seed };
    let firstInputs;
    for (const [mode, save, order] of [["observed", prepared, changed], ["blocked", blocked, baseline]]) {
      const session = await visit({ save });
      try {
        await session.heading("본거지").waitFor();
        assert.deepEqual(await session.read(), save);
        await replaceLead(session);
        const ready = await session.read();
        const inputs = battleInputs(ready);
        if (firstInputs) assert.deepEqual(inputs, firstInputs);
        else firstInputs = inputs;
        entry ??= ready.entryOrder.map(id => ready.roster.find(member => member.id === id))
          .map(({ pokemon, level }) => `${pokemon.nameKr} Lv.${level}`);
        await session.map();
        const result = await session.battle(challengerId, { draws, seed, recordMoves: true });
        assert.deepEqual(result.lineup, order.slice(0, result.lineup.length));
        assert.equal(result.moveOrder.length, result.choices);
        const ally = await session.page.locator('.duel-vitals[data-side="player"] meter').evaluate(meter => ({ hp: meter.value, max: meter.max }));
        const { lineup, choices, moveOrder, switches, replacements, outcome } = result;
        pair[mode] = { lineup, choices, moveOrder, switches, replacements, outcome, ally };
      } finally {
        await session.page.close();
      }
    }
    comparison.push(pair);
  }
  console.log(JSON.stringify({ audit: "Shauna Flying battle comparison", site: challengerId, warningTurn: warned.turnCount,
    battleTurn: prepared.turnCount, entry, comparison }));

  const recon = await visit({ save: prepared });
  await recon.map();
  await recon.use(recon.node(challengerId));
  const send = recon.button(/고스트 첩보 파견/);
  await fixBattleDraws(send, draws.slice(0, 2));
  await recon.use(send);
  await recon.report.getByText(/고스트 첩보 진행 중/).waitFor();
  await recon.turn();
  for (let turn = 0; turn < 2; turn++) await recon.turn();
  assert.equal((await recon.read()).frontier.espionage?.preparation, undefined);
  await recon.page.reload();
  await recon.map();
  await recon.use(recon.node(challengerId));
  const ghostReport = recon.report.getByRole("region", { name: "공개된 수비팀" });
  await ghostReport.waitFor();
  assert.deepEqual(await ghostReport.getByRole("listitem").allTextContents(), changed.map(([name]) => name));
  const grownTeam = changed.map(([name, level]) => [name, level + 1]);
  await recon.page.getByText(/성장 \+1/).waitFor();
  await recon.win(challengerId, { expectedLineup: grownTeam, draws: draws.slice(2), inheritance: "승계 포기" });
  assert.equal((await recon.read()).frontier.intel[challengerId], undefined);
  await recon.page.close();
  console.log(JSON.stringify({ audit: "Enemy observation and Flying detection", border: "nw-01", source: challengerId,
    observed: changed, blocked: baseline, cost: warned.energy - queued.energy, income: prepared.resources.gold - warned.resources.gold,
    leadAtSettlement: "나무킹", leadAtChallenge: "개굴닌자", preparationWindow: 3, ghostAfterExpiry: grownTeam, mobileReload: true }));
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  const fresh = await visit();
  for (let round = 1; round <= 3; round++) {
    await fresh.heading(`스타팅 선택 ${round}/3`).waitFor();
    await fresh.use(fresh.page.locator("[data-draft-target]").first());
  }
  await fresh.use(fresh.button("본거지로 이동"));
  await fresh.page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.introPending === false, saveKey);
  const closed = await fresh.read();
  await fresh.page.close();
  const startIds = closed.mapSnapshot.filter(site => site.active).map(site => site.id);
  // Start just before the real battle that opens the northwest. Use durable entries and
  // budget headroom so this test can measure the supply rules independently of battle balance.
  closed.mapSnapshot = closed.mapSnapshot.map(site => !startIds.includes(site.id) ? site : {
    ...site, owner: site.id === "island" ? "unoccupied" : "player", trainerId: null, scouted: true,
  });
  closed.roster = closed.roster.map((member, i) => ({ ...member, pokemon: testTeam[i], level: 80 }));
  closed.entryOrder = closed.roster.map(member => member.id);
  closed.resources.gold = 0;
  closed.storageCap = 100;
  const desktop = await visit({ save: closed, legacy: true });
  await desktop.map();
  assert.ok(await desktop.node("nw-04").isDisabled());
  await desktop.win("island", { teamSize: 1 });
  const opened = await desktop.read();
  assert.equal(opened.v, 4);
  assert.deepEqual(opened.mapSnapshot.filter(site => site.id.startsWith("nw-") && site.owner === "trainer").map(site => site.id),
    ["nw-02", "nw-03", "nw-04", "nw-07", "nw-08", "nw-09"]);
  const trainers = opened.mapSnapshot.filter(site => site.owner === "trainer").map(site => site.trainerId);
  assert.equal(new Set(trainers).size, 6);
  assert.ok(!trainers.includes(opened.trainerId));
  assert.equal(opened.mapSnapshot.filter(site => site.active && site.owner === "unoccupied").length, 4);
  assert.ok(await desktop.node("se-01").isDisabled());
  assert.equal(await desktop.page.locator("[data-faction]").count(), 0);
  await desktop.use(desktop.node("nw-04"));
  await desktop.heading("미확인 거점").waitFor();
  assert.equal(spot(opened, "nw-04").scouted, false);
  assert.equal(await desktop.report.getByText(/대표 거점|북서 1세력/).count(), 0);
  assert.ok(await desktop.button(/거점 도전/).isEnabled());
  const supplyPlan = desktop.report.getByRole("region", { name: "보급로 전망" });
  assert.equal(await supplyPlan.count(), 0);
  await desktop.use(desktop.button(/정찰하기/));
  await supplyPlan.getByText("확보하면 고립", { exact: true }).waitFor();
  await supplyPlan.getByText(/거점 1곳을 더 확보/).waitFor();
  const forecastRoute = key => desktop.page.locator(`[data-route="${key}"]`);
  for (const edge of ["island|nw-01", "nw-01|nw-04"]) {
    assert.equal(await forecastRoute(edge).getAttribute("data-supply-preview"), "true");
    assert.equal(await forecastRoute(edge).getAttribute("data-owned-route"), "false");
  }
  const scouted04 = await desktop.read();
  await desktop.use(desktop.button("보급로 첫 거점 보기"));
  await desktop.heading("미확인 거점").waitFor();
  assert.equal(await desktop.node("nw-01").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await desktop.read(), scouted04);
  await desktop.use(desktop.button(/정찰하기/));
  await supplyPlan.getByText("확보하면 보급 연결", { exact: true }).waitFor();
  const isolatedChoices = await desktop.win("nw-04", { receipt: /보급로 연결 필요/ });
  const stranded = await desktop.read();
  assert.deepEqual(spot(stranded, "nw-04"), { ...spot(opened, "nw-04"), owner: "player", trainerId: null, scouted: true, loyalty: 100 });
  for (const id of ["nw-02", "nw-03", "nw-07", "nw-08", "nw-09"]) assert.deepEqual(spot(stranded, id), spot(opened, id));
  assert.equal(stranded.resources.gold, 0);
  assert.equal(await desktop.node("nw-04").getAttribute("data-supply"), "isolated");
  await desktop.report.getByText("고립 · 보급 중단").waitFor();
  await desktop.report.getByText("턴당 자금 +0").waitFor();
  await supplyPlan.getByText(/미점령 전환까지 3턴/).waitFor();

  const one = await desktop.turn();
  assert.equal(spot(one, "nw-04").loyalty, 65);
  assert.equal(one.resources.gold, 27);
  await desktop.page.reload();
  await desktop.map();
  assert.deepEqual(await desktop.read(), one);
  assert.equal(await desktop.node("nw-04").getAttribute("data-supply"), "isolated");
  await desktop.use(desktop.node("nw-04"));
  await supplyPlan.getByText(/미점령 전환까지 2턴/).waitFor();
  await desktop.use(desktop.button("보급로 첫 거점 보기"));
  await desktop.heading("북서 1거점").waitFor();
  assert.ok(await desktop.heading("북서 1거점").evaluate(heading => document.activeElement === heading));
  const reconnectChoices = await desktop.win("nw-01", { receipt: /매 턴 자금 \+3/ });
  const connected = await desktop.read();
  assert.equal(spot(connected, "nw-04").loyalty, 65);
  assert.equal(connected.resources.gold, 27);
  for (const path of ["island|nw-01", "nw-01|nw-04"]) {
    assert.equal(await desktop.page.locator(`[data-route="${path}"]`).getAttribute("data-owned-route"), "true");
  }
  await desktop.use(desktop.node("nw-04"));
  await desktop.report.getByText("보급 연결", { exact: true }).waitFor();
  assert.equal(await supplyPlan.count(), 0);
  assert.equal(await forecastRoute("nw-01|nw-04").getAttribute("data-supply-preview"), "false");
  await desktop.report.getByText("충성도 65/100").waitFor();
  await desktop.report.getByText("턴당 자금 +3").waitFor();
  await desktop.use(desktop.node("nw-02"));
  await desktop.use(desktop.button(/정찰하기/));
  await desktop.report.getByText("북서 1세력 · 외곽 거점").waitFor();
  assert.equal(await desktop.page.locator('[data-faction="nw-1"] [data-faction-site]').count(), 2);
  const recovered = await desktop.turn();
  assert.equal(spot(recovered, "nw-04").loyalty, 100);
  assert.equal(recovered.resources.gold, 60);
  await desktop.map();
  await desktop.win("nw-02");
  await desktop.win("nw-03");
  await desktop.page.locator('[data-faction="nw-1"]').getByText("확보 완료").waitFor();
  await desktop.page.close();

  const mobile = await visit({ mobile: true, save: stranded });
  await mobile.map();
  await mobile.use(mobile.node("nw-04"));
  await mobile.report.getByText("고립 · 보급 중단").waitFor();
  const recovery = mobile.report.getByRole("region", { name: "보급로 전망" });
  await recovery.getByText(/미점령 전환까지 3턴/).waitFor();
  const routeShortcut = mobile.button("보급로 첫 거점 보기");
  assert.ok((await routeShortcut.boundingBox())?.height >= 44);
  await mobile.use(routeShortcut);
  await mobile.heading("북서 1거점").waitFor();
  assert.deepEqual(await mobile.read(), stranded);
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  const nextTurn = mobile.page.locator("#nextTurn");
  for (const [turn, loyalty] of [65, 30, 0].entries()) {
    if (turn === 2) {
      const notices = mobile.page.getByRole("region", { name: "다음 턴 경고" });
      const warning = notices.getByText(/다음 턴에 북서 4거점.*미점령/);
      assert.equal(await warning.count(), 1, "The last safe turn warns before losing a territory");
      const descriptions = (await nextTurn.getAttribute("aria-describedby")).split(/\s+/);
      assert.ok(descriptions.includes(await warning.getAttribute("id")));
      assert.ok(descriptions.includes("base-gold-preview"));
      const beforeShortcut = await mobile.read();
      await mobile.use(notices.getByRole("button", { name: "보급로 보기" }));
      await recovery.getByText(/미점령 전환까지 1턴/).waitFor();
      const afterShortcut = await mobile.read();
      assert.equal(afterShortcut.energy, beforeShortcut.energy);
      assert.equal(afterShortcut.turnCount, beforeShortcut.turnCount);
      assert.deepEqual(afterShortcut.mapSnapshot, beforeShortcut.mapSnapshot);
    }
    const snapshot = await mobile.turn();
    const site = spot(snapshot, "nw-04");
    assert.equal(site.owner, loyalty ? "player" : "unoccupied");
    assert.equal(site.loyalty, loyalty);
    assert.equal(snapshot.resources.gold, (turn + 1) * 27);
    if (!loyalty) assert.ok(snapshot.lastLog.some(line => line.includes("미점령 전환")));
  }
  assert.equal(await nextTurn.getAttribute("aria-describedby"), "base-gold-preview");
  const lost = await mobile.read();
  await mobile.page.reload();
  await mobile.map();
  assert.deepEqual(await mobile.read(), lost);
  assert.equal(await mobile.node("nw-04").getAttribute("data-status"), "free");
  await mobile.use(mobile.node("nw-04"));
  await mobile.heading("북서 4거점").waitFor();
  assert.ok(await mobile.button(/거점 도전/).isEnabled());
  const reclaimedChoices = await mobile.win("nw-04", { receipt: /보급로 연결 필요/ });
  assert.equal(spot(await mobile.read(), "nw-04").loyalty, 100);
  await mobile.page.close();

  const older = await visit({ save: { ...closed, mapSnapshot: opened.mapSnapshot.map(site =>
    site.id.startsWith("nw-") ? { id: site.id, owner: site.id === "nw-04" ? "player" : "unoccupied",
      active: true, scouted: site.id === "nw-04" } : site) }, legacy: true });
  await older.map();
  const restored = await older.read();
  assert.equal(restored.mapSnapshot.filter(site => site.id.startsWith("nw-") && site.owner === "trainer").length, 0);
  assert.equal(spot(restored, "nw-04").loyalty, 100);
  assert.equal(restored.turnCount, closed.turnCount);
  assert.equal(restored.resources.gold, 0);
  assert.deepEqual(restored.outposts["nw-04"], { plotCap: 2, clearing: null, inheritancePending: false });
  await older.page.close();

  const { frontier: _unused, ...existingCampaign } = connected;
  const scout = { ...existingCampaign.roster[0], id: "mon-4", pokemon: species.find(pokemon => pokemon.pokemonRowid === 94) };
  const border = { ...existingCampaign, roster: [...existingCampaign.roster, scout],
    nextMemberId: 5, storageCap: 500, resources: { ...existingCampaign.resources, gold: 0 } };
  await verifyWorkshopSabotage(border, opened);
  await verifyEnemyObservation(border);
  const recon = await visit({ save: border, legacy: true });
  await recon.map();
  await recon.use(recon.node("nw-02"));
  assert.equal(await recon.button(/고스트 첩보 파견/).count(), 0);
  await recon.use(recon.button(/정찰하기/));
  const beforeRecon = await recon.read();
  await recon.page.getByLabel("출발 거점").selectOption("nw-01");
  await recon.page.getByLabel("파견할 고스트").selectOption(scout.id);
  // Use a different draw from the post-reload battle so a reroll would change the order.
  await recon.page.evaluate(() => { Math.random = () => .999; });
  await recon.use(recon.button(/고스트 첩보 파견/));
  await recon.report.getByText(/고스트 첩보 진행 중/).waitFor();
  const sent = await recon.read();
  assert.equal(sent.energy, beforeRecon.energy - 1);
  assert.equal(sent.frontier.intel["nw-02"].memberId, scout.id);
  await recon.page.reload();
  await recon.map();
  await recon.use(recon.node("nw-02"));
  await recon.report.getByText(/고스트 첩보 진행 중/).waitFor();
  const warned = await recon.turn();
  assert.equal(warned.resources.gold, 33);
  assert.equal(warned.frontier.intrusion.targetId, "nw-01");
  assert.equal(warned.frontier.espionage?.observation, undefined);
  assert.equal(warned.frontier.intel["nw-02"].memberId, undefined);
  await recon.page.reload();
  await recon.map();
  await recon.use(recon.node("nw-02"));
  const teamReport = recon.report.getByRole("region", { name: "공개된 수비팀" });
  await teamReport.waitFor();
  const expectedTeam = await teamReport.getByRole("listitem").allTextContents();
  assert.equal(expectedTeam.length, 2);
  await recon.win("nw-02", { expectedTeam });
  assert.equal((await recon.read()).frontier.intel["nw-02"], undefined);
  await recon.page.close();

  const guarded = await visit({ save: warned });
  const baseWarning = guarded.page.locator("#base-intrusion-warning");
  await baseWarning.getByText(/북서 1거점/).waitFor();
  await guarded.use(guarded.button("치안 대응"));
  await guarded.heading("월드맵").waitFor();
  await guarded.report.getByText("적 침투 예고 · 다음 턴 정산").waitFor();
  await guarded.use(guarded.button(/드래곤 방어/));
  await guarded.report.getByText("드래곤 방어 배치 완료").waitFor();
  const defense = await guarded.read();
  assert.equal(defense.energy, warned.energy - 1);
  assert.equal(defense.frontier.intrusion.defenderId, existingCampaign.roster[1].id);
  await guarded.page.reload();
  assert.deepEqual(await guarded.read(), defense);
  const defended = await guarded.turn();
  assert.equal(defended.resources.gold - warned.resources.gold, 33);
  assert.ok(defended.lastLog.includes("북서 1거점 · 침투 차단"));
  assert.equal(spot(defended, "nw-01").loyalty, 100);
  for (const quietTurns of [2, 1, 0]) {
    const quiet = await guarded.turn();
    assert.deepEqual(quiet.frontier.intrusion, null);
    assert.equal(quiet.frontier.quietTurns, quietTurns);
  }
  assert.equal((await guarded.turn()).frontier.intrusion.targetId, "nw-01");
  await guarded.page.close();

  const uncovered = { ...warned, roster: warned.roster.map(member => member.pokemon.pokemonRowid === 445 ?
    { ...member, pokemon: testTeam[0] } : member) };
  const undefended = await visit({ mobile: true, save: uncovered });
  await undefended.use(undefended.button("치안 대응"));
  await undefended.report.getByText("미배치 드래곤 타입이 필요합니다.").waitFor();
  assert.ok(await undefended.button(/드래곤 방어/).isDisabled());
  assert.ok(await undefended.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  const hit = await undefended.turn();
  assert.equal(hit.resources.gold - warned.resources.gold, 30);
  assert.deepEqual(spot(hit, "nw-01"), spot(defended, "nw-01"));
  assert.ok(hit.lastLog.includes("북서 1거점 · 적 침투 성공 · 턴당 수입 3 제외"));
  await undefended.page.reload();
  const resumed = await undefended.turn();
  assert.equal(resumed.resources.gold - hit.resources.gold, 33);
  await undefended.page.close();

  const crafter = { ...opened.roster[0], id: "mon-4", pokemon: species.find(pokemon => pokemon.pokemonRowid === 25), level: 1, aptitude: 50 };
  const productionCampaign = { ...opened, resources: { ...opened.resources, material: 0, tool: 0 }, storageCap: 500, energy: 5,
    nextBuildingId: 2, nextMemberId: 5,
    buildings: [{ id: "building-1", type: "workshop", plotIndex: 0, status: "active", remainingTurns: 0 }],
    roster: [{ ...opened.roster[0], buildingId: "building-1", jobId: "mine" }, ...opened.roster.slice(1), crafter] };
  const remote = await visit({ save: productionCampaign, legacy: true });
  async function manageSite(profile, id, name) {
    await profile.use(profile.node(id));
    await profile.use(profile.button("거점 관리"));
    await profile.heading(name).waitFor();
  }
  const workshopName = "제작소 · 1번 부지";
  await remote.map();
  await remote.win("nw-04", { inheritance: "제작소 승계" });
  const inherited = await remote.read();
  const workshop = inherited.buildings.find(building => building.siteId === "nw-04");
  assert.deepEqual(workshop, { id: "building-2", siteId: "nw-04", type: "workshop", inherited: true, plotIndex: 0, status: "active", remainingTurns: 0 });
  assert.ok(inherited.roster.every(member => member.buildingId !== workshop.id));
  await manageSite(remote, "nw-04", "북서 4거점");
  await remote.page.getByText("고립 · 공사·개척·생산 중단").waitFor();
  assert.ok(await remote.button("2번 부지 건설").isDisabled());
  await remote.map();
  await remote.win("nw-01", { inheritance: "none" });
  await manageSite(remote, "nw-04", "북서 4거점");
  await remote.page.getByText("보급 연결 · 본거지와 재고 공유").waitFor();
  await remote.use(remote.button("1번 부지 제작소 관리"));
  let panel = remote.page.getByRole("dialog", { name: workshopName });
  await remote.use(panel.getByRole("button", { name: /부품 제작/ }));
  await remote.use(panel.locator('[data-install-pick="mon-4"]'));
  await remote.use(panel.getByRole("button", { name: /직무 배치 · 행동력 1/ }));
  await panel.getByText(/부품 \+1 \/ 최대 1 · 재료 −1/).waitFor();
  await remote.use(panel.getByRole("button", { name: "닫기" }));
  const beforeProduction = await remote.read();
  assert.equal(beforeProduction.resources.material, 0);
  const produced = await remote.turn();
  assert.equal(produced.resources.tool - beforeProduction.resources.tool, 1);
  assert.ok(produced.lastLog.some(line => /북서 4거점.*부품 제작.*부품 \+1.*재료 −1/.test(line)));
  await remote.map();
  await remote.win("nw-02", { inheritance: "승계 포기" });
  const declined = await remote.read();
  assert.equal(declined.outposts["nw-02"].inheritancePending, false);
  assert.ok(declined.buildings.every(building => building.siteId !== "nw-02"));
  await remote.page.reload();
  await remote.map();
  await manageSite(remote, "nw-02", "북서 2거점");
  assert.ok(await remote.button("1번 부지 건설").isEnabled());
  await remote.map();
  await manageSite(remote, "nw-04", "북서 4거점");
  await remote.use(remote.button("2번 부지 건설"));
  panel = remote.page.getByRole("dialog", { name: "건설 · 2번 부지" });
  await remote.use(panel.getByRole("button", { name: "훈련소", exact: true }));
  await remote.use(panel.locator('[data-install-pick="mon-3"]'));
  await remote.use(panel.locator("[data-build-confirm]"));
  async function clearPlot(profile, plot) {
    await profile.use(profile.button(`${plot}번 미개척 부지`));
    const clearing = profile.page.getByRole("dialog", { name: `땅 평탄화 · ${plot}번 부지` });
    await profile.use(clearing.locator('[data-install-pick="mon-2"]'));
    await profile.use(clearing.getByRole("button", { name: "땅 평탄화 시작" }));
    await profile.use(clearing.getByRole("button", { name: "닫기" }));
  }
  await clearPlot(remote, 3);
  let checkpoint = await remote.turn();
  assert.equal(checkpoint.outposts["nw-04"].plotCap, 3);
  const construction = checkpoint.buildings.find(building => building.siteId === "nw-04" && building.plotIndex === 1);
  assert.equal(construction.remainingTurns, 2);
  await clearPlot(remote, 4);
  checkpoint = await remote.read();
  await remote.page.close();

  // The current rules cannot sever a connected player route. Change only the bridge in a temporary copy.
  const severed = { ...checkpoint, mapSnapshot: checkpoint.mapSnapshot.map(site => site.id === "nw-01" ?
    { ...site, owner: "unoccupied", loyalty: 0 } : site) };
  const halted = await visit({ save: severed, mobile: true });
  await halted.map();
  await manageSite(halted, "nw-04", "북서 4거점");
  await halted.page.getByText("고립 · 공사·개척·생산 중단").waitFor();
  assert.ok(await halted.page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await halted.use(halted.button("4번 미개척 부지"));
  panel = halted.page.getByRole("dialog", { name: "땅 평탄화 · 4번 부지" });
  await panel.getByText(/고립으로 평탄화 중단/).waitFor();
  assert.ok(await panel.getByRole("button", { name: "인력 회수" }).isEnabled());
  await halted.use(panel.getByRole("button", { name: "닫기" }));
  for (const loyalty of [65, 30, 0]) {
    const next = await halted.turn();
    assert.equal(spot(next, "nw-04").loyalty, loyalty);
    assert.equal(next.buildings.find(building => building.id === construction.id).remainingTurns, 2);
    assert.equal(next.outposts["nw-04"].plotCap, 3);
    assert.equal(next.resources.tool, checkpoint.resources.tool);
    if (loyalty === 65) {
      await halted.use(halted.button("1번 부지 제작소 관리"));
      panel = halted.page.getByRole("dialog", { name: workshopName });
      await panel.getByText("고립 · 생산 중단 · 인력 회수 가능").waitFor();
      await halted.use(panel.getByRole("button", { name: "피카츄 회수" }));
      await halted.use(panel.getByRole("button", { name: "닫기" }));
      assert.equal((await halted.read()).roster.find(member => member.id === "mon-4").buildingId, null);
    }
  }
  await halted.heading("본거지").waitFor();
  const abandoned = await halted.read();
  assert.equal(spot(abandoned, "nw-04").owner, "unoccupied");
  assert.equal(abandoned.roster.find(member => member.id === "mon-3").buildingId, null);
  assert.equal(abandoned.outposts["nw-04"].clearing, null);
  await halted.page.reload();
  await halted.heading("본거지").waitFor();
  assert.deepEqual(await halted.read(), abandoned);
  await halted.map();
  await halted.win("nw-01", { inheritance: "none" });
  await halted.win("nw-04", { inheritance: "none" });
  await manageSite(halted, "nw-04", "북서 4거점");
  await halted.use(halted.button(/훈련소 공사 관리/));
  panel = halted.page.getByRole("dialog", { name: "훈련소 · 공사 관리" });
  await panel.getByText(/0마리 배치 · 2턴 남음/).waitFor();
  await halted.use(panel.locator('[data-install-pick="mon-3"]'));
  await halted.use(panel.getByRole("button", { name: "추가 배치" }));
  await halted.use(panel.getByRole("button", { name: "닫기" }));
  assert.equal((await halted.turn()).buildings.find(building => building.id === construction.id).remainingTurns, 1);
  assert.equal((await halted.turn()).buildings.find(building => building.id === construction.id).status, "active");
  await halted.page.close();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: "Chrome", isolatedChoices, reconnectChoices, reclaimedChoices,
    reconnect: [100, 65, 65, 100], connectedIncome: 33, lost: [100, 65, 30, 0], isolatedIncome: 27, legacy: "v3 → v4",
    ghostIntel: expectedTeam, defense: { blockedIncome: 33, hitIncome: 30, recoveryIncome: 33, quietTurns: 3 } }));
  console.log("Outpost Chrome passed: inherit workshop, decline, shared +1 tool, recall during isolation, construction 2→paused→1→completed after loss and recapture");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
