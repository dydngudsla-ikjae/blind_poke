import { useMemo, useState, type MouseEvent } from "react";
import { useGame } from "../game/GameProvider";
import { ART, createMember, samplePokemon } from "../game/gameHelpers";
import { relationSignal, trainerRelation, TRAINER_RELATION_MODIFIER } from "../domain/trainerAffinity";

const spots=[{left:"22%",top:"56%"},{left:"50%",top:"62%"},{left:"77%",top:"53%"}];

export default function DraftScreen(){
  const {state,dispatch,data}=useGame();
  const [hovered,setHovered]=useState<number|null>(null);
  const [cursor,setCursor]=useState({x:0,y:0,visible:false});
  const excluded=new Set(state.roster.map(m=>m.pokemon.pokemonRowid));
  const candidates=useMemo(()=>samplePokemon(data.pokemon,3,excluded),[state.draftRound]);
  const trainer=data.trainers.find(entry=>entry.id===state.trainerId);
  const pick=(pokemon:(typeof candidates)[number])=>{
    const relation=trainer?trainerRelation(trainer,pokemon,data.pokemon,data.types):"neutral";
    const member=createMember(pokemon,state.nextMemberId,pokemon.nameKr,TRAINER_RELATION_MODIFIER[relation]);
    dispatch({type:"ADD_MEMBER",member});
    const next=state.draftRound+1;
    dispatch({type:"PATCH",patch:{draftRound:next,screen:next>=3?"trainerReveal":"draft"}});
  };
  const scanned=hovered===null?null:candidates[hovered];
  const moveScanner=(event:MouseEvent<HTMLDivElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    setCursor({x:event.clientX-rect.left,y:event.clientY-rect.top,visible:true});
  };
  return <div className="encounter-scene" onMouseMove={moveScanner}
    onMouseLeave={()=>{setCursor(value=>({...value,visible:false}));setHovered(null)}}>
    <div className="enc-ground-light" />
    <div className="encounter-mons">{candidates.map((p,i)=>{const relation=trainer?trainerRelation(trainer,p,data.pokemon,data.types):"neutral";const signal=relationSignal(relation);return <button key={p.pokemonRowid} className={`enc-mon${hovered===i?" is-selected":""}`}
      style={{left:spots[i].left,top:spots[i].top,"--hide-scale":1} as React.CSSProperties} onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)} onClick={()=>pick(p)}>
      <span className={`affinity-signal ${signal}`} title={signal==="green"?"좋은 관계":signal==="red"?"불편한 관계":"보통 관계"}/>
      <span className="enc-silhouette-wrap"><span className="enc-selected-ring"><svg className="ring-svg" viewBox="0 0 200 200"><circle className="ring ring-outer" cx="100" cy="100" r="92"/><circle className="ring ring-inner" cx="100" cy="100" r="70"/></svg><span className="ring-bracket top"/><span className="ring-bracket right"/><span className="ring-bracket bottom"/><span className="ring-bracket left"/><span className="ring-scanline"/></span><span className="enc-contact-shadow" />
        <img className="enc-silhouette" src={ART(p.pokemonRowid)} alt={p.nameKr} style={{height:90,maxWidth:120,objectFit:"contain",filter:"brightness(0)"}} />
      </span></button>})}</div>
    <span className={`scan-mini-cursor${hovered!==null?" suppressed":""}`} style={{left:cursor.x,top:cursor.y,opacity:cursor.visible?(hovered!==null?.12:1):0}}><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="20" y1="32" x2="20" y2="38"/><line x1="2" y1="20" x2="8" y2="20"/><line x1="32" y1="20" x2="38" y2="20"/><circle className="mc-dot" cx="20" cy="20" r="1.6"/></svg></span>
    <div className={`scan-panel${scanned?" show":""}`}><div className="sp-inner"><div className="sp-eyebrow"><span>SCAN DATA</span><span className="sp-ticks"/></div>
      {scanned&&<div className="sp-body"><div className="sp-mini"><svg className="sp-mini-ring" viewBox="0 0 100 100"><circle className="mr-outer" cx="50" cy="50" r="46"/><circle className="mr-inner" cx="50" cy="50" r="36"/></svg><span className="sp-mini-sil"><img className="enc-silhouette" src={ART(scanned.pokemonRowid)} alt="" style={{height:41,maxWidth:52,objectFit:"contain"}}/></span></div><div className="sp-text"><div className="sp-name">{scanned.nameKr}</div><div className="sp-row"><span className="sp-stats">{scanned.heightM??"?"}m · {scanned.weightKg??"?"}kg</span></div></div></div>}
      {!scanned&&<><div className="sp-name">스타팅 선택 {state.draftRound+1}/3</div><div className="sp-stats">개체에 스캐너를 맞춰 보세요</div></>}</div></div>
  </div>;
}
