// ===== 본거지: 로스터 · 자원 · 직무 배정 · 턴 진행 =====
import { TYPE_COLORS, ART, $, types } from "./data.js";
import { newCase } from "./identify.js";
import { renderMap, resolveMapTurn } from "./map.js";

/* ---- 본거지 전용 UI 아이콘 시스템: emoji를 섞지 않고 하나의 line-icon 세트로 통일.
   전부 24x24 viewBox · stroke-width 1.7 · round cap/join, 색상은 currentColor로 상속받아
   기본은 off-white/gray-blue, 활성 상태에서만 cyan/teal, 알림 배지에서만 orange를 쓰게 한다. ---- */
const ICON_PATHS = {
  pc:      `<rect x="3" y="4" width="18" height="12" rx="1.4"/><path d="M7 8.2h6M7 11h4"/><path d="M8.5 20h7M12 16v4"/>`,
  entry:   `<circle cx="12" cy="12" r="8"/><path d="M4 12h5.4M14.6 12H20"/><circle cx="12" cy="12" r="2.2"/>`,
  shop:    `<path d="M6.2 8 7.4 4.8A2 2 0 0 1 9.3 3.5h5.4a2 2 0 0 1 1.9 1.3L17.8 8"/><rect x="4.5" y="8" width="15" height="11.6" rx="1.4"/><path d="M9 11.2v1.4a3 3 0 0 0 6 0v-1.4"/>`,
  gauge:   `<path d="M6 18.5V11M12 18.5V5.5M18 18.5v-6"/><path d="M4 21h16"/>`,
  map:     `<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>`,
  explore: `<path d="M12 3.4 16 10h-2.6l3.4 5.6H14l2.6 5H7.4L10 15.6H7.2L11 10H8.4L12 3.4Z"/>`,
  lock:    `<rect x="5" y="10.6" width="14" height="9" rx="1.4"/><path d="M8 10.6V7.8a4 4 0 0 1 8 0v2.8"/>`,
  plus:    `<path d="M12 5.5v13M5.5 12h13"/>`,
  cycle:   `<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5"/><path d="M17.6 3.6v3.4h-3.4M6.4 20.4v-3.4h3.4"/>`,
  bolt:    `<path d="M13 2 5 14h5.5l-1 8L18 10h-5.5L13 2Z"/>`,
  chevron: `<path d="M9 5l7 7-7 7"/>`,
};
function icon(name, size=16, extraClass=""){
  const inner = ICON_PATHS[name] || "";
  return `<svg class="ic${extraClass?` ${extraClass}`:""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* ---- 부지 폴리곤 유틸: town-bg.png 속 실제 흙밭 테두리에 맞춘 clip-path/SVG 좌표를 만든다.
   각 plot은 완전한 HTML 사각형이 아니라 원근이 살짝 들어간 사다리꼴 hit-area를 갖는다. ---- */
function clampPct(v){ return Math.max(0, Math.min(100, v)); }
function plotPolygon(col){
  const lean = (col - 2) * 2.1; // 가운데(2열)를 기준으로 좌우 열이 원근에 맞춰 살짝 기울어짐
  return [
    [clampPct(8 - lean * 0.5), 6],
    [clampPct(92 - lean * 0.5), 6],
    [clampPct(97 - lean), 94],
    [clampPct(3 - lean), 94],
  ];
}
function clipPathStr(pts){
  return `polygon(${pts.map(([x,y])=>`${x.toFixed(1)}% ${y.toFixed(1)}%`).join(", ")})`;
}
function svgPointsStr(pts){
  return pts.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
function cornerBracketPaths(pts, legLen=9){
  const n = pts.length;
  const sub = (a,b)=>[a[0]-b[0], a[1]-b[1]];
  const len = v=>Math.sqrt(v[0]*v[0]+v[1]*v[1]) || 1;
  const norm = v=>{ const l=len(v); return [v[0]/l, v[1]/l]; };
  return pts.map((cur,i)=>{
    const prev = pts[(i-1+n)%n], next = pts[(i+1)%n];
    const d1 = norm(sub(prev,cur)), d2 = norm(sub(next,cur));
    const p1 = [cur[0]+d1[0]*legLen, cur[1]+d1[1]*legLen];
    const p2 = [cur[0]+d2[0]*legLen, cur[1]+d2[1]*legLen];
    return `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  });
}
/* 부지 hover 시 실제 흙밭 폴리곤을 따라 나타나는 반응 레이어(평상시 opacity:0, 완전 투명) */
function plotFxSvg(pts){
  const ptsStr = svgPointsStr(pts);
  const corners = cornerBracketPaths(pts, 8.5).map(d=>`<path class="plot-fx-corner" d="${d}"></path>`).join("");
  return `
    <svg class="plot-fx" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon class="plot-fx-fill" points="${ptsStr}"></polygon>
      <polygon class="plot-fx-outline" points="${ptsStr}"></polygon>
      ${corners}
    </svg>`;
}

/* ---- 타입 → 직무 매핑 (노말은 항상 미스매치 없이 아무 직무나 수행) ---- */
export const JOB_BY_TYPE = {
  풀:"seed", 벌레:"till", 물:"fruit", 불꽃:"cook", 얼음:"chill", 땅:"flatten",
  격투:"train", 에스퍼:"research", 바위:"mine", 강철:"mint", 전기:"craft",
  비행:"watch_air", 드래곤:"watch_dragon", 악:"infiltrate_dark", 고스트:"infiltrate_ghost",
  페어리:"heal", 독:"cure"
};

/* ---- minMembers: 새로 지을 때 필요한 최소 인원(타입 무관, 이미 가동 중이면 무관 — 인원은 이후 계속 추가 가능)
   installCost: 새로 지을 때 1회 소모하는 자원(보유 중인 자원으로 지어야 하는 재료 시스템). null이면 재료 없이 인원만으로 설치 가능 ---- */
