import type { PokemonRecord, RosterMember } from "../domain/types";

export const ART=(id:number)=>`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
export const SPRITE=(p:PokemonRecord)=>p.details?.sprites?.front_default||ART(p.pokemonRowid);
export const rnd=(a:number,b:number)=>Math.floor(Math.random()*(b-a+1))+a;

export function samplePokemon(pool:PokemonRecord[],count:number,excluded=new Set<number>()){
  const available=pool.filter(p=>!excluded.has(p.pokemonRowid)); const out:PokemonRecord[]=[];
  while(out.length<count&&available.length) out.push(available.splice(rnd(0,available.length-1),1)[0]);
  return out;
}

export function createMember(pokemon:PokemonRecord,id:number,alias=pokemon.nameKr,favorModifier=0):RosterMember{
  const rare=pokemon.details?.isLegendary||pokemon.details?.isMythical;
  const baseFavor=rare?rnd(30,55):rnd(70,95);const favCeil=Math.max(1,Math.min(100,baseFavor+favorModifier)); const favFloor=Math.min(rnd(10,30),favCeil-5);
  const iv=Object.fromEntries(["hp","atk","def","satk","sdef","spd"].map(k=>[k,rnd(-15,15)]));
  return {id:`mon-${id}`,pokemon,alias,level:1,exp:0,favor:favCeil,favCeil,favFloor,
    aptitude:rnd(0,100),iv,buildingId:null,job:null,inEntry:false,heldItem:null};
}
