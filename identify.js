// ===== 개체 식별 터미널 : 후보 선택 → 단서 조회 → 포획 =====
import { TYPE_COLORS, STAT_LABEL, ART, $, rnd, POKE, MOVE, ABILITY, types } from "./data.js";
import { addToRoster, renderBase } from "./base.js";

let answer=null, alias="", solved=0, seen=0, cluesUsed=0, attempts=0, paletteCache=null;
let candidates=[];
let favor=0, favCeil=0, favFloor=0, iv={};
let knownType=null, otherType=null, secondTypeExistsKnown=false, secondTypeValueKnown=false;
const CAND_N = 3;
const HINT_DECAY = 8;     // 단서 조회 1회당 우호도 하락폭
const WRONG_DECAY = 20;   // 오답 1회당 우호도 하락폭
const spent = new Set();

/* ---- 스타팅 드래프트: 9마리(3종×3라운드) 중 3마리를 골라 본거지로 진입 ---- */
const START_ROUNDS = 3;
let startRoundIdx = 0;             // 0,1,2 진행 중, 3이면 드래프트 종료
const startSeenIds = new Set();    // 드래프트 동안 이미 등장한 종(중복 방지)
function drafting(){ return startRoundIdx < START_ROUNDS; }

/* ---- 정체불명 실루엣: 정답 형상이 아닌 알(egg) 모양 — 스캔 전까지는 무슨 개체인지 전혀 티가 안 나야 함
   (스타팅 드래프트에서는 안 씀 — 그건 골라서 바로 데려가는 거라 진짜 실루엣을 보여줌) ---- */
const EGG_PATH = "M32,3 C20,3 12,20 12,36 C12,52 20,61 32,61 C44,61 52,52 52,36 C52,20 44,3 32,3 Z";
function eggSvg(w, h, color, extraClass=""){
  return `<svg class="enc-silhouette ${extraClass}" width="${w}" height="${h}" viewBox="0 0 64 64" fill="${color}"><path d="${EGG_PATH}"/></svg>`;
}

/* ---- 조우 스폰 위치: 숲 이곳저곳에 흩어 놓은 고정 좌표 풀. newCase()에서 후보마다 하나씩 배정되면
   그 인카운터가 끝날 때까지 절대 바뀌지 않는다(드래프트/야생 조우 공통).
   가장자리·우하단 SCAN DATA 패널과 안 겹치도록 20~84%/32~64% 안쪽으로 safe margin을 둠 ---- */
const HIDE_SPOTS = [
  {left:"20%", top:"58%", scale:1.05}, {left:"34%", top:"32%", scale:.85},
  {left:"50%", top:"62%", scale:1},    {left:"64%", top:"36%", scale:.9},
  {left:"76%", top:"56%", scale:1.1},  {left:"84%", top:"34%", scale:.8},
];
function pickHideSpots(n){
  const pool = [...HIDE_SPOTS];
  const picked = [];
  for(let i=0;i<n && pool.length;i++) picked.push(pool.splice(rnd(0,pool.length-1),1)[0]);
  return picked;
}

/* ---- 본거지로 돌아가기: 탭 대신 화면 상단의 단일 버튼 하나로만 이동(스타팅 드래프트 중엔 돌아갈 본거지가 없어 숨김) ---- */
function backButtonHtml(){
  return `<div class="scene-nav"><button class="back-btn" id="backToBase">← 본거지로</button></div>`;
}
function wireBackButton(){
  $("#backToBase")?.addEventListener("click", ()=> renderBase());
}
/* ---- 스타팅 드래프트용: 정답 아트워크 그대로의 실루엣(누구인지 형태는 보이되 이름/타입/수치는 스캔해야 나옴) ---- */
function realSilhouetteImg(pokemon, h=70, maxW=92){
  const fallback = pokemon.details?.sprites?.front_default || "";
  return `<img class="enc-silhouette" src="${ART(pokemon.pokemonRowid)}" data-fallback="${fallback}"
    style="height:${h}px;width:auto;max-width:${maxW}px;object-fit:contain" alt="">`;
}

/* ---- 가명 생성: ~~몬 (정답 누출 방지) ---- */
const SYL = ["가","라","보","슈","크","펜","다","조","리","무","포","케","드","비","우","토","네","하","쿠","미","젠","롯","퀴","벨","단"];
function makeAlias(existing=[]){
  let a;
  do{ const n = Math.random()<0.5?3:4;
      a = Array.from({length:n},()=>SYL[rnd(0,SYL.length-1)]).join("");
  }while(POKE.some(p=>p.nameKr===a) || existing.includes(a));
  return a;
}

