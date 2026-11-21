import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isRapidPointerRepeat, readPointerClick, type PointerClick } from "../components/pointerClick";
import { GROWTH_ITEM_ENERGY_COST } from "../domain/economy";
import { HUNT_ENERGY_COST } from "../domain/jobs";
import type { RosterMember } from "../domain/types";
import { duplicateRosterLabels } from "../game/gameHelpers";
import { useGame } from "../game/GameProvider";
import { counterHuntPool, firstBattleBrief, preparedTypeLabel, reserveAttackForecast, territoryPreparation, territoryTactics, uncoveredTerritoryTypes } from "../game/territoryReadiness";
import { PcPanel } from "./BasePanels";
import transitionFieldView from "./transitionFieldView";

type ScoutedAttack = ReturnType<typeof territoryTactics>[number]["attacks"][number];

function attackReading({ best, effectivePp }: ScoutedAttack, forecast: boolean) {
  const matchup = best ? `${best.move.name} · ${best.multiplier > 0 ? `${best.multiplier}배` : "효과 없음"}` : "공격 기술 없음";
  if (!forecast) return matchup;
  const damage = best && best.minDamage > 0
    ? ` · 예상 피해 ${best.minDamage === best.maxDamage ? best.minDamage : `${best.minDamage}–${best.maxDamage}`}` : "";
  return `${matchup}${damage} · 유효 PP 합계 ${effectivePp}`;
}

