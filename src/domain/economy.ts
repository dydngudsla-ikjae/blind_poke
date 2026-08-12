import type { ResourceState, RosterMember } from "./types";

export const RESOURCE_LABELS:Record<keyof Omit<ResourceState,"items">,string>={seed:"씨앗",fruit:"열매",food:"음식",material:"재료",gold:"자금",tool:"부품",tm:"기술머신",candy:"경험치 사탕",healItem:"회복 아이템",cureItem:"치료 아이템"};
export const HELD_ITEMS={leftovers:{name:"먹다남은음식",desc:"매 턴 우호도 2 회복"},soothe_bell:{name:"평온의방울",desc:"우호도 자연 감소 절반"},lucky_egg:{name:"행복의알",desc:"사탕 경험치 2배"},amulet_coin:{name:"부적금화",desc:"재화 주조 산출량 50% 증가"},choice_band:{name:"구애머리띠",desc:"직무 산출량 20% 증가"},focus_sash:{name:"기합의띠",desc:"우호도가 낮아도 이탈하지 않음"}} as const;
export type HeldItemId=keyof typeof HELD_ITEMS;

export function feedMember(m:RosterMember){return {...m,favor:Math.min(m.favCeil,m.favor+15)};}
export function candyMember(m:RosterMember){let exp=m.exp+(m.heldItem==="lucky_egg"?40:20),level=m.level,favCeil=m.favCeil;while(exp>=level*20){exp-=level*20;level++;favCeil=Math.min(100,favCeil+3)}return {...m,exp,level,favCeil};}
export function decayFavor(m:RosterMember){const restored=m.heldItem==="leftovers"?Math.min(m.favCeil,m.favor+2):m.favor;const decay=m.heldItem==="soothe_bell"?1:2;return {...m,favor:Math.max(m.favFloor,restored-decay)};}
