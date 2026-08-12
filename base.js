// ===== 본거지: 로스터 · 자원 · 직무 배정 · 턴 진행 =====
import { TYPE_COLORS, ART, $, types } from "./data.js";
import { newCase } from "./identify.js";
import { renderMap, resolveMapTurn } from "./map.js";
import { constructionTurns, projectedConstructionTurns } from "./src/domain/construction.ts";
import { GAME_SAVE_KEY, readStorage, writeStorage } from "./src/services/storageService.ts";

/* ---- 본거지 전용 UI 아이콘 시스템: emoji를 섞지 않고 하나의 line-icon 세트로 통일.
   전부 24x24 viewBox · stroke-width 1.7 · round cap/join, 색상은 currentColor로 상속받아
   기본은 off-white/gray-blue, 활성 상태에서만 cyan/teal, 알림 배지에서만 orange를 쓰게 한다. ---- */
const ICON_PATHS = {
  pc:      `<rect x="4.5" y="4" width="15" height="15" rx="2"/><path d="M9.3 21h5.4M10.6 19v2"/><circle cx="12" cy="11.3" r="4"/><path d="M7.7 11.3h8.6"/><circle cx="12" cy="11.3" r="1.1" fill="currentColor" stroke="none"/>`,
  entry:   `<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="5.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="17.63" cy="8.75" r="1.15" fill="currentColor" stroke="none"/>
    <circle cx="17.63" cy="15.25" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.15" fill="currentColor" stroke="none"/>
    <circle cx="6.37" cy="15.25" r="1.15" fill="currentColor" stroke="none"/><circle cx="6.37" cy="8.75" r="1.15" fill="currentColor" stroke="none"/>`,
  shop:    `<path d="M4.5 7.5H15.5M12 4.5 15.5 7.5 12 10.5"/><path d="M19.5 16.5H8.5M12 13.5 8.5 16.5 12 19.5"/>`,
  gauge:   `<rect x="4.5" y="13" width="4" height="7.5" rx="0.9"/><rect x="10" y="8" width="4" height="12.5" rx="0.9"/><rect x="15.5" y="10.5" width="4" height="10" rx="0.9"/><path d="M4 20.9h16"/><path d="M5.3 15.2h1.4M10.8 10.2h2.4M16.3 12.7h1.8"/>`,
  map:     `<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>`,
  explore: `<circle cx="13" cy="11" r="6.5"/><path d="M13 6.45 14.4 11 13 15.55 11.6 11Z" fill="currentColor" stroke="none"/><path d="M13 3.2v1.3M19.8 11h-1.3M13 18.8v-1.3M6.2 11h1.3"/><path d="M5 19Q4 14.7 9.7 12.3Q8.8 16.8 5 19Z" fill="currentColor" stroke="none"/>`,
  slot:    `<rect x="6" y="6" width="12" height="12" rx="2.4"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>`,
  parcel:  `<rect x="5" y="5" width="14" height="14" rx="1.8"/><path d="M5 12h14M12 5v14"/>`,
  lock:    `<rect x="5" y="10.6" width="14" height="9" rx="1.4"/><path d="M8 10.6V7.8a4 4 0 0 1 8 0v2.8"/>`,
  plus:    `<path d="M12 5.5v13M5.5 12h13"/>`,
  /* ---- 건설 모달의 건축물 카테고리 아이콘(밭/레스토랑/훈련소/제작소/치료소) ---- */
  bFarm:       `<path d="M4 8.5h16M4 13h16M4 17.5h16"/><path d="M9 8.5v-2.6M12 8.5v-3.4M15 8.5v-2.6"/>`,
  bRestaurant: `<path d="M4 15.5a8 8 0 0 1 16 0"/><path d="M3 15.5h18M12 6.6v2.2"/><circle cx="12" cy="5.3" r="1.1" fill="currentColor" stroke="none"/>`,
  bDojo:       `<circle cx="6.3" cy="12" r="2.3"/><circle cx="17.7" cy="12" r="2.3"/><path d="M8.6 12h6.8M6.3 9.4v5.2M17.7 9.4v5.2"/>`,
  bWorkshop:   `<path d="M8.3 5h7.4l3.1 5.5-3.1 5.5H8.3l-3.1-5.5Z"/><circle cx="12" cy="10.5" r="2.3"/>`,
  bClinic:     `<circle cx="12" cy="12" r="7.5"/><path d="M12 8v8M8 12h8"/>`,
  cycle:   `<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5"/><path d="M17.6 3.6v3.4h-3.4M6.4 20.4v-3.4h3.4"/>`,
  bolt:    `<path d="M13 2 5 14h5.5l-1 8L18 10h-5.5L13 2Z"/>`,
  chevron: `<path d="M9 5l7 7-7 7"/>`,
};
function icon(name, size=16, extraClass=""){
  const inner = ICON_PATHS[name] || "";
  return `<svg class="ic${extraClass?` ${extraClass}`:""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* ---- 부지 폴리곤 유틸: town-bg.png(1672x941) 속 실제 흙밭 10칸의 픽셀 좌표를 Playwright로
   실측해서 얻은 값(assets/town-bg.png, isDirt 휴리스틱으로 각 칸의 상/하단 좌우 끝점을 찾음).
   부지마다 원근에 따라 폭/기울기가 다르므로 칸마다 자기만의 바운딩 박스(box, .base-art 기준 %)와
   그 박스 안에서의 로컬 폴리곤 좌표(0~100%)를 따로 갖는다 — 균일한 그리드 수식으로는 근사가 안 됨.
   i는 plotScene()의 DOM 순서(0~9, row-major: 0~4=위쪽 행, 5~9=아래쪽 행)와 그대로 대응된다. */
const PLOT_LAYOUT = [
  // row0 (뒤쪽 행)
  { box:{left:11.45, top:42.30, width:13.80, height:15.94}, pts:[[14.43,0],[100,0],[90.60,98.27],[0,100]] },
  { box:{left:26.98, top:42.24, width:13.27, height:16.01}, pts:[[7.93,0],[100,0],[95.54,98.81],[0,100]] },
  { box:{left:43.12, top:42.24, width:13.10, height:16.18}, pts:[[2.28,0],[98.68,0],[100,100],[0,97.05]] },
  { box:{left:59.04, top:42.02, width:13.40, height:16.42}, pts:[[0,2.46],[92.82,0],[100,100],[3.93,98.25]] },
  { box:{left:74.41, top:41.82, width:14.19, height:16.35}, pts:[[0,0],[89.59,2.73],[100,98.90],[8.64,100]] },
  // row1 (앞쪽 행 — 카메라에 더 가까워서 폭이 더 넓다)
  { box:{left:8.27,  top:64.35, width:15.02, height:18.76}, pts:[[14.33,0],[100,1.76],[90.13,100],[0,100]] },
  { box:{left:25.31, top:64.12, width:14.49, height:18.98}, pts:[[9.74,0],[100,3.64],[94.92,100],[0,100]] },
  { box:{left:42.77, top:64.51, width:14.09, height:18.86}, pts:[[1.74,0],[95.67,0],[100,100],[0,97.97]] },
  { box:{left:59.81, top:64.37, width:14.47, height:18.91}, pts:[[0,0],[91.15,1.74],[100,100],[4.38,96.74]] },
  { box:{left:76.24, top:64.14, width:15.23, height:18.91}, pts:[[0,0],[88.02,4.16],[100,100],[9.98,100]] },
];
function plotBox(i){ return PLOT_LAYOUT[i].box; }
function plotPolygon(i){ return PLOT_LAYOUT[i].pts; }
function plotCentroid(i){
  const pts = PLOT_LAYOUT[i].pts;
  const cx = pts.reduce((s,[x])=>s+x, 0) / pts.length;
  const cy = pts.reduce((s,[,y])=>s+y, 0) / pts.length;
  return [cx, cy];
}
/* 배치된 포켓몬 스프라이트 위치: 폴리곤 정중앙(plotCentroid)에 두면 건축물 이미지의 지붕/간판 같은
   디테일과 겹쳐서 어색해 보인다 — 아랫변(입구/마당 쪽) 중점을 안쪽으로 살짝 당겨서 "건물 앞에
   서 있는" 자리로 옮긴다. */
function plotBottomAnchor(i, insetFrac=0.14){
  const [,, br, bl] = PLOT_LAYOUT[i].pts;
  const midX = (br[0]+bl[0])/2;
  const midY = (br[1]+bl[1])/2;
  return [midX, midY - insetFrac*100];
}
/* .plot-tag는 더 이상 .plot의 자식이 아니라 형제 요소(.plot-grid 기준 절대좌표)로 그려진다 —
   .plot의 clip-path(실측 폴리곤)에 잘리면 스프라이트 여러 마리를 가로로 늘어놓을 때 옆으로 삐져나온
   부분(또는 +N 배지)이 잘려나가기 때문. 그래서 폴리곤 로컬 좌표(0~100, plot 박스 기준)를
   .base-art 기준 전역 퍼센트로 변환해줘야 한다. */
function plotLocalToGlobal(i, localX, localY){
  const box = plotBox(i);
  return [box.left + (localX/100)*box.width, box.top + (localY/100)*box.height];
}
/* 근무/대기 중인 인원이 여럿이어도 1마리만 보이던 문제 — 최대 3마리까지 나란히 겹쳐 보여주고,
   그 이상은 "+N" 배지로 표시한다. i는 idle 모션 타이밍을 칸/개체별로 어긋나게 하는 데만 쓴다. */
function spriteClusterHtml(members, i){
  const MAX_VISIBLE = 3;
  const shown = members.slice(0, MAX_VISIBLE);
  const extra = members.length - shown.length;
  const imgs = shown.map(({m}, idx)=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    const offset = ((i*0.37) + idx*0.53) % 2.3;
    return `<img class="plot-sprite" style="--idle-offset:${offset.toFixed(2)}" src="${sprite}" alt="${m.pokemon.nameKr}">`;
  }).join("");
  const badge = extra>0 ? `<span class="plot-sprite-more">+${extra}</span>` : "";
  return imgs + badge;
}
/* 부지 폴리곤은 원근 때문에 사다리꼴로 기울어져 있는데, 그 위에 얹는 건축물 이미지는 순수 직사각형이라
   가만히 두면 부지의 기울기와 어긋나 "삐딱하게" 보인다. 각 부지의 좌/우 변이 위→아래로 얼마나
   가로 이동하는지(픽셀 기준)를 재서 평균 낸 뒤 skewX 각도로 바꿔주면 이미지 밑변은 그대로 두고
   윗변만 부지의 기울기만큼 따라가게 만들 수 있다(transform-origin을 bottom으로 둬서 밑변 고정). */
function plotArtSkewDeg(i){
  const IMG_W = 1672, IMG_H = 941;
  const { box, pts:[tl,tr,br,bl] } = PLOT_LAYOUT[i];
  const boxWpx = box.width/100*IMG_W, boxHpx = box.height/100*IMG_H;
  const leftShiftPx = (tl[0]-bl[0])/100*boxWpx;
  const rightShiftPx = (tr[0]-br[0])/100*boxWpx;
  const avgShiftPx = (leftShiftPx+rightShiftPx)/2;
  return -(Math.atan(avgShiftPx/boxHpx)*180/Math.PI);
}
function boxStyleStr(box, scale=1, shiftXFrac=0){
  if(scale===1 && !shiftXFrac) return `left:${box.left}%; top:${box.top}%; width:${box.width}%; height:${box.height}%`;
  const w = box.width*scale, h = box.height*scale;
  const left = box.left - (w-box.width)/2 - w*shiftXFrac, top = box.top - (h-box.height)/2;
  return `left:${left.toFixed(2)}%; top:${top.toFixed(2)}%; width:${w.toFixed(2)}%; height:${h.toFixed(2)}%`;
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
/* 부지 hover 시 실제 흙밭 폴리곤을 따라 나타나는 반응 레이어(평상시 opacity:0, 완전 투명).
   ambient=true(빈 필드)면 폴리곤의 네 꼭짓점 전부에 아주 약한 cyan 코너 브래킷을 상시 노출하고
   숨쉬듯 breathing glow를 준다(hover 전에도 "여기가 지금 행동 가능한 자리"라는 신호는 남기되,
   부지 전체를 사각 카드처럼 덮지는 않는다 — 실제 흙밭 위에 얇은 HUD가 얹힌 느낌을 유지). */
function plotFxSvg(pts, ambient=false){
  const ptsStr = svgPointsStr(pts);
  const corners = cornerBracketPaths(pts, 8.5).map(d=>`<path class="plot-fx-corner" d="${d}"></path>`).join("");
  const ambientMark = ambient
    ? cornerBracketPaths(pts, 6).map(d=>`<path class="plot-fx-corner-ambient" d="${d}"></path>`).join("")
    : "";
  return `
    <svg class="plot-fx" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon class="plot-fx-fill" points="${ptsStr}"></polygon>
      <polygon class="plot-fx-outline" points="${ptsStr}"></polygon>
      ${corners}
      ${ambientMark}
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
/* ---- 부지 건설: 빈 필드에 "직무"를 낱개로 배치하는 게 아니라 "건축물"을 짓고, 그 건축물 안에서
   구체적인 직무를 고르는 2단 구조. BUILDINGS는 JOBS를 용도별로 묶은 상위 카테고리 — 이후 새 직무가
   추가되면 이 표에만 소속을 추가하면 됨(건설 모달 쪽 로직은 그대로 재사용됨). ---- */
const BUILDINGS = {
  farm:       { label:"밭",     icon:"bFarm",   desc:"씨앗을 심고 열매를 거두는 경작지",   jobs:["seed","till","fruit","flatten"] },
  restaurant: { label:"레스토랑", icon:"bRestaurant", desc:"수확물로 음식을 만들고 저장하는 곳", jobs:["cook","chill"] },
  dojo:       { label:"훈련소",  icon:"bDojo",   desc:"전투 능력을 단련하고 성장시키는 곳",  jobs:["train","research"] },
  workshop:   { label:"제작소",  icon:"bWorkshop", desc:"재료를 캐고 가공해 자금·도구로 만드는 곳", jobs:["mine","mint","craft"] },
  clinic:     { label:"치료소",  icon:"bClinic", desc:"회복·치료 아이템을 만드는 곳",       jobs:["heal","cure"] },
};
const BUILDING_ORDER = ["farm","restaurant","dojo","workshop","clinic"];
function buildingOf(jobId){
  return BUILDING_ORDER.find(b=> BUILDINGS[b].jobs.includes(jobId));
}
/* 건축물 실사 이미지 — 그려진 건축물이 하나씩 늘어날 예정이므로 key가 없는 건축물은 계속
   ICON_PATHS의 라인 아이콘으로 대체 표시한다(아이콘 → 이미지로 점진적 교체). */
const BUILDING_ART = {
  farm: "assets/plot.png",
  restaurant: "assets/restaurant.png",
  dojo: "assets/training-center.png",
  workshop: "assets/factory.png",
  clinic: "assets/heal-center.png",
};
/* 밭(plot.png)만 부지를 위에서 내려다본 구도라 부지의 사다리꼴 기울기(plotArtSkewDeg)를 따라가야
   자연스럽다 — 나머지는 건물을 정면에서 바라본 구도라 기울이면 오히려 어색해서 skew를 적용하지 않는다.
   scale/shiftXFrac은 에셋마다 실제로 설치해보며 눈으로 맞춘 값 — 밭은 구도가 좌측으로 쏠려 있어
   shift가 필요했고, 나머지 정면 구도 건물들은 대체로 중앙 정렬이 자연스럽다. 훈련소만 이미지 안에
   자체 울타리 마당이 넓게 들어있어 다른 건물보다 살짝 더 키워야 꽉 차 보인다. */
const BUILDING_ART_TOPDOWN = new Set(["farm"]);
const BUILDING_ART_TUNE = {
  farm:       { scale:1.5,  shiftXFrac:0.077 },
  restaurant: { scale:1.5,  shiftXFrac:0 },
  dojo:       { scale:1.65, shiftXFrac:0 },
  workshop:   { scale:1.5,  shiftXFrac:0 },
  clinic:     { scale:1.5,  shiftXFrac:0 },
};
function plotArtLayerHtml(i, buildingKey, label){
  const art = BUILDING_ART[buildingKey];
  if(!art) return "";
  const { scale, shiftXFrac } = BUILDING_ART_TUNE[buildingKey] || { scale:1.5, shiftXFrac:0 };
  const skewDeg = BUILDING_ART_TOPDOWN.has(buildingKey) ? plotArtSkewDeg(i) : 0;
  return `<div class="plot-art-layer" style="${boxStyleStr(plotBox(i),scale,shiftXFrac)}; transform:skewX(${skewDeg.toFixed(2)}deg)"><img src="${art}" alt="${label}"></div>`;
}
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
export let buildings = [];
let nextMemberId = 1;
let nextBuildingId = 1;
let plotCap = PLOT_CAP_START;
let storageCap = 50;
let entryCap = ENTRY_CAP_START;
let turnCount = 0;
export let energy = ENERGY_PER_TURN;
let lastLog = null;
let logFresh = false;   // true인 동안만 dock-activity가 fade-highlight로 강조됨(렌더 1회로 소비되는 1회성 플래그)
let baseMsg = "";

/* ---- HUD 드롭다운/모달 상태 (재렌더 간 유지) ---- */
let openPanel = null;      // "bag" | "ball" | "pc" | "log" | "install" | "task" | "site" | null
let pcSelected = null;     // PC 모달에서 선택된 roster 인덱스
/* 건설(빈 부지 → 건축물)과 직무 할당(건축물 → 구체적 직무)을 2단계로 분리한다.
   1) 건설 모달: 건축물 카테고리만 고르고 개체를 배정 — 이 시점엔 아직 직무(job)가 정해지지 않고
      개체는 "이 건축물 소속(building)"이라는 상태로만 대기한다(m.job=null, m.building=건축물 id).
   2) 직무 할당 모달: 이미 지어진(직무 미정) 건축물 부지를 눌렀을 때 열리며, 그 건축물의 직무 목록 중
      하나를 골라 대기 중인(또는 완전 미배치인) 개체를 실제로 배정한다(이때 m.job이 정해짐). */
let installPicks = new Set();   // 건설 모달에서 선택된 roster 인덱스(완전 미배치 개체만)
let installBuilding = null;     // 건설 모달에서 선택된 건축물 카테고리 id (BUILDINGS의 key 중 하나)
let installPlotIndex = null;
let constructionBuildingId = null;
let constructionPicks = new Set();
let taskBuilding = null;        // 직무 할당 모달이 다루는, 이미 지어진 건축물 id
let taskFacility = null;        // 직무 할당 모달에서 선택된 직무 id (JOBS의 key 중 하나)
let taskPicks = new Set();      // 직무 할당 모달에서 선택된 roster 인덱스
let siteModalJob = null;   // "site" 패널에서 보고 있는 운영 중 직무 id
let sitePicks = new Set(); // site 모달에서 추가 배치할 미배정 roster 인덱스
let itemModalIdx = null;   // "item" 패널에서 도구를 제작/장착 중인 roster 인덱스

/* 건설은 확정 즉시 완성되지 않고 턴이 걸린다 — { [건축물id]: 남은 턴수 }. 기본 3턴에서 시작해서
   투입 인원 1마리당 1턴씩 줄고 최소 1턴에서 멈춘다(1마리=3턴, 2마리=2턴, 3마리 이상=1턴). 인원을
   더 투입하면(같은 건축물로 건설 모달을 다시 열어 추가 배정) 그 시점 총 인원 기준으로 다시 계산된다.
   0턴이 되면 이 표에서 지워지고, 그 즉시 기존 로직대로 "직무 미정 대기(pending)" 상태로 넘어간다. */

/* 자동 저장: 턴 진행 직후 · 포획(로스터 합류) 직후에 호출. localStorage를 못 쓰는 환경(시크릿 모드 등)이어도
   게임 진행에는 지장이 없도록 실패를 조용히 무시한다 */
function saveState(){
  writeStorage(GAME_SAVE_KEY, { v:2, roster, resources, buildings, nextMemberId, nextBuildingId,
    plotCap, storageCap, entryCap, turnCount, energy });
}

function ensureMemberId(member){
  if(!member.id) member.id = `mon-${nextMemberId++}`;
  const n = Number(String(member.id).split("-").pop());
  if(Number.isFinite(n)) nextMemberId = Math.max(nextMemberId, n+1);
  return member.id;
}
function buildingById(id){ return buildings.find(b=>b.id===id); }
function buildingMembers(id){ return roster.map((m,i)=>({m,i})).filter(x=>x.m.buildingId===id); }
function constructionWorkers(id){ return buildingMembers(id).filter(x=>!x.m.job); }
function firstFreePlot(){
  const used = new Set(buildings.map(b=>b.plotIndex));
  for(let i=0;i<plotCap;i++) if(!used.has(i)) return i;
  return -1;
}
function migrateLegacyBuildings(data){
  const legacyTurns = data.underConstruction || {};
  const byType = new Map();
  roster.forEach(m=>{
    const type = m.building || (m.job ? buildingOf(m.job) : null);
    if(!type) return;
    let b = byType.get(type);
    if(!b){
      b = { id:`building-${nextBuildingId++}`, type, plotIndex:byType.size,
        status:legacyTurns[type]>0?"constructing":"active", remainingTurns:legacyTurns[type]||0 };
      byType.set(type,b);
    }
    m.buildingId = b.id;
    delete m.building;
  });
  buildings = [...byType.values()];
}

/* 부팅 시 호출: 저장된 진행이 있으면 복원하고 true를 반환(있으면 드래프트를 건너뛰고 본거지로 바로 진입) */
export function loadState(){
  const data = readStorage(GAME_SAVE_KEY);
  if(!data) return false;
  try{
    if(!data || !Array.isArray(data.roster) || !data.roster.length) return false;
    roster.length = 0;
    data.roster.forEach(m=> roster.push(m));
    nextMemberId = data.nextMemberId || 1;
    roster.forEach(ensureMemberId);
    Object.assign(resources, data.resources||{});
    plotCap = data.plotCap ?? plotCap;
    storageCap = data.storageCap ?? storageCap;
    entryCap = data.entryCap ?? entryCap;
    turnCount = data.turnCount ?? turnCount;
    nextBuildingId = data.nextBuildingId || 1;
    if(Array.isArray(data.buildings)){
      buildings = data.buildings.map(b=>({...b}));
      buildings.forEach(b=>{
        const n=Number(String(b.id).split("-").pop());
        if(Number.isFinite(n)) nextBuildingId=Math.max(nextBuildingId,n+1);
      });
    }else migrateLegacyBuildings(data);
    energy = data.energy ?? ENERGY_PER_TURN;
    saveState();
    return true;
  }catch(e){ return false; }
}

export function addToRoster(entry){
  ensureMemberId(entry);
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
  return roster.filter(m=>m.job||m.buildingId).length;
}
function entryCount(){
  return roster.filter(m=>m.inEntry).length;
}
/* ---- 공터(부지) = "자리" 1개. 자리는 두 종류다: 직무가 정해진 자리(job:직무 하나당 1개, 인원 제한
   없이 몇 마리든 더 배치 가능)와, 건축은 됐지만 아직 직무가 안 정해진 자리(pending:건축물 하나당 1개).
   plotCap은 "동시에 존재할 수 있는 자리 개수"다. ---- */
function activeJobTypes(){
  const set = new Set();
  roster.forEach(m=>{ if(m.job) set.add(m.job); });
  return [...set];
}
function jobMembers(jobId){
  return roster.map((m,i)=>({m,i})).filter(x=>x.m.job===jobId);
}
function usedPlots(){
  return buildings.length;
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

/* 건설: 완전 미배치 개체를 건축물 소속으로만 배정(직무는 아직 없음) — 이미 그 건축물에 대기 중인
   자리가 있으면 거기 합류(자리 추가 소모 없음), 없으면 새 자리를 하나 소모한다. */
function assignBuilding(idx, buildingId){
  const m = roster[idx];
  if(!m || !buildingById(buildingId) || m.job || m.buildingId) return false;
  baseMsg = "";
  m.buildingId = buildingId;
  return true;
}
/* 직무 할당: 이미 건축된(직무 미정) 자리를 그대로 직무 자리로 전환하는 것이므로 새 자리를 소모하지
   않는다 — 이 모달은 애초에 pendingBuildingsSet()에 해당 건축물이 있을 때만 열릴 수 있어 안전하다. */
function assignJob(idx, jobId, buildingId){
  const m = roster[idx];
  if(!m) return false;
  baseMsg = "";
  if(jobId){ m.buildingId = buildingId || m.buildingId; m.job = jobId; }
  else { m.job = null; }
  return true;
}
/* 해제: 직무든 건축물 소속이든 전부 풀어서 완전 미배치 상태로 되돌린다(항상 "자리"를 줄이거나
   유지할 뿐 새 자리를 만들지 않으므로 별도의 정원 체크가 필요 없다). */
function unassignAll(idx){
  const m = roster[idx];
  if(!m) return false;
  m.job = null;
  m.buildingId = null;
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

  buildings.filter(b=>b.status==="constructing").forEach(b=>{
    if(!constructionWorkers(b.id).length) return;
    b.remainingTurns--;
    if(b.remainingTurns<=0){ b.remainingTurns=0; b.status="active"; }
  });

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
  logFresh = true;
  openPanel = "log";
  saveState();
  renderBase();
}

/* 본거지 부지: town-bg.png 안에 이미 그려진 흙밭 10칸(5x2) 위에 좌표만 얹는다.
   공터 상한(plotCap)만큼은 자리 하나당 1칸씩 보여주고(같은 직무/같은 건축물은 인원 무관 1칸에 모임),
   자리는 "직무가 정해진 자리"와 "건축은 됐지만 직무 미정인 자리" 두 종류다. 남는 칸은 빈 공터(건설
   가능), plotCap을 넘는 영역은 아직 개척되지 않은 미개척지 — 사각 카드가 아니라 실제 흙밭의 원근
   사다리꼴 폴리곤을 hit-area/시각 반응 영역으로 그대로 사용한다. */
function plotScene(){
  const tiles = [];
  for(let i=0;i<TOTAL_PLOT_AREA;i++){
    const pts = plotPolygon(i);
    const clip = clipPathStr(pts);
    const posStyle = boxStyleStr(plotBox(i));
    const [tagXl, tagYl] = plotCentroid(i);
    const [tagXg, tagYg] = plotLocalToGlobal(i, tagXl, tagYl);
    const tagStyle = `left:${tagXg.toFixed(2)}%; top:${tagYg.toFixed(2)}%`;
    const [spriteXl, spriteYl] = plotBottomAnchor(i);
    const [spriteXg, spriteYg] = plotLocalToGlobal(i, spriteXl, spriteYl);
    const spriteTagStyle = `left:${spriteXg.toFixed(2)}%; top:${spriteYg.toFixed(2)}%`;
    if(i < plotCap){
      const site = buildings.find(b=>b.plotIndex===i);
      if(site?.status==="active"){
        const building = site.type;
        const art = BUILDING_ART[building];
        const artLayer = plotArtLayerHtml(i, building, BUILDINGS[building]?.label);
        const members = buildingMembers(site.id);
        const jobs = [...new Set(members.map(x=>x.m.job).filter(Boolean))];
        const jobLabel = jobs.length ? jobs.map(j=>JOBS[j]?.label).join(" · ") : "직무 미할당";
        tiles.push(`
          ${artLayer}
          <div class="plot ${jobs.length?"filled":"pending"} ${art?"has-art":""}" style="${posStyle}; clip-path:${clip}" data-plot-pending="${site.id}" title="${BUILDINGS[building]?.label||""} · ${jobLabel} · ${members.length}마리 배치">
            ${plotFxSvg(pts, !jobs.length)}
            <span class="plot-info"><b>${BUILDINGS[building]?.label||""} · ${jobLabel}</b>${members.length}마리 배치</span>
          </div>
          <span class="plot-tag sprite-tag" style="${spriteTagStyle}">${spriteClusterHtml(members, i)}</span>`);
      }else if(site?.status==="constructing"){
        const buildingKey = site.type;
        const art = BUILDING_ART[buildingKey];
        const artLayer = plotArtLayerHtml(i, buildingKey, BUILDINGS[buildingKey]?.label);
        const members = constructionWorkers(site.id);
        const turnsLeft = site.remainingTurns;
        tiles.push(`
          ${artLayer}
          <div class="plot constructing ${art?"has-art":""}" style="${posStyle}; clip-path:${clip}" data-plot-construction="${site.id}" title="${BUILDINGS[buildingKey].label} 공사 ${members.length?"중":"일시정지"} · ${turnsLeft}턴 남음 · ${members.length}마리 투입">
            ${plotFxSvg(pts)}
            <span class="plot-info"><b>${members.length?"공사 중":"공사 일시정지"}</b>${members.length}마리 투입 · 눌러서 인력을 관리하세요</span>
          </div>
          <span class="plot-tag sprite-tag" style="${spriteTagStyle}">${spriteClusterHtml(members, i)}<span class="plot-turns-badge">${turnsLeft}턴</span></span>`);
      }else{
        tiles.push(`
          <div class="plot empty" style="${posStyle}; clip-path:${clip}" data-plot-install="${i}">
            ${plotFxSvg(pts, true)}
            <span class="plot-info">건축물을 지을 수 있습니다</span>
          </div>
          <span class="plot-tag" style="${tagStyle}">${icon("plus",15)}<span>건설</span></span>`);
      }
    }else{
      tiles.push(`
        <div class="plot locked" style="${posStyle}; clip-path:${clip}" title="땅 평탄화로 개척할 수 있는 미개척지">
          ${plotFxSvg(pts)}
          <span class="plot-info">개척 조건 미달성</span>
        </div>
        <span class="plot-tag" style="${tagStyle}">${icon("lock",14)}<span>미개척지</span></span>`);
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
  const assignedBuilding = buildingById(m.buildingId);
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
          ? `<span class="rc-job-label">${BUILDINGS[buildingOf(m.job)]?.label||""} · ${JOBS[m.job]?.label||""}</span><button data-unassign="${i}" class="rc-unassign">해제</button>`
          : assignedBuilding
            ? `<span class="rc-job-label">${BUILDINGS[assignedBuilding.type]?.label||""} ${assignedBuilding.status==="constructing"?`공사 ${constructionWorkers(assignedBuilding.id).length?"중":"일시정지"}(${assignedBuilding.remainingTurns}턴 남음)`:"건설 완료 · 직무 미할당"}</span><button data-unassign="${i}" class="rc-unassign">해제</button>`
            : `<span class="rc-job-label dim">미배정 · 부지의 빈 공터에서 건설하세요</span>`}
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
        <span class="hud-bracket tr"></span><span class="hud-bracket bl"></span>
        <span class="th-cycle">${icon("cycle",16)}</span>
        <div class="th-turn">
          <span class="th-eyebrow">TURN</span>
          <span class="th-num">${String(turnCount).padStart(2,"0")}</span>
        </div>
        <span class="turn-hud-div"></span>
        <div class="th-energy">
          <span class="th-eyebrow">${icon("bolt",12)}행동력</span>
          <div class="th-energy-row">
            <span class="energy-gauge">${segs}</span>
            <span class="th-frac">${energy}/${ENERGY_PER_TURN}</span>
          </div>
        </div>
      </div>
      <div class="cmdbar">
        <span class="hud-bracket tr"></span><span class="hud-bracket bl"></span>
        <button class="cmd-item ${openPanel==="pc"?"active":""}" data-hud="pc" title="보유 포켓몬">
          ${icon("pc",19)}<span class="cmd-label">PC</span>
          ${roster.length ? `<span class="cmd-badge">${roster.length}</span>` : ""}
        </button>
        <button class="cmd-item ${openPanel==="ball"?"active":""}" data-hud="ball" title="전투 엔트리">
          ${icon("entry",19)}<span class="cmd-label">엔트리</span>
          <span class="cmd-badge">${entryCount()}/${entryCap}</span>
        </button>
        <button class="cmd-item ${openPanel==="shop"?"active":""}" data-hud="shop" title="상점(자금 소비)">
          ${icon("shop",19)}<span class="cmd-label">상점</span>
        </button>
        <button class="cmd-item ${openPanel==="bag"?"active":""}" data-hud="bag" title="자원 현황">
          ${icon("gauge",19)}<span class="cmd-label">자원</span>
        </button>
        <button class="cmd-item" data-action="map" title="세력전 지도">
          ${icon("map",19)}<span class="cmd-label">지도</span>
        </button>
        <button class="cmd-item" data-action="hunt" title="사냥하러 나가기 (에너지 ${HUNT_ENERGY_COST})" ${energy<HUNT_ENERGY_COST?"disabled":""}>
          ${icon("explore",19)}<span class="cmd-label">탐험</span>
        </button>
      </div>
    </div>`;
}

function activitySummaryText(){
  if(!lastLog) return "이번 턴에 발생한 변화 없음";
  const parts = [];
  Object.entries(lastLog.gain).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} +${v}`); });
  Object.entries(lastLog.used).forEach(([k,v])=>{ if(v>0) parts.push(`${RES_META[k]} -${v}`); });
  let text = parts.length ? parts.join(" · ") : "이번 턴에 발생한 변화 없음";
  if(lastLog.left && lastLog.left.length) text += ` · ${lastLog.left.join(", ")} 이탈`;
  if(lastLog.raided && lastLog.raided.length) text += ` · ${lastLog.raided.join(", ")} 피습`;
  return text;
}