const JOBS = {
  seed:             { label:"씨앗 생성",            produce:"seed",     minMembers:1, installCost:null },
  till:             { label:"밭 일구기",            produce:null, note:"열매 생산량 증가", minMembers:2, installCost:null },
  fruit:            { label:"열매 생산",            produce:"fruit", consumeRes:"seed", consumePer:1, minMembers:1, installCost:{seed:5} },
  cook:             { label:"요리",                produce:"food",  consumeRes:"fruit", consumePer:2, minMembers:1, installCost:{fruit:5} },
  chill:            { label:"냉장",                produce:null, note:"자원 저장 상한 증가", minMembers:1, installCost:{material:3} },
  flatten:          { label:"땅 평탄화",            produce:null, note:"직무 배정 인원 상한 증가", minMembers:1, installCost:null },
  train:            { label:"훈련",                produce:"tm",       minMembers:1, installCost:null },
  research:         { label:"육성 연구",            produce:"candy",   minMembers:1, installCost:null },
  mine:             { label:"재료 채취",            produce:"material",minMembers:1, installCost:null },
  mint:             { label:"재화 주조",            produce:"gold", consumeRes:"material", consumePer:1, minMembers:1, installCost:{material:5} },
  craft:            { label:"부품 제작",            produce:"tool", consumeRes:"material", consumePer:1, minMembers:1, installCost:{material:5} },
  watch_air:        { label:"치안(첩보 탐지)",       produce:null, stub:true },
  watch_dragon:     { label:"치안(시설 방해 탐지)",   produce:null, stub:true },
  infiltrate_dark:  { label:"침투(시설 방해)",       produce:null, stub:true },
  infiltrate_ghost: { label:"침투(첩보)",            produce:null, stub:true },
  heal:             { label:"치료(회복 아이템)",      produce:"healItem", minMembers:1, installCost:null },
  cure:             { label:"치료(상태이상 치료)",    produce:"cureItem", minMembers:1, installCost:null },
};
const JOB_BASE_AMT = { seed:3, fruit:2, cook:1, train:1, research:1, mine:3, mint:2, craft:1, heal:1, cure:1 };
const JOB_ORDER = ["seed","mine","train","research","heal","cure","flatten","chill","till",
                    "fruit","mint","craft","cook",
                    "watch_air","watch_dragon","infiltrate_dark","infiltrate_ghost"];
const RES_META = {
  seed:"씨앗", fruit:"열매", food:"음식", material:"재료", gold:"자금", tool:"부품",
  tm:"기술머신", candy:"경험치 사탕", healItem:"회복 아이템", cureItem:"치료 아이템"
};
/* ---- 포켓몬 도구(지니게 하기): PokeAPI 실제 도구의 한글명·스프라이트를 쓰되, 실제 배틀 효과 대신
   이 게임의 본거지 경영에 맞춘 자체 효과를 부여함. "부품"(tool)을 소모해 제작하고, 로스터 1마리당 1개 장착 ---- */
const ITEM_CRAFT_COST = 3;
const HELD_ITEMS = {
  leftovers:   { name:"먹다남은음식", sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/leftovers.png",
                 desc:"장착한 개체는 매 턴 우호도 2를 자동 회복합니다." },
  soothe_bell: { name:"평온의방울",   sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/soothe-bell.png",
                 desc:"장착한 개체는 우호도 자연 감소량이 절반으로 줄어듭니다." },
  lucky_egg:   { name:"행복의알",     sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/lucky-egg.png",
                 desc:"장착한 개체는 사탕을 먹였을 때 경험치를 2배 획득합니다." },
  amulet_coin: { name:"부적금화",     sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/amulet-coin.png",
                 desc:"장착한 개체가 재화 주조 직무 중이면 자금 산출량이 50% 늘어납니다." },
  choice_band: { name:"구애머리띠",   sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/choice-band.png",
                 desc:"장착한 개체의 직무 산출량이 20% 늘어납니다." },
  focus_sash:  { name:"기합의띠",     sprite:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/focus-sash.png",
                 desc:"장착한 개체는 우호도가 낮아져도 무리를 떠나지 않습니다." },
};
const NATURAL_FAVOR_DECAY = 2;   // 턴마다 안 먹이면 자연 하락
const FEED_RESTORE = 15;         // 먹이 주기 1회 우호도 회복량
const CANDY_EXP = 20;            // 사탕 1개 경험치량
const FAVOR_CAP = 100;           // 우호도 절대 최대치
const FAVCEIL_GROWTH = 3;        // 레벨업 1회당 우호도 상한 증가폭 (FAVOR_CAP까지 성장)
const ENTRY_CAP_START = 6;       // 전투 엔트리 최대 등록 수(초기값) — 상점에서 자금으로 확장 가능
const PLOT_CAP_START = 1;        // 공터는 처음엔 1개만 사용 가능 — 확장은 땅 평탄화로
const TOTAL_PLOT_AREA = 10;      // 부지 전체 영역(미개척 구역 포함). 남는 칸은 아직 공터가 아닌 미개척지로 표시
const LEAVE_FAVOR_THRESHOLD = 80;  // 우호도가 이 값 이하로 떨어지면 매 턴 이탈 위험이 생김
const LEAVE_CHANCE_MAX = 0.3;      // 우호도 0에 수렴할수록 이탈 확률이 이 값에 가까워짐(선형)
export const ENERGY_PER_TURN = 5;       // 턴마다 회복되는 행동 에너지
const FEED_ENERGY_COST = 1;
const CANDY_ENERGY_COST = 1;
const UNASSIGN_ENERGY_COST = 1;
const INSTALL_ENERGY_COST = 1;
const HUNT_ENERGY_COST = 2;
const TRAIN_ENERGY_COST = 1;

/* ---- 상점: 자금(gold) 소비처 ---- */
const SHOP_ENERGY_COST = 5;      // 에너지 충전권 가격(자금)
const SHOP_ENERGY_GAIN = 2;      // 충전권 1개당 회복량(에너지 상한까지)
const SHOP_ENTRY_BASE_COST = 20; // 전투 엔트리 확장 기본 가격(자금) — 살 때마다 누적 증가

/* ---- 기술 지도: 기술머신(tm) 소비처. 개체의 특수능력치(직무 산출량 배율)를 직접 강화 ---- */
const TM_TRAIN_COST = 1;      // 소비량(기술머신)
const TM_APTITUDE_GAIN = 5;   // 특수능력치 증가폭(최대 100)

export let roster = [];
export let resources = { seed:0, fruit:0, food:0, material:0, gold:0, tool:0,
                          tm:0, candy:0, healItem:0, cureItem:0, items:{} };
let plotCap = PLOT_CAP_START;
let storageCap = 50;
let entryCap = ENTRY_CAP_START;
let turnCount = 0;
export let energy = ENERGY_PER_TURN;
let lastLog = null;
let baseMsg = "";

