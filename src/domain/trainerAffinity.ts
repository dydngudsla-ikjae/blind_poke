import type { PokemonRecord, TrainerRecord, TypeRecord } from "./types";

export type TrainerRelation = "bond" | "preferred" | "neutral" | "disliked";
export const TRAINER_RELATION_MODIFIER:Record<TrainerRelation,number>={bond:10,preferred:5,neutral:0,disliked:-5};

export function earliestPokemonId(pokemon:PokemonRecord,allPokemon:PokemonRecord[]):number{
  const byId=new Map(allPokemon.map(entry=>[entry.pokemonRowid,entry]));
  let current=pokemon;const visited=new Set<number>();
  while(current.baseRowid&&current.baseRowid!==current.pokemonRowid){
    if(visited.has(current.pokemonRowid))break;
    visited.add(current.pokemonRowid);
    const parent=byId.get(current.baseRowid);if(!parent)break;current=parent;
  }
  return current.pokemonRowid;
}

export function trainerRelation(trainer:TrainerRecord,pokemon:PokemonRecord,allPokemon:PokemonRecord[],types:TypeRecord[]):TrainerRelation{
  const rootId=earliestPokemonId(pokemon,allPokemon);
  if(trainer.pokemon.some(entry=>entry.id===rootId))return "bond";
  const pokemonTypes=new Set([pokemon.type1Rowid,pokemon.type2Rowid].filter((id):id is number=>typeof id==="number"));
  const preferred=new Set(trainer.specialtyTypes.map(type=>type.id));
  if([...pokemonTypes].some(id=>preferred.has(id)))return "preferred";
  const disliked=new Set<number>();
  for(const preferredType of preferred){
    const relation=types.find(type=>type.typeRowid===preferredType)?.relation?.relationMap??{};
    for(const [id,value] of Object.entries(relation))if(value.damageFrom>1)disliked.add(Number(id));
  }
  if([...pokemonTypes].some(id=>disliked.has(id)))return "disliked";
  return "neutral";
}

export const relationSignal=(relation:TrainerRelation):"green"|"red"|"white"=>relation==="bond"||relation==="preferred"?"green":relation==="disliked"?"red":"white";