function highestStat(p, ivObj={}){
  const s={hp:p.hp+(ivObj.hp||0), atk:p.atk+(ivObj.atk||0), def:p.def+(ivObj.def||0),
           satk:p.satk+(ivObj.satk||0), sdef:p.sdef+(ivObj.sdef||0), spd:p.spd+(ivObj.spd||0)};
  const max=Math.max(...Object.values(s));
  return Object.keys(s).filter(k=>s[k]===max).map(k=>STAT_LABEL[k]);
}

/* ---- 우호도: 개체별 상한/하한을 랜덤으로 굴려서 부여 (전설/환상은 상한이 낮음) ---- */
export function rollFavor(p){
  const rare = p.details?.isLegendary || p.details?.isMythical;
  const ceil = rare ? rnd(30,55) : rnd(70,95);
  const floor = Math.min(rnd(10,30), ceil-5);
  return { ceil, floor };
}
/* ---- 개체값: 종족값에 -15~+15 랜덤 보정 (원작 0~31 개념을 0 기준 대칭으로 절반 축소) ---- */
export function rollIV(){
  const keys=["hp","atk","def","satk","sdef","spd"];
  const out={};
  keys.forEach(k=> out[k]=rnd(-15,15));
  return out;
}
/* ---- 특수능력: 0~100 랜덤 — 본거지 직무 산출량으로 환산되는 개체별 재능치 ---- */
export function rollAptitude(){ return rnd(0,100); }
/* ---- 새 라운드: 후보 3종 제시 후 선택 (드래프트 중엔 이미 나온 종 제외).
   각 후보의 숲 속 스폰 위치(spot)는 여기서 딱 한 번만 정해지고, 이후 선택/hover가 바뀌어도
   절대 움직이지 않는다 — 위치는 고정, 강조는 오직 시각 효과(스케일/투명도/링)로만 표현 ---- */
export function newCase(){
  const pool = drafting() ? POKE.filter(p=>!startSeenIds.has(p.pokemonRowid)) : [...POKE];
  const aliases = [];
  const n = Math.min(CAND_N, pool.length);
  const spots = pickHideSpots(n);
  candidates = Array.from({length:n},(_,idx)=>{
    const p = pool.splice(rnd(0,pool.length-1),1)[0];
    if(drafting()) startSeenIds.add(p.pokemonRowid);
    const a = makeAlias(aliases); aliases.push(a);
    const t = types(p);
    const f = rollFavor(p);
    return { pokemon:p, alias:a, shownType:t[rnd(0,t.length-1)], favCeil:f.ceil, favFloor:f.floor, iv:rollIV(),
              spot:spots[idx] };
  });
  renderSelect();
}

/* 선택된(포커스된) 개체 뒤에만 얹히는 스캐너 링 — 바깥쪽 점선 원 + 안쪽 얇은 원이 서로 다른 속도로 회전하고,
   네 방향엔 회전하지 않는 짧은 target bracket을 고정 배치. 세로 스캔라인이 위아래로 훑음.
   포켓몬 실루엣보다 튀지 않도록 얇고 옅게 유지 */
function scannerRingHtml(){
  return `
    <span class="enc-selected-ring">
      <svg class="ring-svg" viewBox="0 0 200 200">
        <circle class="ring ring-outer" cx="100" cy="100" r="92"/>
        <circle class="ring ring-inner" cx="100" cy="100" r="70"/>
      </svg>
      <span class="ring-bracket top"></span><span class="ring-bracket right"></span>
      <span class="ring-bracket bottom"></span><span class="ring-bracket left"></span>
      <span class="ring-scanline"></span>
    </span>`;
}

/* 실루엣과 그 뒤 장식(스캐너 링/감지 링/바닥 글로우)을 한 세트로 반환 — 메인 씬과 우측 패널 미니뷰에서 재사용 */
function monVisual(c, draft, size){
  const sil = draft ? realSilhouetteImg(c.pokemon, size, size*1.3) : eggSvg(size*0.9, size, "#0a0a0a");
  return sil;
}

