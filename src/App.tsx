import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { GameNotice } from "./components/GameNotice";
import type { GameDataBundle } from "./domain/types";
import { endingReady } from "./game/campaign";
import { GameProvider, useGame } from "./game/GameProvider";
import { loadGameData } from "./services/dataService";
import BaseScreen from "./screens/BaseScreen";
import BattleScreen from "./screens/BattleScreen";
import { EndingScreen } from "./screens/CampaignGoals";
import DraftScreen from "./screens/DraftScreen";
import HuntScreen from "./screens/HuntScreen";
import IdentifyScreen from "./screens/IdentifyScreen";
import MapScreen from "./screens/MapScreen";

class GameErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{
  state={error:null as Error|null};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error,info:ErrorInfo){console.error("BlindPoke render failure",error,info);}
  render(){return this.state.error ? (
    <main className="term"><GameNotice title="화면을 열지 못했습니다" focus>
      <p>저장된 진행을 다시 불러옵니다.</p>
      <div><button className="base-button" onClick={() => window.location.reload()}>다시 열기</button></div>
    </GameNotice></main>
  ) : this.props.children;}
}

function ScreenRouter(){const {state}=useGame();switch(state.screen){
  case "draft":
  case "trainerReveal":return <DraftScreen/>;
  case "base":return !state.endingSeen && endingReady(state) ? <EndingScreen /> : <BaseScreen/>;case "hunt":return <HuntScreen/>;
  case "identify":return <IdentifyScreen/>;case "map":return <MapScreen/>;case "battle":return <BattleScreen/>;
}}

export default function App() {
  const [data, setData] = useState<GameDataBundle | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadGameData(controller.signal).then(setData).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <GameErrorBoundary>
      <main className="term" id="app" aria-busy={!data && !error}>
        {error ? (
          <GameNotice title="데이터 로드 실패" focus>
            <p>{error}</p>
            <div><button className="base-button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>다시 시도</button></div>
          </GameNotice>
        ) : data ? <GameProvider data={data}><ScreenRouter /></GameProvider> : (
          <GameNotice title="관측소 연결 중"><p role="status">포켓몬과 지도 데이터를 불러오는 중입니다.</p></GameNotice>
        )}
      </main>
    </GameErrorBoundary>
  );
}
