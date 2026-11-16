import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameDataBundle, PokemonRecord } from "../domain/types";
import { GameProvider } from "../game/GameProvider";
import { GAME_SAVE_KEY } from "../services/storageService";
import DraftScreen from "./DraftScreen";

const pokemon=(id:number,name:string):PokemonRecord=>({pokemonRowid:id,nameKr:name,type1Rowid:12,heightM:0.7,weightKg:6.9,hp:45,atk:49,def:49,satk:65,sdef:65,spd:45,details:{sprites:{front_default:""}}});
const data:GameDataBundle={pokemon:[pokemon(1,"이상해씨"),pokemon(4,"파이리"),pokemon(7,"꼬부기")],types:[{typeRowid:12,nameKr:"풀"}],moves:[],abilities:[],battle:{learnsets:{},moves:{}},trainers:[{id:"red",nameKr:"레드",nameEn:"Red",generation:1,region:"Kanto",roles:["trainer"],specialtyTypes:[],pokemon:[{id:1,nameKr:"이상해씨"}]}]};

describe("DraftScreen",()=>{
  beforeEach(()=>localStorage.clear());
  afterEach(cleanup);
  it("reveals type and measurements on focus without revealing the starter's identity",()=>{
    render(<GameProvider data={data}><DraftScreen/></GameProvider>);
    const choice=screen.getByRole("button",{name:"미확인 개체 1"});
    expect(screen.queryByText("풀")).not.toBeInTheDocument();
    fireEvent.focus(choice);
    expect(screen.getByRole("heading",{name:"스타팅 선택 1/3"})).toBeVisible();
    expect(screen.getByRole("heading",{name:"미확인 개체 1"})).toBeVisible();
    expect(screen.getByText("풀")).toBeVisible();
    expect(screen.getByText("0.7 m")).toBeVisible();
    expect(screen.getByText("6.9 kg")).toBeVisible();
    expect(screen.queryByText(/이상해씨|파이리|꼬부기|좋은 관계|보통 관계|불편한 관계/)).not.toBeInTheDocument();
  });

  it("adds the selected starter to the persisted roster",async()=>{
    render(<GameProvider data={data}><DraftScreen/></GameProvider>);
    expect(screen.getByRole("heading",{name:"스타팅 선택 1/3"})).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(GAME_SAVE_KEY)!).roster).toHaveLength(1));
  });
});
