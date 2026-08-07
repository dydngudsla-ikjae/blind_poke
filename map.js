// ===== 타운맵: 각 구역을 지키는 트레이너에게 도전해 지역을 넓혀가는 지도 — 치안/침투 스텁 직무가 실제로 쓰이는 곳 =====
import { POKE, ART, rnd, $ } from "./data.js";
import { rollIV } from "./identify.js";
import { roster, spendEnergy, energy, ENERGY_PER_TURN, addResource, renderBase } from "./base.js";
import { startBattle } from "./battle.js";

const ATTACK_ENERGY_COST = 2;
const TERRITORY_GOLD_PER_TURN = 3;   // 소유 구역 1개당 턴마다 지급되는 자금(시작 구역 제외)
const CHALLENGE_BASE_CHANCE = 0.15;  // 트레이너와 인접한 소유 구역이 매 턴 재도전받을 기본 확률
const CHALLENGE_CHANCE_PER_WATCH = 0.05; // 치안(watch_air/watch_dragon) 인원 1명당 재도전 확률 감소폭
const INFILTRATE_LEVEL_CUT = 1;      // 침투(infiltrate_dark/infiltrate_ghost) 인원 1명당 상대 포켓몬 레벨 감소폭

/* 고정 지도 그래프 — 인접(neighbors)한, 아직 안 이긴 구역만 도전 가능. tier가 높을수록 트레이너가 강함.
   trainerTitle은 포켓몬 시리즈에서 흔한 "직업형" 트레이너 클래스 명칭(특정 캐릭터명이 아님) */
const TERRITORY_DEFS = [
  { id:"grasslands", name:"초원 마을",   x:50, y:82, tier:0, neighbors:["field","hill"] },
  { id:"field",      name:"들판",        x:28, y:60, tier:1, neighbors:["grasslands","forest","hill"], trainerTitle:"풀숲 트레이너" },
  { id:"hill",       name:"언덕",        x:72, y:60, tier:1, neighbors:["grasslands","field","cave"],  trainerTitle:"언덕길 트레이너" },
  { id:"forest",     name:"숲 어귀",     x:14, y:34, tier:2, neighbors:["field","lake"], trainerTitle:"숲속 트레이너" },
  { id:"cave",       name:"동굴 입구",   x:86, y:34, tier:2, neighbors:["hill","peak"], trainerTitle:"동굴 탐험가" },
  { id:"lake",       name:"호숫가",      x:32, y:10, tier:3, neighbors:["forest"], trainerTitle:"낚시꾼 트레이너" },
  { id:"peak",       name:"봉우리",      x:68, y:10, tier:3, neighbors:["cave"], trainerTitle:"등반가 트레이너" },
];
const TIER_CONFIG = {
  1: { levelMin:3,  levelMax:6,  size:1, statCap:320 },
  2: { levelMin:6,  levelMax:10, size:2, statCap:480 },
  3: { levelMin:10, levelMax:15, size:2, statCap:Infinity },
};
const statTotal = p => p.hp+p.atk+p.def+p.satk+p.sdef+p.spd;
/* 한글 종성 유무에 따라 을/를 조사를 붙임 */
function withEul(word){
  const code = word.charCodeAt(word.length-1) - 0xAC00;
  if(code < 0 || code > 11171) return `${word}을(를)`;
  return word + (code % 28 === 0 ? "를" : "을");
}

let territories = TERRITORY_DEFS.map(t=> ({ ...t, owner: t.tier===0 ? "player" : "wild" }));
let mapMsg = "";

const MAP_SAVE_KEY = "blindpoke-map-v1";
function saveMapState(){
  try{
    localStorage.setItem(MAP_SAVE_KEY, JSON.stringify(territories.map(t=>({ id:t.id, owner:t.owner }))));
  }catch(e){ /* 저장 실패는 무시 */ }
}
export function loadMapState(){
  let raw;
  try{ raw = localStorage.getItem(MAP_SAVE_KEY); }catch(e){ return; }
  if(!raw) return;
  try{
    const saved = JSON.parse(raw);
    saved.forEach(s=>{
      const t = territories.find(x=>x.id===s.id);
      if(t && s.owner) t.owner = s.owner;
    });
  }catch(e){ /* 손상된 저장은 무시하고 기본값 유지 */ }
}

function isAttackable(t){
  if(t.owner==="player") return false;
  return t.neighbors.some(nId=>{
    const n = territories.find(x=>x.id===nId);
    return n && n.owner==="player";
  });
}

function generateGarrison(node){
  const cfg = TIER_CONFIG[node.tier] || TIER_CONFIG[1];
  const infiltrateCount = roster.filter(m=> m.job==="infiltrate_dark" || m.job==="infiltrate_ghost").length;
  const basePool = POKE.filter(p=> !p.details?.isLegendary && !p.details?.isMythical);
  // 티어가 낮은(플레이어와 가까운) 구역은 종족값 총합이 낮은(덜 진화한) 포켓몬으로만 팀을 꾸려
  // 초반부터 준전설급이 나오는 밸런스 붕괴를 막는다
  const pool = basePool.filter(p=> statTotal(p) <= cfg.statCap);
  const squad = [];
  for(let i=0;i<cfg.size;i++){
    const p = pool[rnd(0,pool.length-1)];
    const level = Math.max(1, rnd(cfg.levelMin, cfg.levelMax) - infiltrateCount*INFILTRATE_LEVEL_CUT);
    squad.push({ pokemon:p, level, iv: rollIV() });
  }
  return squad;
}

