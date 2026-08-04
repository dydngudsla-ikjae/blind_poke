// ===== 부트스트랩 =====
import { loadData, $ } from "./data.js";
import { newCase } from "./identify.js";

async function boot(){
  try{
    await loadData();
    newCase();
  }catch(e){
    $("#boot").textContent = "로드 실패: "+e.message+" — 로컬 서버로 실행했는지 확인";
  }
}

boot();
