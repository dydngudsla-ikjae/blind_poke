import { useGame } from "../game/GameProvider";
import { samplePokemon } from "../game/gameHelpers";

const nodes=[
 {id:"grasslands",name:"초원 마을",x:50,y:82,neighbors:["field","hill"],level:1,size:1,cap:320},
 {id:"field",name:"들판",x:28,y:60,neighbors:["grasslands","forest","hill"],level:4,size:1,cap:320},
 {id:"hill",name:"언덕",x:72,y:60,neighbors:["grasslands","field","cave"],level:5,size:1,cap:320},
 {id:"forest",name:"숲 어귀",x:14,y:34,neighbors:["field","lake"],level:8,size:2,cap:480},
 {id:"cave",name:"동굴 입구",x:86,y:34,neighbors:["hill","peak"],level:9,size:2,cap:480},
 {id:"lake",name:"호숫가",x:32,y:10,neighbors:["forest"],level:12,size:2,cap:Infinity},
 {id:"peak",name:"봉우리",x:68,y:10,neighbors:["cave"],level:14,size:2,cap:Infinity},
];
export default function MapScreen(){const {state,data,dispatch}=useGame();const attackable=(n:typeof nodes[number])=>state.territories[n.id]!=="player"&&n.neighbors.some(id=>state.territories[id]==="player");const attack=(n:typeof nodes[number])=>{if(!state.roster.length||state.energy<2)return;const stat=(p:(typeof data.pokemon)[number])=>p.hp+p.atk+p.def+p.satk+p.sdef+p.spd;const pool=data.pokemon.filter(p=>!p.details?.isLegendary&&!p.details?.isMythical&&stat(p)<=n.cap);const enemies=samplePokemon(pool,n.size);dispatch({type:"PATCH",patch:{screen:"battle",energy:state.energy-2,battle:{territoryId:n.id,enemyName:n.name,enemyTeam:enemies.map(p=>({pokemonId:p.pokemonRowid,level:n.level}))}}})};
 return <div className="map-scene"><div className="map-head"><button className="back-btn" id="backToBase" onClick={()=>dispatch({type:"PATCH",patch:{screen:"base"}})}>← 본거지로</button><span>타운맵 · 확보 {Object.values(state.territories).filter(v=>v==="player").length}/7 · 공격 에너지 2 ({state.energy}/5)</span></div><div className="map-board">{nodes.map(n=><button key={n.id} data-node={n.id} disabled={!attackable(n)||state.energy<2} onClick={()=>attack(n)} className={`map-node ${state.territories[n.id]==="player"?"owned":attackable(n)?"attackable":""}`} style={{left:`${n.x}%`,top:`${n.y}%`}}><span className="map-node-dot"/><span className="map-node-name">{n.name}</span><span className="map-node-owner">{state.territories[n.id]==="player"?"확보":attackable(n)?state.energy>=2?"도전 가능":"에너지 부족":"잠김"}</span></button>)}</div></div>}