/* 숲 속에서 후보 3마리를 동시에 마주치는 단일 조우 장면. 각 개체는 newCase()에서 정해진 고유 스폰
   위치(c.spot)에 절대 고정되며, hover/클릭이 바뀌어도 절대 움직이지 않는다 — 포켓몬은 숲 속 제자리에
   그대로 있고, 플레이어의 스캐너가 그 자리를 겨눠 강조하는 구조. 강조는 오직 그 자리에서의 시각 효과
   (스케일/투명도/스캐너 링)로만 표현된다.
   2단계 스캐너 UX: (1) 작은 scanner cursor가 마우스를 따라다니며 "탐색 중"을 표현하고,
   (2) 포켓몬 위에 hover하면 그 포켓몬의 고정된 자리에서 큰 LOCK-ON 링이 fade-in되는 방식으로 "분석 중"을
   표현한다 — 큰 링 자체는 절대 마우스를 따라다니지 않는다. hover=스캔(정보만 미리보기), click=데려가기.
   숲 배경이 화면 끝까지 이어지는 단일 무대이고, SCAN DATA는 그 위에 뜬 작은 휴대 장치 패널(우하단
   플로팅)일 뿐 별도 사이드바가 아니다 */
function renderSelect(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  const draft = drafting();
  app.innerHTML = `
    ${draft ? "" : backButtonHtml()}
    <div class="encounter-scene" id="encScene">
      <div class="enc-ground-light"></div>
      <div class="encounter-mons">
        ${candidates.map((c,i)=>`
          <button class="enc-mon${types(c.pokemon).includes("비행")?" is-flying":""}" data-idx="${i}"
            style="left:${c.spot.left}; top:${c.spot.top}; --hide-scale:${c.spot.scale}">
            <span class="enc-silhouette-wrap">
              ${scannerRingHtml()}
              <span class="enc-contact-shadow"></span>
              ${monVisual(c, draft, 70)}
            </span>
          </button>
        `).join("")}
      </div>
      <span class="scan-mini-cursor" id="miniCursor">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="13"/>
          <line x1="20" y1="2" x2="20" y2="8"/>
          <line x1="20" y1="32" x2="20" y2="38"/>
          <line x1="2" y1="20" x2="8" y2="20"/>
          <line x1="32" y1="20" x2="38" y2="20"/>
          <circle class="mc-dot" cx="20" cy="20" r="1.6"/>
        </svg>
      </span>
      <div class="scan-panel" id="scanPanel"></div>
    </div>
  `;
  wireSilhouetteFallback(app);
  wireEncounterScanner(draft);
  wireBackButton();
}

/* 실루엣 이미지 로드 실패 시 스프라이트로 대체(드래프트 중 정답 아트워크에만 해당) */
function wireSilhouetteFallback(root){
  root.querySelectorAll("img.enc-silhouette").forEach(img=>{
    img.onerror = ()=>{
      if(img.dataset.fb) return;
      img.dataset.fb = 1;
      if(img.dataset.fallback) img.src = img.dataset.fallback;
    };
  });
}

/* 스타팅 드래프트 선택: 식별 없이 즉시 로스터에 합류(실패/도주 없음) 후 다음 후보 또는 본거지로 */
function draftPick(cand){
  addToRoster({ pokemon:cand.pokemon, alias:cand.alias, level:1, exp:0,
    favor:cand.favCeil, favCeil:cand.favCeil, favFloor:cand.favFloor, iv:cand.iv,
    aptitude:rollAptitude(), job:null });
  if(++startRoundIdx >= START_ROUNDS){ renderBase(); }
  else{ newCase(); }
}

/* 개체 위에 마우스를 올리면(hover) 그 자리에서 스캔됨 — 위치는 절대 바꾸지 않고, 그 자리에서만
   확대+LOCK-ON 링이 붙고 불투명해짐. 나머지는 제자리에서 반투명해질 뿐 위치·순서 변경 없음
   (과거엔 hover로 선택을 다른 좌표로 옮기다가 마우스 아래 요소가 계속 바뀌는 무한 순환 버그가
   있었음 — 좌표는 절대 건드리지 않으므로 이 문제는 원천적으로 발생하지 않는다).
   우하단 플로팅 SCAN DATA 패널에 정보가 미리보기로 뜨고, 그 개체를 클릭하면 곧바로 데려간다
   (별도 확정 버튼 없음 — hover=탐색/스캔, click=데려가기라는 상호작용 자체로 의미 전달) */
