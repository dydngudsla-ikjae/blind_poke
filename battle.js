// ===== 배틀: 실제 종족값·기술 위력/명중·타입 상성표를 쓰는 1v1 순차 배틀 =====
// 범위: 변화(상태) 기술은 로그에만 표시되고 스탯 변화는 적용하지 않음(추후 과제).
// 특성 효과·기상/필드·상태이상 지속효과·장착 도구 효과는 이번 배틀에 적용하지 않음(base.js 쪽 경영 효과와 별개).
import { ART, TYPE, MOVE_DATA, isUsableMove, typeEffectiveness, rnd, $ } from "./data.js";

let battle = null; // { playerTeam, enemyTeam, activeP, activeE, log, over, result }

const FALLBACK_MOVE = { id:0, name:"몸통박치기", power:40, accuracy:100, damageClass:2, typeRowid:1 };

function pickMoveset(pokemon){
  const ids = (pokemon.details?.moveRowids||[]).filter(isUsableMove);
  const shuffle = arr => [...arr].sort(()=>Math.random()-0.5);
  const dmgIds = shuffle(ids.filter(id=> MOVE_DATA[id].details.power>0)).slice(0,3);
  const statusIds = shuffle(ids.filter(id=> !(MOVE_DATA[id].details.power>0))).slice(0, 4-dmgIds.length);
  const picked = [...dmgIds, ...statusIds];
  for(const id of shuffle(ids)){
    if(picked.length>=4) break;
    if(!picked.includes(id)) picked.push(id);
  }
  const moves = picked.map(id=>{
    const m = MOVE_DATA[id];
    return { id, name:m.nameKr, power:m.details.power, accuracy:m.details.accuracy,
              damageClass:m.details.damageClass, typeRowid:m.typeRowid };
  });
  return moves.length ? moves : [FALLBACK_MOVE];
}

/* entry: {pokemon, level, iv} 형태(로스터 개체 또는 지도에서 생성한 야생 수비대 정의 모두 호환) */
function buildCombatant(entry, isPlayer){
  const p = entry.pokemon;
  const level = entry.level || 1;
  const iv = entry.iv || {};
  const types = [p.type1Rowid, p.type2Rowid].filter((v,i,a)=> v!=null && a.indexOf(v)===i);
  const stat = k => k==="hp"
    ? Math.max(1, Math.round(p.hp*2 + (iv.hp||0) + level*2 + 10))
    : Math.max(1, Math.round(p[k] + (iv[k]||0) + level));
  const stats = { hp:stat("hp"), atk:stat("atk"), def:stat("def"), satk:stat("satk"), sdef:stat("sdef"), spd:stat("spd") };
  return {
    name: p.nameKr,
    sprite: p.details?.sprites?.front_default || ART(p.pokemonRowid),
    types, level, stats,
    maxHp: stats.hp, curHp: stats.hp,
    moves: pickMoveset(p),
    fainted:false, isPlayer,
  };
}

function pickEnemyMove(actor){
  const dmg = actor.moves.filter(m=>m.damageClass!==1 && m.power>0);
  const pool = dmg.length ? dmg : actor.moves;
  return pool[rnd(0,pool.length-1)];
}

function log(line){ battle.log.unshift(line); }

function applyMove(actor, target, move){
  const acc = move.accuracy || 0;
  const hits = acc<=0 ? true : Math.random()*100 < acc;
  if(!hits){ log(`${actor.name}의 ${move.name}! 하지만 빗나갔다!`); return; }
  if(move.damageClass===1){
    log(`${actor.name}의 ${move.name}!`);
    return; // 변화 기술: 이번 범위에서는 스탯 변화 미적용
  }
  const atkStat = move.damageClass===2 ? actor.stats.atk : actor.stats.satk;
  const defStat = move.damageClass===2 ? target.stats.def : target.stats.sdef;
  const stab = actor.types.includes(move.typeRowid) ? 1.5 : 1;
  const eff = typeEffectiveness(move.typeRowid, target.types);
  if(eff===0){ log(`${actor.name}의 ${move.name}! ${target.name}에게는 효과가 없는 것 같다...`); return; }
  const rand = 0.85 + Math.random()*0.15;
  const raw = ((2*actor.level/5+2) * move.power * atkStat/defStat / 50 + 2) * stab * eff * rand;
  const dmg = Math.max(1, Math.round(raw));
  target.curHp = Math.max(0, target.curHp - dmg);
  const tag = eff>1 ? " 효과는 굉장했다!" : (eff<1 ? " 효과는 별로인 듯하다..." : "");
  log(`${actor.name}의 ${move.name}! ${target.name}에게 ${dmg}의 데미지!${tag}`);
  if(target.curHp<=0){ target.fainted = true; log(`${target.name}은(는) 쓰러졌다!`); }
}

