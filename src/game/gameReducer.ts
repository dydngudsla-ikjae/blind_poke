import type { BuildingState, ResourceState, RosterMember } from "../domain/types";
import type { GameAction, GameState } from "./gameTypes";

export const ENERGY_PER_TURN = 5;

const initialResources: ResourceState = {
  seed:0, fruit:0, food:0, material:0, gold:0, tool:0, tm:0, candy:0,
  healItem:0, cureItem:0, items:{},
};

const defaultTerritories = {
  grasslands:"player", field:"wild", hill:"wild", forest:"wild",
  cave:"wild", lake:"wild", peak:"wild",
} as const;

export function createInitialState(): GameState {
  return {
    screen:"draft", roster:[], buildings:[], resources:{...initialResources}, plotCap:1,
    storageCap:50, entryCap:6, turnCount:0, energy:ENERGY_PER_TURN,
    nextMemberId:1, nextBuildingId:1, draftRound:0, selectedPokemonId:null,
    territories:{...defaultTerritories}, battle:null, message:"",
  };
}

function migrateRoster(raw: unknown[], nextStart=1): { roster:RosterMember[]; nextMemberId:number } {
  let next=nextStart;
  const roster=raw.map(value=>{
    const m=value as RosterMember;
    if(!m.id) m.id=`mon-${next++}`;
    const numeric=Number(m.id.split("-").pop());
    if(Number.isFinite(numeric)) next=Math.max(next,numeric+1);
    return m;
  });
  return {roster,nextMemberId:next};
}

const jobBuilding:Record<string,string>={seed:"farm",till:"farm",fruit:"farm",flatten:"farm",
  cook:"restaurant",chill:"restaurant",train:"dojo",research:"dojo",mine:"workshop",
  mint:"workshop",craft:"workshop",heal:"clinic",cure:"clinic"};

function migrateBuildings(raw:any,roster:RosterMember[]):BuildingState[]{
  if(Array.isArray(raw.buildings)) return raw.buildings;
  const byType=new Map<string,BuildingState>();
  roster.forEach(member=>{
    const legacy=member as RosterMember&{building?:string};
    const type=legacy.building||(member.job?jobBuilding[member.job]:null);
    if(!type) return;
    let building=byType.get(type);
    if(!building){const remaining=raw.underConstruction?.[type]||0;building={id:`building-${byType.size+1}`,type,
      plotIndex:byType.size,status:remaining>0?"constructing":"active",remainingTurns:remaining};byType.set(type,building);}
    member.buildingId=building.id;delete legacy.building;
  });
  return [...byType.values()];
}

export function restoreGameState(raw: any, mapRaw: any): GameState {
  const base=createInitialState();
  if(!raw?.roster?.length) return base;
  const migrated=migrateRoster(raw.roster,raw.nextMemberId||1);
  const buildings=migrateBuildings(raw,migrated.roster);
  const territories={...base.territories};
  if(Array.isArray(mapRaw)) mapRaw.forEach((t:any)=>{if(t?.id&&t?.owner) territories[t.id]=t.owner;});
  return {...base,...raw,roster:migrated.roster,nextMemberId:migrated.nextMemberId,
    buildings,nextBuildingId:Math.max(raw.nextBuildingId||1,buildings.length+1),resources:{...base.resources,...raw.resources,items:raw.resources?.items||{}},
    territories,screen:"base",draftRound:3,selectedPokemonId:null,battle:null,message:""};
}

export function gameReducer(state:GameState, action:GameAction):GameState {
  switch(action.type){
    case "PATCH": return {...state,...action.patch};
    case "ADD_MEMBER": return {...state,roster:[...state.roster,action.member],nextMemberId:state.nextMemberId+1};
    case "START_BUILDING": return {...state,energy:state.energy-1,
      buildings:[...state.buildings,action.building],nextBuildingId:state.nextBuildingId+1,
      roster:state.roster.map(m=>action.memberIds.includes(m.id)?{...m,buildingId:action.building.id,job:null}:m)};
    case "ADD_BUILDERS": return {...state,energy:state.energy-1,
      buildings:state.buildings.map(b=>b.id===action.buildingId?{...b,remainingTurns:action.remainingTurns}:b),
      roster:state.roster.map(m=>action.memberIds.includes(m.id)?{...m,buildingId:action.buildingId,job:null}:m)};
    case "REMOVE_BUILDER": return {...state,roster:state.roster.map(m=>m.id===action.memberId&&m.buildingId===action.buildingId?{...m,buildingId:null}:m)};
    case "CANCEL_BUILDING": return {...state,buildings:state.buildings.filter(b=>b.id!==action.buildingId),
      roster:state.roster.map(m=>m.buildingId===action.buildingId?{...m,buildingId:null,job:null}:m)};
    case "NEXT_TURN": return {...state,turnCount:state.turnCount+1,energy:ENERGY_PER_TURN,
      buildings:state.buildings.map(b=>{
        if(b.status!=="constructing") return b;
        const workers=state.roster.filter(m=>m.buildingId===b.id&&!m.job).length;
        if(!workers) return b;
        const remaining=Math.max(0,b.remainingTurns-1);
        return {...b,remainingTurns:remaining,status:remaining===0?"active":"constructing"};
      })};
    case "CLAIM_TERRITORY": return {...state,territories:{...state.territories,[action.territoryId]:"player"},screen:"map",battle:null};
  }
}
