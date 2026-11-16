import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";
import { ENERGY_CHARGE_COST } from "../src/domain/economy.ts";
import { worldMapNodes } from "../src/domain/worldMap.ts";
import { campaignMemberScore, fixBattleDraws, memberScore, playCampaignBattle, setBattleRandom, useHistoricalBattleData } from "./battle-play.mjs";

const key = "blindpoke-save-v1";
const profiles = [
  { seed: 7, picks: [0, 1, 2] }, { seed: 19, picks: [1, 2, 0] }, { seed: 226, picks: [1, 0, 2] },
  { seed: 83, picks: [2, 0, 1] }, { seed: 121, picks: [0, 2, 1] },
];
const connectedRoute = process.argv.includes("--connected");
const trainingAudit = process.argv.includes("--training-audit");
const frontierAudit = process.argv.includes("--frontier-audit");
const researchSiteAudit = process.argv.includes("--research-site-audit");
const dexRefillAudit = process.argv.includes("--dex-refill-audit");
const inheritedDojoAudit = process.argv.includes("--inherited-dojo-challenge");
const darkAudit = process.argv.includes("--dark-audit");
const flyingDecisionAudit = process.argv.includes("--flying-decision-audit");
const flyingAudit = flyingDecisionAudit || process.argv.includes("--flying-audit");
const flyingExtremes = process.argv.includes("--flying-extremes");
const flyingSample = flyingExtremes || process.argv.includes("--flying-sample");
const flyingBattleAudit = flyingSample || process.argv.includes("--flying-battle-audit");
const endingRun = dexRefillAudit || process.argv.includes("--ending");
const dexDuringCampaign = process.argv.includes("--dex-during");
const useOutposts = endingRun || researchSiteAudit || inheritedDojoAudit || darkAudit || flyingAudit || flyingBattleAudit || process.argv.includes("--outposts");
const useFrontier = useOutposts || frontierAudit || process.argv.includes("--frontier");
const manageFavor = useFrontier || process.argv.includes("--favor");
const useGuidance = manageFavor || process.argv.includes("--guided");
const baselineData = trainingAudit || process.argv.includes("--baseline-data");
const auditCases = new Map([
  [7, { site: "se-06", enemy: ["두까비 Lv.15", "어치르돈 Lv.15"], region: 2, concentrated: [12, 8], spread: [10, 8, 7], choices: 62 }],
  [226, { site: "ne-02", enemy: ["할비롱 Lv.18", "절벼게 Lv.18"], region: 3, concentrated: [16, 11], spread: [15, 11, 6],
    moveThreshold: [14, 9, 10], researchThreshold: { name: "루나톤", level: 4 }, choices: 33 }],
]);
const requested = process.argv.slice(2).filter(arg => !["--connected", "--training-audit", "--guided", "--baseline-data", "--favor", "--frontier", "--frontier-audit", "--outposts", "--research-site-audit", "--ending", "--dex-during", "--dex-refill-audit", "--inherited-dojo-challenge", "--dark-audit", "--flying-audit", "--flying-battle-audit", "--flying-sample", "--flying-extremes", "--flying-decision-audit"].includes(arg)).map(Number);
const eligible = manageFavor ? profiles.filter(({ seed }) => seed === 7)
  : trainingAudit || useGuidance ? profiles.filter(({ seed }) => auditCases.has(seed)) : profiles;
const defaults = trainingAudit || useGuidance ? eligible : eligible.slice(0, 3);
const selected = requested.length ? eligible.filter(({ seed }) => requested.includes(seed)) : defaults;
assert.equal(selected.length, requested.length || defaults.length, "Unknown or duplicate campaign seed");
assert.ok(!(trainingAudit && connectedRoute), "The audited encounters use the original route");
assert.ok(!useGuidance || (!trainingAudit && !connectedRoute), "Guided runs use the original route from a fresh game");
assert.ok(!manageFavor || !baselineData, "The favor replay uses the current battle data");
assert.ok(!useOutposts || !frontierAudit, "The outpost comparison plays the full campaign");
assert.ok(!endingRun || !researchSiteAudit, "The ending replay starts from a new game and does not load the legacy staffing control");
assert.ok(!dexDuringCampaign || endingRun, "Use --dex-during with --ending");
assert.ok(!(dexDuringCampaign && dexRefillAudit), "The refill comparison starts with the shared 40-site save");
assert.ok(!flyingAudit || !(darkAudit || endingRun || inheritedDojoAudit || researchSiteAudit), "The Flying comparison uses the regular outpost route");
assert.ok(!flyingBattleAudit || !(flyingAudit || darkAudit || endingRun || inheritedDojoAudit || researchSiteAudit),
  "The Flying battle comparisons use the regular outpost route through the first Northwest 02 challenge");