/* ---- HUD 드롭다운/모달 상태 (재렌더 간 유지) ---- */
let openPanel = null;      // "bag" | "ball" | "pc" | "log" | "install" | null
let pcSelected = null;     // PC 모달에서 선택된 roster 인덱스
let installPicks = new Set();  // 설치 모달에서 다중 선택된 roster 인덱스(미배정 개체)
let installFacility = null;  // 설치 모달에서 선택된 시설 id (JOBS의 key 중 하나)
let siteModalJob = null;   // "site" 패널에서 보고 있는 운영 중 직무 id
let sitePicks = new Set(); // site 모달에서 추가 배치할 미배정 roster 인덱스
let itemModalIdx = null;   // "item" 패널에서 도구를 제작/장착 중인 roster 인덱스

const SAVE_KEY = "blindpoke-save-v1";

/* 자동 저장: 턴 진행 직후 · 포획(로스터 합류) 직후에 호출. localStorage를 못 쓰는 환경(시크릿 모드 등)이어도
   게임 진행에는 지장이 없도록 실패를 조용히 무시한다 */
function saveState(){
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v:1, roster, resources, plotCap, storageCap, entryCap, turnCount }));
  }catch(e){ /* 저장 실패는 무시 — 세이브 없이 계속 진행 */ }
}

/* 부팅 시 호출: 저장된 진행이 있으면 복원하고 true를 반환(있으면 드래프트를 건너뛰고 본거지로 바로 진입) */
export function loadState(){
  let raw;
  try{ raw = localStorage.getItem(SAVE_KEY); }catch(e){ return false; }
  if(!raw) return false;
  try{
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.roster) || !data.roster.length) return false;
    roster.length = 0;
    data.roster.forEach(m=> roster.push(m));
    Object.assign(resources, data.resources||{});
    plotCap = data.plotCap ?? plotCap;
    storageCap = data.storageCap ?? storageCap;
    entryCap = data.entryCap ?? entryCap;
    turnCount = data.turnCount ?? turnCount;
    return true;
  }catch(e){ return false; }
}

export function addToRoster(entry){
  entry.inEntry = false;
  roster.push(entry);
  saveState();
}

/* 저장 상한을 지켜 자원을 더하는 외부용 헬퍼(지도 세력전의 영토 산출 등에서 사용) */
export function addResource(key, amt){
  resources[key] = Math.min(storageCap, (resources[key]||0) + amt);
}

function isMatch(member, jobId){
  const ts = types(member.pokemon);
  if(ts.includes("노말")) return true;
  return ts.some(t=> JOB_BY_TYPE[t]===jobId);
}
function assignedCount(){
  return roster.filter(m=>m.job).length;
}
function entryCount(){
  return roster.filter(m=>m.inEntry).length;
}
/* ---- 공터(부지) = 직무 "종류"별 작업장 1개. 같은 직무엔 인원 제한 없이 몇 마리든 더 배치 가능하며,
   많이 배치할수록 산출/효과가 커진다(직무 루프가 인원별로 합산). plotCap은 "동시에 운영 가능한 작업장 개수"다. ---- */
function activeJobTypes(){
  const set = new Set();
  roster.forEach(m=>{ if(m.job) set.add(m.job); });
  return [...set];
}
function jobMembers(jobId){
  return roster.map((m,i)=>({m,i})).filter(x=>x.m.job===jobId);
}
function usedPlots(){
  return activeJobTypes().length;
}

export function spendEnergy(cost){
  if(energy < cost){
    baseMsg = `이번 턴 에너지가 부족합니다. (${energy}/${ENERGY_PER_TURN}) 다음 턴에 회복됩니다.`;
    return false;
  }
  baseMsg = "";
  energy -= cost;
  return true;
}

function assignJob(idx, jobId){
  const m = roster[idx];
  if(!m) return false;
  if(jobId && !m.job){
    const isNewSite = !activeJobTypes().includes(jobId);
    if(isNewSite && usedPlots()>=plotCap){
      baseMsg = `공터를 모두 사용 중입니다(${usedPlots()}/${plotCap}). 땅 평탄화로 부지를 늘리세요.`;
      return false;
    }
  }
  baseMsg = "";
  m.job = jobId || null;
  return true;
}

function craftItem(itemId){
  if(!HELD_ITEMS[itemId] || resources.tool < ITEM_CRAFT_COST) return;
  resources.tool -= ITEM_CRAFT_COST;
  resources.items[itemId] = (resources.items[itemId]||0) + 1;
  saveState();
}
function equipItem(idx, itemId){
  const m = roster[idx];
  if(!m || !HELD_ITEMS[itemId] || (resources.items[itemId]||0)<=0) return;
  if(m.heldItem) resources.items[m.heldItem] = (resources.items[m.heldItem]||0) + 1;
  resources.items[itemId]--;
  m.heldItem = itemId;
  saveState();
}
function unequipItem(idx){
  const m = roster[idx];
  if(!m || !m.heldItem) return;
  resources.items[m.heldItem] = (resources.items[m.heldItem]||0) + 1;
  m.heldItem = null;
  saveState();
}

function toggleEntry(idx){
  const m = roster[idx];
  if(!m) return;
  if(!m.inEntry && entryCount()>=entryCap){
    baseMsg = `전투 엔트리는 최대 ${entryCap}마리까지 등록할 수 있습니다.`;
    renderBase();
    return;
  }
  baseMsg = "";
  m.inEntry = !m.inEntry;
  renderBase();
}

function feedHeal(idx){
  const m = roster[idx];
  if(!m || resources.healItem<=0) return;
  if(!spendEnergy(FEED_ENERGY_COST)){ renderBase(); return; }
  resources.healItem--;
  m.favor = Math.min(m.favCeil, m.favor + FEED_RESTORE);
  m.fedThisTurn = true;
  renderBase();
}
function feedCandy(idx){
  const m = roster[idx];
  if(!m || resources.candy<=0) return;
  if(!spendEnergy(CANDY_ENERGY_COST)){ renderBase(); return; }
  resources.candy--;
  m.exp += m.heldItem==="lucky_egg" ? CANDY_EXP*2 : CANDY_EXP;
  while(m.exp >= m.level*20){
    m.exp -= m.level*20; m.level++;
    m.favCeil = Math.min(FAVOR_CAP, m.favCeil + FAVCEIL_GROWTH);
  }
  renderBase();
}

/* ---- 상점: 자금(gold) 소비처. 에너지 충전권은 매번 같은 가격, 전투 엔트리 확장은 살수록 비싸짐 ---- */
function entryExpansionCost(){
  return SHOP_ENTRY_BASE_COST * (entryCap - ENTRY_CAP_START + 1);
}
function buyEnergy(){
  if(resources.gold < SHOP_ENERGY_COST || energy >= ENERGY_PER_TURN) return;
  resources.gold -= SHOP_ENERGY_COST;
  energy = Math.min(ENERGY_PER_TURN, energy + SHOP_ENERGY_GAIN);
  saveState();
  renderBase();
}
function buyEntrySlot(){
  const cost = entryExpansionCost();
  if(resources.gold < cost) return;
  resources.gold -= cost;
  entryCap++;
  saveState();
  renderBase();
}

