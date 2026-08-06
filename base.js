// ===== 본거지: 로스터 · 자원 · 직무 배정 · 턴 진행 =====
import { TYPE_COLORS, ART, $, types } from "./data.js";
import { newCase } from "./identify.js";

/* ---- 타입 → 직무 매핑 (노말은 항상 미스매치 없이 아무 직무나 수행) ---- */
export const JOB_BY_TYPE = {
  풀:"seed", 벌레:"till", 물:"fruit", 불꽃:"cook", 얼음:"chill", 땅:"flatten",
  격투:"train", 에스퍼:"research", 바위:"mine", 강철:"mint", 전기:"craft",
  비행:"watch_air", 드래곤:"watch_dragon", 악:"infiltrate_dark", 고스트:"infiltrate_ghost",
  페어리:"heal", 독:"cure"
};

const JOBS = {
  seed:             { label:"씨앗 생성",            produce:"seed" },
  till:             { label:"밭 일구기",            produce:null, note:"열매 생산량 증가" },
  fruit:            { label:"열매 생산",            produce:"fruit", consumeRes:"seed", consumePer:1 },
  cook:             { label:"요리",                produce:"food",  consumeRes:"fruit", consumePer:2 },
  chill:            { label:"냉장",                produce:null, note:"자원 저장 상한 증가" },
  flatten:          { label:"땅 평탄화",            produce:null, note:"직무 배정 인원 상한 증가" },
  train:            { label:"훈련",                produce:"tm" },
  research:         { label:"육성 연구",            produce:"candy" },
  mine:             { label:"재료 채취",            produce:"material" },
  mint:             { label:"재화 주조",            produce:"gold", consumeRes:"material", consumePer:1 },
  craft:            { label:"도구 제작",            produce:"tool", consumeRes:"material", consumePer:1 },
  watch_air:        { label:"치안(첩보 탐지)",       produce:null, stub:true },
  watch_dragon:     { label:"치안(시설 방해 탐지)",   produce:null, stub:true },
  infiltrate_dark:  { label:"침투(시설 방해)",       produce:null, stub:true },
  infiltrate_ghost: { label:"침투(첩보)",            produce:null, stub:true },
  heal:             { label:"치료(회복 아이템)",      produce:"healItem" },
  cure:             { label:"치료(상태이상 치료)",    produce:"cureItem" },
};
const JOB_BASE_AMT = { seed:3, fruit:2, cook:1, train:1, research:1, mine:3, mint:2, craft:1, heal:1, cure:1 };
const JOB_ORDER = ["seed","mine","train","research","heal","cure","flatten","chill","till",
                    "fruit","mint","craft","cook",
                    "watch_air","watch_dragon","infiltrate_dark","infiltrate_ghost"];
const RES_META = {
  seed:"씨앗", fruit:"열매", food:"음식", material:"재료", gold:"자금", tool:"도구",
  tm:"기술머신", candy:"경험치 사탕", healItem:"회복 아이템", cureItem:"치료 아이템"
};
const NATURAL_FAVOR_DECAY = 2;   // 턴마다 안 먹이면 자연 하락
const FEED_RESTORE = 15;         // 먹이 주기 1회 우호도 회복량
const CANDY_EXP = 20;            // 사탕 1개 경험치량
const FAVOR_CAP = 100;           // 우호도 절대 최대치
const FAVCEIL_GROWTH = 3;        // 레벨업 1회당 우호도 상한 증가폭 (FAVOR_CAP까지 성장)
const ENTRY_CAP = 6;             // 전투 엔트리 최대 등록 수
const INSTALL_JOB = "till";      // 설치 재료 없이 지금 바로 지을 수 있는 유일한 시설(밭) — 다른 시설은 재료 시스템 도입 전까지 비활성
const INSTALL_MIN_MEMBERS = 2;   // 밭 설치에 필요한 최소 인원(타입 무관)

