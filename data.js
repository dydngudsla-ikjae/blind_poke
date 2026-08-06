// ===== 공용 데이터 로드 + 유틸 =====

export const TYPE_COLORS = {
  노말:"#9aa2ab",격투:"#d1425b",비행:"#8fb7ff",독:"#a24bd6",땅:"#d6a94b",바위:"#b8a05c",
  벌레:"#8bbf3d",고스트:"#7d6ca8",강철:"#8fa0b3",불꽃:"#ff6b3d",물:"#4d90ff",풀:"#4caf50",
  전기:"#f7c948",에스퍼:"#ff5aa8",얼음:"#5cd6d6",드래곤:"#7a5bff",악:"#6a6470",페어리:"#ff9ecf"
};
export const STAT_LABEL = {hp:"HP",atk:"공격",def:"방어",satk:"특공",sdef:"특방",spd:"스피드"};
export const ART = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
export const $ = (s,r=document)=>r.querySelector(s);
export const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

export let POKE=[], TYPE={}, MOVE={}, ABILITY={};

export async function loadData(){
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
}

export function types(p){
  return [p.type1Rowid,p.type2Rowid].filter((v,i,arr)=>arr.indexOf(v)===i).map(id=>TYPE[id]).filter(Boolean);
}
