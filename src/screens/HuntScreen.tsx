import { useMemo } from "react";
import { useGame } from "../game/GameProvider";
import { samplePokemon } from "../game/gameHelpers";

const spots=[{left:"22%",top:"56%"},{left:"50%",top:"62%"},{left:"77%",top:"53%"}];
export default function HuntScreen(){const {data,dispatch}=useGame();const candidates=useMemo(()=>samplePokemon(data.pokemon,3),[]);
 return <><div className="scene-nav"><button className="back-btn" id="backToBase" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>← 본거지로</button></div><div className="encounter-scene"><div className="enc-ground-light"/><div className="encounter-mons">{candidates.map((p,i)=><button key={p.pokemonRowid} className="enc-mon" style={{left:spots[i].left,top:spots[i].top,"--hide-scale":1} as React.CSSProperties} onClick={()=>dispatch({type:"PATCH",patch:{screen:"identify",selectedPokemonId:p.pokemonRowid}})}><span className="enc-silhouette-wrap"><span className="enc-contact-shadow"/><svg className="enc-silhouette" width="64" height="72" viewBox="0 0 64 64"><path d="M32,3 C20,3 12,20 12,36 C12,52 20,61 32,61 C44,61 52,52 52,36 C52,20 44,3 32,3 Z"/></svg></span></button>)}</div><div className="scan-panel show"><div className="sp-inner"><div className="sp-eyebrow">WILD SCAN</div><div className="sp-name">미확인 개체 3마리</div><div className="sp-stats">개체를 선택해 식별을 시작하세요</div></div></div></div></>}