/* ---- 기술 지도: 기술머신(tm) 소비처. 개체의 특수능력치(직무 산출량 배율)를 직접 강화 ---- */
function trainWithTM(idx){
  const m = roster[idx];
  if(!m || resources.tm < TM_TRAIN_COST || m.aptitude >= 100) return;
  if(!spendEnergy(TRAIN_ENERGY_COST)){ renderBase(); return; }
  resources.tm -= TM_TRAIN_COST;
  m.aptitude = Math.min(100, m.aptitude + TM_APTITUDE_GAIN);
  saveState();
  renderBase();
}

function resolveTurn(){
  const tillCount = roster.filter(m=>m.job==="till").length;
  const flattenCount = roster.filter(m=>m.job==="flatten").length;
  const chillCount = roster.filter(m=>m.job==="chill").length;

  plotCap += flattenCount;
  storageCap += chillCount*10;

  const gain = {}, used = {};
  JOB_ORDER.forEach(jobId=>{
    const job = JOBS[jobId];
    if(!job.produce) return;   // till/flatten/chill/치안/침투: 직접 산출 없음
    roster.filter(m=>m.job===jobId).forEach(m=>{
      const mismatch = !isMatch(m, jobId);
      let amt = JOB_BASE_AMT[jobId] * (0.5+m.aptitude/100) * (1+m.level*0.1) * (mismatch?0.5:1);
      if(jobId==="fruit") amt *= (1+0.2*tillCount);
      if(jobId==="mint" && m.heldItem==="amulet_coin") amt *= 1.5;
      if(m.heldItem==="choice_band") amt *= 1.2;
      amt = Math.max(0, Math.round(amt));
      if(job.consumeRes){
        const have = resources[job.consumeRes];
        if(have < amt*job.consumePer) amt = Math.floor(have/job.consumePer);
        const spend = amt*job.consumePer;
        resources[job.consumeRes] -= spend;
        used[job.consumeRes] = (used[job.consumeRes]||0) + spend;
      }
      resources[job.produce] = Math.min(storageCap, resources[job.produce] + amt);
      gain[job.produce] = (gain[job.produce]||0) + amt;
    });
  });

  const left = [];
  for(let i=roster.length-1; i>=0; i--){
    const m = roster[i];
    if(m.heldItem==="leftovers") m.favor = Math.min(m.favCeil, m.favor + 2);
    if(m.fedThisTurn){ m.fedThisTurn = false; continue; }
    const decay = m.heldItem==="soothe_bell" ? NATURAL_FAVOR_DECAY/2 : NATURAL_FAVOR_DECAY;
    m.favor = Math.max(m.favFloor, m.favor - decay);
    if(m.heldItem==="focus_sash") continue;
    if(m.favor <= LEAVE_FAVOR_THRESHOLD){
      const leaveChance = LEAVE_CHANCE_MAX * (1 - m.favor/LEAVE_FAVOR_THRESHOLD);
      if(Math.random() < leaveChance){
        left.push(m.pokemon.nameKr);
        roster.splice(i,1);
      }
    }
  }
  if(left.length) pcSelected = null;

  const mapResult = resolveMapTurn();
  if(mapResult.gain) gain.gold = (gain.gold||0) + mapResult.gain;

  energy = ENERGY_PER_TURN;
  turnCount++;
  lastLog = { gain, used, flattenCount, chillCount, left, raided: mapResult.raided };
  openPanel = "log";
  saveState();
  renderBase();
}

/* 본거지 부지: town-bg.png 안에 이미 그려진 흙밭 10칸(5x2) 위에 좌표만 얹는다.
   공터 상한(plotCap)만큼은 운영 중인 직무 하나당 1칸씩 보여주고(같은 직무는 인원 무관 1칸에 모임),
   남는 칸은 빈 공터, plotCap을 넘는 영역은 아직 개척되지 않은 미개척지 — 사각 카드가 아니라
   실제 흙밭의 원근 사다리꼴 폴리곤을 hit-area/시각 반응 영역으로 그대로 사용한다. */
function plotScene(){
  const active = activeJobTypes();
  const tiles = [];
  for(let i=0;i<TOTAL_PLOT_AREA;i++){
    const col = i % 5;
    const pts = plotPolygon(col);
    const clip = clipPathStr(pts);
    const fx = plotFxSvg(pts);
    if(i < plotCap){
      const jobId = active[i];
      if(jobId){
        const members = jobMembers(jobId);
        const first = members[0].m;
        const sprite = first.pokemon.details?.sprites?.front_default || ART(first.pokemon.pokemonRowid);
        tiles.push(`
          <div class="plot filled" style="clip-path:${clip}" data-plot-site="${jobId}" title="${JOBS[jobId]?.label||""} · ${members.length}마리 근무 중">
            ${fx}
            <span class="plot-tag"><img class="plot-sprite" src="${sprite}" alt="${first.pokemon.nameKr}"></span>
            <span class="plot-info"><b>${JOBS[jobId]?.label||""}</b>${members.length}마리 근무 중</span>
          </div>`);
      }else{
        tiles.push(`
          <div class="plot empty" style="clip-path:${clip}" data-plot-install="1">
            ${fx}
            <span class="plot-tag">${icon("plus",13)}<span>빈 필드</span></span>
            <span class="plot-info">포켓몬 배치 가능</span>
          </div>`);
      }
    }else{
      tiles.push(`
        <div class="plot locked" style="clip-path:${clip}" title="땅 평탄화로 개척할 수 있는 미개척지">
          ${fx}
          <span class="plot-tag">${icon("lock",12)}<span>미개척지</span></span>
          <span class="plot-info">개척 조건 미달성</span>
        </div>`);
    }
  }
  return tiles.join("");
}

/* 목록에서 이 개체가 전투 엔트리에 등록돼 있으면 몬스터볼 배지로 표시 */
function entryBadge(m){
  return m.inEntry
    ? `<span class="hud-ico-ball pc-ball" title="전투 엔트리 등록됨"><span class="hb-top"></span><span class="hb-band"></span><span class="hb-btn"></span></span>`
    : "";
}

