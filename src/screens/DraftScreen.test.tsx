import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameDataBundle, PokemonRecord } from "../domain/types";
import { GameProvider } from "../game/GameProvider";
import { GAME_SAVE_KEY } from "../services/storageService";
import DraftScreen from "./DraftScreen";

const pokemon=(id:number,name:string):PokemonRecord=>({pokemonRowid:id,nameKr:name,hp:45,atk:49,def:49,satk:65,sdef:65,spd:45,details:{sprites:{front_default:""}}});
const data:GameDataBundle={pokemon:[pokemon(1,"이상해씨"),pokemon(4,"파이리"),pokemon(7,"꼬부기")],types:[],moves:[],abilities:[]};

describe("DraftScreen",()=>{
  beforeEach(()=>localStorage.clear());
  it("adds the selected starter to the persisted roster",async()=>{
    render(<GameProvider data={data}><DraftScreen/></GameProvider>);
    expect(screen.getByText("스타팅 선택 1/3")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(GAME_SAVE_KEY)!).roster).toHaveLength(1));
  });
});
