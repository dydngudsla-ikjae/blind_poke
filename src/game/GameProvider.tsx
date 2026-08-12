import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { GameDataBundle } from "../domain/types";
import { GAME_SAVE_KEY, MAP_SAVE_KEY, readGameSave, readMapSave, writeStorage } from "../services/storageService";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";
import type { GameAction, GameState } from "./gameTypes";

interface GameContextValue { state:GameState; dispatch:Dispatch<GameAction>; data:GameDataBundle }
const GameContext=createContext<GameContextValue|null>(null);

export function GameProvider({data,children}:{data:GameDataBundle;children:ReactNode}){
  const [state,dispatch]=useReducer(gameReducer,undefined,()=>{
    const save=readGameSave(); const map=readMapSave();
    return save?restoreGameState(save,map):createInitialState();
  });
  useEffect(()=>{
    if(!state.roster.length) return;
    const {screen,draftRound,selectedPokemonId,territories,battle,message,...save}=state;
    writeStorage(GAME_SAVE_KEY,{...save,v:3});
    writeStorage(MAP_SAVE_KEY,Object.entries(territories).map(([id,owner])=>({id,owner})));
  },[state]);
  const value=useMemo(()=>({state,dispatch,data}),[state,data]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(){const value=useContext(GameContext);if(!value)throw new Error("GameProvider missing");return value;}