function wireEncounterScanner(draft){
  const app = $("#app");
  const mons = [...app.querySelectorAll(".enc-mon")];
  const panel = app.querySelector("#scanPanel");
  const cursor = app.querySelector("#miniCursor");
  const scene = app.querySelector("#encScene");
  if(!mons.length || !panel) return;

  function focusIdx(i){
    mons.forEach((m,j)=> m.classList.toggle("is-selected", j===i));
    cursor?.classList.add("suppressed"); // LOCK-ON 중엔 작은 탐색 커서를 거의 숨겨 링이 주된 표현이 되게 함
    const c = candidates[i];
    panel.innerHTML = `
      <span class="sp-frame-bracket tr"></span><span class="sp-frame-bracket bl"></span>
      <div class="sp-inner">
        <div class="sp-eyebrow"><span>SCAN DATA</span><span class="sp-ticks"></span></div>
        <div class="sp-body">
          <div class="sp-mini">
            <svg class="sp-mini-ring" viewBox="0 0 100 100">
              <circle class="mr-outer" cx="50" cy="50" r="46"/>
              <circle class="mr-inner" cx="50" cy="50" r="36"/>
            </svg>
            <span class="mini-bracket t"></span><span class="mini-bracket r"></span>
            <span class="mini-bracket b"></span><span class="mini-bracket l"></span>
            <span class="sp-mini-sil">${monVisual(c, draft, 41)}</span>
          </div>
          <div class="sp-text">
            <div class="sp-name">${c.alias}</div>
            <div class="sp-row">
              <span class="sp-pill" style="background:${TYPE_COLORS[c.shownType]||'#666'}">${c.shownType}</span>
              <span class="sp-stats">${c.pokemon.heightM ?? "?"}m · ${c.pokemon.weightKg ?? "?"}kg</span>
            </div>
          </div>
        </div>
      </div>
    `;
    panel.classList.add("show");
    wireSilhouetteFallback(panel);
  }
  function blurAll(){
    mons.forEach(m=> m.classList.remove("is-selected"));
    panel.classList.remove("show");
    cursor?.classList.remove("suppressed");
  }

  mons.forEach((b,i)=>{
    b.addEventListener("mouseenter", ()=> focusIdx(i));
    b.addEventListener("mouseleave", blurAll);
    b.onclick = ()=>{
      const cand = candidates[i];
      draft ? draftPick(cand) : enterCase(cand);
    };
  });

  // 작은 scanner cursor: 씬 안에서 마우스를 부드럽게 따라다니는 탐색 표시(포켓몬 LOCK-ON과는 별개).
  // 포켓몬을 스캔 중일 땐(.suppressed) 거의 숨겨서 LOCK-ON 링이 주된 표현이 되게 함
  if(cursor && scene){
    scene.addEventListener("mousemove", e=>{
      const r = scene.getBoundingClientRect();
      cursor.style.left = (e.clientX - r.left) + "px";
      cursor.style.top = (e.clientY - r.top) + "px";
      cursor.style.opacity = cursor.classList.contains("suppressed") ? .12 : 1;
    });
    scene.addEventListener("mouseleave", ()=>{ cursor.style.opacity = 0; });
  }
}

function enterCase(cand){
  answer = cand.pokemon;
  alias = cand.alias;
  favCeil = cand.favCeil; favFloor = cand.favFloor; favor = favCeil;
  iv = cand.iv;
  knownType = cand.shownType;
  otherType = types(answer).find(x=>x!==knownType) || null;
  secondTypeExistsKnown = false; secondTypeValueKnown = false;
  cluesUsed=0; attempts=0; spent.clear(); paletteCache=null; seen++;
  render();
}

/* 타입 표시: 후보 선정 때 이미 본 타입 1개만 상시 공개, 두 번째 타입은 상담으로 밝혀지기 전까지 비공개 */
function typeRowHtml(){
  const chips = [`<span class="chip" style="background:${TYPE_COLORS[knownType]||"#666"}">${knownType}</span>`];
  if(secondTypeExistsKnown && otherType){
    chips.push(secondTypeValueKnown
      ? `<span class="chip" style="background:${TYPE_COLORS[otherType]||"#666"}">${otherType}</span>`
      : `<span class="chip redact-chip">?</span>`);
  }
  return chips.join("");
}

