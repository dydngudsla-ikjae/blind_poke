import { useState, type DragEvent } from "react";
import { useGame } from "../game/GameProvider";
import { SPRITE } from "../game/gameHelpers";

export default function EntryModal({onClose}:{onClose:()=>void}){
  const {state,dispatch}=useGame();
  const [dragged,setDragged]=useState<string|null>(null);
  const entryMembers=state.entryOrder.map(id=>state.roster.find(member=>member.id===id)).filter((member):member is (typeof state.roster)[number]=>Boolean(member));
  const setOrder=(ids:string[])=>dispatch({type:"SET_ENTRY_ORDER",memberIds:ids});
  const add=(id:string,index=state.entryOrder.length)=>{const without=state.entryOrder.filter(value=>value!==id);if(!state.entryOrder.includes(id)&&without.length>=6)return;without.splice(Math.min(index,5),0,id);setOrder(without);};
  const dropSlot=(event:DragEvent,index:number)=>{event.preventDefault();if(dragged)add(dragged,index);setDragged(null);};
  const remove=(id:string)=>setOrder(state.entryOrder.filter(value=>value!==id));
  return <div className="modal-overlay"><div className="modal-box entry-editor"><div className="modal-head"><span>전투 엔트리 편성 · {entryMembers.length}/6</span><button className="dd-close" onClick={onClose}>✕</button></div><div className="modal-body">
    <div className="entry-editor-title">PC <small>포켓몬을 아래 슬롯으로 드래그하세요.</small></div>
    <div className="pc-grid entry-pc" data-entry-pc onDragOver={event=>event.preventDefault()} onDrop={()=>{if(dragged)remove(dragged);setDragged(null)}}>{state.roster.map(member=><button key={member.id} data-pc-member={member.id} draggable onDragStart={()=>setDragged(member.id)} onDragEnd={()=>setDragged(null)} onDoubleClick={()=>state.entryOrder.includes(member.id)?remove(member.id):add(member.id)} className={`pc-cell ${state.entryOrder.includes(member.id)?"in-entry":""}`}><img src={SPRITE(member.pokemon)} alt={member.pokemon.nameKr}/><span>{member.pokemon.nameKr}</span>{state.entryOrder.includes(member.id)&&<b>{state.entryOrder.indexOf(member.id)+1}</b>}</button>)}</div>
    <div className="entry-editor-title">출전 순서 <small>PC로 되돌리면 해제됩니다.</small></div>
    <div className="entry-slots">{Array.from({length:6},(_,index)=>{const member=entryMembers[index];return <div key={index} data-entry-slot={index} className={`entry-slot ${member?"filled":""}`} onDragOver={event=>event.preventDefault()} onDrop={event=>dropSlot(event,index)}>{member?<button draggable onDragStart={()=>setDragged(member.id)} onDragEnd={()=>setDragged(null)} onDoubleClick={()=>remove(member.id)}><span className="entry-slot-no">{index+1}</span><img src={SPRITE(member.pokemon)} alt={member.pokemon.nameKr}/><span>{member.pokemon.nameKr}<small>Lv.{member.level}</small></span></button>:<><span className="entry-slot-no">{index+1}</span><span>빈 슬롯</span></>}</div>})}</div>
    <div className="install-note">첫 번째 슬롯의 포켓몬이 선봉으로 출전합니다. 더블클릭으로도 등록·해제할 수 있습니다.</div>
  </div></div></div>;
}