const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [pokemon, { trainers }] = await Promise.all([read("pokemon"), read("trainer")]);
const species = new Map(pokemon.map(record => [record.pokemonRowid, record]));
const routes = [
  ["southwest", "west", "south", "southeast", "east", "center", "northwest", "northeast", "island"],
  (connectedRoute ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [4, 1, 2, 3, 5, 6, 7, 8, 9, 10])
    .map(number => `nw-${String(number).padStart(2, "0")}`),
  ...["se", "ne"].map(prefix => Array.from({ length: 10 }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`)),
];
const goals = [[4, 3], [8, 5], [12, 8], [16, 11]];
const spot = (state, id) => state.mapSnapshot.find(site => site.id === id);
const startingIds = new Set(worldMapNodes.filter(node => node.region === 1).map(node => node.id));
const reconTargets = new Set(["nw-02", "se-03", "ne-03"]);
const inheritedFacilities = { "nw-04": "제작소", "nw-02": "훈련소" };
const isPsychic = member => [member.pokemon.type1Rowid, member.pokemon.type2Rowid].includes(14);
const server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
let browser;

async function loadFrontierRules() {
  const { registerHooks } = await import("node:module");
  const sourceRoot = new URL("../src/", import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  } });
  try {
    const [frontier, supply] = await Promise.all([
      import("../src/domain/frontierOperations.ts"), import("../src/domain/territorySupply.ts"),
    ]);
    return { ...frontier, ...supply };
  } finally {
    hooks.deregister();
  }
}

const frontierRules = darkAudit || flyingAudit || flyingBattleAudit ? await loadFrontierRules() : null;

function initializeCampaignRandom(seed) {
  window.campaignRngState = seed;
  Math.random = () => {
    const current = window.campaignRngState = (window.campaignRngState + 0x6D2B79F5) | 0;
    let value = Math.imul(current ^ current >>> 15, 1 | current);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

async function initializeSaveCopy(page, snapshot) {
  await page.addInitScript(({ key, snapshot }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(snapshot));
  }, { key, snapshot });
}

async function withCampaignCopy(snapshot, playCopy, { touch = false } = {}) {
  const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  try {
    await page.route("https://**/*", resource => resource.abort());
    await page.addInitScript(initializeCampaignRandom, 7);
    await initializeSaveCopy(page, snapshot);
    await page.goto(url);
    await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const button = (name, scope = page) => scope.getByRole("button", { name, exact: typeof name === "string" });
    const result = await playCopy({ page, read, button });
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.close();
  }
}

async function settleCampaignCopy(snapshot, turns, prepare) {
  return withCampaignCopy(snapshot, async session => {
    const { page, read } = session;
    if (prepare) await prepare(session);
    const settled = [];
    for (let count = 1; count <= turns; count++) {
      await page.locator("#nextTurn").press("Enter");
      await page.waitForFunction(({ key, turn }) => JSON.parse(localStorage.getItem(key))?.turnCount === turn,
        { key, turn: snapshot.turnCount + count });
      settled.push(await read());
    }
    return settled;
  });
}

async function readFlyingDecisionScreen(snapshot, targetId, plannedId) {
  return withCampaignCopy(snapshot, async ({ page, read, button }) => {
    const warning = page.locator("#base-espionage-warning");
    await warning.waitFor();
    const warningText = await warning.textContent();
    assert.match(warningText, /적 첩보 신호/);
    assert.doesNotMatch(warningText, /출처/);
    await button("엔트리").press("Enter");
    const entry = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    const leader = await entry.locator('[data-entry-slot="0"] .base-entry-member span').textContent();
    await button("닫기", entry).press("Enter");
    await button("첩보 탐지 대응").press("Enter");
    const response = page.getByRole("region", { name: "비행 탐지 대응" });
    await response.waitFor();
    const responseText = await response.textContent();
    assert.doesNotMatch(responseText, /출처/);
    assert.equal(await page.locator(`[data-node="${targetId}"]`).getAttribute("aria-pressed"), "true");
    const adjacent = await page.locator('.atlas-routes [data-route]:not([data-route-state="locked"])').evaluateAll((lines, target) =>
      lines.map(line => line.dataset.route.split("|")).filter(pair => pair.includes(target))
        .map(pair => pair.find(id => id !== target)), targetId);
    const contacts = [];
    for (const id of adjacent) {
      const node = page.locator(`[data-node="${id}"]`);
      const status = await node.getAttribute("data-status");
      if (["trainer", "unknown", "scoutable"].includes(status)) contacts.push({ id, status, label: await node.getAttribute("aria-label") });
    }

    await page.locator(`[data-node="${plannedId}"]`).press("Enter");
    const report = page.getByRole("complementary", { name: "정찰 기록" });
    const trainer = await report.locator('.atlas-faction-card strong').textContent();
    const ghost = await report.getByRole("region", { name: "공개된 수비팀" }).getByRole("listitem").allTextContents();
    await report.getByText("상성·교대 분석", { exact: true }).press("Enter");
    const options = report.getByLabel("정찰한 상대 후보 타입");
    await options.waitFor();
    const candidates = [];
    for (const { value, label } of await options.getByRole("option").evaluateAll(items => items.map(item => ({ value: item.value, label: item.label })))) {
      await options.selectOption(value);
      candidates.push({ types: label, attacks: await report.getByRole("list", { name: "아군 공격 상성" }).getByRole("listitem").allTextContents(),
        threats: await report.locator(".atlas-tactics-threat").allTextContents() });
    }
    assert.deepEqual(await read(), snapshot);
    assert.ok(candidates.length);
    return { turn: snapshot.turnCount, plannedId, trainer, leader, warning: warningText, response: responseText, contacts, ghost, candidates };
  });
}

function settledTerritoryGold(save) {
  return Number(save.lastLog.find(line => line.startsWith("확보 지역 수입"))?.match(/\+(\d+)/)?.[1] ?? 0);
}

async function verifyDarkIncomeWithRoom(snapshot, order, warning) {
  const territories = Object.fromEntries(snapshot.mapSnapshot.map(site => [site.id, site]));
  const gross = frontierRules.territoryIncome(territories);
  const storageCap = Math.ceil((snapshot.resources.gold + 2 * gross) / 10) * 10;
  const starting = { ...snapshot, storageCap };
  const verifyStarting = async ({ read }) => assert.deepEqual(await read(), starting);
  const control = await settleCampaignCopy(starting, 2, verifyStarting);
  const dispatched = await settleCampaignCopy(starting, 2, async session => {
    await verifyStarting(session);
    const { page, read, button } = session;
    await button("지도").press("Enter");
    await page.getByRole("heading", { name: "월드맵", exact: true }).waitFor();
    await page.locator(`[data-node="${order.targetId}"]`).press("Enter");
    const workshop = page.getByRole("region", { name: "적 시설 생산" });
    await page.getByLabel("파견할 악 타입").selectOption(order.memberId);
    const source = page.getByLabel("방해 출발 거점");
    if (await source.count()) await source.selectOption(order.sourceId);
    await button(/악 타입 시설 방해/, workshop).press("Enter");
    await workshop.getByText(/악 타입 시설 방해 파견 완료/).waitFor();
    await button("본거지로").press("Enter");
    await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    const queued = await read();
    assert.deepEqual(queued.frontier.sabotage, order);
    assert.equal(queued.energy, starting.energy - 1);
  });

  const [controlWarning, controlSettlement] = control;
  const [blockedWarning, protectedSettlement] = dispatched;
  assert.deepEqual(controlWarning.frontier.intrusion, warning);
  assert.equal(blockedWarning.frontier.intrusion, null);
  assert.ok(blockedWarning.lastLog.some(line => line.includes("악 타입 방해 · 제작소 이번 턴 생산 중단")));
  assert.deepEqual(controlWarning.resources, blockedWarning.resources);
  assert.deepEqual(controlWarning.mapSnapshot, blockedWarning.mapSnapshot);
  assert.deepEqual(controlSettlement.mapSnapshot, protectedSettlement.mapSnapshot);
  const headroom = controlWarning.storageCap - controlWarning.resources.gold;
  assert.equal(headroom, blockedWarning.storageCap - blockedWarning.resources.gold);
  assert.ok(headroom >= gross);
  assert.ok(controlSettlement.lastLog.some(line => line.includes("적 침투 성공 · 턴당 수입 3 제외")));
  assert.ok(protectedSettlement.lastLog.every(line => !line.includes("적 침투 성공")));
  assert.equal(settledTerritoryGold(controlWarning), gross);
  assert.equal(settledTerritoryGold(blockedWarning), gross);
  assert.equal(settledTerritoryGold(controlSettlement), gross - 3);
  assert.equal(settledTerritoryGold(protectedSettlement), gross);
  assert.equal(protectedSettlement.resources.gold - controlSettlement.resources.gold, 3);

  const summarize = states => states.map(state => ({ turn: state.turnCount, income: settledTerritoryGold(state),
    gold: state.resources.gold, warning: state.frontier.intrusion }));
  return { turn: snapshot.turnCount, initialGold: snapshot.resources.gold, originalCap: snapshot.storageCap,
    testCap: storageCap, gross, headroom, control: summarize(control), dispatched: summarize(dispatched) };
}

async function compareReconLead({ snapshot, id, originalOrder, advisedOrder, rng, opponents }, reference) {
  assert.deepEqual(snapshot.entryOrder, advisedOrder);
  assert.notEqual(originalOrder[0], advisedOrder[0]);
  const starting = { ...snapshot, entryOrder: originalOrder };
  const names = new Map(snapshot.roster.map(member => [member.id, member.pokemon.nameKr]));
  const results = [];
  for (const offset of [0, 0x45d9f3b, 0x45d9f3b * 2]) {
    const pair = {};
    for (const [strategy, order] of [["original", originalOrder], ["advised", advisedOrder]]) {
      pair[strategy] = await withCampaignCopy(starting, async ({ page, read, button }) => {
        if (strategy === "advised") {
          await button("엔트리").click();
          const dialog = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
          for (let slot = originalOrder.indexOf(order[0]); slot > 0; slot--) {
            await button(`${names.get(order[0])} 앞 순서로 이동`, dialog).click();
          }
          await button("닫기", dialog).click();
        }
        const ready = await read();
        for (const field of ["roster", "buildings", "resources", "turnCount", "energy", "mapSnapshot", "frontier"]) {
          assert.deepEqual(ready[field], starting[field], field);
        }
        assert.deepEqual(ready.entryOrder, order);
        await button("지도").click();
        await page.locator(`[data-node="${id}"]`).click();
        const intel = page.getByRole("region", { name: "공개된 수비팀" });
        await intel.waitFor();
        assert.deepEqual(await intel.getByRole("listitem").allTextContents(), opponents);
        await page.evaluate(rng => { window.campaignRngState = rng; }, rng);
        await button(/거점 도전/).click();
        await page.getByRole("heading", { name: "거점 배틀", exact: true }).waitFor();
        const ally = page.locator('.duel-vitals[data-side="player"]');
        await ally.getByRole("heading", { name: names.get(order[0]), exact: true }).waitFor();
        const combatRng = await page.evaluate(offset => {
          const initial = window.campaignRngState;
          if (offset) window.campaignRngState ^= offset;
          return initial;
        }, offset);
        const result = await playCampaignBattle(page);
        assert.deepEqual(result.enemies, result.won ? reference.enemies : reference.enemies.slice(0, result.enemies.length));
        assert.equal((await read()).energy, ready.energy - 2);
        const last = await ally.evaluate(node => {
          const hp = node.querySelector("meter");
          return { name: node.querySelector("h2").textContent, hp: hp.value, maxHp: hp.max };
        });
        return { lead: names.get(order[0]), combatRng, enemies: result.enemies, choices: result.choices,
          switches: result.switches, replacements: result.replacements, outcome: result.outcome, last };
      });
    }
    assert.equal(pair.original.combatRng, pair.advised.combatRng);
    results.push(pair);
  }
  const team = originalOrder.map(id => snapshot.roster.find(member => member.id === id))
    .map(({ pokemon, level }) => `${pokemon.nameKr} Lv.${level}`);
  console.log(JSON.stringify({ audit: "frontier-lead", id, turn: snapshot.turnCount, team, results }));
  return results[0].advised;
}

async function compareDragonIncome(warning, workerId) {
  // Keep the live campaign and storage cap intact. Give both temporary copies the same room for this payout.
  const starting = { ...warning, resources: { ...warning.resources, gold: 10 } };
  assert.ok(starting.storageCap - starting.resources.gold >= 33);
  const scenarios = {};
  for (const [strategy, defend] of [["ignored", false], ["defended", true]]) {
    scenarios[strategy] = await withCampaignCopy(starting, async ({ page, read, button }) => {
      const initial = await read();
      assert.deepEqual(initial, starting);
      await page.locator("#base-intrusion-warning").waitFor();
      if (defend) {
        await button("치안 대응").click();
        await page.getByLabel("방어할 드래곤").selectOption(workerId);
        await button(/드래곤 방어/).click();
        await page.getByText("드래곤 방어 배치 완료").waitFor();
        await button("본거지로").click();
      }
      const ready = await read();
      assert.equal(ready.energy, initial.energy - Number(defend));
      assert.equal(ready.resources.gold, initial.resources.gold);
      await page.locator("#nextTurn").click();
      await page.waitForFunction(({ key, turn }) => JSON.parse(localStorage.getItem(key))?.turnCount === turn,
        { key, turn: initial.turnCount + 1 });
      const settled = await read();
      assert.ok(settled.lastLog.some(line => defend ? line.includes("침투 차단") : line.includes("적 침투 성공")));
      await page.reload();
      await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
      assert.deepEqual(await read(), settled);
      return settled;
    });
  }
  assert.equal(scenarios.ignored.resources.gold - starting.resources.gold, 30);
  assert.equal(scenarios.defended.resources.gold - starting.resources.gold, 33);
  for (const field of ["mapSnapshot", "frontier", "entryOrder", "roster", "buildings", "turnCount"]) {
    assert.deepEqual(scenarios.defended[field], scenarios.ignored[field], field);
  }
  const target = starting.frontier.intrusion.targetId;
  console.log(JSON.stringify({ audit: "frontier-income", target, turn: starting.turnCount + 1,
    defender: starting.roster.find(member => member.id === workerId).pokemon.nameKr,
    startingGold: starting.resources.gold, storageCap: starting.storageCap,
    ignored: scenarios.ignored.resources.gold - starting.resources.gold,
    defended: scenarios.defended.resources.gold - starting.resources.gold,
    loyalty: spot(scenarios.defended, target).loyalty }));
}

function withLegacyHomeResearcher(snapshot, researcherId) {
  const dojo = snapshot.buildings.find(building => !building.siteId && building.type === "dojo" && building.plotIndex === 0);
  assert.ok(dojo);
  assert.equal(snapshot.roster.filter(member => member.buildingId === dojo.id && member.jobId === "research").length, 3);
  assert.ok(snapshot.roster.some(member => member.id === researcherId && !member.buildingId));
  assert.ok(snapshot.energy >= 1);
  const jobOrder = 1 + Math.max(0, ...snapshot.roster.map(member => member.jobOrder ?? 0));
  return { ...snapshot, energy: snapshot.energy - 1, roster: snapshot.roster.map(member => member.id === researcherId
    ? { ...member, buildingId: dojo.id, jobId: "research", jobOrder } : member) };
}

async function compareResearchStaff({ snapshot, researcherId }) {
  const results = {};
  for (const mode of ["threeHome", "fourHome", "split"]) {
    const starting = mode === "fourHome" ? withLegacyHomeResearcher(snapshot, researcherId) : snapshot;
    results[mode] = await withCampaignCopy(starting, async ({ page, read, button }) => {
      assert.deepEqual(await read(), starting);
      if (mode === "split") {
        await button("지도").click();
        await page.locator('[data-node="nw-02"]').click();
        await button("거점 관리").click();
        await page.getByRole("heading", { name: "북서 2거점", exact: true }).waitFor();
        await button("1번 부지 훈련소 관리").click();
        const dialog = page.getByRole("dialog", { name: "훈련소 · 1번 부지" });
        await button(/육성 연구/, dialog).click();
        await dialog.locator(`[data-install-pick="${researcherId}"]`).click();
        await button(/직무 배치 · 행동력 1/, dialog).click();
        await button("닫기", dialog).click();
        await button("본거지로").click();
      }
      const ready = await read();
      assert.equal(ready.energy, snapshot.energy - Number(mode !== "threeHome"));
      const staff = ready.roster.filter(member => member.jobId === "research");
      assert.equal(staff.length, mode === "threeHome" ? 3 : 4);
      assert.equal(staff.filter(member => ready.buildings.find(building => building.id === member.buildingId)?.siteId === "nw-02").length,
        Number(mode === "split"));
      const produced = [];
      let current = ready;
      for (let i = 0; i < 3; i++) {
        await page.locator("#nextTurn").click();
        await page.waitForFunction(({ key, turn }) => JSON.parse(localStorage.getItem(key))?.turnCount === turn,
          { key, turn: current.turnCount + 1 });
        const after = await read();
        assert.equal(after.roster.filter(member => member.jobId === "research").length, staff.length);
        const gained = after.resources.candy - current.resources.candy;
        assert.ok(after.resources.candy < after.storageCap, "The fixed production sample must stay below the storage cap");
        produced.push(gained);
        current = after;
      }
      return produced;
    });
  }
  assert.deepEqual(results.fourHome, results.split);
  assert.ok(results.fourHome.every((amount, index) => amount > results.threeHome[index]));
  console.log(JSON.stringify({ audit: "research-staff", turn: snapshot.turnCount, startCandy: snapshot.resources.candy,
    storageCap: snapshot.storageCap, charges: 0, results }));
}

async function compareResearchSites(profile) {
  const outpost = await play(profile, "outpost");
  const home = await play(profile, "home");
  assert.deepEqual(home.checkpoint, outpost.checkpoint);
  assert.deepEqual(home.chargeEvents, outpost.chargeEvents);
  assert.deepEqual(home.candyPerTurn, outpost.candyPerTurn);
  assert.deepEqual(home.battles, outpost.battles);
  assert.deepEqual(home.metrics, outpost.metrics);
  console.log(JSON.stringify({ audit: "research-site", seed: profile.seed, checkpointTurn: home.checkpoint.snapshot.turnCount,
    worker: home.checkpoint.snapshot.roster.find(member => member.id === home.checkpoint.researcherId).pokemon.nameKr,
    sameChargeSchedule: true, sameTurnYields: true, metric: home.metrics, homeOutput: home.harvest, outpostOutput: outpost.harvest }));
  await compareResearchStaff(home.checkpoint);
}

async function compareDexRefills(profile) {
  const checkpoint = await play(profile);
  await verifyGoldForecast(checkpoint.snapshot);
  const purchaseFirst = await play(profile, "outpost", { ...checkpoint, strategy: "purchase-first" });
  const nearCap = await play(profile, "outpost", { ...checkpoint, strategy: "near-cap" });
  const turnOnly = await play(profile, "outpost", { ...checkpoint, strategy: "turn-only" });
  for (const result of [nearCap, turnOnly]) {
    assert.deepEqual(result.attempts, purchaseFirst.attempts, "The schedules must face the same encounters and capture rolls");
    assert.deepEqual(result.dex, purchaseFirst.dex);
  }
  assert.ok(purchaseFirst.stage.charges > 0);
  assert.ok(nearCap.stage.charges > 0 && nearCap.stage.charges < purchaseFirst.stage.charges);
  assert.equal(turnOnly.stage.charges, 0);
  const start = checkpoint.snapshot;
  console.log(JSON.stringify({ seed: profile.seed, audit: "dex-refill", start: { version: start.v, turn: start.turnCount,
    energy: start.energy, gold: start.resources.gold, storageCap: start.storageCap, dex: start.caughtSpeciesIds.length },
    purchaseFirst: purchaseFirst.stage, nearCap: nearCap.stage, turnOnly: turnOnly.stage,
    nearCapPurchaseBalances: [...new Set(nearCap.chargeEvents.map(([, , gold]) => gold))],
    extraTurns: turnOnly.stage.toTurn - purchaseFirst.stage.toTurn,
    spendingSaved: (purchaseFirst.stage.charges - turnOnly.stage.charges) * ENERGY_CHARGE_COST,
    extraGoldAtEnding: turnOnly.stage.toGold - purchaseFirst.stage.toGold }));
}

function legacyInheritanceSave({ inheritedResearchCompleted: _completed, legacyOutpostResearch: _legacy, buildings, ...snapshot }) {
  return { ...snapshot, buildings: buildings.map(({ inherited: _inherited, ...building }) => building) };
}

async function verifyInheritedDojoChallenge(snapshot, { siteId = "nw-02", checkIsolation = false } = {}) {
  assert.equal(snapshot.v, 4);
  assert.equal(snapshot.outposts[siteId].inheritancePending, true);
  const siteName = worldMapNodes.find(node => node.id === siteId).name;
  const legacy = legacyInheritanceSave(snapshot);

  for (const touch of checkIsolation ? [false, true] : [false]) {
    const starting = touch ? { ...legacy, mapSnapshot: legacy.mapSnapshot.map(site => site.id === "nw-01"
      ? { ...site, owner: "unoccupied", trainerId: null, loyalty: 0 } : site) } : legacy;
    await withCampaignCopy(starting, async ({ page, read, button }) => {
      const use = locator => touch ? locator.tap() : locator.press("Enter");
      const heading = name => page.getByRole("heading", { name, exact: true });
      const goals = page.getByRole("dialog", { name: "관측 목표와 도감" });
      const challenge = goals.getByRole("list", { name: "선택 도전 과제" });
      async function progress(hint, status = "진행 중") {
        await use(button("목표·도감"));
        await challenge.getByText("승계 훈련소에서 사탕 생산하기", { exact: true }).waitFor();
        await challenge.getByText(hint, { exact: true }).waitFor();
        await challenge.getByText(status, { exact: true }).waitFor();
        assert.equal(await challenge.getByRole("button").count(), Number(status === "달성"));
        await use(button("닫기", goals));
      }
      async function selectOutpost() {
        await use(button("지도"));
        await heading("월드맵").waitFor();
        await use(page.locator(`[data-node="${siteId}"]`));
      }
      async function turn() {
        const next = (await read()).turnCount + 1;
        await use(page.locator("#nextTurn"));
        await page.waitForFunction(({ key, next }) => JSON.parse(localStorage.getItem(key))?.turnCount === next, { key, next });
        return read();
      }

      assert.deepEqual(await read(), { ...starting, legacyOutpostResearch: true });
      await progress("훈련소가 후보인 트레이너 거점을 확보하고 훈련소를 승계하세요.");
      await selectOutpost();
      await use(button("훈련소 승계", page.getByRole("region", { name: "AI 건물 승계" })));
      await page.waitForFunction(({ key, siteId }) => JSON.parse(localStorage.getItem(key)).buildings.some(building =>
        building.siteId === siteId && building.type === "dojo" && building.inherited === true), { key, siteId });
      const dojo = (await read()).buildings.find(building => building.siteId === siteId && building.type === "dojo");
      await use(button("본거지로"));
      await heading("본거지").waitFor();
      await page.reload();
      await heading("본거지").waitFor();
      assert.deepEqual((await read()).buildings.find(building => building.id === dojo.id), dojo);

      if (touch) {
        await progress(`${siteName}까지 본거지 보급로를 연결하세요.`);
        const isolated = await turn();
        assert.equal(isolated.inheritedResearchCompleted, undefined);
        await progress(`${siteName}까지 본거지 보급로를 연결하세요.`);
        return;
      }

      await progress(`${siteName}의 승계 훈련소에 육성 연구원을 배치하세요.`);
      if (!(await read()).energy) {
        await use(button("상점"));
        const shop = page.getByRole("dialog", { name: /상점/ });
        await use(button("구매", shop));
        await use(button("닫기", shop));
      }
      const researcher = (await read()).roster.find(member => member.jobId === "research");
      assert.ok(researcher);
      await selectOutpost();
      await use(button("거점 관리"));
      await heading(siteName).waitFor();
      await use(button("1번 부지 훈련소 관리"));
      const facility = page.getByRole("dialog", { name: "훈련소 · 1번 부지" });
      await use(button(/육성 연구/, facility));
      await use(facility.locator(`[data-install-pick="${researcher.id}"]`));
      await use(button("직무 배치 · 행동력 1", facility));
      await use(button("닫기", facility));
      await use(button("본거지로"));
      await heading("본거지").waitFor();
      await progress(`${siteName}의 승계 훈련소에서 다음 턴에 사탕을 생산합니다.`);
      const staffed = await read();
      assert.equal(staffed.inheritedResearchCompleted, undefined);
      assert.ok(staffed.roster.some(member => member.id === researcher.id && member.buildingId === dojo.id && member.jobId === "research"));
      const completed = await turn();
      const production = completed.lastLog.find(line => line.startsWith(`${siteName} 1번 부지 · 육성 연구 · `));
      assert.match(production ?? "", /경험치 사탕 \+[1-9]/);
      assert.equal(completed.inheritedResearchCompleted, true);
      assert.deepEqual(completed.claimedDexRewards, staffed.claimedDexRewards);
      await progress("보급이 연결된 승계 훈련소에서 경험치 사탕을 생산했습니다.", "달성");
      await page.reload();
      await heading("본거지").waitFor();
      assert.deepEqual(await read(), completed);
      await progress("보급이 연결된 승계 훈련소에서 경험치 사탕을 생산했습니다.", "달성");
      console.log(JSON.stringify({ audit: "inherited-dojo-challenge", site: dojo.siteId, startTurn: starting.turnCount,
        completedTurn: completed.turnCount, production, reloaded: true }));
    }, { touch });
  }
  if (checkIsolation) console.log("Inherited dojo Chrome passed: legacy v4 restoration, keyboard completion and touch isolation");
}

async function verifyLegacyClearedChallenge(snapshot) {
  assert.equal(snapshot.inheritedResearchCompleted, true);
  const legacy = legacyInheritanceSave(snapshot);
  const siteId = await withCampaignCopy(legacy, async ({ page, read, button }) => {
    assert.deepEqual(await read(), { ...legacy, legacyOutpostResearch: true });
    await button("목표·도감").press("Enter");
    const challenge = page.getByRole("list", { name: "선택 도전 과제" });
    await challenge.getByText("진행 중", { exact: true }).waitFor();
    assert.deepEqual(await read(), { ...legacy, legacyOutpostResearch: true });
    await page.keyboard.press("Escape");
    await button("지도").press("Enter");
    await page.getByRole("heading", { name: "월드맵", exact: true }).waitFor();
    const choice = page.getByRole("region", { name: "AI 건물 승계" });
    for (const [id, outpost] of Object.entries(legacy.outposts)) {
      if (!outpost.inheritancePending) continue;
      await page.locator(`[data-node="${id}"]`).press("Enter");
      await page.locator(`[data-node="${id}"][aria-pressed="true"]`).waitFor();
      await choice.waitFor();
      if (await button("훈련소 승계", choice).count()) return id;
    }
    throw new Error("A pending dojo should still be available in the legacy 40-site save");
  });
  await verifyInheritedDojoChallenge(legacy, { siteId });
  console.log(JSON.stringify({ audit: "inherited-dojo-legacy-cleared", turn: legacy.turnCount, cleared: 40, preserved: true, siteId }));
}

async function verifyExhaustedDojoChallenge(snapshot) {
  assert.equal(snapshot.legacyOutpostResearch, false);
  const legacy = legacyInheritanceSave(snapshot);
  const oldDojo = legacy.buildings.find(building => building.type === "dojo" && building.siteId === "nw-02");
  assert.ok(oldDojo);
  const withoutDojo = { ...legacy, buildings: legacy.buildings.filter(building => building.id !== oldDojo.id),
    roster: legacy.roster.map(member => {
      if (member.buildingId !== oldDojo.id) return member;
      const { jobOrder: _order, ...available } = member;
      return { ...available, buildingId: null, jobId: null };
    }) };
  const cases = [
    { name: "existing", source: legacy, outpostRoute: true, siteId: "nw-02", build: false },
    { name: "construction", source: withoutDojo, outpostRoute: true, siteId: "nw-01", build: true },
    { name: "standard", source: { ...withoutDojo, legacyOutpostResearch: snapshot.legacyOutpostResearch },
      outpostRoute: false, siteId: "nw-01", build: true },
  ];
  let legacyCompletion;
  for (const { name, source, outpostRoute, siteId, build } of cases) {
    const completed = await withCampaignCopy(source, async ({ page, read, button }) => {
      const siteName = worldMapNodes.find(node => node.id === siteId).name;
      const heading = name => page.getByRole("heading", { name, exact: true });
      const goals = page.getByRole("dialog", { name: "관측 목표와 도감" });
      const challenge = goals.getByRole("list", { name: "선택 도전 과제" });
      const use = locator => locator.press("Enter");
      async function progress(facility, status, hint) {
        await use(button("목표·도감"));
        await challenge.getByText(`${facility}에서 사탕 생산하기`, { exact: true }).waitFor();
        await challenge.getByText(status, { exact: true }).waitFor();
        if (hint) await challenge.getByText(hint, { exact: true }).waitFor();
        assert.equal(await challenge.getByRole("button").count(), Number(status === "달성"));
        await use(button("닫기", goals));
      }
      async function map() {
        await use(button("지도"));
        await heading("월드맵").waitFor();
      }
      async function selectSite(id) {
        await use(page.locator(`[data-node="${id}"]`));
        await page.locator(`[data-node="${id}"][aria-pressed="true"]`).waitFor();
      }
      async function home() {
        await use(button("본거지로"));
        await heading("본거지").waitFor();
      }
      async function openOutpost() {
        await map();
        await selectSite(siteId);
        await use(button("거점 관리"));
        await heading(siteName).waitFor();
      }
      async function turn() {
        const next = (await read()).turnCount + 1;
        await use(page.locator("#nextTurn"));
        await page.waitForFunction(({ key, next }) => JSON.parse(localStorage.getItem(key)).turnCount === next, { key, next });
        return read();
      }

      assert.deepEqual(await read(), { ...source, legacyOutpostResearch: outpostRoute });
      await progress("승계 훈련소", "진행 중");
      await map();
      for (const [id, site] of Object.entries(source.outposts)) {
        if (!site.inheritancePending) continue;
        await selectSite(id);
        const choice = page.getByRole("region", { name: "AI 건물 승계" });
        await use(button("승계 포기", choice));
        await choice.waitFor({ state: "hidden" });
      }
      await home();
      const exhausted = await read();
      assert.ok(Object.values(exhausted.outposts).every(site => !site.inheritancePending));
      assert.deepEqual(exhausted.mapSnapshot, source.mapSnapshot);
      assert.deepEqual(exhausted.buildings, source.buildings);
      assert.deepEqual(exhausted.resources, source.resources);
      await page.reload();
      await heading("본거지").waitFor();
      assert.deepEqual(await read(), exhausted);

      if (build) {
        if (outpostRoute) await progress("점령지 훈련소", "진행 중", `${siteName}에 훈련소를 건설하세요.`);
        else await progress("승계 훈련소", "진행 불가");
        await use(button("상점"));
        const shop = page.getByRole("dialog", { name: /상점/ });
        await use(button("구매", shop));
        await use(button("닫기", shop));
        const before = await read();
        await openOutpost();
        await use(button("1번 부지 건설"));
        const builder = page.getByRole("dialog", { name: "건설 · 1번 부지" });
        await use(button("훈련소", builder));
        const builders = (await builder.locator("[data-install-pick]").all()).slice(0, 3);
        assert.equal(builders.length, 3);
        for (const worker of builders) await use(worker);
        await use(builder.locator("[data-build-confirm]"));
        await builder.waitFor({ state: "hidden" });
        assert.equal((await read()).energy, before.energy - 1);
        if (outpostRoute) await progress("점령지 훈련소", "진행 중", `${siteName}의 훈련소를 완공하세요.`);
        await turn();
        const researcher = (await read()).roster.find(member => member.jobId === "research");
        assert.ok(researcher);
        await use(button("1번 부지 훈련소 관리"));
        const facility = page.getByRole("dialog", { name: "훈련소 · 1번 부지" });
        await use(button(/육성 연구/, facility));
        await use(facility.locator(`[data-install-pick="${researcher.id}"]`));
        await use(button("직무 배치 · 행동력 1", facility));
        await use(button("닫기", facility));
        await home();
      }
      if (outpostRoute) await progress("점령지 훈련소", "진행 중", `${siteName}의 점령지 훈련소에서 다음 턴에 사탕을 생산합니다.`);
      else await progress("승계 훈련소", "진행 불가");
      const ready = await read();
      assert.equal(ready.inheritedResearchCompleted, undefined);
      const produced = await turn();
      const production = produced.lastLog.find(line => line.startsWith(`${siteName} 1번 부지 · 육성 연구 · `));
      assert.match(production ?? "", /경험치 사탕 \+[1-9]/);
      assert.equal(produced.inheritedResearchCompleted, outpostRoute ? true : undefined);
      assert.deepEqual(produced.claimedDexRewards, ready.claimedDexRewards);
      assert.equal(produced.buildings.find(building => building.siteId === siteId && building.type === "dojo")?.inherited, undefined);
      await page.reload();
      await heading("본거지").waitFor();
      assert.deepEqual(await read(), produced);
      if (outpostRoute) await progress("점령지 훈련소", "달성", "보급이 연결된 점령지 훈련소에서 경험치 사탕을 생산했습니다.");
      else await progress("승계 훈련소", "진행 불가");
      console.log(JSON.stringify({ audit: "exhausted-dojo-challenge", path: name, from: source.turnCount,
        turn: produced.turnCount, production, completed: produced.inheritedResearchCompleted === true, reloaded: true }));
      return produced;
    });
    if (name === "existing") legacyCompletion = completed;
  }
  return legacyCompletion;
}

async function verifyInheritedResearchReward(snapshot, { touch = false } = {}) {
  assert.equal(snapshot.inheritedResearchCompleted, true);
  assert.equal(snapshot.inheritedResearchRewardClaimed, undefined);
  // Keep the original completion and use one free candy slot to exercise all-or-nothing payment.
  const starting = touch ? { ...snapshot, resources: { ...snapshot.resources, candy: snapshot.storageCap - 1 } } : snapshot;
  await withCampaignCopy(starting, async ({ page, read, button }) => {
    const use = locator => touch ? locator.tap() : locator.press("Enter");
    const goals = page.getByRole("dialog", { name: "관측 목표와 도감" });
    const challenge = goals.getByRole("list", { name: "선택 도전 과제" });
    const claim = button("과제 보상 받기", challenge);
    async function openGoals() {
      await use(button("목표·도감"));
      await challenge.getByText("달성", { exact: true }).waitFor();
      await challenge.getByText("보상 · 경험치 사탕 +2", { exact: true }).waitFor();
    }

    assert.deepEqual(await read(), starting);
    await openGoals();
    if (touch) {
      const blocked = button("저장 공간 부족", challenge);
      assert.ok(await blocked.isDisabled());
      await blocked.evaluate(button => button.click());
      assert.deepEqual(await read(), starting);
      await page.reload();
      await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
      await openGoals();
      assert.ok(await blocked.isDisabled());
      await use(button("닫기", goals));
      await use(button(/포켓몬 \d/));
      const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
      await use(pc.locator(`[data-install-pick="${starting.roster[0].id}"]`));
      await use(button("사탕 먹이기", pc));
      await use(button("닫기", pc));
      assert.equal((await read()).resources.candy, starting.storageCap - 2);
      await openGoals();
    }

    const before = await read();
    assert.ok(await claim.isEnabled());
    if (touch) await use(claim);
    else await claim.evaluate(button => { button.click(); button.click(); });
    await challenge.getByText("수령 완료", { exact: true }).waitFor();
    const rewarded = await read();
    assert.deepEqual(rewarded, { ...before, resources: { ...before.resources, candy: before.resources.candy + 2 },
      inheritedResearchRewardClaimed: true });
    await page.reload();
    await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    await openGoals();
    await challenge.getByText("수령 완료", { exact: true }).waitFor();
    assert.equal(await claim.count(), 0);
    assert.deepEqual(await read(), rewarded);
    console.log(JSON.stringify({ audit: "inherited-research-reward", path: touch ? "legacy-outpost" : "inheritance",
      turn: before.turnCount, slotsBefore: before.storageCap - before.resources.candy, candyBefore: before.resources.candy,
      candyAfter: rewarded.resources.candy, blockedWithOneSlot: touch, reloaded: true }));
  }, { touch });
}

async function verifyGoldForecast(snapshot) {
  async function reading(root, label, received, overflow) {
    const forecast = root.getByRole("group", { name: label, exact: true });
    await forecast.getByText(`받을 자금 +${received}`, { exact: true }).waitFor();
    await forecast.getByText(`상한으로 못 받는 자금 ${overflow}`, { exact: true }).waitFor();
  }

  for (const touch of [false, true]) {
    await withCampaignCopy(snapshot, async ({ page, read, button }) => {
      const use = locator => touch ? locator.tap() : locator.press("Enter");
      const base = page.getByRole("heading", { name: "본거지", exact: true });
      const shop = page.getByRole("dialog", { name: /상점/ });
      const now = "다음 턴 자금";
      const afterPurchase = "구매 후 다음 턴 자금";
      const openShop = async () => {
        await use(button("상점"));
        await shop.waitFor();
        assert.ok(await shop.evaluate(dialog => dialog.contains(document.activeElement)));
      };
      const closeShop = async () => {
        if (touch) await use(button("닫기", shop));
        else await page.keyboard.press("Escape");
        await shop.waitFor({ state: "hidden" });
      };
      const afterTurn = async (turn, income) => {
        await use(page.locator("#nextTurn"));
        await page.waitForFunction(({ key, turn }) => JSON.parse(localStorage.getItem(key))?.turnCount === turn, { key, turn });
        const settled = await read();
        assert.equal(settled.resources.gold, 50);
        assert.ok(settled.lastLog.includes(`확보 지역 수입 · 자금 +${income}`));
        await reading(page, now, 0, 117);
        return settled;
      };

      assert.deepEqual(await read(), snapshot);
      await reading(page, now, 30, 87);
      const nextTurn = page.locator("#nextTurn");
      assert.ok((await nextTurn.getAttribute("aria-describedby")).split(" ").includes("base-gold-preview"));
      const shopHint = page.getByText("행동력이 더 필요하면 상점에서 충전권 구매 전후를 비교하세요.", { exact: true });
      await shopHint.waitFor();
      if (touch) {
        await afterTurn(47, 30);
        await openShop();
        assert.ok(await button("구매", shop).isDisabled());
        assert.equal(await shop.getByRole("group", { name: afterPurchase, exact: true }).count(), 0);
        await closeShop();
        for (let attempt = 0; attempt < 2; attempt++) {
          await use(button(/^탐험/));
          await page.getByRole("heading", { name: "야생 탐험", exact: true }).waitFor();
          await use(button("본거지로"));
          await base.waitFor();
        }
        assert.equal((await read()).energy, 1);
        await shopHint.waitFor();
      }

      await openShop();
      await shop.getByText("다음 턴 자금 저장 상한 50", { exact: true }).waitFor();
      await reading(shop, now, touch ? 0 : 30, touch ? 117 : 87);
      await reading(shop, afterPurchase, touch ? 5 : 35, touch ? 112 : 82);
      await shop.getByText("다음 턴 예상 잔액 · 바로 넘기면 50 · 충전권 구매 후 50", { exact: true }).waitFor();
      await shop.getByText(/다음 턴에는 행동력이 5까지 회복됩니다/).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      assert.ok(await shop.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
      await use(button("구매", shop));
      await page.getByRole("heading", { name: `상점 · 자금 ${touch ? 45 : 15}`, exact: true }).waitFor();
      await reading(shop, now, touch ? 5 : 35, touch ? 112 : 82);
      const purchased = await read();
      assert.equal(purchased.resources.gold, touch ? 45 : 15);
      assert.equal(purchased.energy, touch ? 3 : 2);
      await closeShop();
      await reading(page, now, touch ? 5 : 35, touch ? 112 : 82);
      await shopHint.waitFor({ state: "hidden" });
      const settled = await afterTurn(touch ? 48 : 47, touch ? 5 : 35);
      assert.deepEqual(settled.caughtSpeciesIds, snapshot.caughtSpeciesIds);
      await page.reload();
      await base.waitFor();
      await reading(page, now, 0, 117);
      assert.deepEqual(await read(), settled);
    }, { touch });
  }
  console.log(JSON.stringify({ audit: "gold-forecast", turn: snapshot.turnCount, gold: snapshot.resources.gold,
    keyboardSettled: 35, touchSettled: [30, 5], goldCap: 50, reloaded: true }));
}

async function play(profile, researchSite = "outpost", dexRefill, flyingMode) {
  const { seed, picks } = profile;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (baselineData) await useHistoricalBattleData(page);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://**/*", image => image.abort());
  page.setDefaultTimeout(10000);
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: typeof name === "string" });
  const heading = name => page.getByRole("heading", { name, exact: true });
  const ending = heading("관측 임무 완료");
  const save = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const tap = locator => locator.evaluate(button => button.click());
  const close = async dialog => { await tap(button("닫기", dialog)); await dialog.waitFor({ state: "hidden" }); };
  const map = async () => { await tap(button("지도")); await heading("월드맵").waitFor(); };
  const base = async () => {
    await tap(button("본거지로"));
    await heading("본거지").or(ending).waitFor();
    if (!endingRun && await ending.count()) {
      await tap(button("계속 플레이"));
      await heading("본거지").waitFor();
    }
  };
  const focus = id => tap(page.locator(`[data-node="${id}"]`));
  const report = page.getByRole("region", { name: "도전 전 확인" });
  const dojo = () => page.getByRole("dialog", { name: "훈련소 · 1번 부지" });
  const logs = [];
  const dexStages = [];
  const dexAttempts = [];
  const totals = { charges: 0, candies: 0, hunts: 0, added: 0, growthTurns: 0, supplyTurns: 0, observedIsolationTurns: 0,
    missedGrossGold: 0, forfeitedGold: 0, lost: [], retries: 0, counterHunts: 0 };
  const favor = { stages: [], turns: [], healItemsProduced: 0, recovery: [], sashProtection: [], hunts: [],
    actionPower: { hunts: 0, clearing: 0, construction: 0, assignments: 0 }, charges: 0, tool: 0, material: 0 };
  const ledger = { turnRefill: 0, purchasedRefill: 0, income: 0, raids: [], chargeEvents: [], candyPerTurn: [] };
  const settlements = { construction: 0, clearing: 0, assignments: 0, harvest: {}, inheritances: [],
    outpostAssignments: 0, outpostHunts: 0, outpostCharges: 0, outpostTurns: 0, placements: [], remoteMaterialUsed: 0, sash: null };
  let productionCrew;
  let researchCheckpoint;
  const operations = { hunts: 0, recruitEnergy: 0, dragon: null, defenseEnergy: 0, reconEnergy: 0,
    clinicEnergy: 0, charges: 0, turns: [], reports: [] };
  const dark = { hunts: 0, recruitEnergy: 0, dispatchEnergy: 0, preparationTurns: [], worker: null, prevented: [] };
  const flying = { hunts: [], recruitEnergy: 0, detectEnergy: 0, detectCharges: 0, recoveryEnergy: 0, worker: null, events: [] };
  let startingEnergy;
  let registeelId;
  let aceIds;
  let thirdStarterId;
  let region = 0;
  let battleSite = "draft";
  const audit = trainingAudit ? auditCases.get(seed) : undefined;
  const growthLog = [];
  const turnLog = [];
  const guidance = [];
  let fork;
  let target;
  let bippaTactics;
  let defenseCheckpoint;
  let leadCheckpoint;
  let flyingBattleCheckpoints;

  async function turn(reason) {
    let before = await save();
    if (flyingDecisionAudit && flyingMode === "observe" && [30, 35].includes(before.turnCount) &&
      await page.locator("#base-espionage-warning").filter({ hasText: "남동 7거점" }).count()) {
      const visible = await readFlyingDecisionScreen(before, "se-07", "se-10");
      console.log(JSON.stringify({ audit: "Flying decision screen", ...visible }));
    }
    const connected = new Set(["home"]);
    for (const id of connected) {
      for (const neighbor of worldMapNodes.find(node => node.id === id).neighbors) {
        const next = spot(before, neighbor);
        if (next.active && next.owner === "player") connected.add(neighbor);
      }
    }
    const cut = before.mapSnapshot.filter(site => site.owner === "player" && site.loyalty != null && !connected.has(site.id));
    const gross = 3 * before.mapSnapshot.filter(site => site.id !== "home" && site.owner === "player" &&
      (startingIds.has(site.id) || connected.has(site.id))).length;
    if (useFrontier) before = await defendThreat(before, gross);
    const operation = darkAudit ? await dispatchDarkWhenEffective(before) : null;
    if (operation) before = operation.queued;
    if (flyingMode === "detect") before = await detectEnemyObservation(before);
    await tap(page.locator("#nextTurn"));
    await page.waitForFunction(({ key, next }) => JSON.parse(localStorage.getItem(key))?.turnCount === next, { key, next: before.turnCount + 1 });
    const after = await save();
    if (flyingMode && before.frontier.espionage?.observation) {
      const { sourceId, targetId, detectorId } = before.frontier.espionage.observation;
      const resolution = after.lastLog.find(line => /적 첩보 (차단|성공|취소)/.test(line));
      const outcome = resolution?.match(/적 첩보 (차단|성공|취소)/)[1];
      assert.ok(outcome, `Missing observation resolution at turn ${after.turnCount}`);
      assert.equal(outcome === "차단", Boolean(detectorId));
      if (detectorId) assert.notEqual(after.frontier.espionage?.preparation?.territoryId, sourceId);
      flying.events.push({ turn: after.turnCount, sourceId, targetId, outcome, detectorId });
    }
    if (operation) {
      assert.equal(after.frontier.intrusion, null);
      assert.equal(after.frontier.sabotage, undefined);
      assert.ok(after.lastLog.some(line => line.includes("악 타입 방해 · 제작소 이번 턴 생산 중단")));
      const [kept] = await settleCampaignCopy(after, 1);
      assert.deepEqual(operation.control[0].resources, after.resources);
      assert.ok(operation.control[1].lastLog.some(line => line.includes("적 침투 성공 · 턴당 수입 3 제외")));
      dark.prevented.push({ turn: after.turnCount, workshop: operation.queued.frontier.sabotage.targetId,
        source: operation.control[0].frontier.intrusion.sourceId, target: operation.control[0].frontier.intrusion.targetId,
        headroom: after.storageCap - after.resources.gold,
        controlIncome: settledTerritoryGold(operation.control[1]), protectedIncome: settledTerritoryGold(kept) });
    }
    if (reason === "dark-recruit" || reason === "dark-window") {
      dark.preparationTurns.push({ turn: after.turnCount, reason, income: settledTerritoryGold(after) });
    }
    if (manageFavor && registeelId) {
      if (researchSiteAudit) ledger.candyPerTurn.push(after.resources.candy - before.resources.candy);
      for (const line of after.lastLog) {
        const reading = line.match(/^(?:(.+?) )?\d+번 부지 · .+? · .+? · (.+?) \+(\d+)(?: ·|$)/);
        if (!reading) continue;
        const [, site = "본거지", resource, amount] = reading;
        const siteYield = settlements.harvest[site] ??= {};
        siteYield[resource] = (siteYield[resource] ?? 0) + Number(amount);
        if (site !== "본거지") settlements.remoteMaterialUsed += Number(line.match(/ · 재료 −(\d+)/)?.[1] ?? 0);
      }
      if (reason === "outposts") settlements.outpostTurns++;
      ledger.turnRefill += after.energy - before.energy;
      ledger.income += settledTerritoryGold(after);
      const intrusion = before.frontier.intrusion;
      if (intrusion) {
        const outcome = after.lastLog.find(line => /침투 차단|적 침투 성공|침투 위협 해소/.test(line));
        assert.ok(outcome);
        const room = Math.max(0, after.storageCap - before.resources.gold);
        const atStake = outcome.includes("해소") ? 0 : Math.min(gross, room) - Math.min(gross - 3, room);
        ledger.raids.push({ turn: after.turnCount, site: intrusion.targetId, outcome: outcome.includes("차단") ? "blocked"
          : outcome.includes("성공") ? "hit" : "cancelled", gross, room, atStake });
      }
      if (reason === "frontier" || reason === "recon" || reason === "defense") operations.turns.push({ turn: after.turnCount, reason });
      assert.ok(after.roster.some(member => member.id === registeelId), `Registeel departed at turn ${after.turnCount}`);
      if (reason === "favor") favor.turns.push(after.turnCount);
      favor.healItemsProduced += after.resources.healItem - before.resources.healItem;
      if (after.lastLog.includes("레지스틸 · 기합의띠로 이탈 방지")) favor.sashProtection.push(after.turnCount);
    }
    if (audit) turnLog.push({ reason, candyBefore: before.resources.candy, candyProduced: after.resources.candy - before.resources.candy,
      workers: before.roster.filter(member => member.jobId === "research").map(({ pokemon, level, aptitude }) => [pokemon.nameKr, level, aptitude]) });
    if (reason === "growth") totals.growthTurns++;
    if (reason === "supply") totals.supplyTurns++;
    if (cut.length) {
      totals.observedIsolationTurns++;
      totals.missedGrossGold += 3 * cut.length;
      const normallyEarned = 3 * (before.mapSnapshot.filter(site => site.owner === "player").length - 1);
      const capRoom = Math.max(0, after.storageCap - before.resources.gold);
      totals.forfeitedGold += Math.min(normallyEarned, capRoom) - Math.min(normallyEarned - 3 * cut.length, capRoom);
      for (const site of cut) {
        const result = spot(after, site.id);
        const expected = Math.max(0, site.loyalty - 35);
        assert.equal(result.loyalty, expected);
        if (!expected) totals.lost.push(site.id);
      }
    }
    const maintained = manageFavor && registeelId ? await maintainFavor(after) : after;
    if (productionCrew && !settlements.sash && maintained.resources.tool >= 3) return finishOutpostCraft(maintained);
    return maintained;
  }

  function canBuyCharge(state) {
    if (dexRefill?.strategy === "turn-only") return false;
    const minimumGold = dexRefill?.strategy === "near-cap"
      ? Math.max(ENERGY_CHARGE_COST, state.storageCap - ENERGY_CHARGE_COST)
      : ENERGY_CHARGE_COST;
    return state.resources.gold >= minimumGold;
  }

  async function charge() {
    const before = manageFavor ? await save() : null;
    if (dexRefill) assert.ok(canBuyCharge(before), "The purchase must follow the refill strategy");
    await tap(button("상점"));
    const shop = page.getByRole("dialog", { name: /상점/ });
    await tap(button("구매", shop));
    await close(shop);
    totals.charges++;
    const after = await save();
    if (before) ledger.purchasedRefill += after.energy - before.energy;
    if (endingRun) {
      assert.equal(after.resources.gold, before.resources.gold - ENERGY_CHARGE_COST);
      assert.equal(after.energy, Math.min(5, before.energy + 2));
    }
    if (researchSiteAudit || dexRefill) ledger.chargeEvents.push([before.turnCount, before.energy, before.resources.gold, after.energy]);
    return after;
  }

  async function energy(amount, preferTurn = false, reason = "energy") {
    let state = await save();
    while (state.energy < amount) {
      if (!preferTurn && canBuyCharge(state)) {
        state = await charge();
        if (reason === "favor") favor.charges++;
        if (reason === "frontier") operations.charges++;
        if (reason === "outposts") settlements.outpostCharges++;
      } else {
        state = await turn(reason);
      }
    }
    return state;
  }

  async function setParty(ids) {
    const state = await save();
    const next = [...new Set(ids)].slice(0, 6);
    if (state.entryOrder.join() === next.join()) return;
    await tap(button("엔트리"));
    const dialog = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
    for (const id of state.entryOrder) await tap(dialog.locator(`[data-pc-member="${id}"]`));
    for (const id of next) await tap(dialog.locator(`[data-pc-member="${id}"]`));
    await close(dialog);
    assert.deepEqual((await save()).entryOrder, next);
  }

  async function identify(target, fromMap = false, destination = fromMap ? "월드맵" : "본거지") {
    const before = await save();
    await tap(target);
    await tap(button(/본인확인서 대조/));
    const silhouette = page.locator('[data-mode="silhouette"] .identify-target-art');
    await silhouette.waitFor();
    const id = Number((await silhouette.getAttribute("src")).match(/(\d+)\.png$/)?.[1]);
    const chance = dexRefill ? Number(await page.locator("#capture-chance").getAttribute("value")) : null;
    const guess = page.getByRole("textbox", { name: "포켓몬 이름" });
    await guess.fill(species.get(id).nameKr);
    const rng = dexRefill ? await page.evaluate(() => window.campaignRngState) : null;
    await guess.press("Enter");
    const outcome = page.locator(".identify-outcome");
    await outcome.waitFor();
    const caught = await outcome.getAttribute("data-result") === "captured";
    if (dexRefill) dexAttempts.push({ id, chance, rng, caught });
    await tap(button(fromMap ? "월드맵으로" : "본거지로"));
    const arrival = heading(destination);
    await (destination === "본거지" && endingRun ? arrival.or(ending) : arrival).waitFor();
    totals.hunts++;
    const after = await save();
    assert.equal(after.roster.length, before.roster.length + Number(caught));
    totals.added += Number(caught);
    return caught ? after.roster.at(-1) : null;
  }

  const pc = () => page.getByRole("dialog", { name: /보유 포켓몬/ });
  const selectMember = (dialog, id) => tap(dialog.locator(`[data-install-pick="${id}"]`));

  async function useRecovery(state, member) {
    await tap(button(/포켓몬 \d/));
    await selectMember(pc(), member.id);
    await tap(button("회복 아이템 사용", pc()));
    await close(pc());
    const recovered = await save();
    assert.equal(recovered.resources.healItem, state.resources.healItem - 1);
    assert.equal(recovered.energy, state.energy - 1);
    const updated = recovered.roster.find(candidate => candidate.id === member.id);
    assert.equal(updated.favor, Math.min(member.favCeil, member.favor + 15));
    assert.equal(updated.departurePending, undefined);
    favor.recovery.push({ turn: recovered.turnCount, name: member.pokemon.nameKr, from: member.favor, to: updated.favor });
    return recovered;
  }

  async function maintainFavor(state) {
    const important = new Set([...aceIds, thirdStarterId, operations.dragon?.id, dark.worker?.id, flying.worker?.id]);
    const atRisk = state.roster.filter(member => member.departurePending &&
      (important.has(member.id) || member.jobId === "research" || member.jobId === "heal"));
    for (const member of atRisk) {
      if (!state.resources.healItem) break;
      if (!state.energy && canBuyCharge(state)) {
        state = await charge();
        favor.charges++;
      }
      if (!state.energy) break;
      state = await useRecovery(state, member);
      if (member.id === flying.worker?.id) flying.recoveryEnergy++;
    }
    return state;
  }

  async function scanForType(type) {
    const scan = page.getByRole("complementary", { name: "관측 패널" });
    for (const candidate of await page.locator(".hunt-target").all()) {
      await candidate.focus();
      if ((await scan.innerText()).includes(type)) return candidate;
    }
  }

  async function supportHunt(openSearch, type) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = await energy(2, false, "favor");
      await openSearch();
      await heading("야생 탐험").waitFor();
      const target = await scanForType(type);
      assert.ok(target, `Type search did not detect ${type}`);
      const caught = await identify(target);
      assert.equal((await save()).energy, before.energy - 2);
      favor.actionPower.hunts += 2;
      favor.hunts.push({ turn: before.turnCount, type, caught: caught?.pokemon.nameKr ?? null });
      if (caught) return caught;
    }
    throw new Error(`Failed to recruit a ${type} Pokémon`);
  }

  async function recruitDragon() {
    for (let attempt = 0; attempt < 60; attempt++) {
      const before = await energy(2, false, "frontier");
      await tap(button(/탐험 행동력 2/));
      await heading("야생 탐험").waitFor();
      const target = await scanForType("드래곤");
      let caught;
      if (target) caught = await identify(target);
      else {
        await base();
        totals.hunts++;
      }
      assert.equal((await save()).energy, before.energy - 2);
      operations.hunts++;
      operations.recruitEnergy += 2;
      if (!caught) continue;
      assert.ok([caught.pokemon.type1Rowid, caught.pokemon.type2Rowid].includes(16));
      operations.dragon = { id: caught.id, name: caught.pokemon.nameKr, turn: before.turnCount };
      return;
    }
    throw new Error("The general scanner did not recruit a Dragon type");
  }

  async function recruitDark() {
    const isDark = member => [member.pokemon.type1Rowid, member.pokemon.type2Rowid].includes(frontierRules.DARK_TYPE);
    let worker = (await save()).roster.find(member => isDark(member) && !member.buildingId);
    for (let attempt = 0; !worker && attempt < 60; attempt++) {
      const before = await energy(2, false, "dark-recruit");
      await tap(button(/탐험 행동력 2/));
      await heading("야생 탐험").waitFor();
      const target = await scanForType("악");
      if (target) worker = await identify(target);
      else {
        await base();
        totals.hunts++;
      }
      assert.equal((await save()).energy, before.energy - 2);
      dark.hunts++;
      dark.recruitEnergy += 2;
    }
    assert.ok(worker && isDark(worker), "The general scanner could not recruit a Dark type");
    dark.worker = { id: worker.id, name: worker.pokemon.nameKr, turn: (await save()).turnCount };
    console.log(JSON.stringify({ seed, darkRecruit: dark.worker, hunts: dark.hunts, recruitEnergy: dark.recruitEnergy }));
  }

  async function recruitFlying() {
    let worker = frontierRules.availableFrontierWorkers(await save(), frontierRules.FLYING_TYPE)[0];
    for (let attempt = 0; !worker && attempt < 24; attempt++) {
      const before = await energy(2, false, "flying-recruit");
      await tap(button(/탐험 행동력 2/));
      await heading("야생 탐험").waitFor();
      const target = await scanForType("비행");
      if (target) worker = await identify(target);
      else {
        await base();
        totals.hunts++;
      }
      assert.equal((await save()).energy, before.energy - 2);
      flying.hunts.push({ turn: before.turnCount, detected: Boolean(target), caught: worker?.pokemon.nameKr ?? null });
      flying.recruitEnergy += 2;
    }
    assert.ok(worker && [worker.pokemon.type1Rowid, worker.pokemon.type2Rowid].includes(frontierRules.FLYING_TYPE));
    flying.worker = { id: worker.id, name: worker.pokemon.nameKr, turn: (await save()).turnCount };
    console.log(JSON.stringify({ seed, flyingMode, flyingRecruit: flying.worker, hunts: flying.hunts, energy: flying.recruitEnergy }));
  }

  async function detectEnemyObservation(state) {
    if (!await page.locator("#base-espionage-warning").count()) return state;
    const worker = frontierRules.availableFrontierWorkers(state, frontierRules.FLYING_TYPE)
      .find(member => member.id === flying.worker?.id);
    if (!worker) return state;
    if (!state.energy && canBuyCharge(state)) {
      state = await charge();
      flying.detectCharges++;
    }
    if (!state.energy) return state;
    await tap(button("첩보 탐지 대응"));
    await heading("월드맵").waitFor();
    const response = page.getByRole("region", { name: "비행 탐지 대응" });
    await response.getByLabel("탐지할 비행 타입").selectOption(worker.id);
    await tap(button(/비행 탐지/, response));
    const observation = state.frontier.espionage.observation;
    const source = worldMapNodes.find(site => site.id === observation.sourceId).name;
    await response.getByText(`적 첩보 차단 · 출처 ${source}`, { exact: true }).waitFor();
    await base();
    const queued = await save();
    assert.deepEqual(queued.frontier.espionage.observation, { ...observation, detectorId: worker.id });
    assert.equal(queued.energy, state.energy - 1);
    flying.detectEnergy += state.energy - queued.energy;
    return queued;
  }

  async function dispatchDarkWhenEffective(state) {
    if (!dark.worker || !state.energy || state.frontier.intrusion || state.frontier.quietTurns || state.frontier.sabotage) return null;
    const territories = Object.fromEntries(state.mapSnapshot.map(site => [site.id, site]));
    const current = { ...state, territories };
    if (!frontierRules.availableFrontierWorkers(current, frontierRules.DARK_TYPE).some(member => member.id === dark.worker.id)) return null;
    const next = frontierRules.advanceTerritoryLoyalty(territories).territories;
    const normal = frontierRules.advanceFrontier(current, next).frontier.intrusion;
    if (!normal) return null;

    const supplied = frontierRules.suppliedTerritories(territories);
    let order;
    for (const site of state.mapSnapshot) {
      if (!frontierRules.hasEnemyWorkshop(territories, site.id)) continue;
      const [sourceId] = frontierRules.frontierSources(territories, site.id, supplied);
      if (!sourceId) continue;
      const candidate = { sourceId, targetId: site.id, trainerId: site.trainerId, memberId: dark.worker.id };
      // Normal scouting is free. Forecast the order with the target scouted before using the actual map controls.
      const scouted = { ...next, [site.id]: { ...next[site.id], scouted: true } };
      if (frontierRules.advanceFrontier({ ...current, frontier: { ...state.frontier, sabotage: candidate } }, scouted).frontier.intrusion) continue;
      order = candidate;
      break;
    }
    if (!order) return null;

    await map();
    await focus(order.targetId);
    if (!spot(state, order.targetId).scouted) await tap(button(/정찰하기/));
    const workshop = page.getByRole("region", { name: "적 시설 생산" });
    await page.getByLabel("파견할 악 타입").selectOption(order.memberId);
    const source = page.getByLabel("방해 출발 거점");
    if (await source.count()) await source.selectOption(order.sourceId);
    const checkpoint = await save();
    await tap(button(/악 타입 시설 방해/, workshop));
    await workshop.getByText(/악 타입 시설 방해 파견 완료/).waitFor();
    await base();
    const queued = await save();
    assert.deepEqual(queued.frontier.sabotage, order);
    assert.equal(queued.energy, checkpoint.energy - 1);
    dark.dispatchEnergy++;
    const control = await settleCampaignCopy(checkpoint, 2);
    assert.deepEqual(control[0].frontier.intrusion, normal);
    if (seed === 7 && checkpoint.turnCount === 30 && order.targetId === "se-10") {
      dark.incomeWithRoom = await verifyDarkIncomeWithRoom(checkpoint, order, normal);
      console.log(JSON.stringify({ seed, audit: "dark-income-with-room", ...dark.incomeWithRoom }));
    }
    return { queued, control };
  }

  async function defendThreat(state, gross) {
    if (!operations.dragon || !state.energy || !await page.locator("#base-intrusion-warning").count()) return state;
    const room = Math.max(0, state.storageCap - state.resources.gold);
    if (operations.defenseEnergy && room <= gross - 3) return state;
    await tap(button("치안 대응"));
    await heading("월드맵").waitFor();
    const order = button(/드래곤 방어/);
    if (!await order.isDisabled()) {
      await page.getByLabel("방어할 드래곤").selectOption(operations.dragon.id);
      await tap(order);
      await page.getByText("드래곤 방어 배치 완료").waitFor();
    }
    await base();
    const after = await save();
    if (after.frontier.intrusion?.defenderId === operations.dragon.id) {
      assert.equal(after.energy, state.energy - 1);
      operations.defenseEnergy++;
    }
    return after;
  }

  async function reconForBattle(id) {
    const before = await energy(1, false, "frontier");
    const medic = before.roster.find(member => member.jobId === "heal");
    assert.ok(medic && [medic.pokemon.type1Rowid, medic.pokemon.type2Rowid].includes(8), "The clinic Ghost is needed for recon");
    const clinic = page.getByRole("dialog", { name: "치료소 · 2번 부지" });
    const openClinic = () => tap(button("2번 부지 치료소 관리"));
    await openClinic();
    await tap(button(`${medic.pokemon.nameKr} 회수`, clinic));
    await close(clinic);

    await map();
    await focus(id);
    if (!spot(await save(), id).scouted) await tap(button(/정찰하기/));
    await page.getByLabel("파견할 고스트").selectOption(medic.id);
    await tap(button(/고스트 첩보 파견/));
    await page.getByText(/고스트 첩보 진행 중/).waitFor();
    const sent = await save();
    assert.equal(sent.energy, before.energy - 1);
    const source = sent.frontier.intel[id].sourceId;
    operations.reconEnergy++;
    await base();
    await turn("recon");
    await map();
    await focus(id);
    const report = page.getByRole("region", { name: "공개된 수비팀" });
    await report.waitFor();
    const opponents = await report.getByRole("listitem").allTextContents();
    const scouted = await save();
    const records = scouted.frontier.intel[id].pokemonIds.map(id => species.get(id));
    assert.deepEqual(opponents, records.map(pokemon => pokemon.nameKr));
    await base();

    const ready = await energy(1, false, "frontier");
    await openClinic();
    await tap(button(/회복 아이템 생산/, clinic));
    await selectMember(clinic, medic.id);
    await tap(button(/직무 배치 · 행동력/, clinic));
    await close(clinic);
    const staffed = await save();
    assert.equal(staffed.energy, ready.energy - 1);
    operations.clinicEnergy++;
    settlements.assignments++;
    if (staffed.roster.find(member => member.id === medic.id).departurePending) await maintainFavor(staffed);

    // Resolve one live warning before the scheduled assault can remove its source.
    if (!operations.defenseEnergy && await page.locator("#base-intrusion-warning").count()) {
      const available = await energy(1, false, "frontier");
      if (frontierAudit && id === "nw-02") defenseCheckpoint = available;
      await turn("defense");
    }
    const campaign = await save();
    const entryOrder = campaign.entryOrder;
    const predictedLevel = 3 + region * 5 + Math.floor(campaign.mapSnapshot.filter(site =>
      site.owner === "player" && routes[region].includes(site.id)).length / 2);
    const party = entryOrder.map(id => campaign.roster.find(member => member.id === id));
    const lead = party.reduce((best, candidate) => memberScore(candidate, records[0], predictedLevel) >
      memberScore(best, records[0], predictedLevel) ? candidate : best);
    await setParty([lead.id, ...entryOrder.filter(id => id !== lead.id)]);
    const entry = { id, source, turn: scouted.turnCount, scout: medic.pokemon.nameKr, opponents,
      originalLead: party[0].pokemon.nameKr, lead: lead.pokemon.nameKr };
    operations.reports.push(entry);
    return { entryOrder, entry };
  }

  async function clearSupportPlot(plot) {
    const dialog = page.getByRole("dialog", { name: `땅 평탄화 · ${plot}번 부지` });
    const open = () => tap(button(`${plot}번 미개척 부지`));
    const current = await save();
    const worker = current.roster.find(member => !member.jobId && [member.pokemon.type1Rowid, member.pokemon.type2Rowid].includes(5))
      ?? await supportHunt(async () => { await open(); await tap(button(/땅 타입 탐색/, dialog)); }, "땅");
    const before = await energy(1, false, "favor");
    await open();
    await selectMember(dialog, worker.id);
    await tap(button("땅 평탄화 시작", dialog));
    await close(dialog);
    const clearing = await save();
    assert.equal(clearing.energy, before.energy - 1);
    assert.equal(clearing.clearing.memberId, worker.id);
    favor.actionPower.clearing++;
    settlements.clearing++;
    const cleared = await turn("favor");
    assert.equal(cleared.plotCap, plot);
    favor.stages.push({ at: cleared.turnCount, plot, clearedBy: worker.pokemon.nameKr });
  }

  async function buildSupportFacility(plot, label) {
    const before = await energy(1, false, "favor");
    await tap(button(`${plot}번 부지 건설`));
    const dialog = page.getByRole("dialog", { name: `건설 · ${plot}번 부지` });
    await tap(button(label, dialog));
    const builders = before.roster.filter(member => !member.buildingId && !member.jobId)
      .sort((a, b) => (b.favor - b.favFloor) - (a.favor - a.favFloor)).slice(0, 3);
    assert.ok(builders.length > 0);
    for (const builder of builders) await selectMember(dialog, builder.id);
    await tap(dialog.locator("[data-build-confirm]"));
    await dialog.waitFor({ state: "hidden" });
    let state = await save();
    assert.equal(state.energy, before.energy - 1);
    favor.actionPower.construction++;
    settlements.construction++;
    const start = state.turnCount;
    while (state.buildings.find(building => building.plotIndex === plot - 1).status !== "active") {
      assert.ok(state.turnCount - start < 3);
      state = await turn("favor");
    }
    favor.stages.push({ at: state.turnCount, plot, built: label, constructionTurns: state.turnCount - start });
  }

  async function staffSupportFacility(plot, label, job, jobLabel, type, typeId) {
    const dialog = page.getByRole("dialog", { name: `${label} · ${plot}번 부지` });
    async function openJob() {
      await tap(button(`${plot}번 부지 ${label} 관리`));
      await tap(button(new RegExp(jobLabel), dialog));
    }
    const state = await save();
    const member = state.roster.find(candidate => !candidate.jobId &&
      [candidate.pokemon.type1Rowid, candidate.pokemon.type2Rowid].includes(typeId)) ?? await supportHunt(async () => {
      await openJob();
      await tap(button(new RegExp(`${type} 타입 탐색`), dialog));
    }, type);
    const before = await energy(1, false, "favor");
    await openJob();
    await selectMember(dialog, member.id);
    await tap(button(/직무 배치 · 행동력/, dialog));
    await close(dialog);
    const assigned = await save();
    assert.equal(assigned.roster.find(candidate => candidate.id === member.id).jobId, job);
    favor.actionPower.assignments += before.energy - assigned.energy;
    settlements.assignments += before.energy - assigned.energy;
    favor.stages.push({ at: assigned.turnCount, job, worker: member.pokemon.nameKr });
  }

  async function openOutpost(id) {
    await map();
    await focus(id);
    assert.equal(await page.locator(`[data-node="${id}"]`).getAttribute("data-supply"), "supplied");
    await tap(button("거점 관리"));
    await heading(worldMapNodes.find(node => node.id === id).name).waitFor();
  }

  async function recruitOutpostResearcher() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await energy(2, false, "outposts");
      await openOutpost("nw-02");
      await openResearch();
      await tap(button(/에스퍼 타입 탐색/, dojo()));
      await heading("야생 탐험").waitFor();
      const target = await scanForType("에스퍼");
      assert.ok(target);
      const member = await identify(target, false, "북서 2거점");
      await base();
      assert.equal((await save()).energy, before.energy - 2);
      settlements.outpostHunts++;
      if (member) {
        assert.ok(isPsychic(member));
        return member;
      }
    }
    throw new Error("The outpost could not recruit a research worker");
  }

  async function assignProduction({ siteId, label, plot, job, jobLabel, worker }) {
    const before = await energy(1, false, "outposts");
    if (siteId) await openOutpost(siteId);
    await tap(button(`${plot}번 부지 ${label} 관리`));
    const dialog = page.getByRole("dialog", { name: `${label} · ${plot}번 부지` });
    await tap(button(new RegExp(jobLabel), dialog));
    await selectMember(dialog, worker.id);
    await tap(button(/직무 배치 · 행동력/, dialog));
    await close(dialog);
    const staffed = await save();
    const assigned = staffed.roster.find(member => member.id === worker.id);
    assert.equal(assigned.jobId, job);
    assert.equal(staffed.energy, before.energy - 1);
    assert.equal(staffed.buildings.find(building => building.id === assigned.buildingId).siteId, siteId);
    if (siteId) {
      settlements.outpostAssignments++;
      await base();
    } else settlements.assignments++;
    settlements.placements.push({ at: staffed.turnCount, site: siteId ?? "home", job, worker: worker.pokemon.nameKr });
  }

  async function setUpOutpostProduction() {
    const researcher = await recruitOutpostResearcher();
    const before = await energy(1, false, "outposts");
    if (researchSiteAudit) {
      researchCheckpoint = { snapshot: before, researcherId: researcher.id,
        rng: await page.evaluate(() => window.campaignRngState) };
    }

    await openResearch();
    await dojo().getByText("육성 연구 3/3마리", { exact: true }).waitFor();
    await selectMember(dojo(), researcher.id);
    assert.ok(await button("직무 배치 · 행동력 1", dojo()).isDisabled());
    await close(dojo());
    assert.deepEqual(await save(), before);

    if (researchSite === "outpost") {
      await assignProduction({ siteId: "nw-02", label: "훈련소", plot: 1, job: "research", jobLabel: "육성 연구", worker: researcher });
      await openOutpost("nw-02");
      await openResearch();
      await dojo().getByText("육성 연구 1/3마리", { exact: true }).waitFor();
      await close(dojo());
      await base();
    } else {
      // Reproduce the pre-cap control in a temporary Chrome profile.
      assert.ok(researchCheckpoint);
      const legacy = withLegacyHomeResearcher(before, researcher.id);
      await loadTestCheckpoint(legacy);
      assert.deepEqual(await save(), legacy);
      await page.evaluate(rng => { window.campaignRngState = rng; }, researchCheckpoint.rng);
      settlements.assignments++;
      settlements.placements.push({ at: legacy.turnCount, site: "home", job: "research", worker: researcher.pokemon.nameKr });
    }
    const state = await save();
    const miner = state.roster.find(member => member.id === aceIds[0] && [member.pokemon.type1Rowid, member.pokemon.type2Rowid].includes(6));
    const crafter = state.roster.find(member => !member.buildingId && [member.pokemon.type1Rowid, member.pokemon.type2Rowid].includes(13));
    assert.ok(miner && crafter);
    await assignProduction({ label: "제작소", plot: 3, job: "mine", jobLabel: "재료 채취", worker: miner });
    await assignProduction({ siteId: "nw-04", label: "제작소", plot: 1, job: "craft", jobLabel: "부품 제작", worker: crafter });
    productionCrew = { researcher, miner, crafter };
  }

  async function finishOutpostCraft(before) {
    const { researcher, miner, crafter } = productionCrew;
    await tap(button(/포켓몬 \d/));
    await selectMember(pc(), researcher.id);
    const row = pc().getByRole("listitem").filter({ hasText: "기합의띠" });
    await tap(button("제작 3", row));
    await tap(button("장착", row));
    await close(pc());
    const equipped = await save();
    assert.equal(equipped.resources.tool, before.resources.tool - 3);
    assert.equal(equipped.roster.find(member => member.id === researcher.id).heldItem, "focus_sash");
    settlements.sash = { turn: equipped.turnCount, worker: researcher.pokemon.nameKr, parts: 3 };

    await tap(button("3번 부지 제작소 관리"));
    const home = page.getByRole("dialog", { name: "제작소 · 3번 부지" });
    await tap(button(`${miner.pokemon.nameKr} 회수`, home));
    await close(home);
    await openOutpost("nw-04");
    await tap(button("1번 부지 제작소 관리"));
    const outpost = page.getByRole("dialog", { name: "제작소 · 1번 부지" });
    await tap(button(`${crafter.pokemon.nameKr} 회수`, outpost));
    await close(outpost);
    await base();
    return save();
  }

  async function setUpFavorProduction() {
    const state = await save();
    const waiting = state.roster.filter(member => member.buildingId === state.buildings[0].id && !member.jobId);
    if (waiting.length) {
      await tap(button("1번 부지 훈련소 관리"));
      for (const member of waiting) await tap(button(`${member.pokemon.nameKr} 회수`, dojo()));
      await close(dojo());
    }
    await clearSupportPlot(2);
    await buildSupportFacility(2, "치료소");
    await staffSupportFacility(2, "치료소", "heal", "회복 아이템 생산", "페어리", 18);
    await clearSupportPlot(3);
    const recovered = await energy(1, false, "favor");
    assert.ok(recovered.resources.healItem > 0, "The clinic produced at least one recovery item");
    await useRecovery(recovered, recovered.roster.find(member => member.id === registeelId));
    await buildSupportFacility(3, "제작소");
    await staffSupportFacility(3, "제작소", "mine", "재료 채취", "바위", 6);
    await staffSupportFacility(3, "제작소", "craft", "부품 제작", "전기", 13);
    let production = await save();
    for (let elapsed = 0; production.resources.tool < 3; elapsed++) {
      assert.ok(elapsed < 6, "The workshop did not produce three parts");
      production = await turn("favor");
      favor.material += production.lastLog.filter(line => line.includes("부품 제작"))
        .reduce((used, line) => used + Number(line.match(/재료 −(\d+)/)?.[1] ?? 0), 0);
    }
    await tap(button(/포켓몬 \d/));
    await selectMember(pc(), registeelId);
    const row = pc().getByRole("listitem").filter({ hasText: "기합의띠" });
    await tap(button("제작 3", row));
    await tap(button("장착", row));
    await close(pc());
    const equipped = await save();
    assert.equal(equipped.roster.find(member => member.id === registeelId).heldItem, "focus_sash");
    assert.equal(equipped.resources.items.focus_sash, 0);
    favor.tool = production.resources.tool - equipped.resources.tool;
    assert.equal(favor.tool, 3);
    favor.stages.push({ at: equipped.turnCount, equipped: "기합의띠" });

    const workshop = page.getByRole("dialog", { name: "제작소 · 3번 부지" });
    const workshopId = equipped.buildings.find(building => building.type === "workshop").id;
    await tap(button("3번 부지 제작소 관리"));
    for (const worker of equipped.roster.filter(member => member.buildingId === workshopId)) {
      await tap(button(`${worker.pokemon.nameKr} 회수`, workshop));
    }
    await close(workshop);
  }

  async function openResearch() {
    await tap(button("1번 부지 훈련소 관리"));
    await tap(button(/육성 연구/, dojo()));
  }

  async function conductHunt(preferPsychic) {
    await energy(2);
    if (preferPsychic) {
      await openResearch();
      const option = button(/에스퍼 타입 탐색/, dojo());
      if (await option.count()) await tap(option);
      else {
        await close(dojo());
        await tap(button(/탐험/));
      }
    } else await tap(button(/탐험/));
    await heading("야생 탐험").waitFor();
    const scan = page.getByRole("complementary", { name: "관측 패널" });
    const targets = page.locator(".hunt-target");
    let best = 0;
    if (preferPsychic) {
      for (let index = 0; index < await targets.count(); index++) {
        await targets.nth(index).focus();
        if ((await scan.innerText()).includes("에스퍼")) { best = index; break; }
      }
    }
    return identify(targets.nth(best));
  }

  async function collectDex(target, stage) {
    const start = await save();
    const beforeCharges = totals.charges;
    const beforePurchased = ledger.purchasedRefill;
    const beforeRefills = ledger.turnRefill;
    const beforeIncome = ledger.income;
    const beforeRecovery = favor.recovery.length;
    const beforeDefense = operations.defenseEnergy;
    const exploration = { attempts: 0, captured: 0, duplicate: 0 };
    let current = start;
    while (current.caughtSpeciesIds.length < target) {
      await heading("본거지").waitFor();
      assert.equal(await ending.count(), 0);
      assert.ok(exploration.attempts < 80, `The campaign could not reach ${target} species within 80 exploration attempts`);
      const ready = await energy(2);
      const member = await conductHunt(false);
      const after = await save();
      assert.equal(after.energy, ready.energy - 2);
      const caughtId = member?.pokemon.pokemonRowid;
      const isNew = member && !current.caughtSpeciesIds.includes(caughtId);
      assert.deepEqual(after.caughtSpeciesIds, isNew ? [...current.caughtSpeciesIds, caughtId] : current.caughtSpeciesIds);
      exploration.attempts++;
      if (member) {
        exploration.captured++;
        if (!isNew) exploration.duplicate++;
      }
      current = after;
    }
    const purchased = ledger.purchasedRefill - beforePurchased;
    const turnRefill = ledger.turnRefill - beforeRefills;
    const huntEnergy = exploration.attempts * 2;
    const otherEnergy = start.energy + purchased + turnRefill - current.energy - huntEnergy;
    const recoveryEnergy = favor.recovery.length - beforeRecovery;
    const defenseEnergy = operations.defenseEnergy - beforeDefense;
    assert.equal(otherEnergy, recoveryEnergy + defenseEnergy);
    const charges = totals.charges - beforeCharges;
    const income = ledger.income - beforeIncome;
    assert.equal(current.resources.gold, start.resources.gold + income - charges * 5);
    dexStages.push({ stage, target, fromDex: start.caughtSpeciesIds.length, toDex: current.caughtSpeciesIds.length,
      fromTurn: start.turnCount, toTurn: current.turnCount, exploration, charges,
      fromEnergy: start.energy, toEnergy: current.energy, purchased, turnRefill, huntEnergy, recoveryEnergy, defenseEnergy,
      fromGold: start.resources.gold, toGold: current.resources.gold, income });
    return current;
  }

  async function verifyEndingRestore(current) {
    assert.equal(current.caughtSpeciesIds.length, 25);
    assert.equal(current.mapSnapshot.filter(site => site.owner === "player").length, 40);
    assert.equal(current.endingSeen, false);
    await ending.waitFor();
    await page.getByText("확보 거점 40곳 · 누적 도감 25종").waitFor();
    await page.reload();
    await ending.waitFor();
    assert.deepEqual(await save(), current);
  }

  async function verifyCampaignEnding(cleared, chargesAtClear) {
    const current = cleared.caughtSpeciesIds.length < 25 ? await collectDex(25, "after-clear") : cleared;
    const endingCharges = totals.charges;
    await verifyEndingRestore(current);

    await button("새 게임").press("Enter");
    await button("취소").press("Enter");
    await button("취소").waitFor({ state: "hidden" });
    await ending.waitFor();
    assert.deepEqual(await save(), current);
    await button("계속 플레이").press("Enter");
    await heading("본거지").waitFor();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.endingSeen === true, key);
    await page.reload();
    await heading("본거지").waitFor();
    assert.deepEqual(await save(), { ...current, endingSeen: true });
    if (dexDuringCampaign) {
      await map();
      await verifySupplyMap();
      await base();
    }

    const goals = page.getByRole("dialog", { name: "관측 목표와 도감" });
    await button("목표·도감").press("Enter");
    await goals.getByText("최종 목표 · 거점 40/40곳 확보 · 도감 25/25종 등록").waitFor();
    const rewardRow = threshold => goals.getByRole("list", { name: "도감 보상" })
      .getByRole("listitem").filter({ has: page.getByText(`${threshold}종 기록`, { exact: true }) });
    let room = await save();
    if (room.resources.gold + 10 > room.storageCap) {
      assert.ok(await button("저장 공간 부족", rewardRow(25)).isDisabled());
      assert.deepEqual(room.claimedDexRewards, []);
      await close(goals);
      while (room.resources.gold + 10 > room.storageCap) room = await charge();
      await button("목표·도감").press("Enter");
    }
    const rewardRoomCharges = totals.charges - endingCharges;
    const beforeRewards = await save();
    for (const threshold of [10, 25]) {
      const claim = button("보상 받기", rewardRow(threshold));
      assert.ok(await claim.isEnabled(), `No room for the ${threshold}-species reward`);
      await claim.press("Enter");
      await rewardRow(threshold).getByText("수령 완료").waitFor();
    }
    await rewardRow(50).getByText("25종 남음").waitFor();
    const rewarded = await save();
    assert.deepEqual(rewarded.claimedDexRewards, [10, 25]);
    assert.deepEqual(rewarded.resources, { ...beforeRewards.resources, candy: beforeRewards.resources.candy + 3,
      tm: beforeRewards.resources.tm + 3, gold: beforeRewards.resources.gold + 10 });
    await page.reload();
    await heading("본거지").waitFor();
    assert.deepEqual(await save(), rewarded);
    await button("목표·도감").press("Enter");
    for (const threshold of [10, 25]) await rewardRow(threshold).getByText("수령 완료").waitFor();
    assert.equal(await button("보상 받기", goals).count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ seed, audit: "ending", strategy: dexDuringCampaign ? "during" : "after",
      territoryTurn: cleared.turnCount, territoryDex: cleared.caughtSpeciesIds.length, endingTurn: current.turnCount,
      endingDex: current.caughtSpeciesIds.length, totalHunts: totals.hunts, chargesAtClear, endingCharges, rewardRoomCharges,
      endingGold: current.resources.gold, battles: logs.length, battleChoices: logs.reduce((sum, battle) => sum + battle.choices, 0),
      losses: logs.filter(battle => !battle.won).length, growthTurns: totals.growthTurns, dexStages, rewards: rewarded.claimedDexRewards }));
  }

  async function verifySupplyMap() {
    assert.equal(await page.locator('.atlas-node[data-supply="supplied"]').count(), 30);
    assert.equal(await page.getByText("확보 완료", { exact: true }).count(), 6);
  }

  async function research(n) {
    for (let attempt = 0; ; attempt++) {
      const state = await save();
      if (state.roster.filter(member => member.jobId === "research").length >= n) return;
      assert.ok(attempt < 35, "could not recruit enough research workers");
      const worker = state.roster.find(member => isPsychic(member) && member.jobId !== "research");
      if (!worker) {
        await conductHunt(true);
        continue;
      }
      const before = await energy(1);
      await openResearch();
      await tap(dojo().locator(`[data-install-pick="${worker.id}"]`));
      await tap(button(/직무 배치 · 행동력/, dojo()));
      await close(dojo());
      settlements.assignments += before.energy - (await save()).energy;
    }
  }

  async function grow(id, level, purpose = "planned") {
    const initial = await save();
    const member = initial.roster.find(member => member.id === id);
    const candies = totals.candies;
    for (let loop = 0; ; loop++) {
      let state = await save();
      if (state.roster.find(member => member.id === id).level >= level) {
        if (audit && totals.candies > candies) growthLog.push({ purpose, site: battleSite, region: region + 1,
          name: member.pokemon.nameKr, from: member.level, to: level, candies: totals.candies - candies, turns: state.turnCount - initial.turnCount });
        return;
      }
      assert.ok(loop < 220, `level ${level} did not finish`);
      if (!state.resources.candy) state = await turn("growth");
      if (!state.resources.candy) throw new Error("Assigned researchers produced no candy");
      await energy(1);
      await tap(button(/포켓몬 \d/));
      const dialog = page.getByRole("dialog", { name: /보유 포켓몬/ });
      await tap(dialog.locator(`[data-install-pick="${id}"]`));
      for (;;) {
        const current = await save();
        if (!current.energy || !current.resources.candy || current.roster.find(member => member.id === id).level >= level) break;
        await tap(button("사탕 먹이기", dialog));
        totals.candies++;
      }
      await close(dialog);
    }
  }

  async function equip(extra) {
    const state = await save();
    const remaining = state.roster.filter(member => !aceIds.includes(member.id))
      .sort((a, b) => campaignMemberScore(b, b.level) - campaignMemberScore(a, a.level));
    await setParty([...aceIds, ...(extra ? [extra] : []), ...remaining.map(member => member.id)]);
  }

  async function viewTactics(site) {
    await map();
    await focus(site);
    if (!spot(await save(), site).scouted) await tap(button(/정찰하기/));
    const tactics = page.locator("details.atlas-tactics");
    await tactics.locator("summary").press("Enter");
    const types = tactics.getByLabel("정찰한 상대 후보 타입");
    await types.waitFor();
    return { tactics, types };
  }

  async function planBippa() {
    const { tactics, types } = await viewTactics("se-06");
    await types.selectOption("5-11");
    const weakness = await tactics.getByText(/공통 약점.*땅.*킬라플로르.*레지스틸/).textContent();
    const replacement = await tactics.getByText(/땅 기술에 교대.*불카모스 \(1배\)/).textContent();
    await types.selectOption("11-15");
    const reserve = await tactics.getByText(/레지스틸.*차지빔.*2배/).textContent();
    await base();
    const prior = totals.candies;
    const reading = await save();
    await grow(thirdStarterId, 7);
    bippaTactics = { reserve: aceIds[1], opening: { memberId: aceIds[0], move: "애시드봄" } };
    const decision = { seed, guide: "scout", site: "se-06", weakness, replacement, reserve,
      invested: totals.candies - prior, turns: (await save()).turnCount - reading.turnCount };
    guidance.push(decision);
    console.log(JSON.stringify(decision));
  }

  async function improveResearch() {
    const state = await save();
    await openResearch();
    const upgrades = [];
    const output = async () => (await dojo().getByText(/경험치 사탕 \+\d+ \/ 최대 \d+/).allTextContents())
      .reduce((sum, line) => sum + Number(line.match(/\+(\d+)/)[1]), 0);
    let expected = await output();
    for (const member of state.roster.filter(member => member.jobId === "research")) {
      const row = dojo().getByRole("listitem").filter({ hasText: member.pokemon.nameKr });
      const line = await row.getByText(/턴당 최대 사탕/).textContent();
      const [, level, from, to, candy] = line.match(/Lv\.(\d+).*최대 사탕 (\d+) → (\d+)개.*사탕 (\d+)개/).map(Number);
      if (candy <= 15) upgrades.push({ id: member.id, name: member.pokemon.nameKr, level, from, to, candy });
    }
    await close(dojo());
    upgrades.sort((a, b) => a.candy / (a.to - a.from) - b.candy / (b.to - b.from));
    for (const upgrade of upgrades) {
      const before = await save();
      const spent = totals.candies;
      await grow(upgrade.id, upgrade.level);
      assert.equal(totals.candies - spent, upgrade.candy);
      expected += upgrade.to - upgrade.from;
      const decision = { seed, guide: "research", name: upgrade.name, level: upgrade.level, candy: upgrade.candy,
        production: expected, turns: (await save()).turnCount - before.turnCount };
      guidance.push(decision);
      console.log(JSON.stringify(decision));
    }
    await openResearch();
    assert.equal(await output(), expected);
    await close(dojo());
  }

  async function planMinji() {
    const { tactics, types } = await viewTactics("ne-02");
    await types.selectOption("6");
    await tap(button("PC에서 약점 기술 확인", tactics));
    const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
    await tap(pc.locator(`[data-install-pick="${thirdStarterId}"]`));
    const line = await pc.getByText(/Lv\.\d+ 물대포.*사탕 \d+개.*행동력 \d+/).textContent();
    const [, level, candy, energyCost] = line.match(/Lv\.(\d+).*사탕 (\d+)개.*행동력 (\d+)/).map(Number);
    await close(pc);
    await base();
    const before = await save();
    const prior = totals.candies;
    await grow(thirdStarterId, level);
    assert.equal(totals.candies - prior, candy);
    await tap(button(/포켓몬 \d/));
    await tap(pc.locator(`[data-install-pick="${thirdStarterId}"]`));
    await tap(pc.getByText("약점 기술 확인", { exact: true }));
    await pc.getByLabel("상대 타입").selectOption("6");
    await pc.getByText("현재 약점 기술 · 물대포").waitFor();
    await close(pc);
    const decision = { seed, guide: "pc", site: "ne-02", level, candy, energy: energyCost,
      turns: (await save()).turnCount - before.turnCount };
    guidance.push(decision);
    console.log(JSON.stringify(decision));
  }

  async function prepare(id) {
    await map();
    await focus(id);
    if (!(await save()).mapSnapshot.find(site => site.id === id).scouted) await tap(button(/정찰하기/));
    const seen = new Set();
    for (let count = 0; count < 3 && await report.count(); count++) {
      const warning = await report.getByRole("status").textContent();
      if (seen.has(warning)) break;
      seen.add(warning);
      const candidate = button(/유효 공격 후보 탐색/, report);
      if (!(await candidate.count())) break;
      let state = await save();
      if (state.energy < 4) {
        await base();
        state = await energy(4);
        await map();
        await focus(id);
      }
      if (!(await candidate.count()) || await candidate.isDisabled()) break;
      totals.counterHunts++;
      const caught = await (async () => {
        await tap(candidate);
        return identify(page.locator('.hunt-target[data-counter="true"]'), true);
      })();
      if (caught) {
        await base();
        await grow(caught.id, Math.min(6, goals[region][1]));
        await equip(caught.id);
        await energy(2);
        await map();
        await focus(id);
      }
    }
    if ((await save()).energy < 2) { await base(); await energy(2); await map(); await focus(id); }
  }

  async function fight(id, recon) {
    battleSite = id;
    const before = await save();
    if (id === "nw-02" && flyingBattleCheckpoints && !flyingBattleCheckpoints.firstChallenge) {
      flyingBattleCheckpoints.firstChallenge = { snapshot: before, rng: await page.evaluate(() => window.campaignRngState) };
    }
    const preparation = before.frontier.espionage?.preparation;
    const observedTypes = preparation?.territoryId === id && preparation.expiresTurn > before.turnCount ? preparation.leadTypes : null;
    const flyingEncounter = flyingMode ? {
      rng: await page.evaluate(() => window.campaignRngState),
      party: before.entryOrder.map(memberId => before.roster.find(member => member.id === memberId))
        .map(member => [member.pokemon.nameKr, member.level]),
      observedTypes,
    } : undefined;
    if (frontierAudit && id === "nw-02" && recon && !leadCheckpoint) {
      leadCheckpoint = { snapshot: before, id, originalOrder: recon.entryOrder,
        advisedOrder: before.entryOrder, opponents: recon.entry.opponents,
        rng: await page.evaluate(() => window.campaignRngState) };
    }
    const trace = audit?.site === id && !target;
    if (trace) target = { before, rng: await page.evaluate(() => window.campaignRngState) };
    await tap(button(/거점 도전/));
    await heading("거점 배틀").waitFor();
    await page.waitForFunction(({ key, energy }) => JSON.parse(localStorage.getItem(key))?.energy === energy,
      { key, energy: before.energy - 2 });
    const state = await save();
    if (trace) target.combatRng = await page.evaluate(() => window.campaignRngState);
    const useTactics = useGuidance && seed === 7 && id === "se-06" && !logs.some(battle => battle.id === id);
    const battle = await playCampaignBattle(page, 240, trace || useTactics, useTactics ? bippaTactics : undefined);
    if (trace) target.battle = battle;
    logs.push({ id, turn: state.turnCount, ...battle, ...(flyingEncounter ? { flyingEncounter } : {}) });
    if (!battle.won || battle.choices >= 50) console.log(JSON.stringify({ seed, ...logs.at(-1) }));
    const inheritance = useOutposts && battle.won && inheritedFacilities[id];
    if (inheritance) {
      const choice = page.getByRole("region", { name: "AI 건물 승계" });
      await choice.waitFor();
      if (inheritedDojoAudit && id === "nw-02") await verifyInheritedDojoChallenge(await save(), { checkIsolation: true });
      await tap(button(`${inheritance} 승계`, choice));
      await choice.waitFor({ state: "hidden" });
      const inherited = await save();
      assert.equal(inherited.energy, state.energy);
      const building = inherited.buildings.find(building => building.siteId === id);
      assert.ok(building?.status === "active" && building.plotIndex === 0 && !inherited.roster.some(member => member.buildingId === building.id));
      settlements.inheritances.push({ id, name: inheritance, turn: inherited.turnCount });
    }
    if (battle.outcome !== "concede") await tap(button("월드맵으로"));
    await heading("월드맵").waitFor();
    const after = await save();
    assert.equal(spot(after, id).owner === "player", battle.won);
    assert.equal(after.energy, state.energy);
    return battle;
  }

  async function takeSite(id, expectedSupply) {
    const recon = useFrontier && reconTargets.has(id) ? await reconForBattle(id) : null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await energy(2);
      await prepare(id);
      const battle = await fight(id, recon);
      if (recon && attempt === 0) {
        const actual = battle.enemies.map(enemy => enemy.replace(/ Lv\.\d+$/, ""));
        assert.deepEqual(actual, battle.won ? recon.entry.opponents : recon.entry.opponents.slice(0, actual.length));
        recon.entry.actual = battle.enemies;
        recon.entry.choices = battle.choices;
        recon.entry.outcome = battle.outcome;
      }
      if (battle.won) {
        if (expectedSupply) assert.equal(await page.locator(`[data-node="${id}"]`).getAttribute("data-supply"), expectedSupply);
        const reconnect = id === "nw-01" && !connectedRoute && (await save()).mapSnapshot.find(site => site.id === "nw-04").owner === "player";
        if (reconnect) assert.equal(await page.locator('[data-node="nw-04"]').getAttribute("data-supply"), "supplied");
        await base();
        if (recon) {
          const state = await save();
          await setParty([...recon.entryOrder.filter(id => state.roster.some(member => member.id === id)), ...state.entryOrder]);
        }
        return;
      }
      await base();
      totals.retries++;
      const state = await save();
      await grow(aceIds[0], state.roster.find(member => member.id === aceIds[0]).level + 2, "retry");
      await grow(aceIds[1], state.roster.find(member => member.id === aceIds[1]).level + 1, "retry");
    }
    throw new Error(`${id} exhausted four attempts`);
  }

  async function loadTestCheckpoint(snapshot) {
    // This page belongs to Playwright's temporary profile. The two branches use copies.
    await page.evaluate(({ key, snapshot }) => localStorage.setItem(key, JSON.stringify(snapshot)), { key, snapshot });
    await page.reload();
    await heading("본거지").waitFor();
  }

  async function verifyTrainingGuidance(checkpoint) {
    const mobileWidth = seed === 226;
    if (mobileWidth) await page.setViewportSize({ width: 390, height: 844 });
    await loadTestCheckpoint({ ...checkpoint, mapSnapshot: checkpoint.mapSnapshot.map(site =>
      site.id === audit.site ? { ...site, scouted: false } : site) });
    await map();
    await focus(audit.site);
    const tactics = page.locator("details.atlas-tactics");
    assert.equal(await tactics.count(), 0, "Tactics must stay hidden before scouting");
    await tap(button(/정찰하기/));
    await tactics.locator("summary").press("Enter");
    const types = tactics.getByLabel("정찰한 상대 후보 타입");
    await types.waitFor();
    const before = await save();
    if (seed === 7) {
      await types.selectOption("5-11");
      await tactics.getByText(/공통 약점.*땅.*킬라플로르.*레지스틸/).waitFor();
      await tactics.getByText(/땅 기술에 교대.*불카모스 \(1배\)/).waitFor();
      await types.selectOption("11-15");
      await tactics.getByText(/레지스틸.*차지빔.*2배/).waitFor();
      assert.doesNotMatch(await tactics.innerText(), /두까비|어치르돈/);
    } else {
      await types.selectOption("6");
      await tap(button("PC에서 약점 기술 확인", tactics));
      const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
      await tap(pc.locator(`[data-install-pick="${thirdStarterId}"]`));
      assert.equal(await pc.getByLabel("상대 타입").inputValue(), "6");
      await pc.getByText(/Lv\.10 물대포.*사탕 45개.*행동력 45/).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
      await close(pc);
    }
    const after = await save();
    for (const field of ["roster", "entryOrder", "energy", "resources", "mapSnapshot", "turnCount"]) assert.deepEqual(after[field], before[field]);
    if (mobileWidth) await page.setViewportSize({ width: 1440, height: 900 });
    console.log(JSON.stringify({ seed, audit: "guidance", site: audit.site, mobileWidth, savedProgress: "unchanged" }));
  }

  async function compareTraining() {
    assert.ok(fork && target);
    assert.deepEqual(target.battle.enemies, audit.enemy);
    assert.equal(target.battle.choices, audit.choices);
    assert.equal(target.battle.won, false);
    const production = turnLog.filter(turn => turn.reason === "growth");
    const workers = [...new Set(turnLog.filter(turn => turn.workers.length === 3)
      .map(turn => JSON.stringify({ workers: turn.workers, produced: turn.candyProduced })))].map(JSON.parse);
    console.log(JSON.stringify({ seed, audit: "baseline", growth: growthLog, productionTurns: production.length,
      noCandyTurns: production.filter(turn => !turn.candyBefore && turn.candyProduced > 0).length,
      candyProduced: turnLog.reduce((sum, turn) => sum + turn.candyProduced, 0), workers }));
    const ids = [...aceIds, thirdStarterId];
    const checkpoint = { ...fork, mapSnapshot: target.before.mapSnapshot, entryOrder: target.before.entryOrder };
    await verifyTrainingGuidance(checkpoint);
    const budgets = new Map();
    const strategies = { concentrated: audit.concentrated, spread: audit.spread };
    if (audit.moveThreshold) strategies.moveThreshold = audit.moveThreshold;
    for (const [strategy, levels] of Object.entries(strategies)) {
      await loadTestCheckpoint(checkpoint);
      const start = await save();
      const startCandy = totals.candies;
      const startCharges = totals.charges;
      for (const [index, level] of levels.entries()) await grow(ids[index], level);
      await energy(2);
      const trained = await save();
      if (strategy === "moveThreshold") {
        await tap(button(/포켓몬 \d/));
        const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
        await tap(pc.locator(`[data-install-pick="${thirdStarterId}"]`));
        await pc.getByText("약점 기술 확인", { exact: true }).click();
        await pc.getByLabel("상대 타입").selectOption("6");
        await pc.getByText("현재 약점 기술 · 물대포").waitFor();
        await close(pc);
      }
      const candySpent = totals.candies - startCandy;
      budgets.set(strategy, candySpent);
      const results = [];
      for (const variation of [0, 1, 2]) {
        if (variation) await loadTestCheckpoint(trained);
        await map();
        await focus(audit.site);
        await page.evaluate(rng => { window.campaignRngState = rng; }, target.rng);
        await tap(button(/거점 도전/));
        await heading("거점 배틀").waitFor();
        const combatRng = await page.evaluate(() => window.campaignRngState);
        assert.equal(combatRng, target.combatRng, "Same RNG draws built the same enemy roster");
        if (variation) await page.evaluate(offset => { window.campaignRngState ^= offset; }, 0x45d9f3b * variation);
        const battle = await playCampaignBattle(page, 240, variation === 0);
        assert.deepEqual(battle.enemies, audit.enemy.slice(0, battle.enemies.length));
        if (!variation && strategy === "concentrated") {
          assert.equal(battle.choices, target.battle.choices);
          assert.equal(battle.outcome, target.battle.outcome);
          assert.deepEqual(battle.finish, target.battle.finish);
        }
        results.push(battle);
      }
      console.log(JSON.stringify({ seed, audit: strategy, site: audit.site, enemies: audit.enemy, candySpent,
        turns: trained.turnCount - start.turnCount, charges: totals.charges - startCharges,
        team: trained.entryOrder.map(id => trained.roster.find(member => member.id === id)).map(({ pokemon, level }) => [pokemon.nameKr, level]), results }));
    }
    assert.equal(budgets.get("concentrated"), budgets.get("spread"), "Compared strategies must spend the same amount of candy");
    if (audit.moveThreshold) assert.ok(budgets.get("moveThreshold") <= budgets.get("concentrated"));

    if (audit.researchThreshold) {
      const { name, level } = audit.researchThreshold;
      await loadTestCheckpoint(checkpoint);
      const initial = await save();
      const before = await turn("audit");
      const worker = before.roster.find(member => member.jobId === "research" && member.pokemon.nameKr === name);
      assert.ok(worker);
      await openResearch();
      await dojo().getByText(/Lv\.4부터 턴당 최대 사탕 1 → 2개.*사탕 6개.*행동력 6/).waitFor();
      await close(dojo());
      const startCandy = totals.candies;
      await grow(worker.id, level);
      const trained = await save();
      await openResearch();
      await dojo().getByRole("listitem").filter({ hasText: name }).getByText("경험치 사탕 +2 / 최대 2").waitFor();
      await close(dojo());
      const after = await turn("audit");
      const from = before.resources.candy - initial.resources.candy;
      const to = after.resources.candy - trained.resources.candy;
      assert.equal(from, 3);
      assert.equal(to, 4);
      console.log(JSON.stringify({ seed, audit: "researchThreshold", name, aptitude: worker.aptitude, fromLevel: worker.level,
        toLevel: level, cost: totals.candies - startCandy, from, to, trainingTurns: trained.turnCount - before.turnCount }));
    }
    assert.deepEqual(errors, []);
  }

  try {
    await page.addInitScript(initializeCampaignRandom, seed);
    if (dexRefill) {
      const { snapshot, keepers, rng } = dexRefill;
      await initializeSaveCopy(page, snapshot);
      await page.goto(url);
      await heading("본거지").waitFor();
      assert.deepEqual(await save(), snapshot);
      ({ aceIds, thirdStarterId, registeelId } = keepers);
      operations.dragon = keepers.dragon;
      await page.evaluate(state => { window.campaignRngState = state; }, rng);
      const current = await collectDex(25, dexRefill.strategy);
      assert.deepEqual(current.claimedDexRewards, snapshot.claimedDexRewards);
      await verifyEndingRestore(current);
      assert.deepEqual(errors, []);
      return { stage: dexStages[0], attempts: dexAttempts, dex: current.caughtSpeciesIds, chargeEvents: ledger.chargeEvents };
    }
    await page.goto(url);
    for (const [index, pick] of picks.entries()) {
      await heading(`스타팅 선택 ${index + 1}/3`).waitFor();
      await page.locator("[data-draft-target]").nth(pick).press("Enter");
    }
    await tap(button("본거지로 이동"));
    await heading("본거지").waitFor();
    const draft = await save();
    startingEnergy = draft.energy;
    const starters = draft.roster.map(member => member.pokemon.nameKr);
    const trainer = trainers.find(trainer => trainer.id === draft.trainerId).nameKr;
    if (manageFavor) {
      assert.equal(trainer, "비파");
      registeelId = draft.roster.find(member => member.pokemon.nameKr === "레지스틸").id;
    }
    const lead = draft.roster.slice().sort((a, b) => campaignMemberScore(b, 16) - campaignMemberScore(a, 16));
    aceIds = lead.slice(0, 2).map(member => member.id);
    thirdStarterId = lead[2].id;
    console.log(JSON.stringify({ seed, trainer, starters, train: lead.slice(0, 2).map(member => member.pokemon.nameKr) }));
    await setParty(lead.map(member => member.id));
    await prepare("southwest");
    assert.ok((await fight("southwest")).won);
    await base();

    const beforeFirstConstruction = await save();
    await tap(button("1번 부지 건설"));
    const construction = page.getByRole("dialog", { name: "건설 · 1번 부지" });
    await tap(button("훈련소", construction));
    for (const member of draft.roster) await tap(construction.locator(`[data-install-pick="${member.id}"]`));
    await tap(construction.locator("[data-build-confirm]"));
    await construction.waitFor({ state: "hidden" });
    settlements.construction += beforeFirstConstruction.energy - (await save()).energy;
    await turn("growth");
    await research(2);
    await equip();
    for (region = 0; region < routes.length; region++) {
      const start = await save();
      if (region === audit?.region) fork = start;
      const initialLogs = logs.length;
      const initialTotals = { ...totals, lost: totals.lost.length };
      if (region === 1) await research(3);
      if (manageFavor && region === 1) await setUpFavorProduction();
      if (useFrontier && region === 1) await recruitDragon();
      if (useGuidance && seed === 226 && region === 1) await improveResearch();
      if (useGuidance && seed === 226 && region === 3) await planMinji();
      else for (const [index, level] of goals[region].entries()) await grow(aceIds[index], level);
      for (const id of routes[region].filter(id => id !== "southwest")) {
        if (darkAudit && id === "se-10") {
          await recruitDark();
          // Keep the last South-East workshop in enemy hands long enough to exercise a real new-warning window.
          for (let elapsed = 0; !dark.prevented.length && elapsed < 6; elapsed++) {
            await energy(1, false, "dark-window");
            await turn("dark-window");
          }
          assert.ok(dark.prevented.length, "Expected an actual new warning to be prevented in the South-East");
        }
        if (dexDuringCampaign && id === routes.at(-1).at(-1)) {
          const ready = await collectDex(25, "before-last-site");
          assert.equal(ready.mapSnapshot.filter(site => site.owner === "player").length, 39);
          await heading("본거지").waitFor();
        }
        if (useGuidance && seed === 7 && id === "se-06") await planBippa();
        const inspectNorthwest = flyingDecisionAudit && flyingMode === "observe" && id === "nw-02";
        if ((flyingBattleAudit && id === "nw-02") || inspectNorthwest) {
          flyingBattleCheckpoints = flyingSample || inspectNorthwest ? {} : { arrival: await save() };
        }
        const isolate = id === "nw-04" && !connectedRoute;
        await takeSite(id, region > 0 ? isolate ? "isolated" : "supplied" : null);
        if (inspectNorthwest) {
          const { snapshot, rng } = flyingBattleCheckpoints.firstChallenge;
          const visible = await readFlyingDecisionScreen(snapshot, "nw-01", "nw-02");
          console.log(JSON.stringify({ audit: "Flying decision screen", ...visible }));
          await compareFlyingBattleWithCampaignEntry("native", snapshot, logs.find(battle => battle.id === id), rng);
        }
        if (flyingBattleAudit && id === "nw-02") {
          const originalBattle = logs.find(battle => battle.id === id);
          const { arrival, firstChallenge } = flyingBattleCheckpoints;
          if (flyingSample) {
            await compareFlyingBattleWithCampaignEntry("nativeSample", firstChallenge.snapshot, originalBattle, firstChallenge.rng);
          } else {
            await compareFlyingBattleWithCampaignEntry("arrival", arrival, originalBattle);
            await compareFlyingBattleWithCampaignEntry("firstChallenge", firstChallenge.snapshot, originalBattle);
            await compareFlyingBattleWithCampaignEntry("native", firstChallenge.snapshot, originalBattle, firstChallenge.rng);
            await compareFlyingBattleWithCampaignEntry("nativeWithoutReport", firstChallenge.snapshot, originalBattle, firstChallenge.rng);
            await compareFlyingBattleWithCampaignEntry("nativeReordered", firstChallenge.snapshot, originalBattle, firstChallenge.rng);
          }
          assert.deepEqual(errors, []);
          return;
        }
        if (useOutposts && id === "nw-02") await setUpOutpostProduction();
        if (flyingMode && id === "nw-02") await recruitFlying();
        if (frontierAudit && id === "nw-02") {
          assert.ok(leadCheckpoint && defenseCheckpoint);
          const reference = logs.find(battle => battle.id === id);
          const reproduced = await compareReconLead(leadCheckpoint, reference);
          for (const field of ["choices", "switches", "replacements", "outcome"]) assert.equal(reproduced[field], reference[field]);
          await compareDragonIncome(defenseCheckpoint, operations.dragon.id);
          assert.deepEqual(errors, []);
          return;
        }
        if (isolate) {
          // Advance one turn before capturing the bridge in each campaign.
          const settled = await turn("supply");
          assert.equal(spot(settled, id).loyalty, 65);
        }
        if (id === "nw-01" && !connectedRoute && spot(await save(), "nw-04").owner !== "player") await takeSite("nw-04", "supplied");
      }
      const state = await save();
      assert.ok(routes[region].every(id => spot(state, id).owner === "player"));
      const battles = logs.slice(region === 0 ? 0 : initialLogs);
      console.log(JSON.stringify({ seed, region: region + 1, turn: state.turnCount, additionalTurns: state.turnCount - (region === 0 ? 0 : start.turnCount),
        levels: state.entryOrder.map(id => state.roster.find(member => member.id === id).level),
        costs: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, (key === "lost" ? value.length : value) - (region === 0 ? 0 : initialTotals[key])])),
        battles: battles.length, losses: battles.filter(battle => battle.outcome === "lose").length,
        draws: battles.filter(battle => battle.outcome === "draw").length, concedes: battles.filter(battle => battle.outcome === "concede").length,
        choices: battles.reduce((sum, battle) => sum + battle.choices, 0),
        immunities: battles.reduce((sum, battle) => sum + battle.immuneChoices, 0),
        longest: battles.reduce((longest, battle) => battle.choices > longest.choices ? battle : longest),
      }));
      const dexTarget = [null, 13, 19][region];
      if (dexDuringCampaign && dexTarget) await collectDex(dexTarget, `region-${region + 1}`);
    }
    const cleared = await save();
    assert.equal(cleared.mapSnapshot.filter(site => site.owner === "player").length, 40);
    assert.deepEqual(errors, []);
    await page.reload();
    await (dexDuringCampaign ? ending : heading("본거지")).waitFor();
    const restored = await save();
    for (const field of ["roster", "entryOrder", "resources", "v", "mapSnapshot", "turnCount"]) assert.deepEqual(restored[field], cleared[field], field);
    if (inheritedDojoAudit) {
      await verifyLegacyClearedChallenge(restored);
      const legacyCompletion = await verifyExhaustedDojoChallenge(restored);
      assert.ok(legacyCompletion);
      await verifyInheritedResearchReward(restored);
      await verifyInheritedResearchReward(legacyCompletion, { touch: true });
    }
    if (manageFavor) {
      for (const field of ["buildings", "plotCap", "caughtSpeciesIds", "frontier", "outposts"]) assert.deepEqual(restored[field], cleared[field], field);
      const registeel = restored.roster.find(member => member.id === registeelId);
      assert.ok(restored.entryOrder.includes(registeelId));
      assert.ok(favor.recovery.some(use => use.name === "레지스틸"));
      assert.ok(favor.sashProtection.length > 0);
      assert.equal(registeel.heldItem, "focus_sash");
      assert.equal(registeel.favor, registeel.favFloor);
      assert.equal(favor.healItemsProduced - favor.recovery.length, restored.resources.healItem);
      const candyProduced = Object.values(settlements.harvest).reduce((sum, output) => sum + (output["경험치 사탕"] ?? 0), 0);
      assert.equal(candyProduced + 1, totals.candies + restored.resources.candy);
      if (useOutposts) {
        assert.equal(settlements.inheritances.length, 2);
        assert.equal(settlements.remoteMaterialUsed, 3);
        assert.equal(settlements.harvest["북서 4거점"]["부품"], 3);
        const remoteCandy = settlements.harvest["북서 2거점"]?.["경험치 사탕"] ?? 0;
        assert.ok(settlements.sash);
        if (researchSite === "outpost") assert.ok(remoteCandy > 0);
        else assert.equal(remoteCandy, 0);
      }
      console.log(JSON.stringify({ seed, settlementBenchmark: { ...settlements, candyProduced, candySpent: totals.candies,
        candyRemaining: restored.resources.candy, growthTurns: totals.growthTurns, turns: restored.turnCount } }));
      const raids = Object.fromEntries(["hit", "blocked", "cancelled"].map(outcome =>
        [outcome, ledger.raids.filter(event => event.outcome === outcome).length]));
      const battleSummary = { attempts: logs.length, losses: logs.filter(battle => !battle.won).length,
        choices: logs.reduce((sum, battle) => sum + battle.choices, 0), switches: logs.reduce((sum, battle) => sum + battle.switches, 0),
        replacements: logs.reduce((sum, battle) => sum + battle.replacements, 0),
        longest: Math.max(...logs.map(battle => battle.choices)) };
      if (useFrontier) {
        assert.equal(operations.reports.length, reconTargets.size);
        assert.ok(operations.reports.some(report => report.originalLead !== report.lead));
        console.log(JSON.stringify({ seed, operations }));
        assert.ok(raids.blocked > 0 && operations.defenseEnergy > 0, `Expected a resolved Dragon defense: ${JSON.stringify(ledger.raids)}`);
      }
      console.log(JSON.stringify({ seed, benchmark: { turns: restored.turnCount,
        energySpent: startingEnergy + ledger.turnRefill + ledger.purchasedRefill - restored.energy,
        purchasedRefill: ledger.purchasedRefill, income: ledger.income, gold: restored.resources.gold,
        raids, lostIncome: ledger.raids.filter(event => event.outcome === "hit").reduce((sum, event) => sum + event.atStake, 0),
        savedIncome: ledger.raids.filter(event => event.outcome === "blocked").reduce((sum, event) => sum + event.atStake, 0),
        events: ledger.raids, battle: battleSummary, encounters: logs.filter(battle => reconTargets.has(battle.id))
          .map(({ id, enemies, choices, outcome }) => ({ id, enemies, choices, outcome })) } }));
      if (darkAudit) {
        assert.ok(dark.prevented.length > 0);
        if (seed === 7) assert.ok(dark.incomeWithRoom, "The turn-30 Southeast 10 checkpoint was not reached");
        assert.equal(restored.frontier.sabotage, undefined);
        console.log(JSON.stringify({ seed, audit: "dark-campaign", turns: restored.turnCount, income: ledger.income,
          gold: restored.resources.gold, charges: totals.charges, actualRaidLoss: ledger.raids.filter(event => event.outcome === "hit")
            .reduce((sum, event) => sum + event.atStake, 0), ...dark }));
      }
      console.log(JSON.stringify({ seed, favorReplay: { ...favor, recoveryItemsUsed: favor.recovery.length,
        dedicatedTurns: favor.turns.length, actionPowerSpent: Object.values(favor.actionPower).reduce((sum, used) => sum + used, favor.recovery.length),
        goldSpent: favor.charges * 5, recoveryItemsLeft: restored.resources.healItem,
        registeel: { level: registeel.level, favor: registeel.favor, floor: registeel.favFloor, item: registeel.heldItem } } }));
    }
    if (!dexDuringCampaign) {
      await map();
      await verifySupplyMap();
    }
    console.log(JSON.stringify({ seed, trainer, starters, route: connectedRoute ? "connected" : "nw-04-first", cleared: 40, turns: cleared.turnCount, ...totals }));
    if (useGuidance) {
      const site = auditCases.get(seed).site;
      const attempts = logs.filter(battle => battle.id === site);
      if (baselineData && seed === 7) assert.deepEqual(attempts[0].enemies, auditCases.get(seed).enemy);
      console.log(JSON.stringify({ seed, guide: "result", site, attempts, choicesAtSite: attempts.reduce((sum, battle) => sum + battle.choices, 0),
        battles: logs.length, losses: logs.filter(battle => !battle.won).length, growthTurns: totals.growthTurns, decisions: guidance.length }));
    }
    if (audit) await compareTraining();
    if (endingRun) {
      const chargesAtClear = totals.charges;
      if (!dexDuringCampaign) await base();
      if (dexRefillAudit) {
        const snapshot = await save();
        const keepers = { aceIds, thirdStarterId, registeelId, dragon: operations.dragon };
        return { snapshot, keepers, rng: await page.evaluate(() => window.campaignRngState) };
      }
      await verifyCampaignEnding(restored, chargesAtClear);
    }
    if (researchSiteAudit) return {
      checkpoint: researchCheckpoint, chargeEvents: ledger.chargeEvents, candyPerTurn: ledger.candyPerTurn,
      battles: logs.map(({ id, turn, enemies, choices, outcome }) => ({ id, turn, enemies, choices, outcome })),
      harvest: settlements.harvest,
      metrics: { turns: restored.turnCount, growthTurns: totals.growthTurns, candies: totals.candies,
        charges: totals.charges, purchasedRefill: ledger.purchasedRefill, gold: restored.resources.gold,
        construction: settlements.construction, assignments: settlements.assignments + settlements.outpostAssignments },
    };
    if (flyingMode) {
      const encounters = logs.map(({ id, turn, enemies, choices, won, outcome, switches, replacements, flyingEncounter }) =>
        ({ id, turn, enemies, choices, won, outcome, switches, replacements, ...flyingEncounter }));
      const blocked = flying.events.filter(event => event.outcome === "차단").length;
      assert.equal(flying.detectEnergy, blocked);
      if (flyingMode === "detect") assert.ok(blocked > 0, "Expected Flying detection to resolve during the live campaign");
      return { ...flying, blocked, observed: flying.events.filter(event => event.outcome === "성공").length,
        cancelled: flying.events.filter(event => event.outcome === "취소").length,
        turns: restored.turnCount, charges: totals.charges, growthTurns: totals.growthTurns, encounters,
        pending: restored.frontier.espionage?.observation ?? null };
    }
  } catch (error) {
    console.error(JSON.stringify({ seed, region, battleSite, totals, last: logs.slice(-4), state: await save().then(state =>
      state && { turn: state.turnCount, energy: state.energy, gold: state.resources.gold, candy: state.resources.candy,
        roster: state.roster.map(member => [member.pokemon.nameKr, member.level, member.jobId]) }).catch(() => null), errors }));
    throw error;
  } finally {
    await page.close();
  }
}

async function findOliviaDrawSeed(snapshot, trainer) {
  const ids = new Set(trainer.pokemon.map(entry => entry.id));
  const pool = pokemon.filter(entry => ids.has(entry.pokemonRowid)).map(entry => entry.pokemonRowid);
  return withCampaignCopy(snapshot, async ({ page }) => page.evaluate(ids => {
    const originalRng = window.campaignRngState;
    try {
      for (let seed = 0; seed < 10000; seed++) {
        window.campaignRngState = seed;
        const remaining = [...ids];
        const [first] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
        const second = remaining[Math.floor(Math.random() * remaining.length)];
        // Match the preceding benchmark's two level-10 defenders.
        const firstUpperLevel = Math.random() >= .5;
        const secondUpperLevel = Math.random() >= .5;
        if (first === 345 && second === 369 && firstUpperLevel && secondUpperLevel) return seed;
      }
      throw new Error("No Lileep → Relicanth seed with both upper levels");
    } finally {
      window.campaignRngState = originalRng;
    }
  }, pool));
}

async function compareFlyingBattleWithCampaignEntry(phase, snapshot, originalBattle, campaignRng) {
  const siteId = "nw-02";
  const targetId = "nw-01";
  const sample = phase === "nativeSample";
  const reordered = phase === "nativeReordered" || sample;
  const withoutReport = phase === "nativeWithoutReport" || reordered;
  const native = phase === "native" || withoutReport;
  const originalTrainerId = spot(snapshot, siteId).trainerId;
  const trainerId = native ? originalTrainerId : "shauna";
  const trainer = trainers.find(item => item.id === trainerId);
  const trainerName = trainer.nameKr;
  const rosterEntry = save => save.entryOrder.map(id => save.roster.find(member => member.id === id));
  const names = save => rosterEntry(save).map(member => `${member.pokemon.nameKr} Lv.${member.level}`);
  const actualEntry = rosterEntry(snapshot);
  const lead = actualEntry[0].pokemon;
  const leadTypes = [...new Set([lead.type1Rowid, lead.type2Rowid])];
  const graph = Object.fromEntries(snapshot.mapSnapshot.map(site => [site.id, site]));
  assert.ok(frontierRules.frontierSources(graph, siteId).includes(targetId));
  assert.ok(snapshot.energy >= 1, "The campaign checkpoint must afford the Flying order");
  const priorSignal = snapshot.frontier.espionage?.observation;
  const reusedSignal = priorSignal?.sourceId === siteId && priorSignal.targetId === targetId;
  const report = snapshot.frontier.intel[siteId];
  if (native) {
    assert.equal(trainerName, "라이치");
    assert.ok(reusedSignal && priorSignal.trainerId === trainerId && !priorSignal.detectorId);
    assert.ok(report && !report.memberId);
    assert.deepEqual(report.pokemonIds.map(id => species.get(id).nameKr), originalBattle.enemies.map(name => name.replace(/ Lv\.\d+$/, "")));
    assert.ok(Number.isInteger(campaignRng));
  }
  const flying = frontierRules.availableFrontierWorkers(snapshot, frontierRules.FLYING_TYPE)[0];
  const detector = flying ?? { id: `mon-${snapshot.nextMemberId}`, pokemon: species.get(18), alias: "피죤투", level: 1, exp: 0,
    favor: 80, favCeil: 80, favFloor: 20, aptitude: 50, iv: {}, buildingId: null, jobId: null, heldItem: null };
  assert.ok(!snapshot.entryOrder.includes(detector.id) || flying, "The fixture Flying worker must not enter the battle");
  const { [siteId]: _originalReport, ...intel } = snapshot.frontier.intel;
  const starting = {
    ...snapshot,
    ...(!flying && { roster: [...snapshot.roster, detector], nextMemberId: snapshot.nextMemberId + 1,
      caughtSpeciesIds: [...new Set([...snapshot.caughtSpeciesIds, detector.pokemon.pokemonRowid])] }),
    ...(withoutReport && { frontier: { ...snapshot.frontier, intel } }),
    ...(!native && {
      mapSnapshot: snapshot.mapSnapshot.map(site => site.id === siteId ? { ...site, trainerId } : site),
      frontier: { ...snapshot.frontier, intel, espionage: { quietTurns: 0,
        observation: { sourceId: siteId, targetId, trainerId } } },
    }),
  };
  const draws = [.7, .6, 0, .99];
  const drawSeed = sample ? 93 : reordered ? await findOliviaDrawSeed(starting, trainer) : campaignRng;
  const combatSeeds = sample ? Array.from({ length: 30 }, (_, index) => Math.imul(index + 1, 0x9e3779b9) >>> 0)
    : native ? [reordered ? "draw" : "campaign", 19, 226] : [7, 19, 226];
  const typeData = native ? null : { pokemon, types: await read("type") };
  async function runPair(seed, detailed = false) {
    const pair = { seed };
    let beforeBattle;
    let battleRng;
    for (const mode of ["observed", "blocked"]) {
      pair[mode] = await withCampaignCopy(starting, async ({ page, read, button }) => {
        assert.deepEqual(await read(), starting);
        if (mode === "blocked") {
          await button("첩보 탐지 대응").press("Enter");
          const response = page.getByRole("region", { name: "비행 탐지 대응" });
          await response.getByLabel("탐지할 비행 타입").selectOption(detector.id);
          await button(/비행 탐지/, response).press("Enter");
          await response.getByText("적 첩보 차단 · 출처 북서 2거점", { exact: true }).waitFor();
          const queued = await read();
          assert.equal(queued.frontier.espionage.observation.detectorId, detector.id);
          assert.equal(queued.energy, starting.energy - 1);
          await button("본거지로").press("Enter");
        }
        await page.locator("#nextTurn").press("Enter");
        await page.waitForFunction(({ key, turn }) => JSON.parse(localStorage.getItem(key))?.turnCount === turn,
          { key, turn: starting.turnCount + 1 });
        const { lastLog, frontier, ...other } = await read();
        const { espionage, ...otherOrders } = frontier;
        assert.deepEqual(other.entryOrder, snapshot.entryOrder);
        assert.deepEqual(names(other), names(snapshot));
        if (beforeBattle) assert.deepEqual({ ...other, frontier: otherOrders }, beforeBattle);
        else beforeBattle = { ...other, frontier: otherOrders };
        if (mode === "observed") {
          assert.deepEqual(espionage.preparation.leadTypes, leadTypes);
          assert.equal(espionage.preparation.territoryId, siteId);
          if (native) assert.ok(lastLog.some(line => line.includes(withoutReport ? "수비 선봉 준비" : "공개 순서 유지")));
        } else {
          assert.equal(espionage.preparation, undefined);
          assert.ok(lastLog.some(line => line.includes("적 첩보 차단")));
        }
        await button("지도").press("Enter");
        await page.locator(`[data-node="${siteId}"]`).press("Enter");
        const challenge = button(/거점 도전/);
        if (native) {
          const disclosed = page.getByRole("region", { name: "공개된 수비팀" });
          if (withoutReport) {
            assert.equal(frontier.intel[siteId], undefined);
            assert.equal(await disclosed.count(), 0);
          } else {
            assert.deepEqual(frontier.intel[siteId], report);
            await disclosed.waitFor();
            assert.deepEqual(await disclosed.getByRole("listitem").allTextContents(), report.pokemonIds.map(id => species.get(id).nameKr));
          }
          await page.evaluate(value => { window.campaignRngState = value; }, drawSeed);
        } else await fixBattleDraws(challenge, draws);
        await challenge.press("Enter");
        await page.getByRole("heading", { name: "거점 배틀", exact: true }).waitFor();
        await page.getByText(trainerName, { exact: true }).waitFor();
        await page.locator('.duel-vitals[data-side="enemy"] h2').waitFor();
        if (reordered) {
          const rngAfterDraw = await page.evaluate(() => window.campaignRngState);
          if (mode === "observed") battleRng = rngAfterDraw;
          else assert.equal(rngAfterDraw, battleRng);
        }
        if (typeof seed === "number") await setBattleRandom(page, seed);
        const recordRounds = reordered && typeof seed === "number";
        const result = await playCampaignBattle(page, 240, recordRounds ? "rounds" : true);
        if (recordRounds && (!sample || detailed)) {
          assert.equal(result.trace.rounds.length, result.choices);
          for (const [index, round] of result.trace.rounds.entries()) {
            assert.equal(round.round, index + 1);
            assert.ok(round.lines.some(line => line.startsWith(round.choice.replace(" · ", "의 ") + "!")));
            const directDamage = round.lines.filter(line => line.startsWith(round.enemy + "의 "))
              .reduce((sum, line) => sum + Number(line.match(/(\d+) 피해/)?.[1] ?? 0), 0);
            assert.equal(round.playerHp - round.playerHpAfter, directDamage, JSON.stringify(round));
          }
        }
        const expected = native ? originalBattle.enemies : ["개구마르 Lv.9", "푸호꼬 Lv.10"];
        if (!native && frontierRules.prefersSecondDefender(siteId, [656, 653], espionage.preparation, typeData)) expected.reverse();
        if (!withoutReport) assert.deepEqual(result.enemies, expected.slice(0, result.enemies.length));
        if (reordered) {
          const expectedOrder = mode === "blocked" ? ["릴링 Lv.10", "시라칸 Lv.10"] : ["시라칸 Lv.10", "릴링 Lv.10"];
          assert.ok(result.enemies.length > 0);
          assert.deepEqual(result.enemies, expectedOrder.slice(0, result.enemies.length));
        }
        if (seed === "campaign" && !withoutReport) {
          for (const field of ["choices", "switches", "replacements", "outcome", "enemies"]) assert.deepEqual(result[field], originalBattle[field]);
        }
        if (sample) {
          const damage = Object.entries(result.trace.moves)
            .filter(([action]) => /^(시라칸|릴링)의 /.test(action)).reduce((sum, [, move]) => sum + move.damage, 0);
          const { rounds } = result.trace;
          assert.equal(rounds.length, result.choices);
          if (!result.switches && !result.replacements && !result.struggleChoices) {
            assert.equal(damage, rounds[0].playerHp - rounds.at(-1).playerHpAfter);
          }
          return { choices: result.choices, damage, outcome: result.outcome, won: result.won, enemies: result.enemies,
            switches: result.switches, replacements: result.replacements, ...(detailed && { trace: result.trace }) };
        }
        return result;
      });
    }
    if (withoutReport && pair.observed.enemies.length === 2 && pair.blocked.enemies.length === 2) {
      assert.deepEqual(pair.observed.enemies.toSorted(), pair.blocked.enemies.toSorted());
    }
    return pair;
  }

  const cases = [];
  for (const seed of combatSeeds) {
    cases.push(await runPair(seed));
    if (sample && cases.length % 10 === 0) console.log(`Chrome Flying pairs: ${cases.length}/${combatSeeds.length}`);
  }
  console.log(JSON.stringify({ audit: native ? "Lychee Flying battle comparison" : "Shauna with actual campaign entry", phase, checkpointTurn: snapshot.turnCount,
    comparisonTurn: snapshot.turnCount + 1,
    originalTrainer: trainers.find(trainer => trainer.id === originalTrainerId).nameKr,
    originalBattle, actualEntry: names(snapshot), leadTypes, reusedSignal, worker: detector.pokemon.nameKr, addedWorker: !flying, drawSeed,
    ...(sample && { summary: summarizeFlyingSample(cases) }), cases }));
  if (sample && flyingExtremes) {
    const damageDelta = ({ observed, blocked }) => blocked.damage - observed.damage;
    const ranked = cases.toSorted((first, second) => damageDelta(first) - damageDelta(second));
    const selected = [...ranked.slice(0, 3), ...ranked.slice(-3).reverse()];
    for (const original of selected) {
      const replay = await runPair(original.seed, true);
      for (const mode of ["observed", "blocked"]) {
        const { trace, ...result } = replay[mode];
        assert.deepEqual(result, original[mode]);
        assert.equal(trace.rounds.length, result.choices);
      }
      console.log(JSON.stringify({ audit: "Lychee Flying extreme replay", drawSeed, index: cases.indexOf(original) + 1,
        damageDelta: damageDelta(original), ...replay }));
    }
  }
}

function summarizeFlyingSample(cases) {
  const results = Object.fromEntries(["observed", "blocked"].map(mode => {
    const totals = cases.reduce((sum, pair) => {
      const battle = pair[mode];
      return { choices: sum.choices + battle.choices, damage: sum.damage + battle.damage, wins: sum.wins + Number(battle.won) };
    }, { choices: 0, damage: 0, wins: 0 });
    return [mode, { ...totals, meanChoices: totals.choices / cases.length, meanDamage: totals.damage / cases.length }];
  }));
  const pairs = cases.map(({ observed, blocked }) => {
    const wins = Number(blocked.won) - Number(observed.won);
    const choices = observed.choices - blocked.choices;
    const damage = observed.damage - blocked.damage;
    const overall = wins || (choices === 0 && damage === 0 ? 0 : choices >= 0 && damage >= 0 ? 1
      : choices <= 0 && damage <= 0 ? -1 : null);
    return { wins, choices, damage, overall };
  });
  const directions = Object.fromEntries(["wins", "choices", "damage", "overall"].map(metric => [metric, {
    better: pairs.filter(pair => pair[metric] > 0).length,
    tied: pairs.filter(pair => pair[metric] === 0).length,
    worse: pairs.filter(pair => pair[metric] < 0).length,
    ...(metric === "overall" && { tradeoff: pairs.filter(pair => pair.overall === null).length }),
  }]));
  return { results, directions };
}

async function compareFlyingCampaigns(profile) {
  const control = await play(profile, "outpost", undefined, "observe");
  const detected = await play(profile, "outpost", undefined, "detect");
  assert.deepEqual(detected.worker, control.worker);
  assert.deepEqual(detected.hunts, control.hunts);
  const summarize = ({ encounters, ...metrics }) => ({ ...metrics, attempts: encounters.length,
    wins: encounters.filter(battle => battle.won).length, losses: encounters.filter(battle => battle.outcome === "lose").length,
    draws: encounters.filter(battle => battle.outcome === "draw").length, concedes: encounters.filter(battle => battle.outcome === "concede").length,
    choices: encounters.reduce((sum, battle) => sum + battle.choices, 0),
    switches: encounters.reduce((sum, battle) => sum + battle.switches, 0),
    replacements: encounters.reduce((sum, battle) => sum + battle.replacements, 0),
    longest: encounters.reduce((worst, battle) => battle.choices > worst.choices ? battle : worst),
    prepared: encounters.filter(battle => battle.observedTypes).map(({ id, turn, enemies, choices, observedTypes }) =>
      ({ id, turn, enemies, choices, observedTypes })),
    southEastTen: encounters.filter(battle => battle.id === "se-10").map(({ turn, enemies, choices, outcome }) =>
      ({ turn, enemies, choices, outcome })),
  });
  const encounterKey = ({ id, rng }) => `${id}/${rng}`;
  const controlByBattle = new Map(control.encounters.map(battle => [encounterKey(battle), battle]));
  const matched = detected.encounters.flatMap(battle => {
    const prior = controlByBattle.get(encounterKey(battle));
    const sameInputs = prior && JSON.stringify(prior.party) === JSON.stringify(battle.party) &&
      prior.enemies.toSorted().join() === battle.enemies.toSorted().join();
    return sameInputs ? [{ prior, battle }] : [];
  });
  console.log(JSON.stringify({ seed: profile.seed, audit: "flying-campaign", control: summarize(control), detected: summarize(detected),
    matchedBattles: matched.length, matchedDifferences: matched.filter(({ prior, battle }) => prior.enemies.join() !== battle.enemies.join() ||
      prior.choices !== battle.choices || prior.outcome !== battle.outcome).map(({ prior, battle }) => ({ id: battle.id,
      control: { enemies: prior.enemies, choices: prior.choices, outcome: prior.outcome },
      detected: { enemies: battle.enemies, choices: battle.choices, outcome: battle.outcome } })) }));
}

try {
  browser = await chromium.launch({ channel: "chrome" });
  for (const profile of selected) {
    if (dexRefillAudit) await compareDexRefills(profile);
    else if (researchSiteAudit) await compareResearchSites(profile);
    else if (flyingAudit) await compareFlyingCampaigns(profile);
    else await play(profile);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
