import { z } from "zod";
import { MAX_PLOTS } from "../domain/jobs";
import { worldMapNodes } from "../domain/worldMap";
import { ESPIONAGE_QUIET_TURNS, INTRUSION_QUIET_TURNS } from "../domain/frontierOperations";

const buildingSchema=z.object({
  id:z.string().min(1),type:z.string().min(1),plotIndex:z.number().int().min(0).max(9),
  siteId:z.string().min(1).optional(),
  inherited:z.literal(true).optional().catch(undefined),
  status:z.enum(["constructing","active"]),remainingTurns:z.number().int().min(0),
}).passthrough();

const rosterMemberSchema=z.object({
  id:z.string().optional(),pokemon:z.object({pokemonRowid:z.number().int().positive(),nameKr:z.string()}).passthrough(),
  level:z.number().min(1).default(1),exp:z.number().min(0).default(0),job:z.string().nullable().optional(),
  building:z.string().nullable().optional(),buildingId:z.string().nullable().optional(),
  jobId:z.string().nullable().optional(),jobOrder:z.number().int().nonnegative().optional(),
  departurePending:z.boolean().optional(),
}).passthrough();

const frontierSaveSchema = z.object({
  intel: z.record(z.string(), z.object({
    sourceId: z.string(), trainerId: z.string().nullable(), pokemonIds: z.array(z.int().positive()).min(1).max(2),
    memberId: z.string().min(1).optional(),
    reversed: z.literal(true).optional().catch(undefined),
  })),
  intrusion: z.object({ sourceId: z.string(), targetId: z.string(), defenderId: z.string().min(1).optional() }).nullable(),
  quietTurns: z.int().min(0).max(INTRUSION_QUIET_TURNS),
  sabotage: z.object({
    sourceId: z.string().min(1), targetId: z.string().min(1), trainerId: z.string().nullable(), memberId: z.string().min(1),
  }).optional().catch(undefined),
  espionage: z.object({
    quietTurns: z.int().min(0).max(ESPIONAGE_QUIET_TURNS),
    observation: z.object({
      sourceId: z.string().min(1), targetId: z.string().min(1), trainerId: z.string().nullable(),
      detectorId: z.string().min(1).optional(),
    }).optional().catch(undefined),
    preparation: z.object({
      territoryId: z.string().min(1), trainerId: z.string().nullable(),
      leadTypes: z.array(z.int().positive()).min(1).max(2), expiresTurn: z.int().positive(),
    }).optional().catch(undefined),
  }).optional().catch(undefined),
});
const clearingSchema = z.object({plotIndex:z.number().int().min(1).max(MAX_PLOTS-1),memberId:z.string().min(1)});
const outpostSchema = z.object({ plotCap: z.int().min(2).max(MAX_PLOTS), clearing: clearingSchema.nullable(), inheritancePending: z.boolean() });

export const gameSaveSchema=z.object({
  v:z.number().int().min(1).optional(),roster:z.array(rosterMemberSchema),
  resources:z.record(z.string(),z.unknown()).default({}),buildings:z.array(buildingSchema).optional(),
  plotCap:z.number().int().min(1).optional(),storageCap:z.number().min(0).optional(),
  entryCap:z.number().int().min(1).optional(),entryOrder:z.array(z.string().min(1)).max(6).optional(),turnCount:z.number().int().min(0).optional(),
  energy:z.number().min(0).max(5).optional(),nextMemberId:z.number().int().positive().optional(),
  nextBuildingId:z.number().int().positive().optional(),underConstruction:z.record(z.string(),z.number()).optional(),
  trainerId:z.string().min(1).nullable().optional(),
  introPending:z.boolean().optional(),
  caughtSpeciesIds:z.array(z.number().int().positive()).optional(),
  claimedDexRewards:z.array(z.number().int().positive()).optional(),
  legacyOutpostResearch:z.boolean().optional().catch(undefined),
  inheritedResearchCompleted:z.literal(true).optional().catch(undefined),
  inheritedResearchRewardClaimed:z.literal(true).optional().catch(undefined),
  endingSeen:z.boolean().optional(),
  mapSnapshot:z.unknown().optional(),
  frontier:frontierSaveSchema.optional().catch(undefined),
  clearing:clearingSchema.nullable().optional(),
  outposts:z.record(z.string(), outpostSchema.optional().catch(undefined)).optional().catch(undefined),
  lastLog:z.array(z.string()).optional(),
}).passthrough().refine(save => save.roster.length > 0 || (save.v === 4 && save.introPending === false),
  { path: ["roster"], message: "포켓몬 기록이 올바르지 않습니다." }).refine(save => (save.v ?? 1) < 4 || (save.plotCap ?? 1) <= MAX_PLOTS,
  { path: ["plotCap"], message: "부지 상한이 올바르지 않습니다." });

const territoryProgress = {
  factionId: z.string().min(1).optional(),
  loyalty: z.int().min(0).max(100).optional(),
};

export const mapSaveSchema=z.array(z.object({
  id:z.string().min(1),owner:z.enum(["player","trainer","unoccupied","wild"]),
  trainerId:z.string().min(1).nullable().optional(),scouted:z.boolean().optional(),
  active:z.boolean().optional(),unlocked:z.boolean().optional(),
  ...territoryProgress,
}).passthrough()).min(1);

const worldIds = new Set(worldMapNodes.map(node => node.id));
export const mapSnapshotSchema = z.array(z.object({
  id: z.string(), owner: z.enum(["player", "trainer", "unoccupied"]),
  trainerId: z.string().min(1).nullable(), scouted: z.boolean(), active: z.boolean(),
  ...territoryProgress,
})).length(worldIds.size).refine(map => new Set(map.map(spot => spot.id)).size === worldIds.size &&
  map.every(spot => worldIds.has(spot.id)));

export type ParsedGameSave=z.infer<typeof gameSaveSchema>;
export type ParsedMapSave=z.infer<typeof mapSaveSchema>;
