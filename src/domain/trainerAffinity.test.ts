import { describe,expect,it } from "vitest";
import type { PokemonRecord,TrainerRecord,TypeRecord } from "./types";
import { earliestPokemonId,relationSignal,trainerRelation,TRAINER_RELATION_MODIFIER } from "./trainerAffinity";

const pokemon:PokemonRecord[]=[
  {pokemonRowid:4,baseRowid:4,nameKr:"파이리",type1Rowid:10,hp:1,atk:1,def:1,satk:1,sdef:1,spd:1},
  {pokemonRowid:5,baseRowid:4,nameKr:"리자드",type1Rowid:10,hp:1,atk:1,def:1,satk:1,sdef:1,spd:1},
  {pokemonRowid:7,baseRowid:7,nameKr:"꼬부기",type1Rowid:11,hp:1,atk:1,def:1,satk:1,sdef:1,spd:1},
];
const trainer:TrainerRecord={id:"test",nameKr:"테스트",nameEn:"Test",generation:1,region:"Kanto",roles:[],specialtyTypes:[{id:10,nameKr:"불꽃"}],pokemon:[{id:4,nameKr:"파이리"}]};
const types:TypeRecord[]=[{typeRowid:10,nameKr:"불꽃",relation:{relationMap:{"11":{damageFrom:2,damageTo:.5}}}}];

describe("trainer affinity",()=>{
  it("matches an evolved Pokémon to its earliest bond family",()=>expect(trainerRelation(trainer,pokemon[1],pokemon,types)).toBe("bond"));
  it("prioritizes bond and derives preferred and disliked relations",()=>{
    expect(trainerRelation(trainer,pokemon[0],pokemon,types)).toBe("bond");
    expect(trainerRelation({...trainer,pokemon:[]},pokemon[0],pokemon,types)).toBe("preferred");
    expect(trainerRelation(trainer,pokemon[2],pokemon,types)).toBe("disliked");
    expect(TRAINER_RELATION_MODIFIER).toEqual({bond:10,preferred:5,neutral:0,disliked:-5});
    expect(relationSignal("bond")).toBe("green");expect(relationSignal("disliked")).toBe("red");
  });
  it("walks baseRowid links",()=>expect(earliestPokemonId(pokemon[1],pokemon)).toBe(4));
});
