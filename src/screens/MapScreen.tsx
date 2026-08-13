import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { worldMapNodes } from "../domain/worldMap";
import { useGame } from "../game/GameProvider";

export default function MapScreen(){
  const {state,data,dispatch}=useGame();
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [view,setView]=useState({x:0,y:0,zoom:1});
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const selected=selectedId?state.territories[selectedId]:null;
  const selectedNode=worldMapNodes.find(node=>node.id===selectedId);
  const trainer=selected?.trainerId?data.trainers.find(entry=>entry.id===selected.trainerId):null;
  const isAdjacentToPlayer=(id:string)=>worldMapNodes.find(node=>node.id===id)?.neighbors.some(neighbor=>state.territories[neighbor]?.owner==="player")??false;
  const scoutable=(id:string)=>Boolean(state.territories[id]?.active&&state.territories[id]?.owner!=="player"&&!state.territories[id]?.scouted&&isAdjacentToPlayer(id));
  const scout=()=>{if(selectedId&&scoutable(selectedId))dispatch({type:"SCOUT_TERRITORY",territoryId:selectedId});};
  const clamp=(value:number,zoom:number)=>Math.max(-50*(zoom-1),Math.min(0,value));
  const zoomBy=(delta:number)=>setView(current=>{const zoom=Math.max(1,Math.min(2.5,current.zoom+delta));return {zoom,x:clamp(current.x,zoom),y:clamp(current.y,zoom)};});
  const pointerDown=(event:PointerEvent)=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};};
  const pointerMove=(event:PointerEvent)=>{if(!drag.current)return;const rect=event.currentTarget.getBoundingClientRect();setView(current=>({...current,x:clamp(drag.current!.vx+(event.clientX-drag.current!.x)/rect.width*100,current.zoom),y:clamp(drag.current!.vy+(event.clientY-drag.current!.y)/rect.height*100,current.zoom)}));};
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoomBy(event.deltaY<0?.2:-.2);};

  return <div className="map-scene">
    <div className="map-head"><button className="back-btn" id="backToBase" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>← 본거지로</button><span>월드맵 · 시작 영역 확보 {Object.values(state.territories).filter(value=>value.owner==="player").length}/10 · 전체 거점 40</span><div className="map-controls"><button onClick={()=>zoomBy(-.25)} aria-label="지도 축소">−</button><button onClick={()=>setView({x:0,y:0,zoom:1})}>전체</button><button onClick={()=>zoomBy(.25)} aria-label="지도 확대">＋</button></div></div>
    <div className="map-viewport" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onWheel={wheel}>
      <div className="map-board" style={{width:`${view.zoom*100}%`,height:`${view.zoom*100}%`,transform:`translate(${view.x}%,${view.y}%)`}}>
        <svg className="map-edges" viewBox="0 0 100 100" preserveAspectRatio="none">{worldMapNodes.flatMap(node=>node.neighbors.filter(id=>node.id<id).map(id=>{const other=worldMapNodes.find(entry=>entry.id===id)!;return <line className={!state.territories[node.id]?.active||!state.territories[id]?.active?"inactive":undefined} key={`${node.id}-${id}`} x1={node.x} y1={node.y} x2={other.x} y2={other.y}/>;}))}</svg>
        {worldMapNodes.map(node=>{const territory=state.territories[node.id];const inactive=!territory?.active;const nodeTrainer=territory?.trainerId?data.trainers.find(entry=>entry.id===territory.trainerId):null;const hidden=!territory?.scouted;const className=inactive?"inactive":territory?.owner==="player"?"owned":hidden?"hidden":territory?.owner==="trainer"?"trainer":"unoccupied";return <button disabled={inactive} key={node.id} data-node={node.id} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelectedId(node.id)} className={`map-node ${className} ${selectedId===node.id?"selected":""}`} style={{left:`${node.x}%`,top:`${node.y}%`}}><span className="map-node-dot"/><span className="map-node-label">{inactive?"":hidden?"???":node.name}</span><span className="map-node-sub">{inactive?"":territory?.owner==="player"?"내 거점":hidden?"미확인":territory?.owner==="trainer"?(nodeTrainer?.nameKr??"트레이너"):"미점령"}</span></button>})}
      </div>
    </div>
    <div className="map-detail">{!selected||!selectedNode?<span>지도를 드래그하거나 확대해 살펴보세요. 활성 거점을 선택하면 정보를 확인할 수 있습니다.</span>:selected.owner==="player"?<><strong>{selectedNode.name}</strong><span>플레이어가 확보한 거점입니다.</span></>:!selected.scouted?<><strong>미확인 거점</strong><span>{scoutable(selectedNode.id)?"현재 확보 지역과 인접해 정찰할 수 있습니다.":"확보 지역과 인접해야 정찰할 수 있습니다."}</span>{scoutable(selectedNode.id)&&<button className="btn" data-scout={selectedNode.id} onClick={scout}>정찰하기</button>}</>:selected.owner==="trainer"?<><strong>{selectedNode.name}</strong><span>{trainer?.nameKr??"알 수 없는 트레이너"} 점유</span>{trainer?.specialtyTypes.length?<small>선호 타입 · {trainer.specialtyTypes.map(type=>type.nameKr).join(", ")}</small>:null}</>:<><strong>{selectedNode.name}</strong><span>현재 점유한 트레이너가 없습니다.</span></>}</div>
    <div className="map-legend"><span className="map-legend-item"><i className="map-legend-dot owned"/>내 거점</span><span className="map-legend-item"><i className="map-legend-dot trainer"/>다른 트레이너</span><span className="map-legend-item"><i className="map-legend-dot unoccupied"/>미점령</span><span className="map-legend-item"><i className="map-legend-dot hidden"/>미확인</span><span className="map-legend-item"><i className="map-legend-dot inactive"/>준비 중인 지역</span></div>
  </div>;
}
