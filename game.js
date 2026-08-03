// ===== 개체 식별 터미널 : 블라인드 포켓몬 추리 코어 =====

const TYPE_COLORS = {
  노말:"#9aa2ab",격투:"#d1425b",비행:"#8fb7ff",독:"#a24bd6",땅:"#d6a94b",바위:"#b8a05c",
  벌레:"#8bbf3d",고스트:"#7d6ca8",강철:"#8fa0b3",불꽃:"#ff6b3d",물:"#4d90ff",풀:"#4caf50",
  전기:"#f7c948",에스퍼:"#ff5aa8",얼음:"#5cd6d6",드래곤:"#7a5bff",악:"#6a6470",페어리:"#ff9ecf"
};
const STAT_LABEL = {hp:"HP",atk:"공격",def:"방어",satk:"특공",sdef:"특방",spd:"스피드"};
const ART = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const $ = (s,r=document)=>r.querySelector(s);
const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

let POKE=[], TYPE={}, MOVE={}, ABILITY={};
let answer=null, alias="", solved=0, seen=0, cluesUsed=0, attempts=0, paletteCache=null;
const spent = new Set();

async function boot(){
  try{
    const [pk,tp,mv,ab] = await Promise.all([
      fetch("./data/pokemon.json").then(r=>r.json()),
      fetch("./data/type.json").then(r=>r.json()),
      fetch("./data/move.json").then(r=>r.json()),
      fetch("./data/ability.json").then(r=>r.json()),
    ]);
    tp.forEach(t=> TYPE[t.typeRowid]=t.nameKr);
    mv.forEach(m=> MOVE[m.moveRowid]=m.nameKr);
    ab.forEach(a=> ABILITY[a.abilityRowid]=a.nameKr);
    POKE = pk.filter(p=>p.details?.isDefault !== false);
    newCase();
  }catch(e){
    $("#boot").textContent = "로드 실패: "+e.message+" — 로컬 서버로 실행했는지 확인";
  }
}

/* ---- 가명 생성: ~~몬 (정답 누출 방지) ---- */
const SYL = ["가","라","보","슈","크","펜","다","조","리","무","포","케","드","비","우","토","네","하","쿠","미","젠","롯","퀴","벨","단"];
function makeAlias(){
  let a;
  do{ const n = Math.random()<0.5?2:3;
      a = Array.from({length:n},()=>SYL[rnd(0,SYL.length-1)]).join("")+"몬";
  }while(POKE.some(p=>p.nameKr===a));
  return a;
}

function types(p){
  return [p.type1Rowid,p.type2Rowid].filter((v,i,arr)=>arr.indexOf(v)===i).map(id=>TYPE[id]).filter(Boolean);
}
function highestStat(p){
  const s={hp:p.hp,atk:p.atk,def:p.def,satk:p.satk,sdef:p.sdef,spd:p.spd};
  const max=Math.max(...Object.values(s));
  return Object.keys(s).filter(k=>s[k]===max).map(k=>STAT_LABEL[k]);
}
/* ---- 새 문제 ---- */
function newCase(){
  answer = POKE[rnd(0,POKE.length-1)];
  alias = makeAlias();
  cluesUsed=0; attempts=0; spent.clear(); paletteCache=null; seen++;
  render();
}