export let roster = [];
export let resources = { seed:0, fruit:0, food:0, material:0, gold:0, tool:0,
                          tm:0, candy:0, healItem:0, cureItem:0 };
let plotCap = INSTALL_MIN_MEMBERS;  // 밭 설치에 필요한 최소 인원만큼은 시작부터 배정 가능해야 함
let storageCap = 50;
let turnCount = 0;
let lastLog = null;
let baseMsg = "";

/* ---- HUD 드롭다운/모달 상태 (재렌더 간 유지) ---- */
let openPanel = null;      // "bag" | "ball" | "pc" | "log" | "install" | null
let pcSelected = null;     // PC 모달에서 선택된 roster 인덱스
let installPicks = new Set();  // 설치 모달에서 다중 선택된 roster 인덱스(미배정 개체, 밭 설치용)

export function addToRoster(entry){
  entry.inEntry = false;
  roster.push(entry);
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

function assignJob(idx, jobId){
  const m = roster[idx];
  if(!m) return false;
  if(jobId && !m.job && assignedCount()>=plotCap){
    baseMsg = `직무 배정 인원 상한(${plotCap})을 초과했습니다. 땅 평탄화로 슬롯을 늘리세요.`;
    return false;
  }
  baseMsg = "";
  m.job = jobId || null;
  return true;
}

function toggleEntry(idx){
  const m = roster[idx];
  if(!m) return;
  if(!m.inEntry && entryCount()>=ENTRY_CAP){
    baseMsg = `전투 엔트리는 최대 ${ENTRY_CAP}마리까지 등록할 수 있습니다.`;
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
  resources.healItem--;
  m.favor = Math.min(m.favCeil, m.favor + FEED_RESTORE);
  m.fedThisTurn = true;
  renderBase();
}
function feedCandy(idx){
  const m = roster[idx];
  if(!m || resources.candy<=0) return;
  resources.candy--;
  m.exp += CANDY_EXP;
  while(m.exp >= m.level*20){
    m.exp -= m.level*20; m.level++;
    m.favCeil = Math.min(FAVOR_CAP, m.favCeil + FAVCEIL_GROWTH);
  }
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

  roster.forEach(m=>{
    if(m.fedThisTurn){ m.fedThisTurn = false; return; }
    m.favor = Math.max(m.favFloor, m.favor - NATURAL_FAVOR_DECAY);
  });

  turnCount++;
  lastLog = { gain, used, flattenCount, chillCount };
  openPanel = "log";
  renderBase();
}

/* 본거지 부지: 직무 배정 인원 상한(plotCap)만큼 칸을 그려 설치된 개체를 보여줌. 남는 칸은 빈 공터 */
function plotScene(){
  const filled = roster.filter(m=>m.job);
  const tiles = [];
  for(let i=0;i<plotCap;i++){
    const m = filled[i];
    if(m){
      const idx = roster.indexOf(m);
      const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
      tiles.push(`
        <div class="plot filled" data-plot-jump="${idx}" title="${m.pokemon.nameKr} · ${JOBS[m.job]?.label||""}">
          <img src="${sprite}" alt="${m.pokemon.nameKr}">
          <span class="plot-name">${m.pokemon.nameKr}</span>
          <span class="plot-job">${JOBS[m.job]?.label||""}</span>
        </div>`);
    }else{
      tiles.push(`
        <div class="plot empty" data-plot-install="1">
          <span class="plus">+</span>
          <span class="lot-label">빈 공터</span>
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
      <div class="rc-actions">
        <button data-feed="${i}" ${resources.healItem<=0?"disabled":""}>먹이 주기(+우호도)</button>
        <button data-candy="${i}" ${resources.candy<=0?"disabled":""}>사탕 먹이기(+경험치)</button>
        <button data-entry="${i}" class="${m.inEntry?"on":""}">${m.inEntry?"엔트리 해제":"엔트리 등록"}</button>
      </div>
    </div>
  `;
}

function renderTurnLogRows(){
  if(!lastLog) return `<div class="logempty">아직 진행한 턴이 없습니다.</div>`;
  const parts = [];
  Object.entries(lastLog.gain).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} +${v}`); });
  Object.entries(lastLog.used).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} -${v}`); });
  if(lastLog.flattenCount) parts.push(`직무 슬롯 +${lastLog.flattenCount} (합계 ${plotCap})`);
  if(lastLog.chillCount) parts.push(`저장 상한 +${lastLog.chillCount*10} (합계 ${storageCap})`);
  return parts.length
    ? `<div class="logline">${parts.join(" · ")}</div>`
    : `<div class="logempty">이번 턴은 산출이 없었습니다.</div>`;
}

/* ---- HUD: 턴 표시 + 몬스터볼(전투 엔트리) · PC(보유 포켓몬) · 자원 · 로그 아이콘 ---- */
function hudTop(){
  return `
    <div class="hud-top">
      <div class="hud-turn" data-hud="log">턴 <b>${turnCount}</b></div>
      <div class="hud-icons">
        <button class="hud-btn" data-action="hunt" title="사냥하러 나가기">
          <span class="hud-ico">🌲</span>
        </button>
        <button class="hud-btn ${openPanel==="bag"?"active":""}" data-hud="bag" title="자원 현황">
          <span class="hud-ico">🎒</span>
        </button>
        <button class="hud-btn ${openPanel==="ball"?"active":""}" data-hud="ball" title="전투 엔트리">
          <span class="hud-ico-ball"><span class="hb-top"></span><span class="hb-band"></span><span class="hb-btn"></span></span>
          <span class="hud-badge">${entryCount()}/${ENTRY_CAP}</span>
        </button>
        <button class="hud-btn ${openPanel==="pc"?"active":""}" data-hud="pc" title="보유 포켓몬">
          <span class="hud-ico">💻</span>
          <span class="hud-badge">${roster.length}</span>
        </button>
      </div>
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
      </div>
    </div>`;
}

function ballDropdown(){
  const entries = roster.filter(m=>m.inEntry);
  const slots = [];
  for(let i=0;i<ENTRY_CAP;i++){
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
      <div class="dd-head"><span>전투 엔트리 · ${entryCount()}/${ENTRY_CAP}</span><button class="dd-close" data-hud-close>✕</button></div>
      <div class="dd-body">
        <div class="entry-grid">${slots.join("")}</div>
        <div class="entry-list">${list}</div>
      </div>
    </div>`;
}

function logDropdown(){
  return `
    <div class="dd" data-panel="log">
      <div class="dd-head"><span>턴 로그 · 로스터 ${roster.length}마리 · 직무 배정 ${assignedCount()}/${plotCap}</span><button class="dd-close" data-hud-close>✕</button></div>
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

/* 빈 공터 클릭 시: 설치 재료 없이 지을 수 있는 시설(밭)만 우선 개방 — 밭은 2마리 이상(타입 무관) 다중 배정해야 설치됨 */
function installModal(){
  const unassigned = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job);
  const validPicks = [...installPicks].filter(i=> roster[i] && !roster[i].job);
  if(validPicks.length !== installPicks.size) installPicks = new Set(validPicks);
  const remain = Math.max(0, plotCap - assignedCount());
  const grid = unassigned.map(({m,i})=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${installPicks.has(i)?"selected":""}" data-install-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("");
  const enough = installPicks.size >= INSTALL_MIN_MEMBERS;
  return `
    <div class="modal-overlay" data-modal="install">
      <div class="modal-box">
        <div class="modal-head"><span>부지에 설치 · 배정 가능 ${remain}칸</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          <div class="install-note">설치 재료 없이 지금 지을 수 있는 시설은 <b>${JOBS[INSTALL_JOB].label}</b>뿐입니다.
            타입 무관하게 ${INSTALL_MIN_MEMBERS}마리 이상을 함께 배정해야 설치됩니다.</div>
          ${unassigned.length
            ? `<div class="pc-grid">${grid}</div>`
            : `<div class="logempty">배정할 수 있는 개체가 없습니다. 모든 개체가 이미 직무를 수행 중입니다.</div>`}
          <button class="btn wide install-confirm" data-install-confirm ${enough?"":"disabled"}>
            ${JOBS[INSTALL_JOB].label} 설치 (${installPicks.size}/${INSTALL_MIN_MEMBERS}+ 선택됨)
          </button>
        </div>
      </div>
    </div>`;
}

export function renderBase(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  app.innerHTML = `
    <div class="base-scene">
      ${hudTop()}
      <div class="plot-grid">${plotScene()}</div>
      <button class="btn hud-nextturn" id="nextTurn">다음 턴 →</button>
      ${baseMsg ? `<div class="basemsg-toast">${baseMsg}</div>` : ""}

      ${openPanel==="bag" ? bagDropdown() : ""}
      ${openPanel==="ball" ? ballDropdown() : ""}
      ${openPanel==="log" ? logDropdown() : ""}
    </div>

    ${openPanel==="pc" ? pcModal() : ""}
    ${openPanel==="install" ? installModal() : ""}
  `;

  app.querySelectorAll("[data-plot-jump]").forEach(el=> el.onclick = ()=>{
    pcSelected = +el.dataset.plotJump;
    openPanel = "pc";
    renderBase();
  });
  app.querySelectorAll("[data-plot-install]").forEach(el=> el.onclick = ()=>{
    installPicks = new Set();
    openPanel = "install";
    renderBase();
  });
  app.querySelectorAll("[data-install-pick]").forEach(el=> el.onclick = ()=>{
    const idx = +el.dataset.installPick;
    if(installPicks.has(idx)) installPicks.delete(idx); else installPicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-install-confirm]")?.addEventListener("click", ()=>{
    const picks = [...installPicks];
    if(picks.length < INSTALL_MIN_MEMBERS) return;
    if(assignedCount() + picks.length > plotCap){
      baseMsg = `직무 배정 인원 상한(${plotCap})을 초과했습니다. 땅 평탄화로 슬롯을 늘리세요.`;
      renderBase();
      return;
    }
    picks.forEach(idx=> assignJob(idx, INSTALL_JOB));
    installPicks = new Set();
    openPanel = null;
    renderBase();
  });
  app.querySelectorAll("[data-unassign]").forEach(b=> b.onclick = ()=>{
    assignJob(+b.dataset.unassign, null);
    renderBase();
  });
  app.querySelectorAll("[data-feed]").forEach(b=> b.onclick = ()=> feedHeal(+b.dataset.feed));
  app.querySelectorAll("[data-candy]").forEach(b=> b.onclick = ()=> feedCandy(+b.dataset.candy));
  app.querySelectorAll("[data-entry]").forEach(b=> b.onclick = ()=> toggleEntry(+b.dataset.entry));
  app.querySelectorAll("[data-pc-pick]").forEach(el=> el.onclick = ()=>{ pcSelected = +el.dataset.pcPick; renderBase(); });
  $("#nextTurn").onclick = resolveTurn;

  app.querySelectorAll("[data-hud]").forEach(b=> b.onclick = ()=>{
    const name = b.dataset.hud;
    openPanel = (openPanel===name) ? null : name;
    renderBase();
  });
  app.querySelector('[data-action="hunt"]')?.addEventListener("click", ()=> newCase());
  app.querySelectorAll("[data-hud-close]").forEach(b=> b.onclick = ()=>{ openPanel = null; installPicks = new Set(); renderBase(); });
  app.querySelector('[data-modal="pc"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="pc"){ openPanel = null; renderBase(); }
  });
  app.querySelector('[data-modal="install"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="install"){ openPanel = null; installPicks = new Set(); renderBase(); }
  });
}
