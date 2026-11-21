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
    if (message.type() === "error" || /^\[gpu\].*failed GPU validation/i.test(message.text())) errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const firstStarter = page.locator("[data-draft-target]").first();
  const starterScope = page.getByRole("group", { name: "숲 공터" });
  const starterJournal = page.locator(".starter-journal");
  await starterScope.getByRole("heading", { name: "첫 동료를 찾아서" }).waitFor();
  assert.equal(await starterScope.getByRole("button").count(), 3);
  assert.equal(await starterScope.locator(".draft-aim, .draft-lock, .scanner-contact, .hunt-optics, .field-optic-bezel").count(), 0);
  assert.deepEqual(await starterScope.locator(".starter-trace-tag").allTextContents(), ["고사리 그늘", "이끼 길목", "나무뿌리 곁"]);
  await starterJournal.getByRole("heading", { name: "공터에서 들리는 세 기척" }).waitFor();
  assert.equal(await starterJournal.locator(".starter-clues").count(), 0);
  assert.equal(await starterJournal.getByRole("heading", { name: "동료 영입 0/3" }).count(), 1);
  await firstStarter.focus();
  const firstNotes = starterJournal.getByRole("heading", { name: await firstStarter.getAttribute("aria-label"), exact: true });
  await firstNotes.waitFor();
  await firstStarter.getByText("동료로 맞이하기").waitFor();
  assert.equal(await starterJournal.locator(".starter-type-clue dt").textContent(), "타입 단서");
  assert.ok(await starterJournal.locator(".starter-type-clue dd").textContent());
  await page.keyboard.down("Enter");
  await page.getByRole("heading", { name: "동료 영입 1/3" }).waitFor();
  if (!await firstStarter.evaluate(button => document.activeElement === button)) {
    throw new Error("스타팅을 키보드로 선택한 후 다음 후보에 초점이 없습니다.");
  }
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  const starterSave = () => page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  assert.equal((await starterSave()).roster.length, 1, "Enter를 누르고 있어도 다음 동료가 영입되면 안 됩니다.");
  const recruited = (await starterSave()).roster[0].pokemon.nameKr;
  assert.equal(await starterScope.locator(".starter-arrival span").textContent(), `${recruited} 영입`);
  await starterJournal.getByRole("img", { name: recruited, exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "동료 영입 1/3" }).waitFor();
  await firstStarter.dblclick();
  assert.equal((await starterSave()).roster.length, 2, "마우스 더블클릭은 한 단계의 영입으로 처리해야 합니다.");
  await page.getByRole("heading", { name: "동료 영입 2/3" }).waitFor();
  await firstStarter.click();
  const reveal = page.getByRole("group", { name: "트레이너 신분증", exact: true });
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
    await page.locator("#nextTurn").press("Enter");
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
  const measured = await readout.locator(".draft-measurements dd").allTextContents();
  const [detectedType] = measured;
  if (!detectedType || detectedType === "—") throw new Error("탐험 중 감지 타입이 표시되지 않았습니다.");
  await page.keyboard.press("Enter");
  const analysis = page.getByRole("complementary", { name: "개체 분석" });
  await analysis.waitFor();
  const fieldRecord = analysis.getByRole("group", { name: "야외 관측 기록" });
  assert.equal(await fieldRecord.count(), 1, "확대한 개체의 야외 관측 기록이 식별 화면으로 이어져야 합니다.");
  await fieldRecord.getByText(detectedType, { exact: true }).waitFor();
  assert.deepEqual(await fieldRecord.locator("dd").allTextContents(), measured);
  assert.equal(await analysis.getByRole("button", { name: /직접 관찰하기/ }).count(), 0);
  await analysis.getByText(/단서 1회 −8%p · 오답 −20%p · 최저 \d+%/).waitFor();
  const lens = page.getByRole("group", { name: "확대 렌즈" });
  await lens.getByText("미확인 개체 1").waitFor();
  const targetArt = lens.locator(".identify-target-art");
  await lens.locator(".identify-trace").waitFor();
  if (await targetArt.count() !== 0) {
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
  const beforeWrong = Number(await analysis.locator("meter").getAttribute("value"));
  await guess.fill("오답검증");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await analysis.getByText("오답 1", { exact: true }).waitFor();
  assert.equal(Number(await analysis.locator("meter").getAttribute("value")), beforeWrong - 20);
  const consultation = analysis.getByRole("button", { name: /박사와 상담하기/ });
  await consultation.getByText("다음 단서 · 능력치", { exact: true }).waitFor({ timeout: 4000 });
  const journal = analysis.locator(".identify-record");
  await consultation.focus();
  await page.keyboard.down("Enter");
  await journal.getByText(/두드러진 능력치/).waitFor();
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  assert.equal(await journal.getByRole("listitem").count(), 2, "Holding Enter must not request another clue");
  await journal.locator("summary").press("Enter");
  await consultation.getByText("다음 단서 · 기술", { exact: true }).waitFor();
  await consultation.press("Enter");
  await journal.getByText(/배울 수 있는 기술/).waitFor();
  await consultation.getByText("다음 단서 · 특성", { exact: true }).waitFor();
  assert.equal(await journal.getByRole("listitem").count(), 3);
  await guess.fill(pokemonName);
  await guess.press("Enter");
  await analysis.getByRole("heading", { name: "포획 성공" }).waitFor();
  await analysis.getByText(pokemonName, { exact: true }).waitFor({ timeout: 2000 });
  const firstDex = analysis.getByRole("group", { name: "도감 기록" });
  const alreadyRecorded = save.caughtSpeciesIds.includes(pokemonId);
  const totalRecords = save.caughtSpeciesIds.length + Number(!alreadyRecorded);
  await firstDex.getByText(alreadyRecorded ? "도감에 기록된 종" : "도감 신규 등록", { exact: true }).waitFor();
  await firstDex.getByText(`누적 ${totalRecords}종`, { exact: true }).waitFor();
  await firstDex.getByText(`다음 보상까지 ${10 - totalRecords}종`, { exact: true }).waitFor();
  await analysis.getByRole("button", { name: "새 동료 보기" }).click();
  const profile = page.getByRole("dialog", { name: new RegExp(pokemonName) });
  await profile.getByText("최대 HP", { exact: true }).waitFor();
  await profile.getByRole("heading", { name: "장착 기술" }).waitFor();
  await profile.getByRole("button", { name: "닫기" }).click();
  await lens.getByRole("img", { name: pokemonName, exact: true }).waitFor();
  const capturedSave=await page.evaluate(()=>JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if(capturedSave.roster.length!==4) throw new Error("포획한 포켓몬이 로스터와 저장 데이터에 추가되지 않았습니다.");
  assert.equal(capturedSave.caughtSpeciesIds.length, totalRecords);
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
    await analysis.getByRole("group", { name: "야외 관측 기록" }).getByText("땅", { exact: true }).waitFor();
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
  for (let turn = 0; turn < 3; turn++) await page.locator("#nextTurn").press("Enter");
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
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.endingSeen === true);
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
  await page.getByRole("heading", { name: "동료 영입 0/3" }).waitFor();
  assert.deepEqual(await savedGame(), { v: 4, newGame: true });
  assert.deepEqual(await page.evaluate(() => [
    localStorage.getItem("blindpoke-map-v1"),
    localStorage.getItem("blindpoke-test-preference"),
  ]), [null, "keep"]);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "동료 영입 0/3" }).waitFor();

  await page.route("**/data/pokemon.json", route => route.fulfill({ json: {} }));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "데이터 로드 실패" }).waitFor();
  await page.unroute("**/data/pokemon.json");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await page.getByRole("heading", { name: "동료 영입 0/3" }).waitFor();
  await page.evaluate(() => localStorage.setItem("blindpoke-save-v1", "{"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "저장 기록 손상" }).waitFor();
  await page.getByRole("button", { name: "다시 읽기" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("blindpoke-save-v1")), "{");
  await page.getByRole("button", { name: "새 게임" }).click();
  await page.getByRole("button", { name: "기록 지우고 시작" }).click();
  await page.getByRole("heading", { name: "동료 영입 0/3" }).waitFor();

  async function verifyTouchJourney(viewport) {
    const touch = await browser.newPage({ viewport, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await touch.addInitScript(() => {
      Math.random = () => 0;
      sessionStorage.setItem("blindpoke-hunt-instrument", "digital");
    });
    await touch.goto(url);
    const touchStarters = touch.locator("[data-draft-target]");
    const scope = touch.getByRole("group", { name: "숲 공터" });
    await scope.getByRole("heading", { name: "첫 동료를 찾아서" }).waitFor();
    assert.equal(await scope.locator(".field-optic-rim, .draft-atmosphere").count(), 0);
    const journal = touch.locator(".starter-journal");
    const noteBox = await journal.boundingBox();
    for (const candidate of await touchStarters.all()) {
      const bounds = await candidate.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44);
      assert.ok(bounds.y + bounds.height <= noteBox.y, "모바일에서 종이 기록이 기척을 가리면 안 됩니다.");
    }
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    for (let round = 1; round <= 3; round++) {
      const currentRound = touch.getByRole("heading", { name: `동료 영입 ${round - 1}/3` });
      await currentRound.waitFor();
      await touchStarters.first().tap();
      await journal.getByRole("heading", { name: "고사리 그늘" }).waitFor();
      await touchStarters.first().getByText("동료로 맞이하기").waitFor();
      await journal.getByText("같은 자리를 다시 눌러 영입").waitFor();
      if (round === 1) {
        await touchStarters.nth(1).tap();
        await journal.getByRole("heading", { name: "이끼 길목" }).waitFor();
        assert.equal(await touchStarters.first().getByText("동료로 맞이하기").count(), 0);
        await touchStarters.nth(1).getByText("동료로 맞이하기").waitFor();
        await touchStarters.first().tap();
        await journal.getByRole("heading", { name: "고사리 그늘" }).waitFor();
      }
      assert.equal(await currentRound.count(), 1);
      const type = await journal.locator(".starter-type-clue dd").textContent();
      assert.ok(type && type !== "—");
      await touchStarters.first().tap();
    }
    await touch.getByRole("button", { name: "본거지로 이동" }).tap();
    const mobileSave = () => touch.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
    const buildFarm = async () => {
      await touch.getByRole("button", { name: "1번 부지 건설" }).tap();
      const build = touch.getByRole("dialog", { name: "건설 · 1번 부지" });
      await build.getByRole("button", { name: "밭", exact: true }).tap();
      for (const id of ["mon-1", "mon-2", "mon-3"]) await build.locator(`[data-install-pick="${id}"]`).tap();
      await build.locator("[data-build-confirm]").tap();
    };
    const startedConstruction = viewport.width === 390;
    if (startedConstruction) await buildFarm();
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    const beforeHunt = (await mobileSave()).energy;
    const beforeHuntDex = (await mobileSave()).caughtSpeciesIds;
    const startHunt = touch.locator('[data-action="hunt"]');
    await startHunt.evaluate(element => { element.click(); element.click(); });
    const touchReading = touch.getByRole("complementary", { name: "관측 패널" });
    await touchReading.getByText("흔적을 눌러 관측", { exact: true }).waitFor();
    assert.equal((await mobileSave()).energy, beforeHunt - 2);
    await touch.locator(".hunt-target").first().tap();
    await touchReading.getByRole("heading", { name: "미확인 개체 1" }).waitFor();
    const touchTarget = touch.locator(".hunt-target").nth(1);
    await touchTarget.tap();
    await touchReading.getByRole("heading", { name: "미확인 개체 2" }).waitFor();
    await touchReading.getByText("같은 흔적을 다시 눌러 식별", { exact: true }).waitFor();
    assert.equal(await touch.getByRole("heading", { name: "야생 탐험" }).count(), 1);
    const touchMeasurements = await touchReading.locator(".draft-measurements dd").allTextContents();
    const [touchType] = touchMeasurements;
    await touchReading.getByText("야외 관측표").waitFor();
    assert.equal(await touch.getByRole("group", { name: "관측 장비", exact: true }).count(), 0);
    assert.equal(await touch.locator(".hunt-optical-trace").count(), 3);
    assert.equal(await touch.locator(".hunt-optics-focus-mark").count(), 1);
    assert.equal(await touch.locator(".draft-signal-art, .hunt-optics-shader").count(), 0);
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await touchTarget.tap();
    const mobileFieldRecord = touch.getByRole("group", { name: "야외 관측 기록" });
    await mobileFieldRecord.getByText(touchType, { exact: true }).waitFor();
    assert.deepEqual(await mobileFieldRecord.locator("dd").allTextContents(), touchMeasurements);
    const mobileMeter = touch.locator(".identify-chance meter");
    const beforeClue = Number(await mobileMeter.getAttribute("value"));
    const compare = touch.getByRole("button", { name: /본인확인서 대조/ });
    if (viewport.width === 320) await compare.evaluate(button => { button.click(); button.click(); });
    else await compare.tap();
    assert.equal(Number(await mobileMeter.getAttribute("value")), beforeClue - 8);
    assert.ok(await compare.isDisabled());
    await compare.getByText("대조 완료", { exact: true }).waitFor();
    assert.equal(await touch.locator(".identify-record li").count(), 1);
    const mobileArtwork = await touch.locator(".identify-target-art").getAttribute("src");
    const mobileId = Number(mobileArtwork.match(/(\d+)\.png/)?.[1]);
    const mobileName = await touch.evaluate(async id => {
      const pokemon = await fetch("/data/pokemon.json").then(response => response.json());
      return pokemon.find(entry => entry.pokemonRowid === id).nameKr;
    }, mobileId);
    const mobileGuess = touch.getByRole("textbox", { name: "포켓몬 이름" });
    const mobileSubmit = touch.getByRole("button", { name: "식별", exact: true });
    if (viewport.width === 390) {
      const chance = () => mobileMeter.evaluate(element => element.value);
      const repeatTap = async (control, settled) => {
        await control.scrollIntoViewIfNeeded();
        const { x, y, width, height } = await control.boundingBox();
        const point = [x + width / 2, y + height / 2];
        await touch.touchscreen.tap(...point);
        await settled();
        assert.ok(await control.evaluate((button, [clientX, clientY]) =>
          document.elementFromPoint(clientX, clientY)?.closest("button") === button, point));
        await touch.touchscreen.tap(...point);
        await touch.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      const mobileConsultation = touch.getByRole("button", { name: /박사와 상담하기/ });
      const beforeConsultation = await chance();
      await repeatTap(mobileConsultation, () => mobileConsultation.getByText("다음 단서 · 기술", { exact: true }).waitFor());
      const consultationResult = { clues: await touch.locator(".identify-record li").count(), chance: await chance() };
      await mobileGuess.fill("오답 연속 입력 검증");
      const beforeWrong = await chance();
      const wrongs = touch.locator(".identify-record-header [role=status] b");
      await repeatTap(mobileSubmit, () => touch.getByText("오답 1", { exact: true }).waitFor());
      assert.deepEqual({ consultation: consultationResult, wrongs: Number(await wrongs.textContent()), chance: await chance() },
        { consultation: { clues: 2, chance: beforeConsultation - 8 }, wrongs: 1, chance: beforeWrong - 20 },
        "One tap sequence should charge for one clue or one wrong answer");
    }
    await mobileGuess.tap();
    await touch.setViewportSize({ ...viewport, height: 360 });
    await mobileGuess.fill(mobileName);
    await touch.waitForFunction(() => {
      const box = document.querySelector(".identify-submit").getBoundingClientRect();
      const viewport = window.visualViewport;
      return box.top >= viewport.offsetTop && box.bottom <= viewport.offsetTop + viewport.height && box.height >= 44;
    });
    await mobileGuess.dispatchEvent("compositionstart", { data: "ㅇ" });
    await mobileGuess.evaluate(input => input.form.requestSubmit());
    assert.equal(await mobileGuess.count(), 1, "IME 조합 중에는 제출하지 않습니다.");
    await mobileGuess.dispatchEvent("compositionend", { data: mobileName });
    if (viewport.width === 390) await mobileSubmit.tap();
    else await mobileSubmit.evaluate(element => { element.click(); element.click(); });
    await touch.setViewportSize(viewport);
    await touch.getByRole("heading", { name: "포획 성공", exact: true }).waitFor();
    const dex = touch.getByRole("group", { name: "도감 기록" });
    const known = beforeHuntDex.includes(mobileId);
    const currentCount = beforeHuntDex.length + Number(!known);
    await dex.getByText(known ? "도감에 기록된 종" : "도감 신규 등록", { exact: true }).waitFor();
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await dex.getByText(`누적 ${currentCount}종`, { exact: true }).waitFor();
    await touch.getByText(startedConstruction ? /밭이 완공되면 씨앗 생성 직무/ : /건설 메뉴에서 다음 시설을 지으면.*밭/, { exact: false }).waitFor();
    const preparePlacement = touch.getByRole("button", { name: "밭 배치 준비", exact: true });
    assert.equal(await preparePlacement.count(), 0);
    await touch.getByRole("button", { name: "새 동료 보기" }).tap();
    const recruited = touch.getByRole("dialog", { name: new RegExp(mobileName + " · 새 동료") });
    await recruited.getByText("특수공격", { exact: true }).waitFor();
    await recruited.getByRole("button", { name: "닫기" }).tap();
    await touch.getByRole("button", { name: "본거지로" }).tap();
    const afterCapture = await mobileSave();
    assert.equal(afterCapture.roster.length, 4);
    assert.equal(afterCapture.roster.at(-1).pokemon.pokemonRowid, mobileId);
    assert.equal(afterCapture.energy, beforeHunt - 2);
    const seederId = afterCapture.roster.at(-1).id;
    if (!startedConstruction) await buildFarm();
    await touch.locator("#nextTurn").tap();
    await touch.getByRole("button", { name: "1번 부지 밭 관리" }).tap();
    const mobileFarm = touch.getByRole("dialog", { name: "밭 · 1번 부지" });
    const closeFarm = await mobileFarm.getByRole("button", { name: "닫기" }).boundingBox();
    assert.ok(closeFarm && closeFarm.x + closeFarm.width <= viewport.width);
    await mobileFarm.getByRole("button", { name: /씨앗 생성/ }).tap();
    await mobileFarm.locator(`[data-install-pick="${seederId}"]`).tap();
    await mobileFarm.getByText("현재 0마리 → 배치 후 1마리", { exact: true }).waitFor();
    const preview = mobileFarm.getByText(/씨앗 산출 0 → [1-9]/);
    await preview.waitFor();
    const expectedSeeds = Number((await preview.textContent()).match(/씨앗 산출 0 → (\d+)/)[1]);
    await mobileFarm.getByRole("button", { name: /직무 배치 · 행동력/ }).tap();
    await mobileFarm.getByRole("button", { name: "닫기" }).tap();
    const beforeProduction = await mobileSave();
    await touch.locator("#nextTurn").tap();
    await touch.waitForFunction(turn => JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.turnCount === turn, beforeProduction.turnCount + 1);
    const produced = await mobileSave();
    assert.equal(produced.resources.seed, beforeProduction.resources.seed + expectedSeeds);
    assert.equal(produced.roster.find(member => member.id === seederId).jobId, "seed");
    await touch.reload();
    await touch.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    const reloaded = await mobileSave();
    assert.equal(reloaded.resources.seed, produced.resources.seed);
    assert.deepEqual(reloaded.roster.find(member => member.id === seederId), produced.roster.find(member => member.id === seederId));
    const meter = touch.locator(".base-energy");
    assert.equal(await meter.locator("b").textContent(), "5/5");
    const readouts = await touch.locator(".base-hud").evaluate(hud => {
      const turn = hud.querySelector(".base-turn b");
      const energy = hud.querySelector(".base-energy b");
      const gems = hud.querySelector(".base-energy-cells").getBoundingClientRect();
      const card = hud.querySelector(".base-trainer-credential").getBoundingClientRect();
      const energyBox = energy.getBoundingClientRect();
      return {
        turnFont: getComputedStyle(turn).fontSize,
        energyFont: getComputedStyle(energy).fontSize,
        numberOffset: Math.abs(turn.getBoundingClientRect().top - energyBox.top),
        gemOffset: Math.abs((energyBox.top + energyBox.bottom - gems.top - gems.bottom) / 2),
        cardWidth: card.width,
        cardGap: card.left - gems.right,
      };
    });
    assert.equal(readouts.turnFont, readouts.energyFont);
    assert.ok(readouts.numberOffset <= 1 && readouts.gemOffset <= 1, JSON.stringify(readouts));
    assert.ok(readouts.cardWidth >= 100 && readouts.cardGap >= 4, JSON.stringify(readouts));
    await touch.getByRole("button", { name: /포켓몬 \d/ }).tap();
    const mobilePc = touch.getByRole("dialog", { name: /보유 포켓몬/ });
    await mobilePc.getByText("배틀 능력과 장착 기술", { exact: true }).tap();
    await mobilePc.getByText("최대 HP", { exact: true }).waitFor();
    assert.ok(await mobilePc.locator(".base-pc-index .pokemon-type-badges li").count());
    assert.equal(await mobilePc.locator(".pokemon-stat-chart [data-axis]").count(), 6);
    assert.equal(await mobilePc.getByText(/이탈 경계|약점 기술 확인/).count(), 0);
    assert.ok(await mobilePc.locator(".base-dialog-body").evaluate(body => body.scrollWidth <= body.clientWidth));
    await mobilePc.getByRole("button", { name: "엔트리 등록", exact: true }).tap();
    await mobilePc.getByRole("button", { name: "닫기" }).tap();
    await touch.getByRole("button", { name: "지도", exact: true }).tap();
    await touch.locator('[data-node="southwest"]').tap();
    await touch.getByRole("button", { name: /정찰하기/ }).tap();
    await touch.getByText("캐터피 Lv.2", { exact: true }).waitFor();
    await touch.getByRole("button", { name: /거점 도전/ }).tap();
    await touch.getByRole("heading", { name: "거점 배틀", exact: true }).waitFor();
    await touch.locator('.duel-move[data-move-id]:enabled').first().tap();
    await touch.waitForFunction(() => {
      const summary = document.querySelector(".duel-latest");
      const move = document.querySelector(".duel-move");
      if (!summary || !move || !/의 .*피해/.test(summary.textContent ?? "")) return false;
      const report = summary.getBoundingClientRect();
      return report.top >= 0 && report.bottom <= move.getBoundingClientRect().top;
    });
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await touch.reload();
    await touch.getByRole("heading", { name: "본거지", exact: true }).waitFor();
    assert.ok((await mobileSave()).roster.find(member => member.id === seederId).productionCarry.seed >= 0);
    if (viewport.width === 390) {
      const enterAnalysis = async () => {
        await touch.locator('[data-action="hunt"]').tap();
        const target = touch.locator(".hunt-target").nth(1);
        await target.tap();
        await target.tap();
        await touch.getByRole("heading", { name: "개체 식별" }).waitFor();
      };
      const leave = async () => {
        await touch.getByRole("button", { name: "본거지로", exact: true }).tap();
        await touch.getByRole("heading", { name: "본거지", exact: true }).waitFor();
      };
      const oldProgress = await mobileSave();
      const nineSpecies = await touch.evaluate(async ({ ids, exclude }) => {
        const all = await fetch("/data/pokemon.json").then(response => response.json());
        return [...new Set([...ids, ...all.map(mon => mon.pokemonRowid)].filter(id => id !== exclude))].slice(0, 9);
      }, { ids: oldProgress.caughtSpeciesIds, exclude: mobileId });
      const openDexCheckpoint = async speciesIds => {
        const roster = oldProgress.roster.filter(member => member.pokemon.pokemonRowid !== mobileId);
        const entryOrder = oldProgress.entryOrder.filter(id => roster.some(member => member.id === id));
        await touch.evaluate(snapshot => localStorage.setItem("blindpoke-save-v1", JSON.stringify(snapshot)), {
          ...oldProgress, energy: 5, caughtSpeciesIds: speciesIds, roster, entryOrder,
        });
        await touch.reload();
        await touch.getByRole("heading", { name: "본거지", exact: true }).waitFor();
      };
      await openDexCheckpoint(nineSpecies);
      await enterAnalysis();
      assert.equal(await dex.count(), 0);
      await mobileGuess.fill(mobileName);
      await mobileSubmit.tap();
      await touch.getByRole("heading", { name: "포획 성공" }).waitFor();
      await dex.getByText("도감 신규 등록", { exact: true }).waitFor();
      await dex.getByText("누적 10종", { exact: true }).waitFor();
      await dex.getByText(/10종 보상 달성/).waitFor();
      await touch.getByText(/본거지 1번 부지에 있는 밭에서 씨앗 생성 직무/).waitFor();
      const captured = await mobileSave();
      const newId = captured.roster.at(-1).id;
      await preparePlacement.waitFor({ timeout: 4000 });
      await preparePlacement.tap();
      const placement = touch.getByRole("dialog", { name: "밭 · 1번 부지" });
      await placement.waitFor();
      await placement.getByRole("button", { name: /씨앗 생성/, pressed: true }).waitFor();
      assert.equal(await placement.locator(`[data-install-pick="${newId}"]`).getAttribute("aria-pressed"), "true");
      assert.deepEqual(await mobileSave(), captured);
      await placement.getByRole("group", { name: "다음 턴 공동 재고" }).waitFor();
      await placement.getByRole("button", { name: "직무 배치 · 행동력 1" }).tap();
      await placement.getByRole("button", { name: `${mobileName} 회수`, exact: true }).waitFor();
      await placement.getByRole("button", { name: "닫기", exact: true }).tap();
      const completedDex = await mobileSave();
      assert.equal(completedDex.energy, captured.energy - 1);
      assert.equal(completedDex.roster.find(member => member.id === newId).jobId, "seed");
      assert.ok(!Object.hasOwn(completedDex, "facilityOpening"));
      assert.deepEqual(completedDex.caughtSpeciesIds, [...nineSpecies, mobileId]);
      assert.deepEqual(completedDex.claimedDexRewards, oldProgress.claimedDexRewards);
      assert.equal(completedDex.resources.candy, oldProgress.resources.candy);
      await touch.getByRole("button", { name: "목표·도감" }).tap();
      const goals = touch.getByRole("dialog", { name: "관측 목표와 도감" });
      await goals.getByRole("listitem").filter({ hasText: /10종 기록/ }).getByRole("button", { name: "보상 받기" }).waitFor();
      await goals.getByRole("button", { name: "닫기" }).tap();

      await openDexCheckpoint(completedDex.caughtSpeciesIds);
      assert.ok(!(await mobileSave()).roster.some(member => member.pokemon.pokemonRowid === mobileId));
      await enterAnalysis();
      await mobileGuess.fill(mobileName);
      await mobileSubmit.tap();
      await dex.getByText("도감에 기록된 종", { exact: true }).waitFor();
      await dex.getByText("누적 10종", { exact: true }).waitFor();
      await dex.getByText("다음 보상까지 15종", { exact: true }).waitFor();
      const beforeCancel = await mobileSave();
      await preparePlacement.tap();
      await placement.getByRole("button", { name: "닫기", exact: true }).tap();
      await placement.waitFor({ state: "hidden" });
      assert.ok(await touch.getByRole("heading", { name: "본거지", exact: true }).evaluate(heading => document.activeElement === heading));
      assert.deepEqual(await mobileSave(), beforeCancel);
      assert.deepEqual((await mobileSave()).caughtSpeciesIds, completedDex.caughtSpeciesIds);

      const beforeFailure = await mobileSave();
      await enterAnalysis();
      await mobileGuess.fill(mobileName);
      await touch.evaluate(() => { Math.random = () => 0.999; });
      await mobileSubmit.tap();
      await touch.getByRole("heading", { name: /포획 실패/ }).waitFor();
      assert.equal(await preparePlacement.count(), 0);
      assert.equal(await dex.count(), 0);
      await touch.evaluate(() => { Math.random = () => 0; });
      await leave();
      const afterFailure = await mobileSave();
      assert.equal(afterFailure.energy, beforeFailure.energy - 2);
      assert.deepEqual(afterFailure.roster, beforeFailure.roster);
      assert.deepEqual(afterFailure.caughtSpeciesIds, beforeFailure.caughtSpeciesIds);

      await touch.locator("#nextTurn").tap();
      const beforeGiveup = await mobileSave();
      await enterAnalysis();
      const keepHunting = touch.getByRole("button", { name: /^탐험 계속/ });
      assert.equal(await keepHunting.count(), 0);
      await touch.getByRole("button", { name: "식별 포기", exact: true }).tap();
      await touch.getByRole("heading", { name: "식별 포기", exact: true }).waitFor();
      assert.equal(await preparePlacement.count(), 0);
      assert.equal(await dex.count(), 0);
      assert.equal(await touch.locator(".identify-target-art").count(), 0);
      const afterGiveup = await mobileSave();
      assert.equal(afterGiveup.energy, beforeGiveup.energy - 2);
      assert.deepEqual(afterGiveup.roster, beforeGiveup.roster);
      assert.ok((await keepHunting.boundingBox())?.height >= 44);
      await keepHunting.tap();
      await touch.getByRole("heading", { name: "야생 탐험", exact: true }).waitFor();
      await touch.getByRole("heading", { name: "관측 대기", exact: true }).waitFor();
      assert.deepEqual(await mobileSave(), { ...afterGiveup, energy: afterGiveup.energy - 2 });
      const nextCandidate = touch.locator(".hunt-target").first();
      await nextCandidate.tap();
      await nextCandidate.tap();
      await touch.getByRole("heading", { name: "개체 식별" }).waitFor();
      assert.equal(await mobileGuess.inputValue(), "");
      await touch.getByRole("button", { name: "식별 포기", exact: true }).tap();
      assert.ok(await keepHunting.isDisabled());
      assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth), viewport.width);
      await leave();
    }
    await touch.getByRole("button", { name: "설정", exact: true }).tap();
    await touch.getByRole("button", { name: "데이터 초기화" }).tap();
    await touch.getByRole("button", { name: "기록 지우고 시작" }).tap();
    await touch.getByRole("heading", { name: "동료 영입 0/3" }).waitFor();
    await touch.close();
  }
  await verifyTouchJourney({ width: 320, height: 640 });
  await verifyTouchJourney({ width: 390, height: 844 });

  if (errors.length) throw new Error(`브라우저 오류:\n${errors.join("\n")}`);
  console.log("Chrome smoke passed: keyboard, 320/390px touch recruitment → production, Dex milestones and recaptures, failed/abandoned captures, saved progress, battle and ending");
} finally {
  await browser?.close();
  await server.close();
}