function render(){
  const t = types(answer);
  const app = $("#app"); app.removeAttribute("aria-busy");
  app.innerHTML = `
    <section class="case">
      <div class="stamp">신원 미상</div>
      <div class="eyebrow">개체 식별 터미널</div>
      <div class="coderow">
        <div class="codename">${alias}</div>
      </div>
      <div class="caseno">개체 파일 #${String(seen).padStart(3,"0")} · 후보 ${POKE.length}종</div>
    </section>

    <div class="viewport" id="viewport">
      <div class="scanline"></div>
      <div class="crosshair"></div>
      <div class="qmark">?</div>
      <div class="vp-tag">SPECIMEN VIEW</div>
    </div>

    <div class="block">
      <div class="bh">기본 관측 정보</div>
      <div class="rows">
        <div class="row"><span class="k">타입</span><span class="v">${
          t.map(x=>`<span class="chip" style="background:${TYPE_COLORS[x]||"#666"}">${x}</span>`).join("")}</span></div>
        <div class="row"><span class="k">키</span><span class="v amber">${answer.heightM ?? "?"} m</span></div>
        <div class="row"><span class="k">몸무게</span><span class="v amber">${answer.weightKg ?? "?"} kg</span></div>
      </div>
    </div>

    <div class="actions">
      <button class="btn" data-clue="consult"><span class="lab">박사와 상담하기</span><span class="sub">무작위 힌트 · 반복 가능</span></button>
      <button class="btn" data-clue="observe"><span class="lab">직접 관찰하기</span><span class="sub">표본 확대 — 이번 개체 1회</span></button>
      <button class="btn confirm wide" data-clue="silhouette"><span class="lab">본인확인서 대조</span><span class="sub">외곽 실루엣 — 최종 단서</span></button>
    </div>

    <div class="block log">
      <div class="bh">조사 로그</div>
      <div class="rows" id="log"><div class="logempty">아직 조회한 단서가 없습니다.</div></div>
    </div>

    <div class="block">
      <div class="bh">개체 식별</div>
      <div class="rows">
        <div class="guess">
          <input id="guessInput" placeholder="포켓몬 이름 입력" autocomplete="off">
          <button class="id" id="guessBtn">식별</button>
        </div>
        <div class="verdict" id="verdict"></div>
        <button class="textlink" id="giveup">식별 포기 — 정답 공개</button>
      </div>
    </div>

    <div class="foot">
      <span>해결 <b>${solved}</b> / 시도 <b>${seen}</b></span>
      <span>이번 개체 · 단서 <b>${cluesUsed}</b> · 오답 <b>${attempts}</b></span>
    </div>
  `;

  app.querySelectorAll("[data-clue]").forEach(b=> b.onclick=()=>useClue(b.dataset.clue,b));
  $("#guessBtn").onclick = submitGuess;
  $("#guessInput").addEventListener("keydown",e=>{ if(e.key==="Enter") submitGuess(); });
  $("#giveup").onclick = ()=>finish(false,true);
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
  const f = $(".foot"); if(!f) return;
  f.lastElementChild.innerHTML = `이번 개체 · 단서 <b>${cluesUsed}</b> · 오답 <b>${attempts}</b>`;
}
function useClue(kind, btn){
  if(kind!=="consult" && spent.has(kind)) return;   // 상담만 반복 가능
  cluesUsed++;
  if(kind==="consult"){
    consultProfessor();
  }
  else if(kind==="observe"){
    spent.add(kind); btn.disabled=true;
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

/* 박사와 상담: 매번 능력치·색상·기술·특성 중 하나를 가중 랜덤으로 공개 (특성이 가장 희귀) */
function pickWeighted(items){
  const total = items.reduce((s,it)=>s+it.w,0);
  let r = Math.random()*total;
  for(const it of items){ if((r-=it.w)<0) return it.type; }
  return items[items.length-1].type;
}
function consultProfessor(){
  const pool = [{type:"stat",w:3},{type:"color",w:3}];
  if((answer.details?.moveRowids||[]).length) pool.push({type:"move",w:3});
  if((answer.details?.abilityRowids||[]).length) pool.push({type:"ability",w:1});   // 가장 낮은 확률
  const kind = pickWeighted(pool);
  if(kind==="stat"){
    log("상담", `<b>능력치</b> · 종족값상 가장 높은 능력치는 <em>${highestStat(answer).join(" · ")}</em> 계열입니다. <span style="color:var(--mut)">(수치 비공개)</span>`);
  }
  else if(kind==="move"){
    const ids = answer.details.moveRowids;
    const name = MOVE[ids[rnd(0,ids.length-1)]] || "알 수 없는 기술";
    log("상담", `<b>기술</b> · 배울 수 있는 기술 중 하나는 <em>${name}</em>입니다.`);
  }
  else if(kind==="ability"){
    const ids = answer.details.abilityRowids;
    const name = ABILITY[ids[rnd(0,ids.length-1)]] || "알 수 없는 특성";
    log("상담", `<b>특성</b> · 특성 후보 중 하나는 <em>${name}</em>입니다. <span style="color:var(--mut)">(희귀 단서)</span>`);
  }
  else{ // color
    const el = log("상담", `<b>색상</b> · 대표 색상 추출 중…`);
    (paletteCache ? Promise.resolve(paletteCache) : extractPalette(answer)).then(colors=>{
      if(colors) paletteCache = colors;
      el.innerHTML = colors && colors.length
        ? `<span class="tag">상담</span><b>색상</b> · 대표 색상 팔레트: ${colors.map(c=>`<span class="swatch" style="background:${c}"></span>`).join("")}`
        : `<span class="tag">상담</span><b>색상</b> · <span style="color:var(--mut)">색상 추출 실패 — 인터넷 연결을 확인하세요.</span>`;
    });
  }
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
    vp.querySelector(".qmark")?.remove();
    vp.querySelector("img")?.remove();
    let old=vp.querySelector("canvas"); if(old) old.remove();
    vp.appendChild(cv);
    setTag(vp,"SURFACE SAMPLE");
  };
  img.onerror = ()=> log("관찰", `<span style="color:var(--bad)">표본 이미지를 불러오지 못했습니다.</span>`);
  img.src = ART(answer.pokemonRowid);
}
function showSilhouette(){
  const vp = $("#viewport");
  const img = new Image();
  img.className="silhouette";
  img.onload = ()=>{
    vp.querySelector(".qmark")?.remove();
    vp.querySelector("canvas")?.remove();
    vp.querySelector("img")?.remove();
    vp.appendChild(img);
    setTag(vp,"SILHOUETTE MATCH");
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
  if(g === answer.nameKr){ finish(true,false); return; }
  attempts++; bumpFoot();
  v.className="verdict bad";
  const known = POKE.some(p=>p.nameKr===g);
  v.textContent = known ? `${g} 아닙니다. 단서를 더 조회해 보세요.` : `후보 목록에 없는 이름입니다: ${g}`;
  inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake");
  inp.select();
}

function finish(win, gaveUp){
  if(win) solved++;
  const app = $("#app");
  const t = types(answer);
  const banner = document.createElement("div");
  banner.className = "result"+(win?"":" miss");
  banner.innerHTML = `
    <div class="eyebrow" style="color:${win?'var(--ok)':'var(--bad)'}">${win?"식별 성공":(gaveUp?"식별 포기":"식별 실패")}</div>
    <div class="rname">${answer.nameKr}</div>
    <div class="rmsg">${t.join(" / ")} · 키 ${answer.heightM}m · ${answer.weightKg}kg · 단서 ${cluesUsed}개 · 오답 ${attempts}회</div>
    <button class="again" id="again">다음 개체 →</button>
  `;
  // 정답 아트워크 공개
  const vp = $("#viewport");
  if(vp){
    const img=new Image();
    img.onload=()=>{ vp.querySelector(".qmark")?.remove(); vp.querySelector("canvas")?.remove();
      vp.querySelector("img")?.remove(); vp.appendChild(img); setTag(vp,"IDENTIFIED"); };
    img.onerror=()=>{ if(!img.dataset.fb){img.dataset.fb=1; img.src=answer.details?.sprites?.front_default||"";} };
    img.src = ART(answer.pokemonRowid);
  }
  // 스탬프 갱신
  const stamp=$(".stamp"); if(stamp){ stamp.classList.add("done"); stamp.textContent= win?"식별 완료":"미해결"; }
  app.insertBefore(banner, app.querySelector(".actions"));
  app.querySelectorAll("[data-clue],#guessBtn,#guessInput,#giveup").forEach(el=>el.disabled=true);
  banner.scrollIntoView({behavior:"smooth", block:"center"});
  $("#again").onclick = newCase;
}

boot();
