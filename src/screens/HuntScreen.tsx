import { useMemo, useState, type MouseEvent } from "react";
import { useGame } from "../game/GameProvider";
import { samplePokemon } from "../game/gameHelpers";
import unknownWild from "../../assets/unknown-wild.png";

const spots=[{left:"22%",top:"56%"},{left:"50%",top:"62%"},{left:"77%",top:"53%"}];
const TYPE_COLORS:Record<string,string>={노말:"#9aa2ab",격투:"#d1425b",비행:"#8fb7ff",독:"#a24bd6",땅:"#d6a94b",바위:"#b8a05c",벌레:"#8bbf3d",고스트:"#7d6ca8",강철:"#8fa0b3",불꽃:"#ff6b3d",물:"#4d90ff",풀:"#4caf50",전기:"#f7c948",에스퍼:"#ff5aa8",얼음:"#5cd6d6",드래곤:"#7a5bff",악:"#6a6470",페어리:"#ff9ecf"};

export default function HuntScreen(){
  const {data,dispatch}=useGame();
  const candidates=useMemo(()=>samplePokemon(data.pokemon,3).map(p=>{
    const typeIds=[p.type1Rowid,p.type2Rowid].filter((id,index,list):id is number=>id!=null&&list.indexOf(id)===index);
    const shownTypeId=typeIds[Math.floor(Math.random()*typeIds.length)];
    return {pokemon:p,shownType:data.types.find(type=>type.typeRowid===shownTypeId)?.nameKr??"미확인"};
  }),[]);
  const [hovered,setHovered]=useState<number|null>(null);
  const [cursor,setCursor]=useState({x:0,y:0,visible:false});
  const scanned=hovered===null?null:candidates[hovered];
  const moveScanner=(event:MouseEvent<HTMLDivElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    setCursor({x:event.clientX-rect.left,y:event.clientY-rect.top,visible:true});
  };

  return <>
    <div className="scene-nav"><button className="back-btn" id="backToBase" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>← 본거지로</button></div>
    <div className="encounter-scene" onMouseMove={moveScanner} onMouseLeave={()=>{setCursor(value=>({...value,visible:false}));setHovered(null)}}>
      <div className="enc-ground-light"/>
      <div className="encounter-mons">{candidates.map(({pokemon:p,shownType},i)=><button key={p.pokemonRowid}
        className={`enc-mon${hovered===i?" is-selected":""}`}
        style={{left:spots[i].left,top:spots[i].top,"--hide-scale":1} as React.CSSProperties}
        onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}
        onClick={()=>dispatch({type:"PATCH",patch:{screen:"identify",selectedPokemonId:p.pokemonRowid,selectedTypeName:shownType}})}>
        <span className="enc-silhouette-wrap">
          <span className="enc-selected-ring"><svg className="ring-svg" viewBox="0 0 200 200"><circle className="ring ring-outer" cx="100" cy="100" r="92"/><circle className="ring ring-inner" cx="100" cy="100" r="70"/></svg><span className="ring-bracket top"/><span className="ring-bracket right"/><span className="ring-bracket bottom"/><span className="ring-bracket left"/><span className="ring-scanline"/></span>
          <span className="enc-contact-shadow"/><img className="unknown-wild" src={unknownWild} alt="흐릿한 미확인 개체"/>
        </span>
      </button>)}</div>
      <span className={`scan-mini-cursor${hovered!==null?" suppressed":""}`} style={{left:cursor.x,top:cursor.y,opacity:cursor.visible?(hovered!==null?.12:1):0}}><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="20" y1="32" x2="20" y2="38"/><line x1="2" y1="20" x2="8" y2="20"/><line x1="32" y1="20" x2="38" y2="20"/><circle className="mc-dot" cx="20" cy="20" r="1.6"/></svg></span>
      <div className={`scan-panel${scanned?" show":""}`}><div className="sp-inner"><div className="sp-eyebrow"><span>WILD SCAN</span><span className="sp-ticks"/></div>
        {scanned&&<div className="sp-body"><div className="sp-mini"><svg className="sp-mini-ring" viewBox="0 0 100 100"><circle className="mr-outer" cx="50" cy="50" r="46"/><circle className="mr-inner" cx="50" cy="50" r="36"/></svg><span className="sp-mini-sil"><img className="unknown-wild" src={unknownWild} alt="" style={{width:41,height:41}}/></span></div><div className="sp-text"><div className="sp-name">미확인 개체 {hovered!+1}</div><div className="sp-row"><span className="sp-pill" style={{background:TYPE_COLORS[scanned.shownType]??"#666"}}>{scanned.shownType}</span><span className="sp-stats">{scanned.pokemon.heightM??"?"}m · {scanned.pokemon.weightKg??"?"}kg</span></div></div></div>}
      </div></div>
    </div>
  </>;
}
