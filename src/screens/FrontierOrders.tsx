import { useState } from "react";
import { activeIntrusion, activeObservation, activeSabotage, availableFrontierWorkers, DARK_TYPE, DRAGON_TYPE, enemyPartsSupply,
  FLYING_TYPE, FRONTIER_ENERGY_COST, frontierSources, GHOST_TYPE, hasEnemyWorkshop } from "../domain/frontierOperations";
import { TERRITORY_GOLD } from "../domain/territorySupply";
import type { RosterMember } from "../domain/types";
import { worldMapNodes } from "../domain/worldMap";
import { settlementName } from "../domain/settlements";
import { useGame } from "../game/GameProvider";
import { drawGhostIntel } from "../game/territoryBattle";

function WorkerSelect({ label, workers, member, onChange }: {
  label: string;
  workers: RosterMember[];
  member: RosterMember;
  onChange: (id: string) => void;
}) {
  return <label>{label}
    <select value={member.id} onChange={event => onChange(event.target.value)}>
      {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.pokemon.nameKr} · Lv.{worker.level}</option>)}
    </select>
  </label>;
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
        <button className="atlas-scout" disabled={!member || state.energy < FRONTIER_ENERGY_COST} onClick={() => {
          if (member) dispatch({ type: "SEND_DARK_SABOTAGE", sourceId, targetId: territoryId, memberId: member.id });
        }}>악 타입 시설 방해 <small>행동력 {FRONTIER_ENERGY_COST}</small></button>
      </> : <p>보급이 연결된 내 인접 거점에서 파견할 수 있습니다.</p>)}
  </section>;
}

export default function FrontierOrders({ territoryId }: { territoryId: string }) {
  const { state, data, dispatch } = useGame();
  const [selectedMember, setSelectedMember] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
  const energyAvailable = state.energy >= FRONTIER_ENERGY_COST;

  if (intrusion?.targetId === territoryId) {
    const workers = availableFrontierWorkers(state, DRAGON_TYPE);
    const member = workers.find(worker => worker.id === selectedMember) ?? workers[0];
    return <section className="atlas-readiness atlas-frontier" aria-label="치안 대응">
      <strong role="status">{intrusion.defenderId ? "드래곤 방어 배치 완료" : "적 침투 예고 · 다음 턴 정산"}</strong>
      {!intrusion.defenderId && <>
        <p>침투가 성공하면 해당 턴 자금 수입 {TERRITORY_GOLD}이 중단됩니다.</p>
        {member ? <WorkerSelect label="방어할 드래곤" workers={workers} member={member} onChange={setSelectedMember} />
          : <p>미배치 드래곤 타입이 필요합니다.</p>}
        <button className="atlas-scout" disabled={!member || !energyAvailable} onClick={() => {
          if (member) dispatch({ type: "BLOCK_INTRUSION", targetId: territoryId, memberId: member.id });
        }}>드래곤 방어 <small>행동력 {FRONTIER_ENERGY_COST}</small></button>
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
        <button className="atlas-scout" disabled={!member || !energyAvailable} onClick={() => {
          if (member) dispatch({ type: "DETECT_ENEMY_OBSERVATION", targetId: territoryId, memberId: member.id });
        }}>비행 탐지 <small>행동력 {FRONTIER_ENERGY_COST}</small></button>
      </>}
    </section>;
  }

  const target = state.territories[territoryId];
  if (!target?.scouted || target.owner !== "trainer") return null;
  const intel = state.frontier.intel[territoryId];
  if (intel?.memberId) return <p className="atlas-readiness" role="status">고스트 첩보 진행 중 · 다음 턴 완료</p>;
  if (intel) return <section className="atlas-readiness atlas-frontier" aria-label="공개된 수비팀">
    <strong>다음 도전 수비팀</strong>
    <ol>{intel.pokemonIds.map(id => <li key={id}>{data.pokemon.find(pokemon => pokemon.pokemonRowid === id)?.nameKr ?? "기록 없음"}</li>)}</ol>
  </section>;

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
    <button className="atlas-scout" disabled={!member || !energyAvailable} onClick={() => {
      if (!member) return;
      const pokemonIds = drawGhostIntel(state, data, territoryId);
      dispatch({ type: "SEND_GHOST_RECON", sourceId, targetId: territoryId, memberId: member.id, pokemonIds });
    }}>고스트 첩보 파견 <small>행동력 {FRONTIER_ENERGY_COST}</small></button>
  </section>;
}