function rosterCard(m, i){
  const ts = types(m.pokemon);
  const pct = Math.round((m.favor/FAVOR_CAP)*100);
  return `
    <div class="roster-card" id="roster-${i}">
      <div class="rc-head">
        <span class="rc-name">${m.pokemon.nameKr}</span>
        <span class="rc-lv">Lv.${m.level}</span>
      </div>
      <div class="rc-types">${ts.map(t=>`<span class="chip" style="background:${TYPE_COLORS[t]||"#666"}">${t}</span>`).join("")}</div>
      <div class="rc-fav">
        <div class="rc-favbar"><div class="rc-favfill" style="width:${pct}%"></div></div>
        <span class="rc-favtxt">우호도 ${Math.round(m.favor)}/${FAVOR_CAP}</span>
      </div>
      <div class="rc-fav">
        <div class="rc-favbar"><div class="rc-favfill apt" style="width:${m.aptitude}%"></div></div>
        <span class="rc-favtxt">특수능력 ${m.aptitude}/100</span>
      </div>
      <div class="rc-job">
        ${m.job
          ? `<span class="rc-job-label">직무: ${JOBS[m.job]?.label||""}</span><button data-unassign="${i}" class="rc-unassign">해제</button>`
          : `<span class="rc-job-label dim">미배정 · 부지의 빈 공터에서 설치하세요</span>`}
      </div>
      <div class="rc-job">
        ${m.heldItem
          ? `<span class="rc-job-label"><img class="rc-item-ico" src="${HELD_ITEMS[m.heldItem].sprite}" alt="">도구: ${HELD_ITEMS[m.heldItem].name}</span>`
          : `<span class="rc-job-label dim">도구 미장착</span>`}
        <button data-open-item="${i}" class="rc-unassign">도구 관리</button>
      </div>
      <div class="rc-actions">
        <button data-feed="${i}" ${(resources.healItem<=0||energy<FEED_ENERGY_COST)?"disabled":""}>먹이 주기(+우호도)</button>
        <button data-candy="${i}" ${(resources.candy<=0||energy<CANDY_ENERGY_COST)?"disabled":""}>사탕 먹이기(+경험치)</button>
        <button data-train="${i}" ${(resources.tm<TM_TRAIN_COST||m.aptitude>=100||energy<TRAIN_ENERGY_COST)?"disabled":""}>기술 지도(+특수능력)</button>
        <button data-entry="${i}" class="${m.inEntry?"on":""}">${m.inEntry?"엔트리 해제":"엔트리 등록"}</button>
      </div>
    </div>
  `;
}

/* 특정 개체(itemModalIdx)에게 도구를 제작·장착하는 모달. "부품"(tool)을 소모해 도구를 제작하고,
   제작한 도구를 개체에 장착한다(1마리당 1개, 교체 시 기존 도구는 보관함으로 돌아감) */
function itemModal(){
  const idx = itemModalIdx;
  const m = roster[idx];
  if(!m) return "";
  const rows = Object.entries(HELD_ITEMS).map(([id,item])=>{
    const owned = resources.items[id]||0;
    const equipped = m.heldItem===id;
    return `
      <div class="entry-row">
        <span><img class="rc-item-ico" src="${item.sprite}" alt="">${item.name} <span style="color:var(--dim)">보유 ${owned}개</span></span>
        <span style="display:flex; gap:6px">
          <button data-craft-item="${id}" ${resources.tool<ITEM_CRAFT_COST?"disabled":""}>제작(부품 ${ITEM_CRAFT_COST})</button>
          <button data-equip-item="${id}" class="${equipped?"on":""}" ${(owned<=0&&!equipped)?"disabled":""}>${equipped?"장착중":"장착"}</button>
        </span>
      </div>
      <div class="install-note" style="margin:2px 0 10px">${item.desc}</div>`;
  }).join("");
  return `
    <div class="modal-overlay" data-modal="item">
      <div class="modal-box">
        <div class="modal-head"><span>${m.pokemon.nameKr}의 도구 · 보유 부품 ${resources.tool}</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          ${m.heldItem ? `<button class="btn wide" data-unequip-item style="margin-bottom:10px">현재 장착: ${HELD_ITEMS[m.heldItem].name} · 해제하기</button>` : ""}
          ${rows}
        </div>
      </div>
    </div>`;
}

function renderTurnLogRows(){
  if(!lastLog) return `<div class="logempty">아직 진행한 턴이 없습니다.</div>`;
  const parts = [];
  Object.entries(lastLog.gain).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} +${v}`); });
  Object.entries(lastLog.used).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} -${v}`); });
  if(lastLog.flattenCount) parts.push(`직무 슬롯 +${lastLog.flattenCount} (합계 ${plotCap})`);
  if(lastLog.chillCount) parts.push(`저장 상한 +${lastLog.chillCount*10} (합계 ${storageCap})`);
  const rows = [parts.length
    ? `<div class="logline">${parts.join(" · ")}</div>`
    : `<div class="logempty">이번 턴은 산출이 없었습니다.</div>`];
  if(lastLog.left && lastLog.left.length){
    rows.push(`<div class="logline leave">${lastLog.left.join(", ")}이(가) 우호도 저하로 무리를 떠났습니다.</div>`);
  }
  if(lastLog.raided && lastLog.raided.length){
    rows.push(`<div class="logline leave">${lastLog.raided.join(", ")}을(를) 트레이너에게 재도전받아 빼앗겼습니다. 🗺️ 지도에서 치안 인원을 늘리세요.</div>`);
  }
  return rows.join("");
}

/* ---- HUD 상단: 좌측 턴/행동력 모듈 + 우측 Command Bar(PC·엔트리·상점·자원·지도·탐험을
   개별 박스가 아니라 하나의 얇은 바 안에서 아이콘+라벨로만 표시, hover/active는 밑줄 accent로만) ---- */
function hudTop(){
  const segs = Array.from({length:ENERGY_PER_TURN}, (_,i)=>`<span class="eg-seg ${i<energy?"on":""}"></span>`).join("");
  return `
    <div class="hud-top">
      <div class="turn-hud" data-hud="log">
        ${icon("cycle",13)}
        <span class="turn-hud-num">턴 <b>${turnCount}</b></span>
        <span class="turn-hud-div"></span>
        ${icon("bolt",11)}
        <span class="energy-gauge">${segs}</span>
        <span class="turn-hud-num sub">${energy}/${ENERGY_PER_TURN}</span>
      </div>
      <div class="cmdbar">
        <button class="cmd-item ${openPanel==="pc"?"active":""}" data-hud="pc" title="보유 포켓몬">
          ${icon("pc",15)}<span class="cmd-label">PC</span>
          ${roster.length ? `<span class="cmd-badge">${roster.length}</span>` : ""}
        </button>
        <button class="cmd-item ${openPanel==="ball"?"active":""}" data-hud="ball" title="전투 엔트리">
          ${icon("entry",15)}<span class="cmd-label">엔트리</span>
          <span class="cmd-badge">${entryCount()}/${entryCap}</span>
        </button>
        <button class="cmd-item ${openPanel==="shop"?"active":""}" data-hud="shop" title="상점(자금 소비)">
          ${icon("shop",15)}<span class="cmd-label">상점</span>
        </button>
        <button class="cmd-item ${openPanel==="bag"?"active":""}" data-hud="bag" title="자원 현황">
          ${icon("gauge",15)}<span class="cmd-label">자원</span>
        </button>
        <button class="cmd-item" data-action="map" title="세력전 지도">
          ${icon("map",15)}<span class="cmd-label">지도</span>
        </button>
        <button class="cmd-item" data-action="hunt" title="사냥하러 나가기 (에너지 ${HUNT_ENERGY_COST})" ${energy<HUNT_ENERGY_COST?"disabled":""}>
          ${icon("explore",15)}<span class="cmd-label">탐험</span>
        </button>
      </div>
    </div>`;
}

function activitySummaryText(){
  if(!lastLog) return "아직 진행한 턴이 없습니다.";
  const parts = [];
  Object.entries(lastLog.gain).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} +${v}`); });
  Object.entries(lastLog.used).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} -${v}`); });
  let text = parts.length ? parts.join(" · ") : "이번 턴은 산출이 없었습니다.";
  if(lastLog.left && lastLog.left.length) text += ` · ${lastLog.left.join(", ")} 이탈`;
  if(lastLog.raided && lastLog.raided.length) text += ` · ${lastLog.raided.join(", ")} 피습`;
  return text;
}

/* ---- HUD 하단: 마을 정보 · 최근 활동 · 다음 턴을 카드 3개가 아니라 하나의 Dock 안에서
   타이포그래피와 얇은 구분선만으로 나눈다 ---- */
function bottomDock(){
  const pct = Math.round(plotCap/TOTAL_PLOT_AREA*100);
  return `
    <div class="hud-dock">
      <div class="dock-zone dock-village">
        <span class="dock-stat">배치 <b>${assignedCount()}/${roster.length}</b></span>
        <span class="dock-sep">·</span>
        <span class="dock-stat">개척 <b>${plotCap}/${TOTAL_PLOT_AREA}</b></span>
        <span class="dock-mini-bar"><span style="width:${pct}%"></span></span>
      </div>
      <div class="dock-divider"></div>
      <button class="dock-zone dock-activity" data-hud="log">
        <span class="dock-label">최근 활동</span>
        <span class="dock-activity-text">${activitySummaryText()}</span>
      </button>
      <div class="dock-divider"></div>
      <button class="dock-zone dock-nextturn" id="nextTurn">
        <span>다음 턴</span>${icon("chevron",13)}
      </button>
    </div>`;
}

function bagDropdown(){
  return `
    <div class="dd" data-panel="bag">
      <div class="dd-head"><span>자원 현황 · 저장 상한 ${storageCap}</span><button class="dd-close" data-hud-close>✕</button></div>
      <div class="dd-body">
        <div class="res-grid">
          ${Object.entries(RES_META).map(([k,label])=>`
            <div class="res-item"><span class="res-label">${label}</span><span class="res-val">${resources[k]}</span></div>
          `).join("")}
        </div>
        <div class="install-note" style="margin-top:10px">자금은 🏪 상점에서, 기술머신은 개체 카드의 "기술 지도"로, 부품은 개체 카드의 "도구 관리"에서 포켓몬 도구 제작에 사용합니다.</div>
      </div>
    </div>`;
}

function shopDropdown(){
  const entryCost = entryExpansionCost();
  return `
    <div class="dd" data-panel="shop">
      <div class="dd-head"><span>상점 · 보유 자금 ${resources.gold}</span><button class="dd-close" data-hud-close>✕</button></div>
      <div class="dd-body">
        <div class="entry-row">
          <span>에너지 충전권 <span style="color:var(--dim)">(에너지 +${SHOP_ENERGY_GAIN}, 자금 ${SHOP_ENERGY_COST})</span></span>
          <button data-buy="energy" ${(resources.gold<SHOP_ENERGY_COST||energy>=ENERGY_PER_TURN)?"disabled":""}>구매</button>
        </div>
        <div class="entry-row">
          <span>전투 엔트리 확장 <span style="color:var(--dim)">(현재 ${entryCap}마리, 자금 ${entryCost})</span></span>
          <button data-buy="entry" ${resources.gold<entryCost?"disabled":""}>구매</button>
        </div>
      </div>
    </div>`;
}

function ballDropdown(){
  const entries = roster.filter(m=>m.inEntry);
  const slots = [];
  for(let i=0;i<entryCap;i++){
    const m = entries[i];
    if(m){
      const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
      slots.push(`<div class="entry-slot filled"><img src="${sprite}" alt="${m.pokemon.nameKr}"></div>`);
    }else{
      slots.push(`<div class="entry-slot empty">빈 슬롯</div>`);
    }
  }
  const list = roster.length ? roster.map((m,i)=>`
      <div class="entry-row">
        <span>${m.pokemon.nameKr} <span style="color:var(--dim)">Lv.${m.level}</span></span>
        <button data-entry="${i}" class="${m.inEntry?"on":""}">${m.inEntry?"해제":"등록"}</button>
      </div>
    `).join("") : `<div class="logempty">아직 포획한 개체가 없습니다.</div>`;
  return `
    <div class="dd" data-panel="ball">
      <div class="dd-head"><span>전투 엔트리 · ${entryCount()}/${entryCap}</span><button class="dd-close" data-hud-close>✕</button></div>
      <div class="dd-body">
        <div class="entry-grid">${slots.join("")}</div>
        <div class="entry-list">${list}</div>
      </div>
    </div>`;
}

function logDropdown(){
  return `
    <div class="dd" data-panel="log">
      <div class="dd-head"><span>턴 로그 · 로스터 ${roster.length}마리 · 공터 ${usedPlots()}/${plotCap} · 배치 인원 ${assignedCount()}마리</span><button class="dd-close" data-hud-close>✕</button></div>
      <div class="dd-body">${renderTurnLogRows()}</div>
    </div>`;
}

function pcModal(){
  const sel = pcSelected!=null && roster[pcSelected] ? pcSelected : (roster.length?0:null);
  const grid = roster.length ? roster.map((m,i)=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${sel===i?"selected":""}" data-pc-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("") : "";
  return `
    <div class="modal-overlay" data-modal="pc">
      <div class="modal-box">
        <div class="modal-head"><span>보유 포켓몬 · ${roster.length}마리</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          ${roster.length ? `<div class="pc-grid">${grid}</div>` : `<div class="logempty">아직 포획한 개체가 없습니다. 🌲 아이콘으로 사냥하러 나가보세요.</div>`}
          ${sel!=null ? rosterCard(roster[sel], sel) : ""}
        </div>
      </div>
    </div>`;
}

/* 빈 공터 클릭 시: 아직 가동 중이 아닌 시설 중 하나를 새로 짓는다. 시설별로 필요한 최소 인원과
   설치 비용(자원)이 다르며(JOBS[id].minMembers/installCost), 자원이 부족하면 설치할 수 없다.
   이미 가동 중인 시설에 인원을 더 넣으려면 부지의 해당 칸(공터가 아닌 운영 중 시설)을 클릭한다 */
const INSTALLABLE_FACILITIES = Object.keys(JOBS).filter(j=> !JOBS[j].stub);

function canAfford(cost){
  return !cost || Object.entries(cost).every(([k,v])=> resources[k]>=v);
}
function describeCost(cost){
  if(!cost) return "자원 소모 없음";
  return Object.entries(cost).map(([k,v])=>`${RES_META[k]} ${v}`).join(", ");
}
/* 한글 종성 유무에 따라 을/를 조사를 붙임 */
function withEul(word){
  const code = word.charCodeAt(word.length-1) - 0xAC00;
  if(code < 0 || code > 11171) return `${word}을(를)`;
  return word + (code % 28 === 0 ? "를" : "을");
}
function jobDescription(jobId){
  const job = JOBS[jobId];
  const bits = [];
  if(job.produce) bits.push(`가동하면 매 턴 ${withEul(RES_META[job.produce])} 생산합니다.`);
  if(job.consumeRes) bits.push(`생산 시 매 턴 ${withEul(RES_META[job.consumeRes])} 소모합니다.`);
  if(job.note) bits.push(job.note+".");
  bits.push(`같은 직무엔 이후에도 인원을 계속 추가할 수 있고, 많이 배치할수록 효과가 커집니다.`);
  return bits.join(" ");
}

function installModal(){
  const active = activeJobTypes();
  const facilities = INSTALLABLE_FACILITIES.filter(j=> !active.includes(j));
  if(!facilities.includes(installFacility)) installFacility = facilities[0] || null;
  if(!facilities.length){
    return `
      <div class="modal-overlay" data-modal="install">
        <div class="modal-box">
          <div class="modal-head"><span>부지에 설치</span><button class="dd-close" data-hud-close>✕</button></div>
          <div class="modal-body">
            <div class="logempty">지금 새로 지을 수 있는 시설이 없습니다. 이미 모든 시설을 가동 중입니다.</div>
          </div>
        </div>
      </div>`;
  }
  const job = JOBS[installFacility];
  const unassigned = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job);
  const validPicks = [...installPicks].filter(i=> roster[i] && !roster[i].job);
  if(validPicks.length !== installPicks.size) installPicks = new Set(validPicks);
  const remain = Math.max(0, plotCap - active.length);
  const minNeeded = job.minMembers;
  const afford = canAfford(job.installCost);
  const grid = unassigned.map(({m,i})=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${installPicks.has(i)?"selected":""}" data-install-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("");
  const enough = installPicks.size >= minNeeded && energy>=INSTALL_ENERGY_COST && afford;
  return `
    <div class="modal-overlay" data-modal="install">
      <div class="modal-box">
        <div class="modal-head"><span>부지에 설치 · 배정 가능 ${remain}칸</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          <div class="install-tabs">
            ${facilities.map(j=>`<button class="install-tab ${installFacility===j?"active":""}" data-install-facility="${j}">${JOBS[j].label}</button>`).join("")}
          </div>
          <div class="install-note">${jobDescription(installFacility)} 최소 인원 ${minNeeded}마리 · 설치 비용: ${describeCost(job.installCost)} · 에너지 ${INSTALL_ENERGY_COST}</div>
          ${!afford ? `<div class="install-note" style="color:var(--bad)">자원이 부족하여 설치할 수 없습니다. (필요: ${describeCost(job.installCost)})</div>` : ""}
          ${energy<INSTALL_ENERGY_COST ? `<div class="install-note" style="color:var(--bad)">에너지가 부족하여 설치할 수 없습니다. (${energy}/${ENERGY_PER_TURN})</div>` : ""}
          ${unassigned.length
            ? `<div class="pc-grid">${grid}</div>`
            : `<div class="logempty">배정할 수 있는 개체가 없습니다. 모든 개체가 이미 직무를 수행 중입니다.</div>`}
          <button class="btn wide install-confirm" data-install-confirm ${enough?"":"disabled"}>
            ${job.label} 설치 (${installPicks.size}/${minNeeded}+ 선택됨)
          </button>
        </div>
      </div>
    </div>`;
}

/* 운영 중인 시설(부지의 채워진 칸) 클릭 시: 현재 근무 인원을 보여주고, 미배정 개체를 더 추가 배치할 수 있게 함 */
function siteModal(){
  const jobId = siteModalJob;
  const job = JOBS[jobId];
  const members = jobMembers(jobId);
  const unassigned = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job);
  const validPicks = [...sitePicks].filter(i=> roster[i] && !roster[i].job);
  if(validPicks.length !== sitePicks.size) sitePicks = new Set(validPicks);
  const memberRows = members.map(({m,i})=>`
      <div class="entry-row">
        <span>${m.pokemon.nameKr} <span style="color:var(--dim)">Lv.${m.level}</span></span>
        <button data-unassign="${i}" class="rc-unassign">해제</button>
      </div>
    `).join("");
  const grid = unassigned.map(({m,i})=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${sitePicks.has(i)?"selected":""}" data-site-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("");
  const enough = sitePicks.size>=1 && energy>=INSTALL_ENERGY_COST;
  return `
    <div class="modal-overlay" data-modal="site">
      <div class="modal-box">
        <div class="modal-head"><span>${job?.label||""} · ${members.length}마리 근무 중</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          <div class="install-note">같은 직무에 인원을 더 배치할수록 산출/효과가 커집니다.</div>
          <div class="entry-list">${memberRows || `<div class="logempty">근무 중인 개체가 없습니다.</div>`}</div>
          <div class="install-note" style="margin-top:12px">인원 추가</div>
          ${unassigned.length
            ? `<div class="pc-grid">${grid}</div>`
            : `<div class="logempty">배정할 수 있는 미배치 개체가 없습니다.</div>`}
          <button class="btn wide install-confirm" data-site-confirm ${enough?"":"disabled"}>
            추가 배치 (${sitePicks.size}마리 · 에너지 ${INSTALL_ENERGY_COST})
          </button>
        </div>
      </div>
    </div>`;
}

export function renderBase(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  app.innerHTML = `
    <div class="base-scene">
      <div class="base-art">
        ${hudTop()}
        <div class="plot-grid">${plotScene()}</div>
      </div>
      ${baseMsg ? `<div class="basemsg-toast">${baseMsg}</div>` : ""}
      ${bottomDock()}

      ${openPanel==="bag" ? bagDropdown() : ""}
      ${openPanel==="shop" ? shopDropdown() : ""}
      ${openPanel==="ball" ? ballDropdown() : ""}
      ${openPanel==="log" ? logDropdown() : ""}
    </div>

    ${openPanel==="pc" ? pcModal() : ""}
    ${openPanel==="install" ? installModal() : ""}
    ${openPanel==="site" ? siteModal() : ""}
    ${openPanel==="item" ? itemModal() : ""}
  `;

  app.querySelectorAll("[data-plot-site]").forEach(el=> el.onclick = ()=>{
    siteModalJob = el.dataset.plotSite;
    sitePicks = new Set();
    openPanel = "site";
    renderBase();
  });
  app.querySelectorAll("[data-plot-install]").forEach(el=> el.onclick = ()=>{
    const active = activeJobTypes();
    const facilities = INSTALLABLE_FACILITIES.filter(j=> !active.includes(j));
    installFacility = facilities[0] || null;
    installPicks = new Set();
    openPanel = "install";
    renderBase();
  });
  app.querySelectorAll("[data-install-facility]").forEach(b=> b.onclick = ()=>{
    installFacility = b.dataset.installFacility;
    installPicks = new Set();
    renderBase();
  });
  app.querySelectorAll("[data-install-pick]").forEach(el=> el.onclick = ()=>{
    const idx = +el.dataset.installPick;
    if(installPicks.has(idx)) installPicks.delete(idx); else installPicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-install-confirm]")?.addEventListener("click", ()=>{
    if(!installFacility) return;
    const job = JOBS[installFacility];
    const picks = [...installPicks];
    if(picks.length < job.minMembers) return;
    if(!canAfford(job.installCost)){
      baseMsg = `자원이 부족하여 설치할 수 없습니다. (필요: ${describeCost(job.installCost)})`;
      renderBase();
      return;
    }
    if(!spendEnergy(INSTALL_ENERGY_COST)){ renderBase(); return; }
    if(job.installCost) Object.entries(job.installCost).forEach(([k,v])=> resources[k]-=v);
    picks.forEach(idx=> assignJob(idx, installFacility));
    installPicks = new Set();
    openPanel = null;
    renderBase();
  });
  app.querySelectorAll("[data-site-pick]").forEach(el=> el.onclick = ()=>{
    const idx = +el.dataset.sitePick;
    if(sitePicks.has(idx)) sitePicks.delete(idx); else sitePicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-site-confirm]")?.addEventListener("click", ()=>{
    const picks = [...sitePicks];
    if(!picks.length) return;
    if(!spendEnergy(INSTALL_ENERGY_COST)){ renderBase(); return; }
    picks.forEach(idx=> assignJob(idx, siteModalJob));
    sitePicks = new Set();
    openPanel = null;
    renderBase();
  });
  app.querySelectorAll("[data-unassign]").forEach(b=> b.onclick = ()=>{
    if(!spendEnergy(UNASSIGN_ENERGY_COST)){ renderBase(); return; }
    assignJob(+b.dataset.unassign, null);
    renderBase();
  });
  app.querySelectorAll("[data-feed]").forEach(b=> b.onclick = ()=> feedHeal(+b.dataset.feed));
  app.querySelectorAll("[data-candy]").forEach(b=> b.onclick = ()=> feedCandy(+b.dataset.candy));
  app.querySelectorAll("[data-train]").forEach(b=> b.onclick = ()=> trainWithTM(+b.dataset.train));
  app.querySelectorAll("[data-entry]").forEach(b=> b.onclick = ()=> toggleEntry(+b.dataset.entry));
  app.querySelectorAll("[data-buy]").forEach(b=> b.onclick = ()=>{
    if(b.dataset.buy==="energy") buyEnergy();
    else if(b.dataset.buy==="entry") buyEntrySlot();
  });
  app.querySelectorAll("[data-pc-pick]").forEach(el=> el.onclick = ()=>{ pcSelected = +el.dataset.pcPick; renderBase(); });
  app.querySelectorAll("[data-open-item]").forEach(b=> b.onclick = ()=>{
    itemModalIdx = +b.dataset.openItem;
    openPanel = "item";
    renderBase();
  });
  app.querySelectorAll("[data-craft-item]").forEach(b=> b.onclick = ()=>{ craftItem(b.dataset.craftItem); renderBase(); });
  app.querySelectorAll("[data-equip-item]").forEach(b=> b.onclick = ()=>{ equipItem(itemModalIdx, b.dataset.equipItem); renderBase(); });
  app.querySelector("[data-unequip-item]")?.addEventListener("click", ()=>{ unequipItem(itemModalIdx); renderBase(); });
  $("#nextTurn").onclick = resolveTurn;

  app.querySelectorAll("[data-hud]").forEach(b=> b.onclick = ()=>{
    const name = b.dataset.hud;
    openPanel = (openPanel===name) ? null : name;
    renderBase();
  });
  app.querySelector('[data-action="map"]')?.addEventListener("click", ()=> renderMap());
  app.querySelector('[data-action="hunt"]')?.addEventListener("click", ()=>{
    if(!spendEnergy(HUNT_ENERGY_COST)){ renderBase(); return; }
    newCase();
  });
  app.querySelectorAll("[data-hud-close]").forEach(b=> b.onclick = ()=>{
    openPanel = null; installPicks = new Set(); sitePicks = new Set(); renderBase();
  });
  app.querySelector('[data-modal="pc"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="pc"){ openPanel = null; renderBase(); }
  });
  app.querySelector('[data-modal="install"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="install"){ openPanel = null; installPicks = new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="site"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="site"){ openPanel = null; sitePicks = new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="item"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="item"){ openPanel = null; renderBase(); }
  });
}