function syncActive(){
  if(battle.playerTeam[battle.activeP]?.fainted){
    const next = battle.playerTeam.findIndex(m=>!m.fainted);
    if(next>=0 && next!==battle.activeP){ battle.activeP = next; log(`${battle.playerTeam[next].name}, 나서라!`); }
  }
  if(battle.enemyTeam[battle.activeE]?.fainted){
    const next = battle.enemyTeam.findIndex(m=>!m.fainted);
    if(next>=0 && next!==battle.activeE){ battle.activeE = next; log(`상대의 ${battle.enemyTeam[next].name}(이)가 나왔다!`); }
  }
}

function battleOutcome(){
  if(battle.playerTeam.every(m=>m.fainted)) return "lose";
  if(battle.enemyTeam.every(m=>m.fainted)) return "win";
  return null;
}

function resolveTurn(moveIdx){
  if(battle.over) return;
  const p = battle.playerTeam[battle.activeP];
  const e = battle.enemyTeam[battle.activeE];
  const pMove = p.moves[moveIdx] || FALLBACK_MOVE;
  const eMove = pickEnemyMove(e);
  const pFirst = p.stats.spd===e.stats.spd ? Math.random()<0.5 : p.stats.spd>e.stats.spd;
  const order = pFirst ? [[p,e,pMove],[e,p,eMove]] : [[e,p,eMove],[p,e,pMove]];
  for(const [actor,target,move] of order){
    if(actor.fainted || target.fainted) continue;
    applyMove(actor, target, move);
    syncActive();
    const outcome = battleOutcome();
    if(outcome){ battle.over = true; battle.result = outcome; break; }
  }
  render();
}

function pctHp(m){ return Math.max(0, Math.round((m.curHp/m.maxHp)*100)); }

function monBlock(m, side){
  return `
    <div class="battle-mon ${side} ${m.fainted?"fainted":""}">
      <img src="${m.sprite}" alt="${m.name}">
      <div class="battle-name">${m.name} <span class="battle-lv">Lv.${m.level}</span></div>
      <div class="battle-hpbar"><div class="battle-hpfill" style="width:${pctHp(m)}%"></div></div>
      <div class="battle-hptext">${m.curHp}/${m.maxHp}</div>
    </div>`;
}

function render(){
  const app = $("#app");
  const p = battle.playerTeam[battle.activeP];
  const e = battle.enemyTeam[battle.activeE];
  const moveButtons = (p && !battle.over) ? p.moves.map((mv,i)=>`
      <button class="battle-move" data-move="${i}">
        <span class="bm-name">${mv.name}</span>
        <span class="bm-meta">${TYPE[mv.typeRowid]||""} · ${mv.damageClass===1?"변화":`위력 ${mv.power} · 명중 ${mv.accuracy||100}%`}</span>
      </button>`).join("") : "";
  app.innerHTML = `
    <div class="battle-scene">
      <div class="battle-field">
        ${e ? monBlock(e,"enemy") : ""}
        ${p ? monBlock(p,"player") : ""}
      </div>
      <div class="battle-log">${battle.log.slice(0,6).map(l=>`<div class="logline">${l}</div>`).join("")}</div>
      ${battle.over
        ? `<div class="battle-result ${battle.result}">${battle.result==="win"?"승리했다!":"패배했다..."}</div>
           <button class="btn wide" id="battleContinue">계속하기</button>`
        : `<div class="battle-moves">${moveButtons}</div>`}
    </div>`;

  if(!battle.over){
    app.querySelectorAll("[data-move]").forEach(b=> b.onclick = ()=> resolveTurn(+b.dataset.move));
  }else{
    $("#battleContinue").onclick = ()=>{
      const result = battle.result;
      const onEnd = battle.onEnd;
      battle = null;
      onEnd(result);
    };
  }
}

/* playerEntries: 전투 엔트리(inEntry) 로스터 배열 [{pokemon,level,iv},...]
   enemyEntries: 상대 스쿼드 정의 배열(같은 형태, iv 생략 가능)
   onEnd(result): "win" | "lose" 결과를 받아 호출자가 후처리(영토 점령 등)하도록 콜백 */
export function startBattle(playerEntries, enemyEntries, onEnd){
  battle = {
    playerTeam: playerEntries.map(e=> buildCombatant(e, true)),
    enemyTeam: enemyEntries.map(e=> buildCombatant(e, false)),
    activeP: 0, activeE: 0,
    log: ["대결이 시작됐다!"],
    over: false, result: null,
    onEnd,
  };
  render();
}
