import { createContext, useContext, useEffect, useMemo, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { GameNotice, NewGameDialog } from "../components/GameNotice";
import type { GameDataBundle } from "../domain/types";
import { clearGameStorage, readSaveSlot, writeGameSave } from "../services/storageService";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";
import type { GameAction, GameState } from "./gameTypes";
import { factionDefenders } from "./territoryFactions";

interface GameContextValue {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  data: GameDataBundle;
  startNewGame: () => boolean;
}
const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ data, children }: { data: GameDataBundle; children: ReactNode }) {
  const [slot, setSlot] = useState(readSaveSlot);
  const [session, setSession] = useState(0);
  const [confirm, setConfirm] = useState(false);

  function startNewGame() {
    if (!clearGameStorage()) return false;
    setConfirm(false);
    setSlot({ kind: "empty" });
    setSession(value => value + 1);
    return true;
  }

  if (slot.kind === "damaged" || slot.kind === "unavailable") {
    return (
      <GameNotice title={slot.kind === "damaged" ? "저장 기록 손상" : "저장소 연결 실패"} focus>
        <p>{slot.kind === "damaged" ? "이전 기록을 읽을 수 없습니다. 새 게임을 확인하기 전까지 기록을 보존합니다." : "브라우저 저장소를 열 수 없습니다. 사이트의 저장 권한을 확인해 주세요."}</p>
        <div className="base-panel-actions">
          <button className="base-button" onClick={() => setSlot(readSaveSlot())}>다시 읽기</button>
          {slot.kind === "damaged" && <button className="base-button" onClick={() => setConfirm(true)}>새 게임</button>}
        </div>
        {confirm && <NewGameDialog onClose={() => setConfirm(false)} onConfirm={startNewGame} />}
      </GameNotice>
    );
  }

  return <GameSession key={session} data={data} slot={slot} startNewGame={startNewGame}>{children}</GameSession>;
}

function GameSession({ data, children, slot, startNewGame }: {
  data: GameDataBundle; children: ReactNode;
  slot: Extract<ReturnType<typeof readSaveSlot>, { kind: "ready" | "empty" }>;
  startNewGame: () => boolean;
}) {
  const [state, dispatch] = useReducer((state: GameState, action: GameAction) => gameReducer(state, action, data), undefined, () => {
    const trainerId = (slot.kind === "ready" && slot.game.trainerId) || data.trainers[Math.floor(Math.random() * data.trainers.length)]?.id || null;
    const opponents = data.trainers.filter(trainer => trainer.id !== trainerId).map(trainer => trainer.id);
    const defenders = factionDefenders(data);
    return slot.kind === "ready" ? restoreGameState(slot.game, slot.map, trainerId, opponents, defenders)
      : createInitialState(trainerId, opponents, Math.random, defenders);
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState(slot.kind === "ready" && slot.mapRecovered
    ? (slot.map ? "손상된 지도 기록을 호환 저장에서 복구했습니다." : "지도 기록을 읽지 못해 지도를 다시 구성했습니다. 본거지 기록은 복원했습니다.") : "");

  useEffect(() => {
    if (!state.roster.length && state.introPending !== false) return;
    const { screen, draftRound, selectedPokemonId, selectedTypeName, selectedScan, huntTypeId, counterHunt, territories,
      battle, mapFocusId, siteViewId, facilityOpening, message, factionDefenderIds, ...save } = state;
    const map = Object.entries(territories).map(([id, territory]) => ({ id, ...territory }));
    setSaveFailed(!writeGameSave(save, map));
  }, [state]);

  const value = useMemo(() => ({ state, dispatch, data, startNewGame }), [state, data, startNewGame]);
  return (
    <GameContext.Provider value={value}>
      {saveFailed && <div className="game-storage-notice" role="alert">진행을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.</div>}
      {recoveryNotice && <div className="game-storage-notice"><span role="status">{recoveryNotice}</span>
        <button className="base-button" onClick={() => setRecoveryNotice("")}>확인</button></div>}
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error("GameProvider missing");
  return value;
}