/* 스캐너 화면: 숲에서 만난 개체에 스캐너를 가져다 댄 것 — 정보/조작을 전부 스캐너 화면 하나 안에 오버레이로 표시 (별도 박스 나열 없음) */
function render(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  app.innerHTML = `
    ${drafting() ? "" : backButtonHtml()}
    <div class="scanner">
      <div class="scn-view" id="viewport">
        <div class="scn-scanline"></div>
        <div class="scn-bracket tl"></div><div class="scn-bracket tr"></div>
        <div class="scn-bracket bl"></div><div class="scn-bracket br"></div>
        <div class="enc-glow vp-glow" style="background:${TYPE_COLORS[knownType]||'#888'}"></div>
        ${eggSvg(88,96,"#0a0a0a","vp-silhouette")}
        <div class="scn-namebar">
          <span class="scn-name">${alias}</span>
          <span class="scn-stamp">신원 미상</span>
        </div>
        <div class="scn-readout tl" id="typeRow">${typeRowHtml()}</div>
        <div class="scn-readout tr">${answer.heightM ?? "?"}m · ${answer.weightKg ?? "?"}kg</div>
        <div class="scn-status" id="statusReadout">단서 0 · 오답 0</div>
        <div class="vp-tag">관찰 중</div>
      </div>

      <div class="scn-controls actions">
        <button class="scn-btn wide" data-clue="consult">박사와 상담하기<span class="sub">능력치·기술·특성 무작위 · 반복 가능</span></button>
        <div class="scn-grouplab">직접 관찰하기</div>
        <button class="scn-btn" data-clue="color">멀리서 지켜봤다<span class="sub">색상 추출 · 1회</span></button>
        <button class="scn-btn" data-clue="patch">정밀하게 지켜봤다<span class="sub">표본 확대 · 반복</span></button>
        <button class="scn-btn accent wide" data-clue="silhouette">본인확인서 대조<span class="sub">외곽 실루엣 · 최종 단서</span></button>
      </div>

      <div class="scn-log" id="log"><div class="logempty">아직 조회한 단서가 없습니다.</div></div>

      <div class="scn-dock">
        <input id="guessInput" placeholder="포켓몬 이름 입력" autocomplete="off">
        <button class="scn-id" id="guessBtn">식별</button>
      </div>
      <div class="verdict" id="verdict"></div>
      <button class="textlink" id="giveup">식별 포기 — 정답 공개</button>
    </div>
  `;

  app.querySelectorAll("[data-clue]").forEach(b=> b.onclick=()=>useClue(b.dataset.clue,b));
  $("#guessBtn").onclick = submitGuess;
  $("#guessInput").addEventListener("keydown",e=>{ if(e.key==="Enter") submitGuess(); });
  $("#giveup").onclick = ()=>finish("giveup");
  wireBackButton();
}

/* ---- 단서 사용 ---- */
function log(tag, html){
  const box = $("#log");
  const empty = box.querySelector(".logempty"); if(empty) empty.remove();
  const el = document.createElement("div");
  el.className="logline"; el.innerHTML = `<span class="tag">${tag}</span>${html}`;
  box.appendChild(el);
  return el;
}
function bumpFoot(){
  const s = $("#statusReadout"); if(!s) return;
  s.textContent = `단서 ${cluesUsed} · 오답 ${attempts}`;
}
function useClue(kind, btn){
  const repeatable = kind==="consult" || kind==="patch";   // 상담·정밀 관찰은 반복 가능
  if(!repeatable && spent.has(kind)) return;
  cluesUsed++;
  favor = Math.max(favFloor, favor - HINT_DECAY);
  if(kind==="consult"){
    consultProfessor();
  }
  else if(kind==="color"){
    spent.add(kind); btn.disabled=true;
    consultColor();
  }
  else if(kind==="patch"){
    showPatch();
    log("관찰", `표면 표본을 확대 추출했습니다. <span style="color:var(--mut)">(뷰포트 확인)</span>`);
  }
  else if(kind==="silhouette"){
    spent.add(kind); btn.disabled=true;
    showSilhouette();
    log("대조", `외곽 실루엣을 뷰포트에 투영했습니다.`);
  }
  bumpFoot();
}

