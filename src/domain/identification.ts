import type { GameDataBundle, PokemonRecord } from "./types";

export const HINT_DECAY=8,WRONG_DECAY=20;
export function highestStats(p:PokemonRecord,iv:Record<string,number>){const values={HP:p.hp+(iv.hp||0),공격:p.atk+(iv.atk||0),방어:p.def+(iv.def||0),특공:p.satk+(iv.satk||0),특방:p.sdef+(iv.sdef||0),스피드:p.spd+(iv.spd||0)};const max=Math.max(...Object.values(values));return Object.entries(values).filter(([,v])=>v===max).map(([k])=>k)}

export type ClueNote = { topic: string; text: string };
type ProfessorTopic = { name: string; options: string[] };

export function professorTopics(pokemon: PokemonRecord, iv: Record<string, number>,
  data: Pick<GameDataBundle, "moves" | "abilities" | "types">): ProfessorTopic[] {
  const moveIds: number[] = pokemon.details?.moveRowids ?? [];
  const abilityIds: number[] = pokemon.details?.abilityRowids ?? [];
  const moveNames = moveIds.map(id => data.moves.find(move => move.moveRowid === id)?.nameKr);
  const abilityNames = abilityIds.map(id => data.abilities.find(ability => ability.abilityRowid === id)?.nameKr);
  const types = [...new Set([pokemon.type1Rowid, pokemon.type2Rowid])]
    .map(id => data.types.find(type => type.typeRowid === id)?.nameKr).filter(Boolean);
  return [
    { name: "능력치", options: [`두드러진 능력치: ${highestStats(pokemon, iv).join(" · ")}`] },
    { name: "기술", options: [...new Set(moveNames)].flatMap(name => name ? [`배울 수 있는 기술: ${name}`] : []) },
    { name: "특성", options: [...new Set(abilityNames)].flatMap(name => name ? [`특성 후보: ${name}`] : []) },
    { name: "타입", options: types.length ? [`타입 구성: ${types.join(" / ")}`] : [] },
  ];
}

export function nextProfessorTopic(topics: readonly ProfessorTopic[], notes: readonly ClueNote[]) {
  const topicNames = new Set(topics.map(topic => topic.name));
  const last = [...notes].reverse().find(note => topicNames.has(note.topic));
  const start = topics.findIndex(topic => topic.name === last?.topic) + 1;
  const seen = new Set(notes.map(note => note.text));
  for (const topic of [...topics.slice(start), ...topics.slice(0, start)]) {
    const options = topic.options.filter(text => !seen.has(text));
    if (options.length) return { name: topic.name, options };
  }
}
