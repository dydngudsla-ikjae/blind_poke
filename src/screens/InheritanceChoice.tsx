import { inheritanceCandidates, outpostIsOwned } from "../domain/settlements";
import { useGame } from "../game/GameProvider";
import { buildings } from "./BasePanels";

export default function InheritanceChoice({ siteId }: { siteId: string }) {
  const { state, dispatch } = useGame();
  if (!outpostIsOwned(state, siteId) || !state.outposts[siteId]?.inheritancePending) return null;
  return (
    <section className="base-inheritance" aria-label="AI 건물 승계">
      <strong>AI 건물 승계</strong>
      <p>하나를 선택하면 첫 부지에 완공 시설이 들어옵니다.</p>
      <div className="base-panel-actions">
        {inheritanceCandidates(siteId).map(buildingType => (
          <button className="base-button" key={buildingType}
            onClick={() => dispatch({ type: "RESOLVE_INHERITANCE", siteId, buildingType })}>
            {buildings[buildingType].label} 승계
          </button>
        ))}
        <button className="base-button" onClick={() => dispatch({ type: "RESOLVE_INHERITANCE", siteId, buildingType: null })}>승계 포기</button>
      </div>
    </section>
  );
}
