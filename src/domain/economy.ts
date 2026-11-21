import type { ResourceState, RosterMember } from "./types";

export const RESOURCE_LABELS:Record<keyof Omit<ResourceState,"items">,string>={seed:"씨앗",fruit:"열매",food:"음식",material:"재료",gold:"자금",tool:"부품",tm:"기술머신",candy:"경험치 사탕",healItem:"회복 아이템",cureItem:"치료 아이템"};
export const HELD_ITEMS={leftovers:{name:"먹다남은음식",desc:"매 턴 우호도 2 회복"},soothe_bell:{name:"평온의방울",desc:"우호도 자연 감소 절반"},lucky_egg:{name:"행복의알",desc:"사탕 경험치 2배"},amulet_coin:{name:"부적금화",desc:"재화 주조 산출량 50% 증가"},choice_band:{name:"구애머리띠",desc:"직무 산출량 20% 증가"},focus_sash:{name:"기합의띠",desc:"장착 중 우호도 하한에서 이탈 방지"}} as const;
export type HeldItemId=keyof typeof HELD_ITEMS;
export const HELD_ITEM_COST = 3;
export const ENERGY_CHARGE_COST = 5;
export const ENERGY_CHARGE_GAIN = 2;
export const GROWTH_ITEM_ENERGY_COST = 1;

export function isHeldItemId(id: string): id is HeldItemId {
  return Object.hasOwn(HELD_ITEMS, id);
}

export function feedMember(m:RosterMember){return {...m,favor:Math.min(m.favCeil,m.favor+15),departurePending:undefined};}
export const levelExperienceCost = (level: number) => level * 20;
export const experiencePerCandy = (member: RosterMember) => member.heldItem === "lucky_egg" ? 40 : 20;

export function candyCostToLevel(member: RosterMember, targetLevel: number) {
  const levels = Math.max(0, Math.ceil(targetLevel - member.level));
  if (!levels) return 0;
  const required = levels * levelExperienceCost(member.level + (levels - 1) / 2);
  return Math.max(1, Math.ceil((required - member.exp) / experiencePerCandy(member)));
}

export function candyMember(member: RosterMember, count = 1) {
  let { level, exp, favCeil } = member;
  exp += experiencePerCandy(member) * count;
  while (exp >= levelExperienceCost(level)) {
    exp -= levelExperienceCost(level);
    level++;
    favCeil = Math.min(100, favCeil + 3);
  }
  return { ...member, exp, level, favCeil };
}
export function isDeparturePending(member: RosterMember) {
  return member.departurePending === true && member.favor <= member.favFloor && member.heldItem !== "focus_sash";
}

const favorDecay = (member: RosterMember) => member.heldItem === "soothe_bell" ? 1 : 2;

export function turnsUntilDepartureWarning(member: RosterMember) {
  if (member.heldItem === "focus_sash") return null;
  if (isDeparturePending(member)) return 0;
  if (member.favor <= member.favFloor) return 1;
  if (member.heldItem === "leftovers") return null;
  const turns = Math.ceil((member.favor - member.favFloor) / favorDecay(member));
  return Number.isFinite(turns) ? turns : null;
}

export function departureWarnings(roster: readonly RosterMember[]) {
  return roster.flatMap(member => {
    const turns = turnsUntilDepartureWarning(member);
    return turns !== null && turns <= 5 ? [{ member, turns }] : [];
  }).sort((a, b) => a.turns - b.turns);
}

export function advanceMemberFavor(member: RosterMember) {
  const restored = member.heldItem === "leftovers" ? Math.min(member.favCeil, member.favor + 2) : member.favor;
  const favor = Math.max(member.favFloor, restored - favorDecay(member));
  const atFloor = favor <= member.favFloor;
  const protectedBySash = atFloor && member.heldItem === "focus_sash";
  const departed = atFloor && isDeparturePending(member);
  const updated = { ...member, favor, departurePending: atFloor && !protectedBySash ? true : undefined };
  return { member: updated, departed, protectedBySash };
}

export const GROWTH_ITEMS = {
  food: { action: "음식 주기", effect: feedMember, canImprove: (member: RosterMember) => member.favor < member.favCeil },
  healItem: { action: "회복 아이템 사용", effect: feedMember, canImprove: (member: RosterMember) => member.favor < member.favCeil },
  candy: { action: "사탕 먹이기", effect: candyMember, canImprove: () => true },
  tm: { action: "기술 지도", effect: (member: RosterMember) => ({ ...member, aptitude: Math.min(100, member.aptitude + 5) }),
    canImprove: (member: RosterMember) => member.aptitude < 100 },
} as const;
export type GrowthItem = keyof typeof GROWTH_ITEMS;

export function canUseGrowthItem(state: { energy: number; resources: ResourceState }, member: RosterMember, item: GrowthItem, count = 1) {
  if (!Number.isSafeInteger(count) || count < 1 || (item !== "candy" && count !== 1)) return false;
  return Object.hasOwn(GROWTH_ITEMS, item) && state.energy >= GROWTH_ITEM_ENERGY_COST * count &&
    state.resources[item] >= count && GROWTH_ITEMS[item].canImprove(member);
}