/* 박사와 상담: 매번 능력치·기술·특성 중 하나를 가중 랜덤으로 공개 (특성이 가장 희귀, 능력치는 1회 한정) */
function pickWeighted(items){
  const total = items.reduce((s,it)=>s+it.w,0);
  let r = Math.random()*total;
  for(const it of items){ if((r-=it.w)<0) return it.type; }
  return items[items.length-1].type;
}
function consultProfessor(){
  const pool = [];
  if(!spent.has("stat")) pool.push({type:"stat",w:3});
  if((answer.details?.moveRowids||[]).length) pool.push({type:"move",w:3});
  if(!spent.has("ability") && (answer.details?.abilityRowids||[]).length) pool.push({type:"ability",w:1});   // 가장 낮은 확률
  const type2Pending = !secondTypeExistsKnown || (otherType && !secondTypeValueKnown);
  if(type2Pending) pool.push({type:"type2",w:3});
  if(!pool.length){
    log("상담", `<span style="color:var(--mut)">더 이상 새로운 정보가 없습니다.</span>`);
    return;
  }
  const kind = pickWeighted(pool);
  if(kind==="stat"){
    spent.add("stat");
    log("상담", `<b>능력치</b> · 이 개체는 <em>${highestStat(answer, iv).join(" · ")}</em> 계열이 두드러집니다. <span style="color:var(--mut)">(수치 비공개)</span>`);
  }
  else if(kind==="move"){
    const ids = answer.details.moveRowids;
    const name = MOVE[ids[rnd(0,ids.length-1)]] || "알 수 없는 기술";
    log("상담", `<b>기술</b> · 배울 수 있는 기술 중 하나는 <em>${name}</em>입니다.`);
  }
  else if(kind==="type2"){
    if(!secondTypeExistsKnown){
      secondTypeExistsKnown = true;
      if(otherType){
        log("상담", `<b>타입</b> · 이 개체는 <em>두 번째 타입이 존재</em>합니다. <span style="color:var(--mut)">(어떤 타입인지는 비공개)</span>`);
      }else{
        secondTypeValueKnown = true;   // 단일 타입 확정 — 더 밝혀낼 게 없음
        log("상담", `<b>타입</b> · 이 개체는 <em>단일 타입</em>입니다. 두 번째 타입이 없습니다.`);
      }
    }else{
      secondTypeValueKnown = true;
      log("상담", `<b>타입</b> · 두 번째 타입은 <em>${otherType}</em>입니다.`);
    }
    const tr = $("#typeRow"); if(tr) tr.innerHTML = typeRowHtml();
  }
  else{ // ability
    spent.add("ability");
    const ids = answer.details.abilityRowids;
    const name = ABILITY[ids[rnd(0,ids.length-1)]] || "알 수 없는 특성";
    log("상담", `<b>특성</b> · 특성 후보 중 하나는 <em>${name}</em>입니다. <span style="color:var(--mut)">(희귀 단서)</span>`);
  }
}

/* 멀리서 지켜봤다: 대표 색상 추출 (이번 개체 1회) */
function consultColor(){
  const el = log("관찰", `<b>색상</b> · 대표 색상 추출 중…`);
  (paletteCache ? Promise.resolve(paletteCache) : extractPalette(answer)).then(colors=>{
    if(colors) paletteCache = colors;
    el.innerHTML = colors && colors.length
      ? `<span class="tag">관찰</span><b>색상</b> · 대표 색상 팔레트: ${colors.map(c=>`<span class="swatch" style="background:${c}"></span>`).join("")}`
      : `<span class="tag">관찰</span><b>색상</b> · <span style="color:var(--mut)">색상 추출 실패 — 인터넷 연결을 확인하세요.</span>`;
  });
}

