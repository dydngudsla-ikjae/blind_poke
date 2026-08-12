import { useGame } from "../game/GameProvider";
import { samplePokemon } from "../game/gameHelpers";

const nodes=[
 {id:"grasslands",name:"초원 마을",x:50,y:82,neighbors:["field","hill"],level:1},
 {id:"field",name:"들판",x:28,y:60,neighbors:["grasslands","forest","hill"],level:4},
 {id:"hill",name:"언덕",x:72,y:60,neighbors:["grasslands","field","cave"],level:5},
 {id:"forest",name:"숲 어귀",x:14,y:34,neighbors:["field","lake"],level:8},
 {id:"cave",name:"동굴 입구",x:86,y:34,neighbors:["hill","peak"],level:9},
 {id:"lake",name:"호숫가",x:32,y:10,neighbors:["forest"],level:12},
 {id:"peak",name:"봉우리",x:68,y:10,neighbors:["cave"],level:14},
];
export default function MapScreen(){const {state,data,dispatch}=useGame();const attackable=(n:typeof nodes[number])=>state.territories[n.id]!=="player"&&n.neighbors.some(id=>state.territories[id]==="player");const attack=(n:typeof nodes[number])=>{if(!state.roster.length)return;const enemy=samplePokemon(data.pokemon.filter(p=>!p.details?.isLegendary&&!p.details?.isMythical),1)[0];dispatch({type:"PATCH",patch:{screen:"battle",battle:{territoryId:n.id,enemyName:n.name,enemyPokemonId:enemy.pokemonRowid,enemyLevel:n.level}}})};
 return <div className="map-scene"><div className="map-head"><button className="back-btn" id="backToBase" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>← 본거지로</button><span>타운맵 · 확보 {Object.values(state.territories).filter(v=>v==="player").length}/7</span></div><div className="map-board">{nodes.map(n=><button key={n.id} data-node={n.id} disabled={!attackable(n)} onClick={()=>attack(n)} className={`map-node ${state.territories[n.id]==="player"?"owned":attackable(n)?"attackable":""}`} style={{left:`${n.x}%`,top:`${n.y}%`}}><span className="map-node-dot"/><span className="map-node-name">{n.name}</span><span className="map-node-owner">{state.territories[n.id]==="player"?"확보":attackable(n)?"도전 가능":"잠김"}</span></button>)}</div></div>}
