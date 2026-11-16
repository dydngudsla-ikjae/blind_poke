import { useMemo, useState } from "react";
import EntryModal from "../components/EntryModal";
import { HUNT_ENERGY_COST } from "../domain/jobs";
import { useGame } from "../game/GameProvider";
import { counterHuntPool, preparedTypeLabel, territoryPreparation, territoryTactics, uncoveredTerritoryTypes } from "../game/territoryReadiness";
import { PcPanel } from "./BasePanels";
import transitionFieldView from "./transitionFieldView";

export default function TerritoryReadiness({ territoryId }: { territoryId: string }) {
  const { state, data, dispatch } = useGame();
  const [selectedKey, setSelectedKey] = useState("");
  const [showTactics, setShowTactics] = useState(false);
  const [tacticsKey, setTacticsKey] = useState("");
  const [panel, setPanel] = useState<{ kind: "entry" } | { kind: "growth"; memberId?: string; targetTypes?: number[] } | null>(null);
  const risks = useMemo(() => uncoveredTerritoryTypes(state, data, territoryId), [state, data, territoryId]);
  const risk = risks.find(group => group.key === selectedKey) ?? risks[0];
  const preparation = useMemo(() => risk ? territoryPreparation(state, data, risk.typeIds) : null, [risk, state, data]);
  const counterAvailable = useMemo(() => Boolean(risk && !preparation && counterHuntPool(data, risk.typeIds).length), [data, risk, preparation]);
  const groups = useMemo(() => showTactics ? territoryTactics(state, data, territoryId) : [], [showTactics, state, data, territoryId]);
  const tactics = groups.find(group => group.key === tacticsKey) ?? groups[0];

  return (
    <>
      {risk && (
        <section className="atlas-readiness" aria-label="도전 전 확인">
          <p role="status"><strong>{preparedTypeLabel(risk.typeIds, data)}</strong> 상대 후보에 유효 공격 없음</p>
          {risks.length > 1 && (
            <label>대응할 상대 타입
              <select value={risk.key} onChange={event => setSelectedKey(event.target.value)}>
                {risks.map(group => <option key={group.key} value={group.key}>{preparedTypeLabel(group.typeIds, data)}</option>)}
              </select>
            </label>
          )}
          {preparation?.kind === "entry" ? (
            <>
              <p>{preparation.member.pokemon.nameKr}의 {preparation.move.name}으로 공격할 수 있습니다.</p>
              <button className="base-button" onClick={() => setPanel({ kind: "entry" })}>엔트리 편성</button>
            </>
          ) : preparation?.kind === "growth" ? (
            <>
              <p>{preparation.member.pokemon.nameKr} Lv.{preparation.level} · {preparation.move.name} · 사탕 {preparation.candy}개</p>
              <button className="base-button" onClick={() => setPanel({ kind: "growth", memberId: preparation.member.id })}>PC에서 육성</button>
            </>
          ) : (
            <>
              <button className="base-button" disabled={!counterAvailable || state.energy < HUNT_ENERGY_COST}
                onClick={() => transitionFieldView(() => dispatch({ type: "START_COUNTER_HUNT", territoryId, typeIds: risk.typeIds }))}>
                유효 공격 후보 탐색 <small>행동력 {HUNT_ENERGY_COST}</small>
              </button>
              {!counterAvailable ? <p>현재 탐색 가능한 대응 후보가 없습니다.</p>
                : state.energy < HUNT_ENERGY_COST && <p>다음 턴에 행동력을 회복하세요.</p>}
            </>
          )}
        </section>
      )}
      {state.entryOrder.length > 0 && (
        <details className="atlas-readiness atlas-tactics" onToggle={event => setShowTactics(event.currentTarget.open)}>
          <summary>상성·교대 분석</summary>
          {tactics && (
            <div className="atlas-tactics-body">
              <label>정찰한 상대 후보 타입
                <select value={tactics.key} onChange={event => setTacticsKey(event.target.value)}>
                  {groups.map(group => <option key={group.key} value={group.key}>{preparedTypeLabel(group.typeIds, data)}</option>)}
                </select>
              </label>
              <ul aria-label="아군 공격 상성">
                {tactics.attacks.map(({ member, best }) => (
                  <li key={member.id}>{member.pokemon.nameKr} · {best
                    ? `${best.move.name} · ${best.multiplier > 0 ? `${best.multiplier}배` : "효과 없음"}`
                    : "공격 기술 없음"}</li>
                ))}
              </ul>
              {tactics.threats.map(({ typeId, weak, switches }) => {
                const label = preparedTypeLabel([typeId], data);
                return (
                  <div className="atlas-tactics-threat" key={typeId}>
                    <p><strong>{weak.length > 1 ? "공통 약점" : "약점"} · {label}</strong> · {weak.map(member => member.pokemon.nameKr).join(", ")}</p>
                    <p>{label} 기술에 교대 {switches.length
                      ? switches.map(({ member, multiplier }) => `${member.pokemon.nameKr} (${multiplier > 0 ? `${multiplier}배` : "무효"})`).join(", ")
                      : "후보 없음"}</p>
                  </div>
                );
              })}
              <button className="base-button" onClick={() => setPanel({ kind: "growth", targetTypes: tactics.typeIds })}>PC에서 약점 기술 확인</button>
            </div>
          )}
        </details>
      )}
      {panel?.kind === "entry" && <EntryModal onClose={() => setPanel(null)} />}
      {panel?.kind === "growth" && <PcPanel initialMemberId={panel.memberId} initialTargetTypes={panel.targetTypes} onClose={() => setPanel(null)} />}
    </>
  );
}
