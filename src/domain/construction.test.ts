import { describe, expect, it } from "vitest";
import { constructionTurns, projectedConstructionTurns } from "./construction";

describe("construction rules",()=>{
  it.each([[1,3],[2,2],[3,1],[4,1]])("%i workers require %i turns",(workers,turns)=>{
    expect(constructionTurns(workers)).toBe(turns);
  });
  it("never increases remaining time when workers are added",()=>{
    expect(projectedConstructionTurns(1,2)).toBe(1);
    expect(projectedConstructionTurns(3,2)).toBe(2);
  });
});