/* 턴마다 호출: 소유 구역 산출 + 트레이너와 인접한 구역의 재도전 판정(치안 인원이 확률을 낮춤) */
export function resolveMapTurn(){
  const owned = territories.filter(t=> t.owner==="player" && t.tier>0);
  if(owned.length) addResource("gold", owned.length*TERRITORY_GOLD_PER_TURN);

  const watchCount = roster.filter(m=> m.job==="watch_air" || m.job==="watch_dragon").length;
  const challenged = [];
  territories.forEach(t=>{
    if(t.owner!=="player" || t.tier===0) return;
    const hasWildNeighbor = t.neighbors.some(nId=>{
      const n = territories.find(x=>x.id===nId);
      return n && n.owner!=="player";
    });
    if(!hasWildNeighbor) return;
    const chance = Math.max(0, CHALLENGE_BASE_CHANCE - watchCount*CHALLENGE_CHANCE_PER_WATCH);
    if(Math.random() < chance){
      t.owner = "wild";
      challenged.push(t.name);
    }
  });

  if(owned.length || challenged.length) saveMapState();
  return { gain: owned.length*TERRITORY_GOLD_PER_TURN, raided: challenged };
}

function handleBattleResult(node, result){
  if(result==="win"){
    node.owner = "player";
    mapMsg = `${withEul(node.trainerTitle)} 이기고 ${withEul(node.name)} 얻었다!`;
    saveMapState();
  }else{
    const LOSS_FAVOR_PENALTY = 5;
    roster.filter(m=>m.inEntry).forEach(m=>{ m.favor = Math.max(m.favFloor, m.favor - LOSS_FAVOR_PENALTY); });
    mapMsg = `${node.trainerTitle}에게 패배했다... (참전 개체 우호도 소폭 하락)`;
  }
  renderMap();
}

function attackNode(node){
  const entryTeam = roster.filter(m=>m.inEntry);
  if(!entryTeam.length){
    mapMsg = "전투 엔트리에 등록된 개체가 없습니다. 본거지 PC에서 엔트리에 등록하세요.";
    renderMap();
    return;
  }
  if(!spendEnergy(ATTACK_ENERGY_COST)){
    mapMsg = `에너지가 부족합니다. (${energy}/${ENERGY_PER_TURN})`;
    renderMap();
    return;
  }
  mapMsg = "";
  const playerEntries = entryTeam.map(m=> ({ pokemon:m.pokemon, level:m.level, iv:m.iv }));
  const enemyEntries = generateGarrison(node);
  startBattle(playerEntries, enemyEntries, (result)=> handleBattleResult(node, result));
}

function edgesSvg(){
  const lines = [];
  const seen = new Set();
  territories.forEach(t=>{
    t.neighbors.forEach(nId=>{
      const key = [t.id,nId].sort().join("-");
      if(seen.has(key)) return;
      seen.add(key);
      const n = territories.find(x=>x.id===nId);
      if(!n) return;
      lines.push(`<line x1="${t.x}" y1="${t.y}" x2="${n.x}" y2="${n.y}" stroke="rgba(255,255,255,.3)" stroke-width="0.6"/>`);
    });
  });
  return `<svg class="map-edges" viewBox="0 0 100 100" preserveAspectRatio="none">${lines.join("")}</svg>`;
}

function nodeButtons(){
  return territories.map(t=>{
    const owned = t.owner==="player";
    const attackable = isAttackable(t);
    const sub = owned ? "확보한 구역" : t.trainerTitle;
    return `
      <button class="map-node ${owned?"owned":"wild"} ${attackable?"attackable":""}"
        style="left:${t.x}%; top:${t.y}%"
        data-node="${t.id}" ${attackable?"":"disabled"} title="${t.name} · ${sub}">
        <span class="map-node-dot"></span>
        <span class="map-node-label">${t.name}</span>
        ${!owned ? `<span class="map-node-sub">${t.trainerTitle}</span>` : ""}
      </button>`;
  }).join("");
}

export function renderMap(){
  const app = $("#app");
  const ownedCount = territories.filter(t=>t.owner==="player").length;
  const watchCount = roster.filter(m=> m.job==="watch_air" || m.job==="watch_dragon").length;
  const infiltrateCount = roster.filter(m=> m.job==="infiltrate_dark" || m.job==="infiltrate_ghost").length;
  app.innerHTML = `
    <div class="scene-nav"><button class="back-btn" id="backToBase">← 본거지로</button></div>
    <div class="map-scene">
      <div class="map-head">
        <span>타운맵 · 확보 ${ownedCount}/${territories.length}</span>
        <span class="map-head-sub">치안 ${watchCount}마리 · 침투 ${infiltrateCount}마리</span>
      </div>
      <div class="map-board">
        ${edgesSvg()}
        ${nodeButtons()}
      </div>
      <div class="map-legend">
        <span class="map-legend-item"><span class="map-legend-dot owned"></span>확보한 구역</span>
        <span class="map-legend-item"><span class="map-legend-dot wild"></span>트레이너가 지키는 구역</span>
      </div>
      ${mapMsg ? `<div class="basemsg-toast">${mapMsg}</div>` : ""}
    </div>`;

  $("#backToBase").onclick = ()=> renderBase();
  app.querySelectorAll("[data-node]:not([disabled])").forEach(b=> b.onclick = ()=>{
    const node = territories.find(t=>t.id===b.dataset.node);
    if(node) attackNode(node);
  });
}
