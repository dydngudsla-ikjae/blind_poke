import type { BuildingState, ResourceState, RosterMember } from "../domain/types";
import type { GameAction, GameState, TerritoryState } from "./gameTypes";
import { decayFavor } from "../domain/economy";
import { STARTING_TERRITORY_IDS, worldMapNodes } from "../domain/worldMap";

export const ENERGY_PER_TURN = 5;

const initialResources: ResourceState = {
  seed:0, fruit:0, food:0, material:0, gold:0, tool:0, tm:0, candy:0,
  healItem:0, cureItem:0, items:{},
};

export const TERRITORY_IDS = worldMapNodes.map(node=>node.id);

export function createTerritories(opponentTrainerIds:string[]=[]):Record<string,TerritoryState>{
  const shuffled=[...new Set(opponentTrainerIds)].sort(()=>Math.random()-.5).slice(0,6);
  const slots=STARTING_TERRITORY_IDS.filter(id=>id!=="home").sort(()=>Math.random()-.5);
  const territories:Record<string,TerritoryState>={};
  TERRITORY_IDS.forEach(id=>territories[id]={owner:"unoccupied",trainerId:null,scouted:false,active:STARTING_TERRITORY_IDS.includes(id)});
  territories.home={owner:"player",trainerId:null,scouted:true,active:true};
  slots.forEach((id,index)=>{const trainerId=shuffled[index]??null;territories[id]={owner:trainerId?"trainer":"unoccupied",trainerId,scouted:false,active:true};});
  return territories;
}

export function createInitialState(trainerId:string|null=null, opponentTrainerIds:string[]=[]): GameState {
  return {
    screen:"draft", roster:[], buildings:[], resources:{...initialResources}, plotCap:1,
    storageCap:50, entryCap:6, entryOrder:[], turnCount:0, energy:ENERGY_PER_TURN,
    nextMemberId:1, nextBuildingId:1, draftRound:0, selectedPokemonId:null,
    territories:createTerritories(opponentTrainerIds), battle:null, message:"",lastLog:[],trainerId,
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

export function restoreGameState(raw: any, mapRaw: any, fallbackTrainerId:string|null=null, opponentTrainerIds:string[]=[]): GameState {
  const base=createInitialState(fallbackTrainerId,opponentTrainerIds);
  if(!raw?.roster?.length) return base;
  const migrated=migrateRoster(raw.roster,raw.nextMemberId||1);
  const buildings=migrateBuildings(raw,migrated.roster);
  const validIds=new Set(migrated.roster.map(member=>member.id));
  const legacyOrder=migrated.roster.filter(member=>member.inEntry).map(member=>member.id);
  const entryOrder=(Array.isArray(raw.entryOrder)?raw.entryOrder:legacyOrder).filter((id:string,index:number,list:string[])=>validIds.has(id)&&list.indexOf(id)===index).slice(0,6);
  migrated.roster.forEach(member=>{delete member.inEntry;});
  const territories={...base.territories};
  if(Array.isArray(mapRaw)) mapRaw.forEach((t:any)=>{
    if(!t?.id||!territories[t.id]) return;
    if(typeof t.owner==="string"&&typeof t.scouted==="boolean") territories[t.id]={owner:t.owner==="wild"?"unoccupied":t.owner,trainerId:t.trainerId??null,scouted:t.scouted,active:t.active??t.unlocked??STARTING_TERRITORY_IDS.includes(t.id)};
    else if(t.owner==="player") territories[t.id]={owner:"player",trainerId:null,scouted:true,active:true};
  });
  return {...base,...raw,roster:migrated.roster,nextMemberId:migrated.nextMemberId,
    buildings,nextBuildingId:Math.max(raw.nextBuildingId||1,buildings.length+1),resources:{...base.resources,...raw.resources,items:raw.resources?.items||{}},
    territories,entryCap:6,entryOrder,trainerId:raw.trainerId??fallbackTrainerId,screen:"base",draftRound:3,selectedPokemonId:null,battle:null,message:"",lastLog:[]};
}

export function gameReducer(state:GameState, action:GameAction):GameState {
  switch(action.type){
    case "PATCH": return {...state,...action.patch};
    case "ADD_MEMBER": return {...state,roster:[...state.roster,action.member],nextMemberId:state.nextMemberId+1};
    case "SET_ENTRY_ORDER": {const validIds=new Set(state.roster.map(member=>member.id));const entryOrder=action.memberIds.filter((id,index,list)=>validIds.has(id)&&list.indexOf(id)===index).slice(0,6);return {...state,entryOrder,message:action.memberIds.length>6?"전투 엔트리는 최대 6마리입니다.":""};}
    case "START_BUILDING": return {...state,energy:state.energy-1,
      buildings:[...state.buildings,action.building],nextBuildingId:state.nextBuildingId+1,
      roster:state.roster.map(m=>action.memberIds.includes(m.id)?{...m,buildingId:action.building.id,job:null}:m)};
    case "ADD_BUILDERS": return {...state,energy:state.energy-1,
      buildings:state.buildings.map(b=>b.id===action.buildingId?{...b,remainingTurns:action.remainingTurns}:b),
      roster:state.roster.map(m=>action.memberIds.includes(m.id)?{...m,buildingId:action.buildingId,job:null}:m)};
    case "REMOVE_BUILDER": return {...state,roster:state.roster.map(m=>m.id===action.memberId&&m.buildingId===action.buildingId?{...m,buildingId:null}:m)};
    case "CANCEL_BUILDING": return {...state,buildings:state.buildings.filter(b=>b.id!==action.buildingId),
      roster:state.roster.map(m=>m.buildingId===action.buildingId?{...m,buildingId:null,job:null}:m)};
    case "NEXT_TURN": {const owned=Object.values(state.territories).filter(t=>t.owner==="player").length-1;const gold=Math.min(state.storageCap,state.resources.gold+owned*3);return {...state,turnCount:state.turnCount+1,energy:ENERGY_PER_TURN,resources:{...state.resources,gold},roster:state.roster.map(decayFavor),lastLog:[...(owned?[`확보 지역 수입: 자금 +${owned*3}`]:[]),"모든 공사의 남은 시간이 진행되었습니다."],
      buildings:state.buildings.map(b=>{
        if(b.status!=="constructing") return b;
        const workers=state.roster.filter(m=>m.buildingId===b.id&&!m.job).length;
        if(!workers) return b;
        const remaining=Math.max(0,b.remainingTurns-1);
        return {...b,remainingTurns:remaining,status:remaining===0?"active":"constructing"};
      })};}
    case "SCOUT_TERRITORY": {const territory=state.territories[action.territoryId];return territory?{...state,territories:{...state.territories,[action.territoryId]:{...territory,scouted:true}}}:state;}
    case "CLAIM_TERRITORY": return {...state,territories:{...state.territories,[action.territoryId]:{owner:"player",trainerId:null,scouted:true,active:true}},screen:"map",battle:null};
  }
}
