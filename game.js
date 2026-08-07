// ===== 부트스트랩 =====
import { loadData, $ } from "./data.js";
import { newCase } from "./identify.js";
import { loadState, renderBase } from "./base.js";
import { loadMapState } from "./map.js";

async function boot(){
  try{
    await loadData();
    loadMapState();
    if(loadState()) renderBase();   // 저장된 진행이 있으면 드래프트를 건너뛰고 본거지로 바로 복원
    else newCase();
  }catch(e){
    $("#boot").textContent = "로드 실패: "+e.message+" — 로컬 서버로 실행했는지 확인";
  }
}

boot();
