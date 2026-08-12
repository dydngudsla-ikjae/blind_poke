import { useState, type CSSProperties } from "react";
import type { BuildingState } from "../domain/types";
import { constructionTurns, projectedConstructionTurns } from "../domain/construction";
import { useGame } from "../game/GameProvider";
import { SPRITE } from "../game/gameHelpers";

const layouts=[
 {left:11.45,top:42.30,width:13.80,height:15.94},{left:26.98,top:42.24,width:13.27,height:16.01},
 {left:43.12,top:42.24,width:13.10,height:16.18},{left:59.04,top:42.02,width:13.40,height:16.42},
 {left:74.41,top:41.82,width:14.19,height:16.35},{left:8.27,top:64.35,width:15.02,height:18.76},
 {left:25.31,top:64.12,width:14.49,height:18.98},{left:42.77,top:64.51,width:14.09,height:18.86},
 {left:59.81,top:64.37,width:14.47,height:18.91},{left:76.24,top:64.14,width:15.23,height:18.91},
];
const BUILDINGS={
 farm:{label:"밭",desc:"씨앗을 심고 열매를 거두는 경작지",art:"/assets/plot.png"},
 restaurant:{label:"레스토랑",desc:"수확물로 음식을 만들고 저장하는 곳",art:"/assets/restaurant.png"},
 dojo:{label:"훈련소",desc:"전투 능력을 단련하고 성장시키는 곳",art:"/assets/training-center.png"},
 workshop:{label:"제작소",desc:"재료를 캐고 가공하는 곳",art:"/assets/factory.png"},
 clinic:{label:"치료소",desc:"회복과 치료를 담당하는 곳",art:"/assets/heal-center.png"},
} as const;
type BuildingType=keyof typeof BUILDINGS;

function BuildModal({plot,onClose}:{plot:number;onClose:()=>void}){
 const {state,dispatch}=useGame(); const [type,setType]=useState<BuildingType>("farm"); const [selected,setSelected]=useState<string[]>([]);
 const free=state.roster.filter(m=>!m.buildingId&&!m.job); const toggle=(id:string)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
 const start=()=>{if(!selected.length||state.energy<1)return;const building:BuildingState={id:`building-${state.nextBuildingId}`,type,plotIndex:plot,status:"constructing",remainingTurns:constructionTurns(selected.length)};dispatch({type:"START_BUILDING",building,memberIds:selected});onClose();};
 return <div className="modal-overlay"><div className="modal-box"><div className="modal-head"><span>건설 · 부지 {plot+1}</span><button className="dd-close" onClick={onClose}>✕</button></div><div className="modal-body">
  <div className="install-buildings">{Object.entries(BUILDINGS).map(([id,b])=><button key={id} className={`install-building has-art ${type===id?"active":""}`} onClick={()=>setType(id as BuildingType)}><img className="install-building-art" src={b.art} alt=""/><span>{b.label}</span></button>)}</div>
  <div className="install-note install-building-desc">{BUILDINGS[type].desc}</div>
  <div className="install-note">기본 3턴 · 선택 {selected.length}마리 → <b>{selected.length?constructionTurns(selected.length):"-"}턴</b> · 에너지 1</div>
  <div className="pc-grid">{free.map(m=><div key={m.id} data-install-pick={m.id} className={`pc-cell ${selected.includes(m.id)?"selected":""}`} onClick={()=>toggle(m.id)}><img src={SPRITE(m.pokemon)} alt={m.pokemon.nameKr}/><span className="pc-cell-name">{m.pokemon.nameKr}</span></div>)}</div>
  <button className="btn wide install-confirm" data-build-confirm disabled={!selected.length||state.energy<1} onClick={start}>{BUILDINGS[type].label} 건설 시작</button>
 </div></div></div>;
}

function ConstructionModal({building,onClose}:{building:BuildingState;onClose:()=>void}){
 const {state,dispatch}=useGame();const [selected,setSelected]=useState<string[]>([]);const workers=state.roster.filter(m=>m.buildingId===building.id&&!m.job);const free=state.roster.filter(m=>!m.buildingId&&!m.job);
 const projected=projectedConstructionTurns(building.remainingTurns,workers.length+selected.length);
 return <div className="modal-overlay"><div className="modal-box"><div className="modal-head"><span>{BUILDINGS[building.type as BuildingType]?.label} · 공사 관리</span><button className="dd-close" onClick={onClose}>✕</button></div><div className="modal-body">
  <div className="install-note">현재 {workers.length}마리 · {building.remainingTurns}턴 남음 {workers.length?"":"· 일시정지"}</div>
  <div className="entry-list">{workers.map(m=><div className="entry-row" key={m.id}><span>{m.pokemon.nameKr}</span><button className="rc-unassign" onClick={()=>dispatch({type:"REMOVE_BUILDER",buildingId:building.id,memberId:m.id})}>회수</button></div>)}</div>
  <div className="pc-grid">{free.map(m=><div key={m.id} className={`pc-cell ${selected.includes(m.id)?"selected":""}`} onClick={()=>setSelected(s=>s.includes(m.id)?s.filter(x=>x!==m.id):[...s,m.id])}><img src={SPRITE(m.pokemon)} alt={m.pokemon.nameKr}/><span>{m.pokemon.nameKr}</span></div>)}</div>
  <div className="install-note">추가 후 {projected}턴 · 에너지 1</div><button className="btn wide" disabled={!selected.length||state.energy<1} onClick={()=>{dispatch({type:"ADD_BUILDERS",buildingId:building.id,memberIds:selected,remainingTurns:projected});setSelected([])}}>추가 배치</button>
  <button className="btn wide" onClick={()=>{dispatch({type:"CANCEL_BUILDING",buildingId:building.id});onClose()}}>공사 취소</button>
 </div></div></div>;
}