/* 표본 스캔: 공식 아트워크에서 작은 조각을 확대 (픽셀 read 없음 → CORS 무관) */
function showPatch(){
  const vp = $("#viewport");
  const img = new Image();
  img.onload = ()=>{
    const cv = document.createElement("canvas"); cv.width=140; cv.height=140;
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled=false;
    const w=img.naturalWidth||475, h=img.naturalHeight||475;
    const box = Math.max(6, Math.round(w*0.03));            // ~5px 원본 조각
    const sx = rnd(Math.round(w*0.30), Math.round(w*0.70)-box);  // 중앙부(피사체) 안에서
    const sy = rnd(Math.round(h*0.28), Math.round(h*0.72)-box);
    ctx.drawImage(img, sx,sy,box,box, 0,0,140,140);
    vp.querySelector(".vp-silhouette")?.remove(); vp.querySelector(".vp-glow")?.remove();
    vp.querySelector("img")?.remove();
    let old=vp.querySelector("canvas"); if(old) old.remove();
    vp.appendChild(cv);
    setTag(vp,"표면 확대");
  };
  img.onerror = ()=> log("관찰", `<span style="color:var(--bad)">표본 이미지를 불러오지 못했습니다.</span>`);
  img.src = ART(answer.pokemonRowid);
}
function showSilhouette(){
  const vp = $("#viewport");
  const img = new Image();
  img.className="silhouette";
  img.onload = ()=>{
    vp.querySelector(".vp-silhouette")?.remove(); vp.querySelector(".vp-glow")?.remove();
    vp.querySelector("canvas")?.remove();
    vp.querySelector("img")?.remove();
    vp.appendChild(img);
    setTag(vp,"실루엣 대조");
  };
  img.onerror = ()=>{ // 아트워크 없으면 기본 스프라이트로 폴백
    if(img.dataset.fb) return;
    img.dataset.fb=1; img.src = answer.details?.sprites?.front_default || "";
  };
  img.src = ART(answer.pokemonRowid);
}
function setTag(vp,txt){ const t=vp.querySelector(".vp-tag"); if(t) t.textContent=txt; }

/* 색상 조회: 아트워크를 다운스케일해 평균색 버킷 중 상위 3색 추출 (배경/외곽선 제외) */
function colorDist(a,b){ return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); }
function extractPalette(p){
  return new Promise(resolve=>{
    const img = new Image();
    img.crossOrigin = "anonymous";     // raw.githubusercontent.com이 CORS 허용 → pixel read 가능
    img.onload = ()=>{
      try{
        const SZ = 48;
        const cv = document.createElement("canvas"); cv.width=SZ; cv.height=SZ;
        const ctx = cv.getContext("2d", {willReadFrequently:true});
        ctx.drawImage(img,0,0,SZ,SZ);
        const {data} = ctx.getImageData(0,0,SZ,SZ);
        const buckets = new Map();
        for(let i=0;i<data.length;i+=4){
          if(data[i+3] < 128) continue;                 // 투명 배경 제외
          const r=data[i], g=data[i+1], b=data[i+2];
          const lum = (r+g+b)/3;
          if(lum>245 || lum<10) continue;                // 흰 하이라이트/검정 외곽선 제외
          const key = [Math.round(r/24)*24, Math.round(g/24)*24, Math.round(b/24)*24].join(",");
          const e = buckets.get(key) || {r:0,g:0,b:0,n:0};
          e.r+=r; e.g+=g; e.b+=b; e.n++;
          buckets.set(key,e);
        }
        const sorted = [...buckets.values()].sort((a,b)=>b.n-a.n);
        const picked = [];
        for(const c of sorted){
          const col = [Math.round(c.r/c.n), Math.round(c.g/c.n), Math.round(c.b/c.n)];
          if(picked.some(p2=>colorDist(p2,col)<40)) continue;   // 비슷한 색끼리 묶기
          picked.push(col);
          if(picked.length>=3) break;
        }
        resolve(picked.map(([r,g,b])=>`#${[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("")}`));
      }catch(e){ resolve(null); }
    };
    img.onerror = ()=> resolve(null);
    img.src = ART(p.pokemonRowid);
  });
}

/* ---- 식별 판정 ---- */
function submitGuess(){
  const inp = $("#guessInput"); const g = inp.value.trim();
  const v = $("#verdict");
  if(!g){ v.className="verdict bad"; v.textContent="이름을 입력하세요."; return; }
  if(g === answer.nameKr){
    const captured = Math.random()*100 < favor;
    finish(captured ? "captured" : "fled");
    return;
  }
  attempts++;
  favor = Math.max(favFloor, favor - WRONG_DECAY);
  bumpFoot();
  v.className="verdict bad";
  const known = POKE.some(p=>p.nameKr===g);
  v.textContent = known ? `${g} 아닙니다. 단서를 더 조회해 보세요.` : `후보 목록에 없는 이름입니다: ${g}`;
  inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake");
  inp.select();
}

/* outcome: "captured"(식별+포획 성공) | "fled"(식별 성공, 포획 실패로 도주) | "giveup" */
function finish(outcome){
  $("#app").querySelectorAll("[data-clue],#guessBtn,#guessInput,#giveup").forEach(el=>el.disabled=true);
  if(outcome==="captured" || outcome==="fled"){
    playCaptureFx(outcome).then(()=> revealResult(outcome));
  }else{
    revealResult(outcome);
  }
}

