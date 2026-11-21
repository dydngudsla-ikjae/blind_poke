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
  it("lets players read traces directly in the clearing while keeping the starter's identity hidden",()=>{
    const { container } = render(<GameProvider data={data}><DraftScreen/></GameProvider>);
    const clearing = screen.getByRole("group", { name: "숲 공터" });
    expect(clearing.querySelectorAll("[data-draft-target]")).toHaveLength(3);
    expect(container.querySelector(".draft-aim, .draft-lock, .scanner-contact, .hunt-optics, .field-optic-bezel")).toBeNull();
    expect(screen.getByRole("heading", { name: "첫 동료를 찾아서" })).toBeVisible();
    const choice=screen.getByRole("button",{name:"고사리 그늘"});
    expect(screen.queryByText("풀")).not.toBeInTheDocument();
    expect(choice).not.toHaveTextContent("동료로 맞이하기");
    fireEvent.focus(choice);
    expect(choice).toHaveTextContent("동료로 맞이하기");
    expect(choice).toHaveAccessibleDescription("타입 단서 풀 키 0.7 m 몸무게 6.9 kg");
    expect(screen.getByRole("heading",{name:"동료 영입 0/3"})).toBeVisible();
    expect(screen.getByRole("heading",{name:"고사리 그늘"})).toBeVisible();
    expect(screen.getByText("풀")).toBeVisible();
    expect(screen.getByText("0.7 m")).toBeVisible();
    expect(screen.getByText("6.9 kg")).toBeVisible();
    expect(screen.queryByText(/이상해씨|파이리|꼬부기|좋은 관계|보통 관계|불편한 관계/)).not.toBeInTheDocument();
  });

  it("adds the selected starter to the persisted roster",async()=>{
    render(<GameProvider data={data}><DraftScreen/></GameProvider>);
    expect(screen.getByRole("heading",{name:"동료 영입 0/3"})).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(GAME_SAVE_KEY)!).roster).toHaveLength(1));
    expect(screen.getByRole("heading",{name:"동료 영입 1/3"})).toBeVisible();
  });
});
