import { useGame } from "../game/GameProvider";

export default function TrainerRevealScreen(){
  const {state,data,dispatch}=useGame();
  const trainer=data.trainers.find(entry=>entry.id===state.trainerId);
  if(!trainer)return null;
  const types=trainer.specialtyTypes.length?trainer.specialtyTypes.map(type=>type.nameKr).join(" · "):"없음";
  return <div className="trainer-reveal">
    <div className="trainer-card">
      <div className="eyebrow">TRAINER IDENTIFIED</div>
      <h1>{trainer.nameKr}</h1>
      <div className="trainer-meta">{trainer.nameEn} · {trainer.region} · {trainer.generation}세대</div>
      <div className="trainer-specialty"><span>선호 타입</span><b>{types}</b></div>
      <p>초록불은 인연 또는 선호, 흰색불은 중립, 빨간불은 선호 타입의 약점을 뜻합니다.</p>
      <button className="btn wide" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>본거지로 이동</button>
    </div>
  </div>;
}
