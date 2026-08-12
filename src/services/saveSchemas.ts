import { z } from "zod";

const buildingSchema=z.object({
  id:z.string().min(1),type:z.string().min(1),plotIndex:z.number().int().min(0).max(9),
  status:z.enum(["constructing","active"]),remainingTurns:z.number().int().min(0),
}).passthrough();

const rosterMemberSchema=z.object({
  id:z.string().optional(),pokemon:z.object({pokemonRowid:z.number().int().positive(),nameKr:z.string()}).passthrough(),
  level:z.number().min(1).default(1),exp:z.number().min(0).default(0),job:z.string().nullable().optional(),
  building:z.string().optional(),buildingId:z.string().nullable().optional(),
}).passthrough();

export const gameSaveSchema=z.object({
  v:z.number().int().min(1).optional(),roster:z.array(rosterMemberSchema).min(1),
  resources:z.record(z.string(),z.unknown()).default({}),buildings:z.array(buildingSchema).optional(),
  plotCap:z.number().int().min(1).max(10).optional(),storageCap:z.number().min(0).optional(),
  entryCap:z.number().int().min(1).optional(),turnCount:z.number().int().min(0).optional(),
  energy:z.number().min(0).max(5).optional(),nextMemberId:z.number().int().positive().optional(),
  nextBuildingId:z.number().int().positive().optional(),underConstruction:z.record(z.string(),z.number()).optional(),
}).passthrough();

export const mapSaveSchema=z.array(z.object({
  id:z.string().min(1),owner:z.enum(["player","wild"]),
}).passthrough());

export type ParsedGameSave=z.infer<typeof gameSaveSchema>;
export type ParsedMapSave=z.infer<typeof mapSaveSchema>;
