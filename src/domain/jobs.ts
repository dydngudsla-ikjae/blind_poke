import type { BuildingState, PokemonRecord, ResourceState, RosterMember } from "./types";
import type { BuildingType } from "./construction";

export const MAX_PLOTS = 10;
export const GROUND_TYPE = 5;
export const HUNT_ENERGY_COST = 2;
export const MAX_RESEARCH_WORKERS = 3;
export type ResourceKey = keyof Omit<ResourceState, "items">;
type Recipe = {
  output: ResourceKey;
  base: number;
  input?: { key: ResourceKey; amount: number };
};

interface JobDefinition {
  building: BuildingType;
  name: string;
  typeId: number;
  description: string;
  recipe?: Recipe;
}

export const JOBS = {
  seed: { building: "farm", name: "씨앗 생성", typeId: 12, description: "씨앗을 생산합니다.", recipe: { output: "seed", base: 3 } },
  till: { building: "farm", name: "밭 일구기", typeId: 7, description: "같은 밭의 열매 생산량을 마리당 20% 높입니다." },
  fruit: { building: "farm", name: "열매 재배", typeId: 11, description: "열매 하나마다 씨앗 하나를 사용합니다.", recipe: { output: "fruit", base: 2, input: { key: "seed", amount: 1 } } },
  cook: { building: "restaurant", name: "요리", typeId: 10, description: "음식 하나마다 열매 두 개를 사용합니다.", recipe: { output: "food", base: 1, input: { key: "fruit", amount: 2 } } },
  chill: { building: "restaurant", name: "냉장", typeId: 15, description: "매 턴 자원별 저장 상한을 마리당 10 늘립니다." },
  train: { building: "dojo", name: "훈련", typeId: 2, description: "기술머신을 생산합니다.", recipe: { output: "tm", base: 1 } },
  research: { building: "dojo", name: "육성 연구", typeId: 14, description: "경험치 사탕을 생산합니다.", recipe: { output: "candy", base: 1 } },
  mine: { building: "workshop", name: "재료 채취", typeId: 6, description: "재료를 생산합니다.", recipe: { output: "material", base: 3 } },
  mint: { building: "workshop", name: "재화 주조", typeId: 9, description: "자금 하나마다 재료 하나를 사용합니다.", recipe: { output: "gold", base: 2, input: { key: "material", amount: 1 } } },
  craft: { building: "workshop", name: "부품 제작", typeId: 13, description: "부품 하나마다 재료 하나를 사용합니다.", recipe: { output: "tool", base: 1, input: { key: "material", amount: 1 } } },
  heal: { building: "clinic", name: "회복 아이템 생산", typeId: 18, description: "우호도를 회복하는 아이템을 만듭니다.", recipe: { output: "healItem", base: 1 } },
  cure: { building: "clinic", name: "치료 아이템 생산", typeId: 4, description: "배틀 중 선봉의 상태이상을 치료하는 아이템을 만듭니다.", recipe: { output: "cureItem", base: 1 } },
} satisfies Record<string, JobDefinition>;

export type JobId = keyof typeof JOBS;
export const jobIds = Object.keys(JOBS) as JobId[];
export const jobDefinitions: Record<JobId, JobDefinition> = JOBS;

export function isJobId(value: string): value is JobId {
  return Object.hasOwn(JOBS, value);
}

export function hasPokemonType(pokemon: PokemonRecord, typeId: number) {
  return pokemon.type1Rowid === typeId || pokemon.type2Rowid === typeId;
}

export function researcherCount(roster: readonly RosterMember[], buildingId: string) {
  return roster.filter(member => member.buildingId === buildingId && member.jobId === "research").length;
}

export function supportsJob(building: BuildingState, pokemon: PokemonRecord, jobId: JobId) {
  const job = jobDefinitions[jobId];
  return building.status === "active" && building.type === job.building && hasPokemonType(pokemon, job.typeId);
}
