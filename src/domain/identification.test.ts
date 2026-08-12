import { describe,expect,it } from "vitest";
import { HINT_DECAY,WRONG_DECAY,highestStats } from "./identification";
const pokemon={pokemonRowid:1,nameKr:"테스트몬",hp:40,atk:80,def:50,satk:60,sdef:50,spd:70};
describe("identification rules",()=>{it("keeps clue and wrong penalties",()=>{expect(HINT_DECAY).toBe(8);expect(WRONG_DECAY).toBe(20)});it("uses IV when finding highest stats",()=>expect(highestStats(pokemon,{spd:20})).toEqual(["스피드"]))});
