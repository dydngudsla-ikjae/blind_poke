import { useRef, useState } from "react";
import { ENERGY_CHARGE_COST } from "../domain/economy";
import { activeIntrusion, activeObservation, activeSabotage, availableFrontierWorkers, DARK_TYPE, DRAGON_TYPE, enemyPartsSupply,
  FLYING_TYPE, FRONTIER_ENERGY_COST, frontierSources, GHOST_TYPE, hasEnemyWorkshop } from "../domain/frontierOperations";
import { TERRITORY_GOLD } from "../domain/territorySupply";
import { forecastIntrusionLoss } from "../domain/production";
import type { RosterMember } from "../domain/types";
import { worldMapNodes } from "../domain/worldMap";
import { settlementName } from "../domain/settlements";
import { useGame } from "../game/GameProvider";
import { duplicateRosterLabels } from "../game/gameHelpers";
import { drawGhostIntel, territoryOpponents } from "../game/territoryBattle";
import { QuickChargeButton } from "./BasePanels";

function WorkerSelect({ label, workers, member, onChange }: {
  label: string;
  workers: RosterMember[];
  member: RosterMember;
  onChange: (id: string) => void;
}) {
  const { state } = useGame();
  const memberLabels = duplicateRosterLabels(state.roster);
  return <label>{label}
    <select value={member.id} onChange={event => onChange(event.target.value)}>
      {workers.map(worker => <option key={worker.id} value={worker.id}>
        {memberLabels.get(worker.id) ?? worker.pokemon.nameKr} · Lv.{worker.level}
      </option>)}
    </select>
  </label>;
}

function FrontierCommand({ label, member, onOrder }: {
  label: string;
  member: RosterMember | undefined;
  onOrder: (memberId: string) => void;
}) {
  const { state } = useGame();
  const command = useRef<HTMLButtonElement>(null);
  const needsEnergy = state.energy < FRONTIER_ENERGY_COST;

  return <>
    <button className="atlas-scout" type="button" ref={command} disabled={!member || needsEnergy} onClick={() => {
      if (member) onOrder(member.id);
    }}>{label} <small>행동력 {FRONTIER_ENERGY_COST}</small></button>
    {member && <QuickChargeButton requiredEnergy={FRONTIER_ENERGY_COST} nextAction={command} />}
    {member && needsEnergy && state.resources.gold < ENERGY_CHARGE_COST && (
      <p>자금이 부족합니다. 충전권 가격은 {ENERGY_CHARGE_COST}입니다.</p>
    )}
  </>;
}

export function EnemyWorkshopOrders({ territoryId }: { territoryId: string }) {
  const { state, dispatch } = useGame();
  const [selectedMember, setSelectedMember] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const target = state.territories[territoryId];
  if (!target?.active || !target.scouted || target.owner !== "trainer" ||
    !worldMapNodes.some(node => node.id === territoryId && node.region > 1)) return null;

  const order = state.frontier.sabotage;
  const stopped = activeSabotage(state.territories, order)?.targetId;
  const workshop = hasEnemyWorkshop(state.territories, territoryId);
  const supplied = enemyPartsSupply(state.territories, stopped).has(territoryId);
  const sources = workshop ? frontierSources(state.territories, territoryId) : [];
  const sourceId = sources.includes(selectedSource) ? selectedSource : sources[0];
  const workers = workshop ? availableFrontierWorkers(state, DARK_TYPE) : [];
  const member = workers.find(worker => worker.id === selectedMember) ?? workers[0];

  return <section className="atlas-readiness atlas-frontier" aria-label="적 시설 생산">
    <strong>적 시설 생산</strong>
    <p>제작소 · {stopped === territoryId ? "다음 턴 생산 중단" : workshop ? "가동 중" : "미설치"}</p>
    <p>다음 턴 부품 공급 {supplied ? "가능" : "없음"}</p>
    {order?.targetId === territoryId ? <p role="status">악 타입 시설 방해 파견 완료 · 다음 턴 정산</p>
      : workshop && (order ? <p role="status">이번 턴 시설 방해 파견 완료</p> : sourceId ? <>
        {sources.length > 1 && <label>방해 출발 거점
          <select value={sourceId} onChange={event => setSelectedSource(event.target.value)}>
            {sources.map(id => <option key={id} value={id}>{settlementName(id)}</option>)}
          </select>
        </label>}
        {member ? <WorkerSelect label="파견할 악 타입" workers={workers} member={member} onChange={setSelectedMember} />
          : <p>미배치 악 타입이 필요합니다.</p>}
        <FrontierCommand label="악 타입 시설 방해" member={member} onOrder={memberId => {
          dispatch({ type: "SEND_DARK_SABOTAGE", sourceId, targetId: territoryId, memberId });
        }} />
      </> : <p>보급이 연결된 내 인접 거점에서 파견할 수 있습니다.</p>)}
  </section>;
}

