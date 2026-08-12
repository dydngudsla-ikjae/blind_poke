import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
  logLevel: "error",
});

const errors = [];
let browser;

try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { Math.random = () => 0.1; });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("http://127.0.0.1:5175/", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  for (let round = 0; round < 3; round++) {
    await page.locator(".enc-mon").first().waitFor({ state: "visible" });
    await page.locator(".enc-mon").first().click();
  }

  await page.locator('[data-plot-install="0"]').click();
  await page.locator("[data-install-pick]").first().click();
  await page.locator("[data-build-confirm]").click();

  let save = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if (save.v !== 3 || save.roster.length !== 3 || save.buildings[0]?.remainingTurns !== 3) {
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
  await page.locator(".enc-mon").first().waitFor({ state: "visible" });
  await page.locator(".enc-mon").first().click();
  await page.getByRole("button", { name: /본인확인서 대조/ }).click();
  const artwork = await page.locator(".scn-view img").getAttribute("src");
  const pokemonId = Number(artwork.match(/(\d+)\.png/)?.[1]);
  const pokemonName = await page.evaluate(async id => {
    const pokemon = await fetch("/data/pokemon.json").then(response => response.json());
    return pokemon.find(entry => entry.pokemonRowid === id).nameKr;
  }, pokemonId);
  await page.locator(".scn-dock input").fill(pokemonName);
  await page.locator(".scn-id").click();
  await page.getByRole("button", { name: "본거지로" }).last().click();
  await page.locator('[data-action="map"]').click();
  await page.locator("[data-node]:not([disabled])").first().click();
  for (let turn = 0; turn < 30 && !await page.locator("#battleContinue").count(); turn++) {
    await page.locator("[data-move]").first().click();
  }
  if (!await page.locator("#battleContinue").count()) throw new Error("React 배틀이 30턴 안에 끝나지 않았습니다.");
  await page.locator("#battleContinue").click();
  await page.locator(".map-scene").waitFor({ state: "visible" });

  const legacy = await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("blindpoke-save-v1"));
    value.v = 1;
    delete value.buildings;
    delete value.nextBuildingId;
    value.underConstruction = { farm: 2 };
    value.roster[0].building = "farm";
    delete value.roster[0].buildingId;
    localStorage.setItem("blindpoke-save-v1", JSON.stringify(value));
    return value.roster[0].id;
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-plot-construction="building-1"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("blindpoke-save-v1"))?.v === 3);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("blindpoke-save-v1")));
  if (migrated.v !== 3 || migrated.roster.find(member => member.id === legacy)?.buildingId !== "building-1") {
    throw new Error("v1 저장 데이터가 React v3 상태로 마이그레이션되지 않았습니다.");
  }

  if (errors.length) throw new Error(`브라우저 오류:\n${errors.join("\n")}`);
  console.log("Smoke test passed: draft → base → construction → save/reload → hunt/identify → map/battle");
} finally {
  await browser?.close();
  await server.close();
}
