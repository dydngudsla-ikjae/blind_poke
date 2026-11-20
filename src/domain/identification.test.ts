import { describe,expect,it } from "vitest";
import { HINT_DECAY, WRONG_DECAY, highestStats, nextProfessorTopic, type ClueNote } from "./identification";
const pokemon={pokemonRowid:1,nameKr:"테스트몬",hp:40,atk:80,def:50,satk:60,sdef:50,spd:70};
describe("identification rules",()=>{it("keeps clue and wrong penalties",()=>{expect(HINT_DECAY).toBe(8);expect(WRONG_DECAY).toBe(20)});it("uses IV when finding highest stats",()=>expect(highestStats(pokemon,{spd:20})).toEqual(["스피드"]))});

describe("professor consultation", () => {
  const topics = [
    { name: "능력치", options: ["스피드"] },
    { name: "기술", options: ["몸통박치기", "울음소리"] },
    { name: "특성", options: [] },
    { name: "타입", options: ["불꽃"] },
  ];

  it("keeps the consultation order regardless of other sources, then offers unread clues", () => {
    const notes: ClueNote[] = [{ topic: "직접 관찰", text: "키" }];
    expect(nextProfessorTopic(topics, notes)?.name).toBe("능력치");
    notes.push({ topic: "능력치", text: "스피드" }, { topic: "본인확인서", text: "실루엣" });
    expect(nextProfessorTopic(topics, notes)?.name).toBe("기술");
    notes.push({ topic: "기술", text: "몸통박치기" });
    expect(nextProfessorTopic(topics, notes)?.name).toBe("타입");
    notes.push({ topic: "타입", text: "불꽃" });
    expect(nextProfessorTopic(topics, notes)).toEqual({ name: "기술", options: ["울음소리"] });
    notes.push({ topic: "기술", text: "울음소리" });
    expect(nextProfessorTopic(topics, notes)).toBeUndefined();
  });
});
