import { useMemo } from "react";
import { useGame } from "../game/GameProvider";
import { ART, createMember, samplePokemon } from "../game/gameHelpers";
import { relationSignal, trainerRelation, TRAINER_RELATION_MODIFIER } from "../domain/trainerAffinity";

const spots=[{left:"22%",top:"56%"},{left:"50%",top:"62%"},{left:"77%",top:"53%"}];

export default function DraftScreen(){
  const {state,dispatch,data}=useGame();
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
  return <div className="encounter-scene">
    <div className="enc-ground-light" />
    <div className="encounter-mons">{candidates.map((p,i)=>{const relation=trainer?trainerRelation(trainer,p,data.pokemon,data.types):"neutral";const signal=relationSignal(relation);return <button key={p.pokemonRowid} className="enc-mon is-selected"
      style={{left:spots[i].left,top:spots[i].top,"--hide-scale":1} as React.CSSProperties} onClick={()=>pick(p)}>
      <span className={`affinity-signal ${signal}`} title={signal==="green"?"좋은 관계":signal==="red"?"불편한 관계":"보통 관계"}/>
      <span className="enc-silhouette-wrap"><span className="enc-contact-shadow" />
        <img className="enc-silhouette" src={ART(p.pokemonRowid)} alt={p.nameKr} style={{height:90,maxWidth:120,objectFit:"contain",filter:"brightness(0)"}} />
      </span></button>})}</div>
    <div className="scan-panel show"><div className="sp-inner"><div className="sp-eyebrow">STARTER DRAFT</div>
      <div className="sp-name">스타팅 선택 {state.draftRound+1}/3</div><div className="sp-stats">실루엣을 눌러 동료로 선택하세요</div></div></div>
  </div>;
}
