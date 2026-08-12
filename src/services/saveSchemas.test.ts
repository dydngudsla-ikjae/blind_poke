import { describe, expect, it } from "vitest";
import { gameSaveSchema } from "./saveSchemas";

const pokemon={pokemonRowid:1,nameKr:"이상해씨"};
describe("game save schema",()=>{
  it("accepts legacy saves for migration",()=>{
    expect(gameSaveSchema.safeParse({v:1,roster:[{pokemon,level:1,exp:0,building:"farm"}],resources:{}}).success).toBe(true);
  });
  it("rejects invalid building positions",()=>{
    const result=gameSaveSchema.safeParse({v:3,roster:[{id:"mon-1",pokemon,level:1,exp:0}],resources:{},buildings:[{id:"building-1",type:"farm",plotIndex:99,status:"active",remainingTurns:0}]});
    expect(result.success).toBe(false);
  });
  it("rejects saves without roster members",()=>{
    expect(gameSaveSchema.safeParse({v:3,roster:[],resources:{}}).success).toBe(false);
  });
});
