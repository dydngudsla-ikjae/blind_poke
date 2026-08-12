import { describe, expect, it } from "vitest";
import type { RosterMember } from "../domain/types";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";

const member=(id="mon-1"):RosterMember=>({id,alias:"테스트",pokemon:{pokemonRowid:1,nameKr:"이상해씨",hp:45,atk:49,def:49,satk:65,sdef:65,spd:45},level:1,exp:0,favor:80,favCeil:90,favFloor:20,aptitude:50,iv:{},buildingId:null,job:null});

describe("game reducer",()=>{
  it("completes a one-worker building after three turns",()=>{
    let state={...createInitialState(),roster:[member()]};
    state=gameReducer(state,{type:"START_BUILDING",building:{id:"building-1",type:"farm",plotIndex:0,status:"constructing",remainingTurns:3},memberIds:["mon-1"]});
    state=gameReducer(state,{type:"NEXT_TURN"});state=gameReducer(state,{type:"NEXT_TURN"});state=gameReducer(state,{type:"NEXT_TURN"});
    expect(state.buildings[0]).toMatchObject({status:"active",remainingTurns:0});
  });
  it("pauses construction without workers",()=>{
    const state={...createInitialState(),buildings:[{id:"building-1",type:"farm",plotIndex:0,status:"constructing" as const,remainingTurns:2}]};
    expect(gameReducer(state,{type:"NEXT_TURN"}).buildings[0].remainingTurns).toBe(2);
  });
});

describe("save migration",()=>{
  it("migrates a v1 building assignment",()=>{
    const legacyMember={...member(),building:"farm"};delete (legacyMember as any).buildingId;
    const state=restoreGameState({v:1,roster:[legacyMember],resources:{},underConstruction:{farm:2}},null);
    expect(state.buildings[0]).toMatchObject({id:"building-1",type:"farm",status:"constructing",remainingTurns:2});
    expect(state.roster[0].buildingId).toBe("building-1");
  });
});