export default function FrontierOrders({ territoryId }: { territoryId: string }) {
  const { state, data, dispatch } = useGame();
  const [selectedMember, setSelectedMember] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
  if (intrusion?.targetId === territoryId) {
    const workers = availableFrontierWorkers(state, DRAGON_TYPE);
    const member = workers.find(worker => worker.id === selectedMember) ?? workers[0];
    return <section className="atlas-readiness atlas-frontier" aria-label="치안 대응">
      <strong role="status">{intrusion.defenderId ? "드래곤 방어 배치 완료" : "적 침투 예고 · 다음 턴 정산"}</strong>
      {!intrusion.defenderId && <>
        <p>침투가 성공하면 해당 턴 자금 수입 {TERRITORY_GOLD}이 중단됩니다.</p>
        <p>다음 턴 자금 손실 예상 {forecastIntrusionLoss(state)}</p>
        {member ? <WorkerSelect label="방어할 드래곤" workers={workers} member={member} onChange={setSelectedMember} />
          : <p>미배치 드래곤 타입이 필요합니다.</p>}
        <FrontierCommand label="드래곤 방어" member={member} onOrder={memberId => {
          dispatch({ type: "BLOCK_INTRUSION", targetId: territoryId, memberId });
        }} />
      </>}
    </section>;
  }

  const observation = activeObservation(state.territories, state.frontier.espionage?.observation);
  if (observation?.targetId === territoryId) {
    const workers = availableFrontierWorkers(state, FLYING_TYPE);
    const member = workers.find(worker => worker.id === selectedMember) ?? workers[0];
    return <section className="atlas-readiness atlas-frontier" aria-label="비행 탐지 대응">
      {observation.detectorId ? <>
        <strong role="status">적 첩보 차단 · 출처 {settlementName(observation.sourceId)}</strong>
        <p>다음 턴 정산 후 파견 인력이 돌아옵니다.</p>
      </> : <>
        <strong role="status">적 첩보 신호 · 다음 턴 정산</strong>
        <p>관측이 성공하면 적이 정산 시점의 선봉 타입을 참고해 수비 순서를 준비합니다.</p>
        {member ? <WorkerSelect label="탐지할 비행 타입" workers={workers} member={member} onChange={setSelectedMember} />
          : <p>미배치 비행 타입이 필요합니다.</p>}
        <FrontierCommand label="비행 탐지" member={member} onOrder={memberId => {
          dispatch({ type: "DETECT_ENEMY_OBSERVATION", targetId: territoryId, memberId });
        }} />
      </>}
    </section>;
  }

  const target = state.territories[territoryId];
  if (!target?.scouted || target.owner !== "trainer") return null;
  const intel = state.frontier.intel[territoryId];
  if (intel?.memberId) return <p className="atlas-readiness" role="status">고스트 첩보 진행 중 · 다음 턴 완료</p>;
  if (intel) {
    const team = territoryOpponents(state, data, territoryId)?.revealedTeam;
    return team && <section className="atlas-readiness atlas-frontier" aria-label="공개된 수비팀">
      <strong>다음 도전 수비팀</strong>
      <ol>{team.members.map(pokemon => <li key={pokemon.pokemonRowid}>{pokemon.nameKr}</li>)}</ol>
    </section>;
  }

  const sources = frontierSources(state.territories, territoryId);
  if (!sources.length) return null;
  const sourceId = sources.includes(selectedSource) ? selectedSource : sources[0];
  const workers = availableFrontierWorkers(state, GHOST_TYPE);
  const member = workers.find(worker => worker.id === selectedMember) ?? workers[0];
  return <section className="atlas-readiness atlas-frontier" aria-label="고스트 첩보">
    <strong>고스트 첩보</strong>
    <p>다음 턴에 실제 수비팀과 출전 순서를 확인합니다.</p>
    <label>출발 거점
      <select value={sourceId} onChange={event => setSelectedSource(event.target.value)}>
        {sources.map(id => <option key={id} value={id}>{worldMapNodes.find(node => node.id === id)?.name}</option>)}
      </select>
    </label>
    {member ? <WorkerSelect label="파견할 고스트" workers={workers} member={member} onChange={setSelectedMember} />
      : <p>미배치 고스트 타입이 필요합니다.</p>}
    <FrontierCommand label="고스트 첩보 파견" member={member} onOrder={memberId => {
      const pokemonIds = drawGhostIntel(state, data, territoryId);
      dispatch({ type: "SEND_GHOST_RECON", sourceId, targetId: territoryId, memberId, pokemonIds });
    }} />
  </section>;
}