/* 몬스터볼 포획 연출: 던짐(낙하) → 정지 흔들림 3회 → 포획 성공(정지+반짝) / 실패(뚜껑 튕겨나감) → 페이드아웃 */
const FX_DROP_MS = 550, FX_SHAKE_MS = 1500, FX_OUTCOME_MS = 600, FX_EXIT_MS = 320;
function playCaptureFx(outcome){
  return new Promise(resolve=>{
    const vp = $("#viewport");
    if(!vp){ resolve(); return; }
    vp.querySelector(".vp-silhouette")?.remove(); vp.querySelector(".vp-glow")?.remove();
    vp.querySelector("canvas")?.remove();
    vp.querySelector("img")?.remove();
    const fx = document.createElement("div");
    fx.className = "captfx";
    fx.innerHTML = `<div class="ball"><div class="ball-top"></div><div class="ball-bot"></div><div class="ball-band"></div><div class="ball-btn"></div></div>`;
    vp.appendChild(fx);
    setTag(vp,"포획 중…");
    requestAnimationFrame(()=> fx.classList.add("drop"));
    setTimeout(()=> fx.classList.add("shake"), FX_DROP_MS);
    setTimeout(()=>{
      if(outcome==="captured"){
        fx.classList.add("caught");
        setTag(vp,"포획 성공");
      }else{
        fx.classList.add("broke");
        setTag(vp,"놓침");
      }
      setTimeout(()=>{
        fx.classList.add("exit");
        setTimeout(()=>{ fx.remove(); resolve(); }, FX_EXIT_MS);
      }, FX_OUTCOME_MS);
    }, FX_DROP_MS + FX_SHAKE_MS);
  });
}

function revealResult(outcome){
  const identified = outcome==="captured" || outcome==="fled";
  if(identified) solved++;
  if(outcome==="captured"){
    addToRoster({ pokemon:answer, alias, level:1, exp:0, favor, favCeil, favFloor, iv, aptitude:rollAptitude(), job:null });
  }
  const app = $("#app");
  const t = types(answer);
  const banner = document.createElement("div");
  const cls = outcome==="captured" ? "" : outcome==="fled" ? " fled" : " miss";
  banner.className = "result"+cls;
  const title = outcome==="captured" ? "포획 성공"
              : outcome==="fled" ? "정체 확인 · 포획 실패(도주)"
              : "식별 포기";
  const color = outcome==="captured" ? "var(--ok)" : outcome==="fled" ? "var(--amber)" : "var(--bad)";
  const favLine = identified ? ` · 우호도 ${Math.round(favor)}` : "";
  banner.innerHTML = `
    <div class="eyebrow" style="color:${color}">${title}</div>
    <div class="rname">${answer.nameKr}</div>
    <div class="rmsg">${t.join(" / ")} · 키 ${answer.heightM}m · ${answer.weightKg}kg · 단서 ${cluesUsed}개 · 오답 ${attempts}회${favLine}</div>
    <button class="again" id="again">${drafting() && startRoundIdx+1>=START_ROUNDS ? "본거지로 →" : "다음 개체 →"}</button>
  `;
  // 정답 아트워크 공개
  const vp = $("#viewport");
  if(vp){
    const img=new Image();
    img.onload=()=>{ vp.querySelector(".vp-silhouette")?.remove(); vp.querySelector(".vp-glow")?.remove(); vp.querySelector("canvas")?.remove();
      vp.querySelector("img")?.remove(); vp.appendChild(img); setTag(vp,"정체 확인"); };
    img.onerror=()=>{ if(!img.dataset.fb){img.dataset.fb=1; img.src=answer.details?.sprites?.front_default||"";} };
    img.src = ART(answer.pokemonRowid);
  }
  // 스탬프 갱신
  const stamp=$(".scn-stamp");
  if(stamp){
    if(outcome==="captured") stamp.classList.add("done");
    stamp.textContent = outcome==="captured" ? "포획 완료" : outcome==="fled" ? "확인 · 도주" : "미해결";
  }
  const controls = app.querySelector(".scn-controls");
  controls.parentNode.insertBefore(banner, controls);
  banner.scrollIntoView({behavior:"smooth", block:"center"});
  $("#again").onclick = ()=>{
    if(drafting() && ++startRoundIdx >= START_ROUNDS){ renderBase(); }
    else{ newCase(); }
  };
}
