import { describe, expect, it } from "vitest";
import type { RosterMember } from "../domain/types";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";

const member=(id="mon-1"):RosterMember=>({id,alias:"테스트",pokemon:{pokemonRowid:1,nameKr:"이상해씨",hp:45,atk:49,def:49,satk:65,sdef:65,spd:45},level:1,exp:0,favor:80,favCeil:90,favFloor:20,aptitude:50,iv:{},buildingId:null,job:null});

describe("game reducer",()=>{
  it("stores at most six unique battle entries in order",()=>{
    let state={...createInitialState(),roster:Array.from({length:7},(_,index)=>member(`mon-${index+1}`))};
    state=gameReducer(state,{type:"SET_ENTRY_ORDER",memberIds:["mon-3","mon-1","mon-3","mon-2","mon-4","mon-5","mon-6","mon-7"]});
    expect(state.entryOrder).toEqual(["mon-3","mon-1","mon-2","mon-4","mon-5","mon-6"]);
    expect(state.message).toBe("전투 엔트리는 최대 6마리입니다.");
  });
  it("places six trainers in ten active territories on a forty-node map",()=>{
    const state=createInitialState("player",["a","b","c","d","e","f","g"]);
    expect(Object.keys(state.territories)).toHaveLength(40);
    expect(Object.values(state.territories).filter(value=>value.active)).toHaveLength(10);
    expect(Object.values(state.territories).filter(value=>value.owner==="trainer")).toHaveLength(6);
    expect(Object.values(state.territories).filter(value=>value.active&&value.owner==="unoccupied")).toHaveLength(3);
    expect(Object.values(state.territories).filter(value=>!value.active)).toHaveLength(30);
  });
  it("reveals a territory when it is scouted",()=>{
    const state=createInitialState("player",["a","b","c","d","e","f"]);
    const next=gameReducer(state,{type:"SCOUT_TERRITORY",territoryId:"south"});
    expect(next.territories.south.scouted).toBe(true);
  });
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
  it("trims legacy battle entries to six",()=>{
    const roster=Array.from({length:7},(_,index)=>({...member(`mon-${index+1}`),inEntry:true}));
    const state=restoreGameState({v:3,roster,resources:{}},null);
    expect(state.entryCap).toBe(6);
    expect(state.entryOrder).toHaveLength(6);
    expect(state.roster.every(entry=>entry.inEntry===undefined)).toBe(true);
  });
  it("migrates a v1 building assignment",()=>{
    const legacyMember={...member(),building:"farm"};delete (legacyMember as any).buildingId;
    const state=restoreGameState({v:1,roster:[legacyMember],resources:{},underConstruction:{farm:2}},null);
    expect(state.buildings[0]).toMatchObject({id:"building-1",type:"farm",status:"constructing",remainingTurns:2});
    expect(state.roster[0].buildingId).toBe("building-1");
  });
});
