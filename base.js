// ===== 본거지: 로스터 · 자원 · 직무 배정 · 턴 진행 =====
import { TYPE_COLORS, ART, $, types, tabBar } from "./data.js";
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

export let roster = [];
export let resources = { seed:0, fruit:0, food:0, material:0, gold:0, tool:0,
                          tm:0, candy:0, healItem:0, cureItem:0 };
let plotCap = 1;
let storageCap = 50;
let turnCount = 0;
let lastLog = null;
let baseMsg = "";

export function addToRoster(entry){
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

function assignJob(idx, jobId){
  const m = roster[idx];
  if(!m) return;
  if(jobId && !m.job && assignedCount()>=plotCap){
    baseMsg = `직무 배정 인원 상한(${plotCap})을 초과했습니다. 땅 평탄화로 슬롯을 늘리세요.`;
    renderBase();
    return;
  }
  baseMsg = "";
  m.job = jobId || null;
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
        <div class="plot empty">
          <span class="plus">+</span>
          <span class="lot-label">빈 공터</span>
        </div>`);
    }
  }
  return tiles.join("");
}

function rosterCard(m, i){
  const ts = types(m.pokemon);
  const pct = m.favCeil>0 ? Math.round((m.favor/m.favCeil)*100) : 0;
  const jobOptions = Object.entries(JOBS).map(([id,job])=>{
    const match = isMatch(m, id);
    return `<option value="${id}" ${m.job===id?"selected":""}>${job.label}${match?"":" (미스매치)"}</option>`;
  }).join("");
  return `
    <div class="roster-card" id="roster-${i}">
      <div class="rc-head">
        <span class="rc-name">${m.pokemon.nameKr}</span>
        <span class="rc-lv">Lv.${m.level}</span>
      </div>
      <div class="rc-types">${ts.map(t=>`<span class="chip" style="background:${TYPE_COLORS[t]||"#666"}">${t}</span>`).join("")}</div>
      <div class="rc-fav">
        <div class="rc-favbar"><div class="rc-favfill" style="width:${pct}%"></div></div>
        <span class="rc-favtxt">우호도 ${Math.round(m.favor)}/${m.favCeil}</span>
      </div>
      <div class="rc-fav">
        <div class="rc-favbar"><div class="rc-favfill apt" style="width:${m.aptitude}%"></div></div>
        <span class="rc-favtxt">특수능력 ${m.aptitude}/100</span>
      </div>
      <div class="rc-job">
        <label>직무</label>
        <select data-job="${i}">
          <option value="">미배정</option>
          ${jobOptions}
        </select>
      </div>
      <div class="rc-actions">
        <button data-feed="${i}" ${resources.healItem<=0?"disabled":""}>먹이 주기(+우호도)</button>
        <button data-candy="${i}" ${resources.candy<=0?"disabled":""}>사탕 먹이기(+경험치)</button>
      </div>
    </div>
  `;
}

function renderTurnLog(){
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

export function renderBase(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  app.innerHTML = `
    ${tabBar("base")}
    <section class="case">
      <div class="eyebrow">본거지</div>
      <div class="coderow"><div class="codename" style="font-size:20px">내정</div></div>
      <div class="caseno">턴 <b>${turnCount}</b> · 로스터 <b>${roster.length}</b>마리 · 직무 배정 <b>${assignedCount()}/${plotCap}</b></div>
    </section>

    <div class="base-scene">
      <div class="base-scene-label">본거지 부지 · ${assignedCount()}/${plotCap}</div>
      <div class="plot-grid">${plotScene()}</div>
    </div>

    <div class="block">
      <div class="bh">자원 현황 <span style="float:right; font-weight:400">저장 상한 ${storageCap}</span></div>
      <div class="res-grid">
        ${Object.entries(RES_META).map(([k,label])=>`
          <div class="res-item"><span class="res-label">${label}</span><span class="res-val">${resources[k]}</span></div>
        `).join("")}
      </div>
    </div>

    <div class="block">
      <div class="bh">로스터</div>
      <div class="rows">
        ${roster.length ? roster.map((m,i)=> rosterCard(m,i)).join("") : `<div class="logempty">아직 포획한 개체가 없습니다. "개체 조사" 탭에서 포획해보세요.</div>`}
      </div>
    </div>

    ${baseMsg ? `<div class="basemsg">${baseMsg}</div>` : ""}

    <button class="btn confirm wide" id="nextTurn">다음 턴 →</button>

    <div class="block log">
      <div class="bh">턴 로그</div>
      <div class="rows">${renderTurnLog()}</div>
    </div>
  `;

  app.querySelectorAll("[data-plot-jump]").forEach(el=> el.onclick = ()=>{
    const card = app.querySelector(`#roster-${el.dataset.plotJump}`);
    if(!card) return;
    card.scrollIntoView({behavior:"smooth", block:"center"});
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
  });
  app.querySelectorAll("[data-job]").forEach(sel=>
    sel.addEventListener("change", ()=> assignJob(+sel.dataset.job, sel.value)));
  app.querySelectorAll("[data-feed]").forEach(b=> b.onclick = ()=> feedHeal(+b.dataset.feed));
  app.querySelectorAll("[data-candy]").forEach(b=> b.onclick = ()=> feedCandy(+b.dataset.candy));
  $("#nextTurn").onclick = resolveTurn;

  app.querySelector('[data-tab="identify"]')?.addEventListener("click", ()=> newCase());
  app.querySelector('[data-tab="base"]')?.addEventListener("click", ()=> renderBase());
}
