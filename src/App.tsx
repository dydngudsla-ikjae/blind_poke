import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import type { GameDataBundle } from "./domain/types";
import { GameProvider, useGame } from "./game/GameProvider";
import { loadGameData } from "./services/dataService";
import BaseScreen from "./screens/BaseScreen";
import BattleScreen from "./screens/BattleScreen";
import DraftScreen from "./screens/DraftScreen";
import HuntScreen from "./screens/HuntScreen";
import IdentifyScreen from "./screens/IdentifyScreen";
import MapScreen from "./screens/MapScreen";

class GameErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{
  state={error:null as Error|null};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error,info:ErrorInfo){console.error("BlindPoke render failure",error,info);}
  render(){return this.state.error?<main className="term"><div className="boot">실행 실패: {this.state.error.message}</div></main>:this.props.children;}
}

function ScreenRouter(){const {state}=useGame();switch(state.screen){
  case "draft":return <DraftScreen/>;case "base":return <BaseScreen/>;case "hunt":return <HuntScreen/>;
  case "identify":return <IdentifyScreen/>;case "map":return <MapScreen/>;case "battle":return <BattleScreen/>;
}}

export default function App(){const [data,setData]=useState<GameDataBundle|null>(null);const [error,setError]=useState("");
 useEffect(()=>{loadGameData().then(setData).catch(e=>setError(e instanceof Error?e.message:String(e)))},[]);
 return <GameErrorBoundary><main className="term" id="app" aria-busy={!data}>{error?<div className="boot">로드 실패: {error}</div>:data?<GameProvider data={data}><ScreenRouter/></GameProvider>:<div className="boot">개체 데이터베이스 로드 중<span className="dots"/></div>}</main></GameErrorBoundary>;
}
