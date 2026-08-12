// ===== 공용 데이터 로드 + 유틸 =====
import { loadGameData } from "./src/services/dataService.ts";

export const TYPE_COLORS = {
  노말:"#9aa2ab",격투:"#d1425b",비행:"#8fb7ff",독:"#a24bd6",땅:"#d6a94b",바위:"#b8a05c",
  벌레:"#8bbf3d",고스트:"#7d6ca8",강철:"#8fa0b3",불꽃:"#ff6b3d",물:"#4d90ff",풀:"#4caf50",
  전기:"#f7c948",에스퍼:"#ff5aa8",얼음:"#5cd6d6",드래곤:"#7a5bff",악:"#6a6470",페어리:"#ff9ecf"
};
export const STAT_LABEL = {hp:"HP",atk:"공격",def:"방어",satk:"특공",sdef:"특방",spd:"스피드"};
export const ART = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
export const $ = (s,r=document)=>r.querySelector(s);
export const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

export let POKE=[], TYPE={}, MOVE={}, ABILITY={}, MOVE_DATA={}, TYPE_CHART={};

export async function loadData(){
  const { pokemon:pk, types:tp, moves:mv, abilities:ab } = await loadGameData();
  tp.forEach(t=>{ TYPE[t.typeRowid]=t.nameKr; TYPE_CHART[t.typeRowid]=t.relation?.relationMap||{}; });
  mv.forEach(m=>{ MOVE[m.moveRowid]=m.nameKr; MOVE_DATA[m.moveRowid]=m; });
  ab.forEach(a=> ABILITY[a.abilityRowid]=a.nameKr);
  POKE = pk.filter(p=>p.details?.isDefault !== false);
}

/* 배틀에서 실제로 쓸 수 있는 기술만 필터링 — move.json 중 일부는 "사용할 수 없는 기술"로 명시돼 있음 */
export function isUsableMove(moveId){
  const m = MOVE_DATA[moveId];
  return !!m && !(m.descriptionKr||"").includes("사용할 수 없는");
}
/* 공격측 typeRowid → 방어측 typeRowid 상성 배율(0.5/1/2 등). type.json의 relationMap은
   "이 타입이 상대 타입으로부터 받는/주는 배율"이므로 공격자 기준 typeRowid에서 조회해 damageTo를 사용 */
export function typeEffectiveness(attackTypeRowid, defenderTypeRowids){
  const rel = TYPE_CHART[attackTypeRowid] || {};
  return defenderTypeRowids.reduce((mult, tId)=> mult * (rel[tId]?.damageTo ?? 1), 1);
}

export function types(p){
  return [p.type1Rowid,p.type2Rowid].filter((v,i,arr)=>arr.indexOf(v)===i).map(id=>TYPE[id]).filter(Boolean);
}
