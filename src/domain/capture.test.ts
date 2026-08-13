import {describe,expect,it} from "vitest";
import {resolveCapture} from "./capture";

describe("capture",()=>{
  it("captures when the roll is below favor",()=>expect(resolveCapture(70,69.99)).toBe("captured"));
  it("fails when the roll reaches favor",()=>expect(resolveCapture(70,70)).toBe("fled"));
  it("clamps favor to a valid percentage",()=>{
    expect(resolveCapture(120,99.99)).toBe("captured");
    expect(resolveCapture(-10,0)).toBe("fled");
  });
});