export default function TerritoryReadiness({ territoryId, onOpenEntry }: { territoryId: string; onOpenEntry: (memberId?: string) => void }) {
  const { state, data, dispatch } = useGame();
  const [selectedKey, setSelectedKey] = useState("");
  const [showTactics, setShowTactics] = useState(false);
  const [tacticsKey, setTacticsKey] = useState("");
  const [growth, setGrowth] = useState<{ memberId?: string; targetTypes: number[] } | null>(null);
  const lastLeadClick = useRef<PointerClick | null>(null);
  const leadFocus = useRef<HTMLButtonElement | null>(null);
  const memberLabels = useMemo(() => duplicateRosterLabels(state.roster), [state.roster]);
  const risks = useMemo(() => uncoveredTerritoryTypes(state, data, territoryId), [state, data, territoryId]);
  const risk = risks.find(group => group.key === selectedKey) ?? risks[0];
  const preparation = useMemo(() => risk ? territoryPreparation(state, data, risk.typeIds) : null, [risk, state, data]);
  const counterAvailable = useMemo(() => Boolean(risk && !preparation && counterHuntPool(data, risk.typeIds).length), [data, risk, preparation]);
  const opening = useMemo(() => firstBattleBrief(state, data, territoryId), [state, data, territoryId]);
  const groups = useMemo(() => showTactics ? territoryTactics(state, data, territoryId) : [], [showTactics, state, data, territoryId]);
  const ppRisks = groups.filter(group => group.ppShortfall);
  const tactics = groups.find(group => group.key === tacticsKey) ?? ppRisks[0] ?? groups[0];
  const tacticTypes = tactics?.typeIds;
  const reserves = useMemo(() => tacticTypes && !opening ? reserveAttackForecast(state, data, territoryId, tacticTypes) : [],
    [tacticTypes, opening, state, data, territoryId]);
  const attackers = tactics?.ppShortfall ? tactics.attacks.filter(({ effectivePp }) => effectivePp > 0) : [];
  const ppMemberId = attackers.length === 1 ? attackers[0].member.id : undefined;
  const memberName = (member: RosterMember) => memberLabels.get(member.id) ?? member.pokemon.nameKr;

  useLayoutEffect(() => {
    leadFocus.current?.focus();
    leadFocus.current = null;
  }, [state.entryOrder]);

  function leadControl(member: RosterMember) {
    const current = state.entryOrder[0] === member.id;
    const label = current ? "현재 선봉" : "선봉으로";
    return (
      <button className="base-button" type="button" aria-disabled={current} aria-label={`${memberName(member)} ${label}`}
        onClick={event => {
          if (current) return;
          const click = readPointerClick(event);
          if (isRapidPointerRepeat(lastLeadClick.current, click)) return;
          lastLeadClick.current = click;
          if (event.detail === 0) leadFocus.current = event.currentTarget;
          dispatch({ type: "SET_ENTRY_ORDER", memberIds: [member.id, ...state.entryOrder.filter(id => id !== member.id)] });
        }}>{label}</button>
    );
  }

  return (
    <>
      {opening && (
        <section className="atlas-readiness atlas-opening" aria-label="첫 도전 준비">
          <p>첫 상대 <strong>{opening.enemy.name} Lv.{opening.enemy.level}</strong></p>
          {opening.entries.length > 0 && (
            <details className="atlas-tactics">
              <summary>선봉 비교 <span>· {memberName(opening.entries[0].member)}</span></summary>
              <p>첫 공격이 명중했을 때 줄 수 있는 피해입니다.</p>
              <ol aria-label="선봉별 공격">
                {opening.entries.map(({ member, best }) => (
                  <li key={member.id}>
                    <div>
                      <strong>{memberName(member)}{memberLabels.has(member.id) && <small> Lv.{member.level}</small>}</strong>
                      <span>{best ? `${best.move.name} · ${best.damage} 피해${best.move.accuracy > 0 && best.move.accuracy < 100 ? ` · 명중 ${best.move.accuracy}%` : ""}` : "유효한 일반 공격기 없음"}</span>
                    </div>
                    {leadControl(member)}
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
              <p>{memberName(preparation.member)}의 {preparation.move.name}으로 공격할 수 있습니다.</p>
              <button className="base-button" aria-haspopup="dialog"
                onClick={() => onOpenEntry(preparation.member.id)}>대응 전력 편성</button>
            </>
          ) : preparation?.kind === "growth" ? (
            <>
              <p>{memberName(preparation.member)} Lv.{preparation.level} · {preparation.move.name} · 사탕 {preparation.candy}개 · 행동력 {preparation.candy * GROWTH_ITEM_ENERGY_COST}</p>
              <button className="base-button" aria-haspopup="dialog"
                onClick={() => setGrowth({ memberId: preparation.member.id, targetTypes: risk.typeIds })}>PC에서 육성</button>
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
              {tactics.reported && <p>고스트 첩보로 공개한 수비팀 기준</p>}
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
              {!opening && <p>예상 피해는 명중 시 후보와 레벨에 따른 범위입니다.</p>}
              <ul className={!opening ? "atlas-attack-lines" : undefined} aria-label="아군 공격 상성">
                {tactics.attacks.map(attack => (
                  <li key={attack.member.id}>
                    <p>{memberName(attack.member)} · {attackReading(attack, !opening)}</p>
                    {!opening && leadControl(attack.member)}
                  </li>
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
                    <p><strong>{weak.length > 1 ? "공통 약점" : "약점"} · {label}</strong> · {weak.map(memberName).join(", ")}</p>
                    <p>{label} 기술에 교대 {switches.length
                      ? switches.map(({ member, multiplier }) => `${memberName(member)} (${multiplier > 0 ? `${multiplier}배` : "무효"})`).join(", ")
                      : "후보 없음"}</p>
                  </div>
                );
              })}
              {tactics.ppShortfall && state.roster.length > state.entryOrder.length && (
                <button className="base-button" aria-haspopup="dialog"
                  onClick={() => onOpenEntry(reserves[0]?.member.id)}>교대 전력 편성</button>
              )}
              {reserves.length > 0 && (
                <details className="atlas-reserve">
                  <summary>미편성 동료 · {reserves.length}마리</summary>
                  <ul aria-label="미편성 동료 공격 상성">
                    {reserves.map(attack => {
                      const { member } = attack;
                      const name = memberName(member);
                      return (
                        <li key={member.id}>
                          <p><strong>{name}</strong> Lv.{member.level} · {attackReading(attack, true)}</p>
                          <div className="atlas-reserve-actions">
                            <button className="base-button" type="button" aria-haspopup="dialog"
                              aria-label={`${name} 육성 전망`}
                              onClick={() => setGrowth({ memberId: member.id, targetTypes: tactics.typeIds })}>육성 전망</button>
                            <button className="base-button" type="button" aria-haspopup="dialog"
                              aria-label={`${name} 편성에서 보기`} onClick={() => onOpenEntry(member.id)}>편성에서 보기</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              <button className="base-button" aria-haspopup="dialog"
                onClick={() => setGrowth({ targetTypes: tactics.typeIds, memberId: ppMemberId ?? state.entryOrder[0] })}>PC에서 약점 기술 확인</button>
            </div>
          )}
        </details>
      )}
      {growth && <PcPanel initialMemberId={growth.memberId} initialTargetTypes={growth.targetTypes}
        scoutedTerritoryId={territoryId} onClose={() => setGrowth(null)} />}
    </>
  );
}
