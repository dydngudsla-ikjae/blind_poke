import type { GameDataBundle, MoveRecord, PokemonRecord, RosterMember } from "./types";

export interface BattleMove {id:number;name:string;power:number;accuracy:number;damageClass:number;typeRowid:number;typeName:string}
export interface Combatant {key:string;name:string;pokemon:PokemonRecord;level:number;types:number[];stats:Record<string,number>;maxHp:number;curHp:number;moves:BattleMove[];fainted:boolean}

const fallback:BattleMove={id:0,name:"몸통박치기",power:40,accuracy:100,damageClass:2,typeRowid:1,typeName:"노말"};
const shuffle=<T,>(items:T[])=>[...items].sort(()=>Math.random()-.5);

export function pickMoveset(pokemon:PokemonRecord,data:GameDataBundle):BattleMove[]{
 const map=new Map(data.moves.map(m=>[m.moveRowid,m]));const usable=((pokemon.details?.moveRowids||[]) as number[]).map(id=>map.get(id)).filter((m):m is MoveRecord=>!!m&&!m.descriptionKr?.includes("사용할 수 없는"));
 const damage=shuffle(usable.filter(m=>(m.details.power||0)>0)).slice(0,3);const status=shuffle(usable.filter(m=>!(m.details.power||0))).slice(0,4-damage.length);const picked=[...damage,...status];
 for(const move of shuffle(usable)){if(picked.length>=4)break;if(!picked.includes(move))picked.push(move)}
 const typeNames=new Map(data.types.map(t=>[t.typeRowid,t.nameKr]));return picked.map(m=>({id:m.moveRowid,name:m.nameKr,power:m.details.power||0,accuracy:m.details.accuracy||0,damageClass:m.details.damageClass,typeRowid:m.typeRowid,typeName:typeNames.get(m.typeRowid)||""})).concat(picked.length?[]:[fallback]);
}

export function buildCombatant(entry:RosterMember|{id?:string;pokemon:PokemonRecord;level:number;iv?:Record<string,number>},data:GameDataBundle,key:string):Combatant{
 const p=entry.pokemon,level=entry.level||1,iv=entry.iv||{};const stat=(k:keyof PokemonRecord)=>k==="hp"?Math.max(1,Math.round(p.hp*2+(iv.hp||0)+level*2+10)):Math.max(1,Math.round(Number(p[k])+(iv[k]||0)+level));
 const stats={hp:stat("hp"),atk:stat("atk"),def:stat("def"),satk:stat("satk"),sdef:stat("sdef"),spd:stat("spd")};
 return {key,name:p.nameKr,pokemon:p,level,types:[p.type1Rowid,p.type2Rowid].filter((v,i,a):v is number=>v!=null&&a.indexOf(v)===i),stats,maxHp:stats.hp,curHp:stats.hp,moves:pickMoveset(p,data),fainted:false};
}

export function effectiveness(moveType:number,defenderTypes:number[],data:GameDataBundle){const rel=data.types.find(t=>t.typeRowid===moveType)?.relation?.relationMap||{};return defenderTypes.reduce((m,id)=>m*(rel[String(id)]?.damageTo??1),1)}
export function calculateDamage(actor:Combatant,target:Combatant,move:BattleMove,data:GameDataBundle,random=.925){if(move.damageClass===1||move.power<=0)return 0;const atk=move.damageClass===2?actor.stats.atk:actor.stats.satk;const def=move.damageClass===2?target.stats.def:target.stats.sdef;const stab=actor.types.includes(move.typeRowid)?1.5:1;return Math.max(1,Math.round(((2*actor.level/5+2)*move.power*atk/def/50+2)*stab*effectiveness(move.typeRowid,target.types,data)*random))}