/* ---- HUD 하단: 마을 정보 · 최근 활동 · 다음 턴을 카드 3개가 아니라 하나의 Dock 안에서
   타이포그래피와 얇은 구분선만으로 나눈다 ---- */
function bottomDock(){
  const pct = Math.round(plotCap/TOTAL_PLOT_AREA*100);
  const activityFresh = logFresh;
  logFresh = false;   // 이 렌더로 소비 — 같은 lastLog로 다시 렌더될 때는 더 이상 강조하지 않음
  return `
    <div class="hud-dock">
      <div class="dock-zone dock-village">
        <span class="dock-stat">${icon("slot",11,"dock-stat-ic")}배치 <b>${assignedCount()}/${roster.length}</b></span>
        <span class="dock-sep">·</span>
        <span class="dock-stat">${icon("parcel",11,"dock-stat-ic")}개척 <b>${plotCap}/${TOTAL_PLOT_AREA}</b></span>
        <span class="dock-mini-bar"><span style="width:${pct}%"></span></span>
      </div>
      <div class="dock-divider"></div>
      <button class="dock-zone dock-activity" data-hud="log">
        <span class="dock-label">최근 활동</span>
        <span class="dock-activity-text${activityFresh?" just-changed":""}">${activitySummaryText()}</span>
      </button>
      <div class="dock-divider"></div>
      <button class="dock-zone dock-nextturn" id="nextTurn">
        <span class="hud-bracket tr"></span><span class="hud-bracket bl"></span>
        <span class="dn-text">
          <span class="dn-eyebrow">TURN END</span>
          <span class="dn-main">다음 턴</span>
        </span>
        ${icon("chevron",16)}
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

/* 건설 모달(1단계): 빈 부지에서 건축물 카테고리만 고르고 개체를 배정한다. 여기서는 아직 구체적인
   직무를 정하지 않는다 — 그래서 자원 비용도 없고, 필요한 최소 인원도 "1마리 이상"뿐이다. 건축물이
   세워지면(부지에 pending 칸으로 나타나면) 그 칸을 눌러야 taskModal()에서 실제 직무를 고르게 된다. */
function installModal(){
  if(!BUILDING_ORDER.includes(installBuilding)) installBuilding = BUILDING_ORDER[0];
  const unassigned = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job && !x.m.buildingId);
  const validPicks = [...installPicks].filter(i=> roster[i] && !roster[i].job && !roster[i].buildingId);
  if(validPicks.length !== installPicks.size) installPicks = new Set(validPicks);
  const enough = installPicks.size>=1 && energy>=INSTALL_ENERGY_COST;
  const grid = unassigned.map(({m,i})=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${installPicks.has(i)?"selected":""}" data-install-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("");
  return `
    <div class="modal-overlay" data-modal="install">
      <div class="modal-box">
        <div class="modal-head"><span>건설 · 배정 가능 ${Math.max(0, plotCap-usedPlots())}칸</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          <div class="install-buildings">
            ${BUILDING_ORDER.map(b=>{
              return `
                <button class="install-building ${installBuilding===b?"active":""} ${BUILDING_ART[b]?"has-art":""}" data-install-building="${b}" title="${BUILDINGS[b].desc}">
                  ${BUILDING_ART[b] ? `<img class="install-building-art" src="${BUILDING_ART[b]}" alt="">` : icon(BUILDINGS[b].icon,20)}<span>${BUILDINGS[b].label}</span>
                </button>`;
            }).join("")}
          </div>
          <div class="install-note install-building-desc">${BUILDINGS[installBuilding].desc}</div>
          <div class="install-note">부지 ${Number(installPlotIndex)+1} · 기본 3턴 · 현재 선택 ${installPicks.size}마리 → <b>${installPicks.size?constructionTurns(installPicks.size):"-"}턴</b> · 3마리부터 최대 단축 · 에너지 ${INSTALL_ENERGY_COST}</div>
          ${energy<INSTALL_ENERGY_COST ? `<div class="install-note" style="color:var(--bad)">에너지가 부족하여 건설할 수 없습니다. (${energy}/${ENERGY_PER_TURN})</div>` : ""}
          ${unassigned.length
            ? `<div class="pc-grid">${grid}</div>`
            : `<div class="logempty">배정할 수 있는 개체가 없습니다. 모든 개체가 이미 배치되어 있습니다.</div>`}
          <button class="btn wide install-confirm" data-build-confirm ${enough?"":"disabled"}>
            ${BUILDINGS[installBuilding].label} 건설 (${installPicks.size}마리 선택됨)
          </button>
        </div>
      </div>
    </div>`;
}

function constructionModal(){
  const b = buildingById(constructionBuildingId);
  if(!b) return "";
  const workers = constructionWorkers(b.id);
  const available = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job && !x.m.buildingId);
  const valid = [...constructionPicks].filter(i=>available.some(x=>x.i===i));
  if(valid.length!==constructionPicks.size) constructionPicks=new Set(valid);
  const grid = available.map(({m,i})=>{
    const sprite=m.pokemon.details?.sprites?.front_default||ART(m.pokemon.pokemonRowid);
    return `<div class="pc-cell ${constructionPicks.has(i)?"selected":""}" data-construction-pick="${i}">
      ${entryBadge(m)}<img src="${sprite}" alt="${m.pokemon.nameKr}"><span class="pc-cell-name">${m.pokemon.nameKr}</span></div>`;
  }).join("");
  const projected = constructionPicks.size
    ? Math.min(b.remainingTurns, constructionTurns(workers.length+constructionPicks.size))
    : b.remainingTurns;
  return `<div class="modal-overlay" data-modal="construction"><div class="modal-box">
    <div class="modal-head"><span>${BUILDINGS[b.type].label} · 공사 관리</span><button class="dd-close" data-hud-close>✕</button></div>
    <div class="modal-body">
      <div class="install-note">현재 ${workers.length}마리 · ${b.remainingTurns}턴 남음${workers.length?"":" · 인력이 없어 일시정지"}</div>
      <div class="entry-list">${workers.map(({m,i})=>`<div class="entry-row"><span>${m.pokemon.nameKr}</span><button data-construction-remove="${i}" class="rc-unassign">회수</button></div>`).join("")||`<div class="logempty">배정된 건설 인력이 없습니다.</div>`}</div>
      <div class="install-note" style="margin-top:12px">추가 인력 · 선택 후 ${projected}턴 남음 · 한 번에 추가하면 에너지 ${INSTALL_ENERGY_COST}</div>
      ${available.length?`<div class="pc-grid">${grid}</div>`:`<div class="logempty">추가할 수 있는 미배치 포켓몬이 없습니다.</div>`}
      <button class="btn wide install-confirm" data-construction-add ${constructionPicks.size&&energy>=INSTALL_ENERGY_COST?"":"disabled"}>추가 배치 (${constructionPicks.size}마리)</button>
      <button class="btn wide" data-construction-cancel>공사 취소</button>
    </div></div></div>`;
}

/* 직무 할당 모달(2단계): 이미 건설된(직무 미정) 건축물 부지를 눌렀을 때 연다. 그 건축물이 만들 수
   있는 직무 중 하나를 고르고, 이미 대기 중인 개체 + 아직 완전히 미배치인 개체 중에서 인원을 배정한다.
   이 시점에 비로소 자원 비용(installCost)이 든다. 새 부지를 소모하지 않으므로(이미 건설 때 자리를
   확보해둔 상태라) 정원 체크가 필요 없다. */
function taskModal(){
  const targetBuilding = buildingById(taskBuilding);
  if(!targetBuilding) return "";
  const buildingJobs = new Set(buildingMembers(targetBuilding.id).map(x=>x.m.job).filter(Boolean));
  const availableJobs = BUILDINGS[targetBuilding.type].jobs.filter(j=>!buildingJobs.has(j));
  if(!availableJobs.length){
    return `
      <div class="modal-overlay" data-modal="task">
        <div class="modal-box">
          <div class="modal-head"><span>${BUILDINGS[targetBuilding.type].label} · 직무 할당</span><button class="dd-close" data-hud-close>✕</button></div>
          <div class="modal-body">
            <div class="logempty">이 건축물이 만들 수 있는 직무가 이미 전부 가동 중입니다.</div>
          </div>
        </div>
      </div>`;
  }
  if(!availableJobs.includes(taskFacility)) taskFacility = availableJobs[0];
  const job = JOBS[taskFacility];
  const eligible = roster.map((m,i)=>({m,i})).filter(x=> !x.m.job && (x.m.buildingId===targetBuilding.id || !x.m.buildingId));
  const validPicks = [...taskPicks].filter(i=> eligible.some(x=>x.i===i));
  if(validPicks.length !== taskPicks.size) taskPicks = new Set(validPicks);
  const afford = canAfford(job.installCost);
  const grid = eligible.map(({m,i})=>{
    const sprite = m.pokemon.details?.sprites?.front_default || ART(m.pokemon.pokemonRowid);
    return `
      <div class="pc-cell ${taskPicks.has(i)?"selected":""}" data-task-pick="${i}">
        ${entryBadge(m)}
        <img src="${sprite}" alt="${m.pokemon.nameKr}">
        <span class="pc-cell-name">${m.pokemon.nameKr}</span>
      </div>`;
  }).join("");
  const enough = taskPicks.size >= job.minMembers && energy>=INSTALL_ENERGY_COST && afford;
  return `
    <div class="modal-overlay" data-modal="task">
      <div class="modal-box">
        <div class="modal-head"><span>${BUILDINGS[targetBuilding.type].label} · 직무 할당</span><button class="dd-close" data-hud-close>✕</button></div>
        <div class="modal-body">
          <div class="install-tabs">
            ${availableJobs.map(j=>`<button class="install-tab ${taskFacility===j?"active":""}" data-task-facility="${j}">${JOBS[j].label}</button>`).join("")}
          </div>
          <div class="install-note">${jobDescription(taskFacility)} 최소 인원 ${job.minMembers}마리 · 설치 비용: ${describeCost(job.installCost)} · 에너지 ${INSTALL_ENERGY_COST}</div>
          ${!afford ? `<div class="install-note" style="color:var(--bad)">자원이 부족하여 배정할 수 없습니다. (필요: ${describeCost(job.installCost)})</div>` : ""}
          ${energy<INSTALL_ENERGY_COST ? `<div class="install-note" style="color:var(--bad)">에너지가 부족하여 배정할 수 없습니다. (${energy}/${ENERGY_PER_TURN})</div>` : ""}
          ${eligible.length
            ? `<div class="pc-grid">${grid}</div>`
            : `<div class="logempty">배정할 수 있는 개체가 없습니다.</div>`}
          <button class="btn wide install-confirm" data-task-confirm ${enough?"":"disabled"}>
            ${job.label} 배정 (${taskPicks.size}/${job.minMembers}+ 선택됨)
          </button>
        </div>
      </div>
    </div>`;
}

/* 운영 중인 시설(부지의 채워진 칸) 클릭 시: 현재 근무 인원을 보여주고, 미배정 개체를 더 추가 배치할 수 있게 함 */
function siteModal(){
  const jobId = siteModalJob;
  const job = JOBS[jobId];
  const building = buildingOf(jobId);
  const members = jobMembers(jobId);
  // 추가 배치 후보 = 완전 미배치 개체 + 같은 건축물에 이미 배정 대기 중인(직무 미정) 개체
  // (다른 건축물에 대기 중인 개체는 그 건축물의 직무 할당 모달에서만 배정할 수 있다)
  const unassigned = roster.map((m,i)=>({m,i})).filter(x=>!x.m.job && (!x.m.building || x.m.building===building));
  const validPicks = [...sitePicks].filter(i=> unassigned.some(x=>x.i===i));
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
        <div class="modal-head"><span>${BUILDINGS[buildingOf(jobId)]?.label||""} · ${job?.label||""} · ${members.length}마리 근무 중</span><button class="dd-close" data-hud-close>✕</button></div>
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
    ${openPanel==="construction" ? constructionModal() : ""}
    ${openPanel==="task" ? taskModal() : ""}
    ${openPanel==="site" ? siteModal() : ""}
    ${openPanel==="item" ? itemModal() : ""}
  `;

  app.querySelectorAll("[data-plot-site]").forEach(el=> el.onclick = ()=>{
    siteModalJob = el.dataset.plotSite;
    sitePicks = new Set();
    openPanel = "site";
    renderBase();
  });
  app.querySelectorAll("[data-plot-pending]").forEach(el=> el.onclick = ()=>{
    taskBuilding = el.dataset.plotPending;
    taskFacility = null;   // taskModal()이 열리면서 아직 가동 중이 아닌 첫 직무로 자동 선택됨
    taskPicks = new Set();
    openPanel = "task";
    renderBase();
  });
  app.querySelectorAll("[data-plot-construction]").forEach(el=> el.onclick = ()=>{
    constructionBuildingId = el.dataset.plotConstruction;
    constructionPicks = new Set();
    openPanel = "construction";
    renderBase();
  });
  app.querySelectorAll("[data-plot-install]").forEach(el=> el.onclick = ()=>{
    installBuilding = null;   // installModal()이 열리면서 지을 수 있는 첫 건축물로 자동 선택됨
    installPicks = new Set();
    installPlotIndex = +el.dataset.plotInstall;
    openPanel = "install";
    renderBase();
  });
  app.querySelectorAll("[data-install-building]").forEach(b=> b.onclick = ()=>{
    installBuilding = b.dataset.installBuilding;
    installPicks = new Set();
    renderBase();
  });
  app.querySelectorAll("[data-install-pick]").forEach(el=> el.onclick = ()=>{
    const idx = +el.dataset.installPick;
    if(installPicks.has(idx)) installPicks.delete(idx); else installPicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-build-confirm]")?.addEventListener("click", ()=>{
    if(!installBuilding) return;
    const picks = [...installPicks];
    if(!picks.length) return;
    if(usedPlots()>=plotCap || buildings.some(b=>b.plotIndex===installPlotIndex)){
      baseMsg = `공터를 모두 사용 중입니다(${usedPlots()}/${plotCap}). 땅 평탄화로 부지를 늘리세요.`;
      renderBase();
      return;
    }
    if(!spendEnergy(INSTALL_ENERGY_COST)){ renderBase(); return; }
    const b={ id:`building-${nextBuildingId++}`, type:installBuilding, plotIndex:installPlotIndex,
      status:"constructing", remainingTurns:constructionTurns(picks.length) };
    buildings.push(b);
    picks.forEach(idx=> assignBuilding(idx, b.id));
    saveState();
    installPicks = new Set();
    openPanel = null;
    renderBase();
  });
  app.querySelectorAll("[data-construction-pick]").forEach(el=>el.onclick=()=>{
    const idx=+el.dataset.constructionPick;
    if(constructionPicks.has(idx)) constructionPicks.delete(idx); else constructionPicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-construction-add]")?.addEventListener("click",()=>{
    const b=buildingById(constructionBuildingId);
    const picks=[...constructionPicks];
    if(!b||!picks.length||!spendEnergy(INSTALL_ENERGY_COST)){ renderBase(); return; }
    picks.forEach(idx=>assignBuilding(idx,b.id));
    b.remainingTurns=projectedConstructionTurns(b.remainingTurns,constructionWorkers(b.id).length);
    constructionPicks=new Set(); saveState(); renderBase();
  });
  app.querySelectorAll("[data-construction-remove]").forEach(el=>el.onclick=()=>{
    const m=roster[+el.dataset.constructionRemove];
    if(m?.buildingId===constructionBuildingId&&!m.job){ m.buildingId=null; saveState(); renderBase(); }
  });
  app.querySelector("[data-construction-cancel]")?.addEventListener("click",()=>{
    const b=buildingById(constructionBuildingId); if(!b) return;
    buildingMembers(b.id).forEach(({m})=>{m.buildingId=null;m.job=null;});
    buildings=buildings.filter(x=>x.id!==b.id);
    constructionBuildingId=null; openPanel=null; saveState(); renderBase();
  });
  app.querySelectorAll("[data-task-facility]").forEach(b=> b.onclick = ()=>{
    taskFacility = b.dataset.taskFacility;
    taskPicks = new Set();
    renderBase();
  });
  app.querySelectorAll("[data-task-pick]").forEach(el=> el.onclick = ()=>{
    const idx = +el.dataset.taskPick;
    if(taskPicks.has(idx)) taskPicks.delete(idx); else taskPicks.add(idx);
    renderBase();
  });
  app.querySelector("[data-task-confirm]")?.addEventListener("click", ()=>{
    if(!taskFacility) return;
    const job = JOBS[taskFacility];
    const picks = [...taskPicks];
    if(picks.length < job.minMembers) return;
    if(!canAfford(job.installCost)){
      baseMsg = `자원이 부족하여 배정할 수 없습니다. (필요: ${describeCost(job.installCost)})`;
      renderBase();
      return;
    }
    if(!spendEnergy(INSTALL_ENERGY_COST)){ renderBase(); return; }
    if(job.installCost) Object.entries(job.installCost).forEach(([k,v])=> resources[k]-=v);
    picks.forEach(idx=> assignJob(idx, taskFacility, taskBuilding));
    saveState();
    taskPicks = new Set();
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
    saveState();
    sitePicks = new Set();
    openPanel = null;
    renderBase();
  });
  app.querySelectorAll("[data-unassign]").forEach(b=> b.onclick = ()=>{
    if(!spendEnergy(UNASSIGN_ENERGY_COST)){ renderBase(); return; }
    unassignAll(+b.dataset.unassign);
    saveState();
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
    openPanel = null; installPicks = new Set(); taskPicks = new Set(); sitePicks = new Set(); constructionPicks = new Set(); renderBase();
  });
  app.querySelector('[data-modal="pc"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="pc"){ openPanel = null; renderBase(); }
  });
  app.querySelector('[data-modal="install"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="install"){ openPanel = null; installPicks = new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="construction"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="construction"){ openPanel=null; constructionPicks=new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="task"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="task"){ openPanel = null; taskPicks = new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="site"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="site"){ openPanel = null; sitePicks = new Set(); renderBase(); }
  });
  app.querySelector('[data-modal="item"]')?.addEventListener("click", (e)=>{
    if(e.target.dataset.modal==="item"){ openPanel = null; renderBase(); }
  });
}