export default function BaseScreen(){
 const {state,dispatch}=useGame();const [buildPlot,setBuildPlot]=useState<number|null>(null);const [manage,setManage]=useState<string|null>(null);const [panel,setPanel]=useState<"pc"|"resources"|null>(null);
 const activeManage=state.buildings.find(b=>b.id===manage)||null;
 return <div className="base-scene"><div className="base-art">
  <div className="hud-top"><div className="turn-hud"><span className="th-label">TURN</span><span className="th-num">{String(state.turnCount).padStart(2,"0")}</span><span className="th-energy">에너지 {state.energy}/5</span></div>
  <div className="cmdbar"><button className="cmd-item" onClick={()=>setPanel("pc")}>PC <b>{state.roster.length}</b></button><button className="cmd-item" onClick={()=>setPanel("resources")}>자원</button><button className="cmd-item" data-action="map" onClick={()=>dispatch({type:"PATCH",patch:{screen:"map"}})}>지도</button><button className="cmd-item" data-action="hunt" onClick={()=>state.energy>=2&&dispatch({type:"PATCH",patch:{screen:"hunt",energy:state.energy-2}})}>탐험</button></div></div>
  <div className="plot-grid">{layouts.map((box,i)=>{const b=state.buildings.find(x=>x.plotIndex===i);const unlocked=i<state.plotCap;const style={left:`${box.left}%`,top:`${box.top}%`,width:`${box.width}%`,height:`${box.height}%`} as CSSProperties;
   return <div key={i}>{b&&<div className="plot-art-layer" style={{...style,transform:"scale(1.5)"}}><img src={BUILDINGS[b.type as BuildingType]?.art} alt=""/></div>}<button style={style} className={`plot ${!unlocked?"locked":b?.status==="constructing"?"constructing":b?"pending":"empty"}`} data-plot-install={!b&&unlocked?i:undefined} data-plot-construction={b?.status==="constructing"?b.id:undefined} onClick={()=>{if(!unlocked)return;if(!b)setBuildPlot(i);else if(b.status==="constructing")setManage(b.id)}}><span className="plot-info"><b>{b?BUILDINGS[b.type as BuildingType]?.label:unlocked?"건설":"미개척지"}</b>{b?.status==="constructing"?`${b.remainingTurns}턴 남음`:""}</span></button><span className={`plot-tag ${b?"sprite-tag":""}`} style={{left:`${box.left+box.width/2}%`,top:`${box.top+box.height/2}%`}}>{b?state.roster.filter(m=>m.buildingId===b.id).slice(0,3).map(m=><img className="plot-sprite" key={m.id} src={SPRITE(m.pokemon)} alt={m.pokemon.nameKr}/>):<span>{unlocked?"＋ 건설":"▣"}</span>}{b?.status==="constructing"&&<span className="plot-turns-badge">{b.remainingTurns}턴</span>}</span></div>})}</div>
 </div><div className="hud-dock"><span className="dock-stat">배치 <b>{state.roster.filter(m=>m.buildingId).length}/{state.roster.length}</b></span><span className="dock-stat">개척 <b>{state.plotCap}/10</b></span><button className="dock-zone dock-nextturn" id="nextTurn" onClick={()=>dispatch({type:"NEXT_TURN"})}>TURN END<br/><b>다음 턴 〉</b></button></div>
 {buildPlot!==null&&<BuildModal plot={buildPlot} onClose={()=>setBuildPlot(null)}/>}
 {activeManage&&<ConstructionModal building={activeManage} onClose={()=>setManage(null)}/>}
 {panel&&<div className="modal-overlay"><div className="modal-box"><div className="modal-head"><span>{panel==="pc"?"보유 포켓몬":"자원 현황"}</span><button className="dd-close" onClick={()=>setPanel(null)}>✕</button></div><div className="modal-body">{panel==="pc"?<div className="pc-grid">{state.roster.map(m=><div className="pc-cell" key={m.id}><img src={SPRITE(m.pokemon)} alt={m.pokemon.nameKr}/><span>{m.pokemon.nameKr}</span></div>)}</div>:<div className="res-grid">{Object.entries(state.resources).filter(([,v])=>typeof v==="number").map(([k,v])=><div className="res-item" key={k}><span>{k}</span><b>{v as number}</b></div>)}</div>}</div></div></div>}
 </div>;
}
