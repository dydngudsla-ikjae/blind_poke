// ===== 개체 식별 터미널 : 후보 선택 → 단서 조회 → 포획 =====
import { TYPE_COLORS, STAT_LABEL, ART, $, rnd, POKE, MOVE, ABILITY, types, tabBar } from "./data.js";
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
/* ---- 스타팅 드래프트용: 정답 아트워크 그대로의 실루엣(누구인지 형태는 보이되 이름/타입/수치는 스캔해야 나옴) ---- */
function realSilhouetteImg(pokemon){
  const fallback = pokemon.details?.sprites?.front_default || "";
  return `<img class="enc-silhouette" src="${ART(pokemon.pokemonRowid)}" data-fallback="${fallback}"
    style="height:70px;width:auto;max-width:92px;object-fit:contain" alt="">`;
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
function rollFavor(p){
  const rare = p.details?.isLegendary || p.details?.isMythical;
  const ceil = rare ? rnd(30,55) : rnd(70,95);
  const floor = Math.min(rnd(10,30), ceil-5);
  return { ceil, floor };
}
/* ---- 개체값: 종족값에 -15~+15 랜덤 보정 (원작 0~31 개념을 0 기준 대칭으로 절반 축소) ---- */
function rollIV(){
  const keys=["hp","atk","def","satk","sdef","spd"];
  const out={};
  keys.forEach(k=> out[k]=rnd(-15,15));
  return out;
}
/* ---- 특수능력: 0~100 랜덤 — 본거지 직무 산출량으로 환산되는 개체별 재능치 ---- */
function rollAptitude(){ return rnd(0,100); }
/* ---- 새 라운드: 후보 3종 제시 후 선택 (드래프트 중엔 이미 나온 종 제외) ---- */
export function newCase(){
  const pool = drafting() ? POKE.filter(p=>!startSeenIds.has(p.pokemonRowid)) : [...POKE];
  const aliases = [];
  candidates = Array.from({length:Math.min(CAND_N,pool.length)},()=>{
    const p = pool.splice(rnd(0,pool.length-1),1)[0];
    if(drafting()) startSeenIds.add(p.pokemonRowid);
    const a = makeAlias(aliases); aliases.push(a);
    const t = types(p);
    const f = rollFavor(p);
    return { pokemon:p, alias:a, shownType:t[rnd(0,t.length-1)], favCeil:f.ceil, favFloor:f.floor, iv:rollIV() };
  });
  renderSelect();
}

/* 숲 속에서 후보 3마리를 동시에 마주치는 단일 조우 장면 — 마우스로 든 스캐너가 포인터를 따라다니고,
   개체 위에 겨누면 스캐너 오른쪽에 정보가 뜸(항상 보이는 이름표 대신 스캔해야 알 수 있게).
   스타팅 드래프트 중에는 골라서 바로 데려가는 것뿐이라 실루엣도 실제 형태로 보여주고, 클릭하면
   단서 조회 없이 즉시 로스터에 합류시킴 — 힌트로 알아맞히는 로직은 드래프트 이후 야생 조우에서만 그대로 유지 */
function renderSelect(){
  const app = $("#app"); app.removeAttribute("aria-busy");
  const draft = drafting();
  app.innerHTML = `
    ${draft ? "" : tabBar("identify")}
    <div class="encounter-scene" id="encScene">
      <div class="scan-cursor" id="scanCursor">
        <span class="sc-lens"><span class="sc-led"></span></span>
        <span class="sc-screen"><span class="sc-sweep"></span></span>
        <span class="sc-lens"></span>
      </div>
      <div class="scan-info" id="scanInfo"></div>
      <div class="encounter-mons">
        ${candidates.map((c,i)=>`
          <button class="enc-mon" data-idx="${i}">
            ${draft ? realSilhouetteImg(c.pokemon) : eggSvg(64,70,"#0a0a0a")}
          </button>
        `).join("")}
      </div>
    </div>
  `;
  app.querySelectorAll(".enc-mon").forEach(b=> b.onclick=()=>{
    const cand = candidates[+b.dataset.idx];
    draft ? draftPick(cand) : enterCase(cand);
  });
  if(draft){
    app.querySelectorAll("img.enc-silhouette").forEach(img=> img.onerror = ()=>{
      if(img.dataset.fb) return;
      img.dataset.fb = 1;
      if(img.dataset.fallback) img.src = img.dataset.fallback;
    });
  }
  wireEncounterScanner();
  wireTabBar();
}

/* 스타팅 드래프트 선택: 식별 없이 즉시 로스터에 합류(실패/도주 없음) 후 다음 후보 또는 본거지로 */
function draftPick(cand){
  addToRoster({ pokemon:cand.pokemon, alias:cand.alias, level:1, exp:0,
    favor:cand.favCeil, favCeil:cand.favCeil, favFloor:cand.favFloor, iv:cand.iv,
    aptitude:rollAptitude(), job:null });
  if(++startRoundIdx >= START_ROUNDS){ renderBase(); }
  else{ newCase(); }
}

/* 스캐너 커서: 씬 안에서 마우스를 따라다니다가 개체 위에 겨누면 스캐너 위쪽(공간 없으면 오른쪽/아래)에 정보 패널 표시 */
function wireEncounterScanner(){
  const app = $("#app");
  const scene = app.querySelector("#encScene");
  const cursor = app.querySelector("#scanCursor");
  const info = app.querySelector("#scanInfo");
  if(!scene) return;
  let hoveredIdx = null;

  function placeInfo(x, y, rect){
    const panelW = info.offsetWidth || 150, panelH = info.offsetHeight || 70;
    let left = x - panelW/2;
    let top = y - 34 - panelH;               // 기본: 스캐너 바로 위
    if(top < 6){                             // 위쪽 공간 부족 -> 오른쪽으로
      left = x + 56; top = y - panelH/2;
      if(left + panelW > rect.width) left = x - panelW - 56;   // 오른쪽도 부족하면 왼쪽
    }
    left = Math.max(6, Math.min(left, rect.width - panelW - 6));
    top = Math.max(6, Math.min(top, rect.height - panelH - 6));
    info.style.left = left+"px"; info.style.top = top+"px";
  }

  scene.addEventListener("mousemove", e=>{
    const r = scene.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    cursor.style.left = x+"px"; cursor.style.top = y+"px";
    cursor.style.opacity = 1;
    if(hoveredIdx!=null) placeInfo(x, y, r);
  });
  scene.addEventListener("mouseleave", ()=>{ cursor.style.opacity = 0; info.classList.remove("show"); hoveredIdx=null; });

  app.querySelectorAll(".enc-mon").forEach((b,i)=>{
    b.addEventListener("mouseenter", ()=>{
      hoveredIdx = i;
      const c = candidates[i];
      cursor.classList.add("locked");
      info.innerHTML = `
        <div class="scan-info-name">${c.alias}</div>
        <div class="scan-info-row"><span class="chip" style="background:${TYPE_COLORS[c.shownType]||'#666'}">${c.shownType}</span></div>
        <div class="scan-info-row">${c.pokemon.heightM ?? "?"}m · ${c.pokemon.weightKg ?? "?"}kg</div>
      `;
      info.classList.add("show");
      const r = scene.getBoundingClientRect();
      placeInfo(parseFloat(cursor.style.left)||0, parseFloat(cursor.style.top)||0, r);
    });
    b.addEventListener("mouseleave", ()=>{
      hoveredIdx=null; info.classList.remove("show");
      cursor.classList.remove("locked");
    });
  });
}

function wireTabBar(){
  const app = $("#app");
  app.querySelector('[data-tab="identify"]')?.addEventListener("click", ()=> newCase());
  app.querySelector('[data-tab="base"]')?.addEventListener("click", ()=> renderBase());
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
    ${drafting() ? "" : tabBar("identify")}
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
  wireTabBar();
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
