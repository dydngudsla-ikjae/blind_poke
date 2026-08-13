import { useMemo, useState } from "react";
import { HINT_DECAY, WRONG_DECAY, professorClues } from "../domain/identification";
import { useGame } from "../game/GameProvider";
import { ART, createMember } from "../game/gameHelpers";
import { trainerRelation, TRAINER_RELATION_MODIFIER } from "../domain/trainerAffinity";
import unknownWild from "../../assets/unknown-wild.png";
import { resolveCapture } from "../domain/capture";

export default function IdentifyScreen(){
 const {state,data,dispatch}=useGame();const pokemon=data.pokemon.find(p=>p.pokemonRowid===state.selectedPokemonId);
 const trainer=data.trainers.find(entry=>entry.id===state.trainerId);const relation=pokemon&&trainer?trainerRelation(trainer,pokemon,data.pokemon,data.types):"neutral";
 const candidate=useMemo(()=>pokemon?createMember(pokemon,state.nextMemberId,pokemon.nameKr,TRAINER_RELATION_MODIFIER[relation]):null,[pokemon?.pokemonRowid,state.trainerId]);
 const [guess,setGuess]=useState(""),[clues,setClues]=useState<string[]>([]),[favor,setFavor]=useState(candidate?.favor||0),[attempts,setAttempts]=useState(0),[mode,setMode]=useState<"unknown"|"art">("unknown"),[result,setResult]=useState<"captured"|"fled"|"giveup"|null>(null);
 if(!pokemon||!candidate)return null;
 const consult=()=>{const pool=professorClues(pokemon,candidate,data);setClues(c=>[...c,pool[c.length%pool.length]]);setFavor(v=>Math.max(candidate.favFloor,v-HINT_DECAY))};
 const observe=()=>{setClues(c=>[...c,`신체 정보: 키 ${pokemon.heightM??"?"}m · 몸무게 ${pokemon.weightKg??"?"}kg`]);setFavor(v=>Math.max(candidate.favFloor,v-HINT_DECAY))};
 const silhouette=()=>{setMode("art");setClues(c=>[...c,"본인확인서에서 외곽 실루엣을 대조했습니다."]);setFavor(v=>Math.max(candidate.favFloor,v-HINT_DECAY))};
 const submit=()=>{if(guess.trim()!==pokemon.nameKr){setAttempts(v=>v+1);setFavor(v=>Math.max(candidate.favFloor,v-WRONG_DECAY));return;}const capture=resolveCapture(favor);if(capture==="fled"){setResult("fled");return;}dispatch({type:"ADD_MEMBER",member:{...candidate,favor}});setResult("captured")};
 const title=result==="captured"?"포획 성공":result==="fled"?"정체 확인 · 포획 실패":result==="giveup"?"식별 포기":null;
 const identified=result!=="giveup"&&(mode==="art"||Boolean(result));
 return <><div className="scene-nav"><button className="back-btn" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base",selectedPokemonId:null,selectedTypeName:null}})}>← 본거지로</button></div><div className="scanner">
  <div className="scn-view"><div className="scn-scanline"/>{identified?<img className={result?"":"silhouette"} src={ART(pokemon.pokemonRowid)} alt="미확인 개체"/>:<img className="unknown-wild vp-unknown-wild" src={unknownWild} alt="흐릿한 미확인 개체"/>}<div className="scn-namebar"><span className="scn-name">{result&&result!=="giveup"?pokemon.nameKr:"미확인 개체"}</span><span className="scn-stamp">{title||"신원 미상"}</span></div><div className="scn-status">{state.selectedTypeName&&<>감지 타입 {state.selectedTypeName} · </>}단서 {clues.length} · 오답 {attempts} · 포획률 {Math.round(favor)}%</div></div>
  {!result&&<><div className="scn-controls actions"><button className="scn-btn wide" onClick={consult}>박사와 상담하기<span className="sub">능력치·기술·특성·타입</span></button><button className="scn-btn" onClick={observe}>직접 관찰하기<span className="sub">키·몸무게</span></button><button className="scn-btn accent" onClick={silhouette}>본인확인서 대조<span className="sub">외곽 실루엣</span></button></div><div className="scn-log">{clues.length?clues.map((c,i)=><div className="logline" key={i}><span className="tag">단서</span>{c}</div>):<div className="logempty">아직 조회한 단서가 없습니다.</div>}</div><div className="scn-dock"><input value={guess} onChange={e=>setGuess(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="포켓몬 이름 입력"/><button className="scn-id" onClick={submit}>식별</button></div><button className="textlink" onClick={()=>setResult("giveup")}>식별 포기</button></>}
  {result&&<div className={`result ${result==="captured"?"":"miss"}`}><div className="eyebrow">{title}</div><div className="rname">{result==="giveup"?"미확인 개체":pokemon.nameKr}</div><div className="rmsg">{result==="captured"?`우호도 ${Math.round(favor)}로 동료가 되었습니다.`:result==="fled"?`이름은 맞혔지만 포획률 ${Math.round(favor)}% 판정에 실패해 도주했습니다.`:"정체를 확인하지 못한 채 탐험을 종료했습니다."}</div><div className="rmsg">단서 {clues.length}개 · 오답 {attempts}회</div><button className="again" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base",selectedPokemonId:null}})}>본거지로 →</button></div>}
 </div></>;
}
