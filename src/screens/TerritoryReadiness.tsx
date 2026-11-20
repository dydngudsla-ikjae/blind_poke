import { useMemo, useState } from "react";
import EntryModal from "../components/EntryModal";
import { HUNT_ENERGY_COST } from "../domain/jobs";
import { useGame } from "../game/GameProvider";
import { counterHuntPool, firstBattleBrief, preparedTypeLabel, territoryPreparation, territoryTactics, uncoveredTerritoryTypes } from "../game/territoryReadiness";
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
  const opening = useMemo(() => firstBattleBrief(state, data, territoryId), [state, data, territoryId]);
  const groups = useMemo(() => showTactics ? territoryTactics(state, data, territoryId) : [], [showTactics, state, data, territoryId]);
  const ppRisks = groups.filter(group => group.ppShortfall);
  const tactics = groups.find(group => group.key === tacticsKey) ?? ppRisks[0] ?? groups[0];
  const attackers = tactics?.ppShortfall ? tactics.attacks.filter(({ effectivePp }) => effectivePp > 0) : [];
  const ppMemberId = attackers.length === 1 ? attackers[0].member.id : undefined;

  return (
    <>
      {opening && (
        <section className="atlas-readiness atlas-opening" aria-label="첫 도전 준비">
          <p>첫 상대 <strong>{opening.enemy.name} Lv.{opening.enemy.level}</strong></p>
          {opening.entries.length > 0 && (
            <details className="atlas-tactics">
              <summary>선봉 비교 <span>· {opening.entries[0].member.pokemon.nameKr}</span></summary>
              <p>첫 공격이 명중했을 때 줄 수 있는 피해입니다.</p>
              <ol aria-label="선봉별 공격">
                {opening.entries.map(({ member, best }, index) => (
                  <li key={member.id}>
                    <div>
                      <strong>{member.pokemon.nameKr}</strong>
                      <span>{best ? `${best.move.name} · ${best.damage} 피해${best.move.accuracy > 0 && best.move.accuracy < 100 ? ` · 명중 ${best.move.accuracy}%` : ""}` : "유효한 일반 공격기 없음"}</span>
                    </div>
                    <button className="base-button" type="button" aria-disabled={index === 0}
                      aria-label={`${member.pokemon.nameKr} ${index === 0 ? "현재 선봉" : "선봉으로"}`} onClick={() => {
                        if (index === 0) return;
                        dispatch({ type: "SET_ENTRY_ORDER", memberIds: [member.id, ...state.entryOrder.filter(id => id !== member.id)] });
                      }}>{index === 0 ? "현재 선봉" : "선봉으로"}</button>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}
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
                  {ppRisks.length > 0 && (
                    <optgroup label="유효 공격 PP 부족 가능">
                      {ppRisks.map(group => <option key={group.key} value={group.key}>{preparedTypeLabel(group.typeIds, data)}</option>)}
                    </optgroup>
                  )}
                  {groups.filter(group => !group.ppShortfall)
                    .map(group => <option key={group.key} value={group.key}>{preparedTypeLabel(group.typeIds, data)}</option>)}
                </select>
              </label>
              <ul aria-label="아군 공격 상성">
                {tactics.attacks.map(({ member, best, effectivePp }) => (
                  <li key={member.id}>{member.pokemon.nameKr} · {best
                    ? `${best.move.name} · ${best.multiplier > 0 ? `${best.multiplier}배` : "효과 없음"}`
                    : "공격 기술 없음"}{!opening && ` · 유효 PP 합계 ${effectivePp}`}</li>
                ))}
              </ul>
              {tactics.ppShortfall && (
                <div className="atlas-tactics-threat" role="status">
                  <p><strong>유효 공격 PP 부족 가능</strong></p>
                  <p>능력치 변화 없이 일반 공격을 전부 명중시켜도 일부 후보의 HP가 남을 수 있습니다.</p>
                </div>
              )}
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
              {tactics.ppShortfall && state.roster.length > state.entryOrder.length && (
                <button className="base-button" onClick={() => setPanel({ kind: "entry" })}>교대 전력 편성</button>
              )}
              <button className="base-button" onClick={() => setPanel({ kind: "growth", targetTypes: tactics.typeIds, memberId: ppMemberId })}>PC에서 약점 기술 확인</button>
            </div>
          )}
        </details>
      )}
      {panel?.kind === "entry" && <EntryModal onClose={() => setPanel(null)} />}
      {panel?.kind === "growth" && <PcPanel initialMemberId={panel.memberId} initialTargetTypes={panel.targetTypes} onClose={() => setPanel(null)} />}
    </>
  );
}
