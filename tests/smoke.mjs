import { playBattle } from "./battle-play.mjs";
import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});

const errors = [];
let browser;

try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { Math.random = () => 0; });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const firstStarter = page.locator("[data-draft-target]").first();
  await firstStarter.focus();
  await page.getByRole("heading", { name: await firstStarter.getAttribute("aria-label"), exact: true }).waitFor();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "스타팅 선택 2/3" }).waitFor();
  if (!await firstStarter.evaluate(button => document.activeElement === button)) {
    throw new Error("스타팅을 키보드로 선택한 후 다음 후보에 초점이 없습니다.");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "스타팅 선택 2/3" }).waitFor();
  await firstStarter.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "스타팅 선택 3/3" }).waitFor();
  await firstStarter.click();
  const reveal = page.getByRole("group", { name: "트레이너 신분증 뷰파인더" });
  await reveal.getByRole("img", { name: "레드 트레이너" }).evaluate(img => img.decode());
  await page.reload({ waitUntil: "networkidle" });
  await reveal.getByRole("heading", { name: "레드", exact: true }).waitFor();
  await page.getByRole("button", { name: "본거지로 이동" }).click();
  await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
  const trainerButton = page.getByRole("button", { name: "트레이너 카드" });
  const trainerDialog = page.getByRole("dialog", { name: "트레이너 카드" });
  for (let attempt = 0; attempt < 2; attempt++) {
    await trainerButton.press("Enter");
    await trainerDialog.getByRole("img", { name: "레드 트레이너" }).evaluate(img => img.decode());
    if (attempt === 0) await page.keyboard.press("Escape");
    else await trainerDialog.getByRole("button", { name: "닫기" }).click();
    await trainerDialog.waitFor({ state: "hidden" });
    if (!await trainerButton.evaluate(button => document.activeElement === button)) {
      throw new Error("신분증을 닫은 뒤 호출 버튼으로 초점이 돌아오지 않았습니다.");
    }
  }
  if (await page.locator(".base-path-partner").count() !== 3 || await page.locator("[data-plot]").count() !== 10) {
    throw new Error("본거지에서 스타팅 포켓몬 세 마리와 부지 열 곳이 보여야 합니다.");
  }

  const firstPlot = page.getByRole("button", { name: "1번 부지 건설" });
  await firstPlot.click();
  await page.getByRole("dialog", { name: /1번 부지/ }).waitFor();
  await page.keyboard.press("Escape");
  if (!await firstPlot.evaluate(button => document.activeElement === button)) {
    throw new Error("건설 창을 닫은 뒤 건설 부지로 초점이 돌아오지 않았습니다.");
  }
  await firstPlot.click();
  await page.getByRole("button", { name: "치료소", exact: true }).click();
  await page.locator("[data-install-pick]").first().click();
  await page.locator("[data-build-confirm]").click();
  if (await page.locator(".base-path-partner").count() !== 2 || await page.locator(".base-plot-workers img").count() !== 1) {
    throw new Error("건설에 배치한 포켓몬이 부지로 이동하지 않았습니다.");
  }

  let save = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if (save.v !== 4 || save.roster.length !== 3 || save.buildings[0]?.remainingTurns !== 3 ||
      save.buildings[0].type !== "clinic" || save.roster.some(({ pokemon }) => [pokemon.type1Rowid, pokemon.type2Rowid].includes(5))) {
    throw new Error("React 전환 후 초기 저장 또는 착공 상태가 올바르지 않습니다.");
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-plot-construction]").waitFor({ state: "visible" });
  for (let turn = 0; turn < 3; turn++) {
    await page.locator("#nextTurn").click();
    await page.waitForFunction(expected => JSON.parse(localStorage.getItem("blindpoke-save-v1")).turnCount === expected, turn+1);
  }

  save = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if (save.buildings[0]?.status !== "active") {
    throw new Error(`건물이 3턴 뒤 완공되지 않았습니다: ${JSON.stringify(save.buildings[0])}`);
  }

  await page.locator('[data-action="map"]').click();
  await page.locator("#backToBase").click();
  await page.locator('[data-action="hunt"]').click();
  const huntTarget = page.getByRole("button", { name: "미확인 개체 1", exact: true });
  const readout = page.getByRole("complementary", { name: "관측 패널" });
  await readout.getByRole("heading", { name: "관측 대기" }).waitFor();
  await page.keyboard.press("Tab");
  if (!await huntTarget.evaluate(button => document.activeElement === button)) {
    throw new Error("탐험 화면에서 Tab으로 첫 개체를 조준할 수 없습니다.");
  }
  await readout.getByRole("heading", { name: "미확인 개체 1" }).waitFor();
  const detectedType = await readout.locator(".draft-detected-type dd").textContent();
  if (!detectedType || detectedType === "—") throw new Error("탐험 중 감지 타입이 표시되지 않았습니다.");
  await page.keyboard.press("Enter");
  const analysis = page.getByRole("complementary", { name: "개체 분석" });
  await analysis.locator(".identify-console-header", { hasText: `감지 타입 ${detectedType}` }).waitFor();
  const lens = page.getByRole("group", { name: "확대 렌즈" });
  await lens.getByText("미확인 개체 1").waitFor();
  const targetArt = lens.locator(".identify-target-art");
  if (!(await targetArt.getAttribute("src"))?.includes("unknown-presence")) {
    throw new Error("외곽 대조 전에 포켓몬 원화가 표시됩니다.");
  }
  await page.getByRole("button", { name: /본인확인서 대조/ }).click();
  await lens.locator('[data-mode="silhouette"]').waitFor();
  const artwork = await targetArt.getAttribute("src");
  const pokemonId = Number(artwork.match(/(\d+)\.png/)?.[1]);
  const pokemonName = await page.evaluate(async id => {
    const pokemon = await fetch("/data/pokemon.json").then(response => response.json());
    return pokemon.find(entry => entry.pokemonRowid === id).nameKr;
  }, pokemonId);
  const guess = page.getByRole("textbox", { name: "포켓몬 이름" });
  await guess.fill(pokemonName);
  await guess.press("Enter");
  await analysis.getByRole("heading", { name: "포획 성공" }).waitFor();
  await lens.getByRole("img", { name: pokemonName, exact: true }).waitFor();
  const capturedSave=await page.evaluate(()=>JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if(capturedSave.roster.length!==4) throw new Error("포획한 포켓몬이 로스터와 저장 데이터에 추가되지 않았습니다.");
  await page.getByRole("button", { name: "본거지로" }).click();
  await page.getByRole("button", {name:"엔트리"}).click();
  await page.locator('[data-pc-member="mon-1"]').dragTo(page.locator('[data-entry-slot="0"]'));
  await page.locator('[data-pc-member="mon-2"]').dragTo(page.locator('[data-entry-slot="0"]'));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.entryOrder?.join(",")==="mon-2,mon-1");
  const entryDialog = page.getByRole("dialog", { name: /전투 엔트리 편성/ });
  await entryDialog.getByRole("button", { name: /뒤 순서로 이동/ }).first().press("Enter");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.entryOrder?.join(",") === "mon-1,mon-2");
  await entryDialog.getByRole("button", { name: "닫기" }).click();
  await page.locator('[data-action="map"]').click();
  await page.getByRole("heading", { name: "월드맵" }).waitFor();
  if (await page.locator("[data-node]").count() !== 40) throw new Error("월드맵 거점이 40개가 아닙니다.");
  if (await page.locator("[data-node]:disabled").count() !== 30) throw new Error("준비 중인 거점이 30개가 아닙니다.");
  const scoutButton=page.locator("[data-scout]").first();
  for (const id of ["southwest","south","southeast"]) {
    await page.locator(`[data-node="${id}"]`).click();
    if (await scoutButton.count()) break;
  }
  await scoutButton.click();
  const mapSave=await page.evaluate(()=>JSON.parse(localStorage.getItem("blindpoke-map-v1")));
  if (mapSave.length!==40||!mapSave.some(entry=>entry.id!=="home"&&entry.scouted)) throw new Error("정찰 결과가 저장되지 않았습니다.");

  await page.locator("#backToBase").click();
  await page.getByRole("button", { name: "1번 부지 치료소 관리" }).waitFor();
  const clinicCheckpoint = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));

  async function expandBase() {
    await page.getByRole("button", { name: "2번 미개척 부지" }).click();
    await page.getByRole("button", { name: /땅 타입 탐색/ }).click();
    await page.getByRole("heading", { name: "야생 탐험" }).waitFor();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-field-transition"));
    const wildTargets = page.locator(".hunt-target");
    let foundGround = false;
    for (const target of await wildTargets.all()) {
      await target.hover();
      if (await readout.locator(".draft-detected-type dd").textContent() === "땅") {
        await target.click();
        foundGround = true;
        break;
      }
    }
    if (!foundGround) throw new Error("땅 타입 탐색에서 일치하는 개체가 나오지 않았습니다.");
    await analysis.locator(".identify-console-header", { hasText: "감지 타입 땅" }).waitFor();
    await page.getByRole("button", { name: /본인확인서 대조/ }).click();
    await lens.locator('[data-mode="silhouette"]').waitFor();
    const groundArt = await targetArt.getAttribute("src");
    const groundId = Number(groundArt.match(/(\d+)\.png/)?.[1]);
    const groundName = await page.evaluate(async id =>
      (await fetch("/data/pokemon.json").then(response => response.json())).find(entry => entry.pokemonRowid === id).nameKr, groundId);
    await guess.fill(groundName);
    await guess.press("Enter");
    await analysis.getByRole("heading", { name: "포획 성공" }).waitFor();
    await page.getByRole("button", { name: "본거지로" }).click();
    await page.getByRole("button", { name: "2번 미개척 부지" }).click();
    const clearing = page.getByRole("dialog", { name: /땅 평탄화/ });
    await clearing.getByRole("button", { name: groundName, exact: true }).click();
    await clearing.getByRole("button", { name: "땅 평탄화 시작" }).click();
    await clearing.getByText(/작업 중 · 다음 턴에 개척 완료/).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("개척 중", { exact: true }).waitFor();
    await page.locator("#nextTurn").click();
    await page.getByRole("button", { name: "2번 부지 건설" }).click();
    await page.getByRole("dialog", { name: /건설 · 2번 부지/ }).getByRole("button", { name: groundName, exact: true }).click();
    await page.locator("[data-build-confirm]").click();
    await page.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem("blindpoke-save-v1"));
      return save.plotCap === 2 && save.clearing === null && save.buildings[1]?.plotIndex === 1;
    });
  }

  await expandBase();
  await page.evaluate(({ mapSnapshot, caughtSpeciesIds, claimedDexRewards, endingSeen, ...previous }) => {
    // v3 saves stored the map separately and predate the Pokédex.
    localStorage.setItem("blindpoke-save-v1", JSON.stringify({ ...previous, v: 3 }));
    localStorage.setItem("blindpoke-map-v1", JSON.stringify(mapSnapshot));
  }, clinicCheckpoint);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "1번 부지 치료소 관리" }).waitFor();
  await expandBase();
  for (let turn = 0; turn < 3; turn++) await page.locator("#nextTurn").click();
  await page.getByRole("button", { name: "2번 부지 밭 관리" }).click();
  const farm = page.getByRole("dialog", { name: "밭 · 2번 부지" });
  await farm.getByRole("button", { name: "이상해꽃", exact: true }).click();
  await farm.getByRole("button", { name: /직무 배치 · 행동력 1/ }).click();
  const predicted = await farm.getByText(/씨앗 \+\d+ \/ 최대/).textContent();
  const seedGain = Number(predicted.match(/\+(\d+)/)?.[1]);
  await farm.getByRole("button", { name: "닫기" }).click();
  await page.locator("#nextTurn").click();
  await page.waitForFunction(amount => {
    const save = JSON.parse(localStorage.getItem("blindpoke-save-v1"));
    return save.resources.seed === amount && save.roster.some(member => member.jobId === "seed");
  }, seedGain);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const savedGame = () => page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  const rosterBeforeBattle = await savedGame();
  async function winTerritory(id, first = false) {
    await page.locator(`[data-node="${id}"]`).click();
    if (await page.locator("[data-scout]").count()) await page.locator("[data-scout]").click();
    await page.getByRole("button", { name: /거점 도전/ }).click();
    await page.getByRole("heading", { name: "거점 배틀" }).waitFor();
    if (first) await page.getByRole("heading", { name: "캐터피" }).waitFor();
    assert.equal((await playBattle(page)).won, true, "Failed to win " + id);
  }
  await page.locator('[data-action="map"]').click();
  await winTerritory("southwest", true);
  assert.match(await page.locator(".duel-outcome").textContent(), /첫 승리 보상/);
  // Ownership and rewards are saved while the results are on screen.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")).mapSnapshot.find(spot => spot.id === "southwest").owner === "player");
  await page.evaluate(() => localStorage.setItem("blindpoke-map-v1", "{"));
  await page.reload({ waitUntil: "networkidle" });
  const victory = await savedGame();
  assert.equal(victory.resources.candy, rosterBeforeBattle.resources.candy + 1);
  assert.equal(victory.resources.gold, rosterBeforeBattle.resources.gold + 5);
  assert.equal(victory.mapSnapshot.find(spot => spot.id === "southwest").owner, "player");
  await page.locator("#nextTurn").click();
  await page.waitForFunction(gold => JSON.parse(localStorage.getItem("blindpoke-save-v1")).resources.gold === gold, victory.resources.gold + 3);
  await page.getByRole("button", { name: /포켓몬 \d/ }).click();
  const pc = page.getByRole("dialog", { name: /보유 포켓몬/ });
  await pc.locator('[data-install-pick="mon-1"]').click();
  await pc.getByRole("button", { name: "사탕 먹이기" }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")).roster[0].level === 2);
  await pc.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: "상점" }).click();
  await page.getByRole("button", { name: "구매" }).click();
  await page.waitForFunction(gold => JSON.parse(localStorage.getItem("blindpoke-save-v1")).resources.gold === gold, victory.resources.gold - 2);
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();

  // Fill the entry using available partners, without editing the live campaign save.
  await page.getByRole("button", { name: "엔트리" }).click();
  for (const id of ["mon-3", "mon-4", "mon-5"]) {
    await page.locator(`[data-pc-member="${id}"]`).click();
  }
  await entryDialog.getByRole("button", { name: "닫기" }).click();
  for (const id of ["west", "south", "southeast", "east", "center", "northwest", "northeast", "island"]) {
    await page.locator("#nextTurn").click();
    await page.locator('[data-action="map"]').click();
    await winTerritory(id);
    await page.getByRole("button", { name: "월드맵으로" }).click();
    if (id !== "island") assert.equal(await page.locator("[data-node]:disabled").count(), 30);
    await page.locator("#backToBase").click();
  }
  const campaign = await savedGame();
  assert.equal(campaign.mapSnapshot.filter(spot => spot.owner === "player").length, 10);
  assert.equal(campaign.mapSnapshot.filter(spot => spot.active).length, 20);

  const legacy = await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("blindpoke-save-v1"));
    value.v = 1;
    delete value.mapSnapshot;
    delete value.buildings;
    delete value.nextBuildingId;
    value.underConstruction = { farm: 2 };
    value.roster.forEach(member => { delete member.buildingId; });
    value.roster[0].building = "farm";
    localStorage.setItem("blindpoke-save-v1", JSON.stringify(value));
    return value.roster[0].id;
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-plot-construction="building-1"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.v === 4);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if (migrated.v !== 4 || migrated.roster.find(member => member.id === legacy)?.buildingId !== "building-1") {
    throw new Error("v1 저장 데이터가 v4 상태로 마이그레이션되지 않았습니다.");
  }

  // Fixture only skips the remaining battles/captures. Control and persistence run through the real UI.
  await page.evaluate(() => {
    const key = "blindpoke-save-v1";
    const save = JSON.parse(localStorage.getItem(key));
    save.caughtSpeciesIds = Array.from({ length: 25 }, (_, index) => index + 1);
    save.mapSnapshot = save.mapSnapshot.map(spot => ({ ...spot, owner: "player", scouted: true, active: true }));
    localStorage.setItem(key, JSON.stringify(save));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "관측 임무 완료" }).waitFor();
  await page.getByRole("button", { name: "새 게임" }).click();
  await page.getByRole("button", { name: "취소" }).click();
  await page.getByRole("heading", { name: "관측 임무 완료" }).waitFor();
  await page.getByRole("button", { name: "계속 플레이" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "본거지", exact: true }).waitFor();
  await page.getByRole("button", { name: /목표·도감/ }).click();
  const goals = page.getByRole("dialog", { name: "관측 목표와 도감" });
  await goals.getByRole("button", { name: "보상 받기" }).first().click();
  await goals.getByText("수령 완료").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /목표·도감/ }).click();
  await goals.getByText("수령 완료").waitFor();
  await goals.getByRole("button", { name: "닫기" }).click();
  const beforeReset = await savedGame();
  const beforeMap = await page.evaluate(map => {
    localStorage.setItem("blindpoke-test-preference", "keep");
    const snapshot = JSON.stringify(map);
    localStorage.setItem("blindpoke-map-v1", snapshot);
    return snapshot;
  }, beforeReset.mapSnapshot);
  const settings = page.getByRole("dialog", { name: "설정", exact: true });
  const reset = settings.getByRole("button", { name: "데이터 초기화" });
  const confirmation = page.getByRole("dialog", { name: "새 게임 시작" });
  await page.getByRole("button", { name: "설정", exact: true }).press("Enter", { timeout: 5000 });
  await reset.press("Enter");
  await confirmation.getByRole("button", { name: "취소" }).press("Enter");
  await confirmation.waitFor({ state: "hidden" });
  assert.ok(await reset.evaluate(button => document.activeElement === button));
  assert.deepEqual(await savedGame(), beforeReset);
  assert.equal(await page.evaluate(() => localStorage.getItem("blindpoke-map-v1")), beforeMap);
  await reset.press("Enter");
  await confirmation.getByRole("button", { name: "기록 지우고 시작" }).press("Enter");
  await page.getByRole("heading", { name: "스타팅 선택 1/3" }).waitFor();
  assert.deepEqual(await savedGame(), { v: 4, newGame: true });
  assert.deepEqual(await page.evaluate(() => [
    localStorage.getItem("blindpoke-map-v1"),
    localStorage.getItem("blindpoke-test-preference"),
  ]), [null, "keep"]);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "스타팅 선택 1/3" }).waitFor();

  await page.route("**/data/pokemon.json", route => route.fulfill({ json: {} }));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "데이터 로드 실패" }).waitFor();
  await page.unroute("**/data/pokemon.json");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await page.getByRole("heading", { name: "스타팅 선택 1/3" }).waitFor();
  await page.evaluate(() => localStorage.setItem("blindpoke-save-v1", "{"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "저장 기록 손상" }).waitFor();
  await page.getByRole("button", { name: "다시 읽기" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("blindpoke-save-v1")), "{");
  await page.getByRole("button", { name: "새 게임" }).click();
  await page.getByRole("button", { name: "기록 지우고 시작" }).click();
  await page.getByRole("heading", { name: "스타팅 선택 1/3" }).waitFor();

  const touch = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await touch.addInitScript(() => { Math.random = () => 0; });
  await touch.goto(url);
  const touchStarters = touch.locator("[data-draft-target]");
  for (let round = 1; round <= 3; round++) {
    const currentRound = touch.getByRole("heading", { name: `스타팅 선택 ${round}/3` });
    await currentRound.waitFor();
    await touchStarters.first().tap();
    await touch.getByRole("heading", { name: "미확인 개체 1" }).waitFor();
    if (round === 1) {
      await touchStarters.nth(1).tap();
      await touch.getByRole("heading", { name: "미확인 개체 2" }).waitFor();
      await touchStarters.first().tap();
      await touch.getByRole("heading", { name: "미확인 개체 1" }).waitFor();
    }
    assert.equal(await currentRound.count(), 1);
    const type = await touch.locator(".draft-detected-type dd").textContent();
    assert.ok(type && type !== "—");
    await touchStarters.first().tap();
  }
  await touch.getByRole("button", { name: "본거지로 이동" }).tap();
  await touch.locator('[data-action="hunt"]').tap();
  const touchTarget = touch.locator(".hunt-target").first();
  await touchTarget.tap();
  const touchReading = touch.getByRole("complementary", { name: "관측 패널" });
  await touchReading.getByRole("heading", { name: "미확인 개체 1" }).waitFor();
  assert.equal(await touch.getByRole("heading", { name: "야생 탐험" }).count(), 1);
  const touchType = await touchReading.locator(".draft-detected-type dd").textContent();
  await touchTarget.tap();
  await touch.locator(".identify-console-header", { hasText: `감지 타입 ${touchType}` }).waitFor();
  await touch.getByRole("button", { name: "본거지로" }).tap();
  await touch.getByRole("button", { name: "설정", exact: true }).tap();
  await touch.getByRole("button", { name: "데이터 초기화" }).tap();
  await touch.getByRole("button", { name: "기록 지우고 시작" }).tap();
  await touch.getByRole("heading", { name: "스타팅 선택 1/3" }).waitFor();
  await touch.close();

  if (errors.length) throw new Error(`브라우저 오류:\n${errors.join("\n")}`);
  console.log("Chrome smoke passed: trainer reveal, mobile scan preview, fresh and v3 base expansion, production preview, starting region cleared, reward spending, ending, Pokédex, reset and recovery");
} finally {
  await browser?.close();
  await server.close();
}
