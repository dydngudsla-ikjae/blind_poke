import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import town from "../../assets/observatory-base.webp";
import forest from "../../assets/observatory-forest.webp";
import atlas from "../../assets/observatory-atlas.webp";
import useFieldMotion from "../components/useFieldMotion";
import { ENERGY_PER_TURN, isFreeWorker } from "../game/gameReducer";
import { ENERGY_CHARGE_COST, turnsUntilDepartureWarning } from "../domain/economy";
import { HUNT_ENERGY_COST } from "../domain/jobs";
import { forecastGold } from "../domain/production";
import { advanceTerritoryLoyalty, TERRITORY_GOLD } from "../domain/territorySupply";
import { activeIntrusion, activeObservation } from "../domain/frontierOperations";
import { worldMapNodes } from "../domain/worldMap";
import { canOperateSettlement, HOME_SITE, settlementAt, settlementName } from "../domain/settlements";
import { useGame } from "../game/GameProvider";
import { SPRITE } from "../game/gameHelpers";
import { BasePanels, buildings, GoldForecast, type BasePanel } from "./BasePanels";
import { CampaignStatus } from "./CampaignGoals";
import InheritanceChoice from "./InheritanceChoice";
import transitionFieldView from "./transitionFieldView";
import "./BaseScreen.css";

// Coordinates follow the visible soil pads in the 1672 × 941 background.
const plots = [
  [104, 429, 279, 144], [408, 429, 262, 144], [708, 429, 256, 144],
  [999, 429, 267, 144], [1289, 429, 287, 144],
  [34, 624, 310, 168], [370, 624, 288, 168], [701, 624, 279, 168],
  [1014, 624, 295, 168], [1330, 624, 314, 168],
] as const;
const trail = [[33, 42], [50, 42], [67, 42]];
const BaseWaterShader = lazy(() => import("../components/BaseWaterShader").catch(() => ({ default: () => null })));

export default function BaseScreen() {
  const { state } = useGame();
  const siteId = state.siteViewId ?? HOME_SITE;
  return <SettlementScreen key={siteId} siteId={siteId} />;
}

function SettlementScreen({ siteId }: { siteId: string }) {
  const { state, dispatch } = useGame();
  const [panel, setPanel] = useState<BasePanel | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const showWater = useFieldMotion();
  const settlement = settlementAt(state, siteId)!;
  const home = siteId === HOME_SITE;
  const canOperate = canOperateSettlement(state, siteId);
  const name = settlementName(siteId);
  const resting = state.roster.filter(member => isFreeWorker(state, member)).slice(0, trail.length);
  const assignedCount = state.roster.filter(member => !isFreeWorker(state, member)).length;
  const imminentLosses = useMemo(() => advanceTerritoryLoyalty(state.territories).lost, [state.territories]);
  const favorWarnings = state.roster.flatMap(member => {
    const turns = turnsUntilDepartureWarning(member);
    return turns !== null && turns <= 5 ? [{ member, turns }] : [];
  }).sort((a, b) => a.turns - b.turns);
  const firstWarning = favorWarnings[0];
  const imminentDepartures = favorWarnings.filter(({ turns }) => turns === 0).length;
  const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
  const observation = activeObservation(state.territories, state.frontier.espionage?.observation);
  const turnDetails = [home && "base-gold-preview", imminentLosses.length && "base-supply-warning", firstWarning && "base-departure-warning",
    intrusion && !intrusion.defenderId && "base-intrusion-warning",
    observation && !observation.detectorId && "base-espionage-warning"].filter(Boolean).join(" ");
  const goldReading = useMemo(() => home ? forecastGold(state) : null, [home, state]);
  const turnHint = state.energy < HUNT_ENERGY_COST
    ? state.resources.gold >= ENERGY_CHARGE_COST
      ? "행동력이 더 필요하면 상점에서 충전권 구매 전후를 비교하세요."
      : `다음 턴에 행동력이 ${ENERGY_PER_TURN}까지 회복됩니다.`
    : undefined;

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function explore() {
    transitionFieldView(() => dispatch({ type: "START_HUNT" }));
  }

  return (
    <section className="field-base" aria-labelledby="base-title">
      <div className="base-device">
        <header className="base-hud">
          <div className="base-identity">
            <button className="base-trainer-button" aria-label="트레이너 카드" onClick={() => setPanel({ kind: "trainer" })}>
              <span className="base-emblem" aria-hidden="true" />
              <span>신분증</span>
            </button>
            <div><span>야생 관측소</span><h1 id="base-title" data-base-heading ref={heading} tabIndex={-1}>{name}</h1></div>
          </div>
          <button className="base-button base-turn" onClick={() => setPanel({ kind: "log" })} aria-label={`${state.turnCount}턴, 턴 기록`}>
            <span>턴 기록</span><b>{String(state.turnCount).padStart(2, "0")}</b>
          </button>
          <div className="base-energy" aria-label={`행동력 ${state.energy}/${ENERGY_PER_TURN}`}>
            <span>행동력 <b>{state.energy}/{ENERGY_PER_TURN}</b></span>
            <div className="base-energy-cells" aria-hidden="true">
              {Array.from({ length: ENERGY_PER_TURN }, (_, index) => <i key={index} data-filled={index < state.energy} />)}
            </div>
          </div>
        </header>

        {!home && <div className="base-supply-warning base-departure-warning" role="group" aria-label="거점 운영 상태">
          <span>{canOperate ? "보급 연결 · 본거지와 재고 공유" : "고립 · 공사·개척·생산 중단"}</span>
          <button className="base-button" onClick={() => dispatch({ type: "PATCH", patch: { siteViewId: null } })}>본거지로</button>
        </div>}
        {!home && <InheritanceChoice siteId={siteId} />}
        <div className="base-board" role="group" aria-label={`${name} 조감도`}>
          <img className="base-landscape" src={town} width={1672} height={941} alt="" fetchPriority="high" />
          {showWater && (
            <div className="base-water" aria-hidden="true">
              <Suspense fallback={null}><BaseWaterShader /></Suspense>
            </div>
          )}
          {home && resting.map((member, index) => (
            <div className="base-path-partner" key={member.id} style={{ left: `${trail[index][0]}%`, top: `${trail[index][1]}%` }}>
              <img src={SPRITE(member.pokemon)} alt={member.pokemon.nameKr} />
            </div>
          ))}
          {plots.map(([left, top, width, height], index) => {
            const building = state.buildings.find(item => (item.siteId ?? HOME_SITE) === siteId && item.plotIndex === index);
            const facility = building && buildings[building.type as keyof typeof buildings];
            const clearing = settlement.clearing?.plotIndex === index ? settlement.clearing : null;
            const workers = state.roster.filter(member => building ? member.buildingId === building.id : member.id === clearing?.memberId);
            const isOpen = index < settlement.plotCap;
            const constructing = building?.status === "constructing";
            const phase = building ? (constructing ? "constructing" : "complete") : isOpen ? "empty" : index === settlement.plotCap ? "frontier" : "locked";
            const remaining = constructing && building
              ? canOperate && workers.length ? building.remainingTurns === 1 ? "다음 턴 완공" : `${building.remainingTurns}턴 남음` : "공사 일시정지"
              : "완공";
            const style = {
              left: `${left / 16.72}%`, top: `${top / 9.41}%`,
              width: `${width / 16.72}%`, height: `${height / 9.41}%`,
            } as CSSProperties;

            return (
              <div className="base-plot" data-phase={phase} data-plot={index} key={index} style={style}>
                {facility && <img className="base-facility" src={facility.art} alt="" />}
                {workers.length > 0 && (
                  <div className="base-plot-workers">
                    {workers.slice(0, 3).map(member => <img key={member.id} src={SPRITE(member.pokemon)} alt={member.pokemon.nameKr} />)}
                  </div>
                )}
                {!building && isOpen && index === 0 && settlement.inheritancePending ? <span className="base-plot-label">승계 선택</span>
                : !building && isOpen ? (
                  <button className="base-plot-action" data-plot-install={index} disabled={!canOperate} onClick={() => setPanel({ kind: "build", plot: index })} aria-label={`${index + 1}번 부지 건설`}>
                    <span className="base-plot-label"><span aria-hidden="true">＋</span> 건설</span>
                  </button>
                ) : building && constructing ? (
                  <button className="base-plot-action" data-plot-construction={building.id} onClick={() => setPanel({ kind: "construction", buildingId: building.id })} aria-label={`${facility?.label ?? "시설"} 공사 관리, ${remaining}`}>
                    <span className="base-plot-label">{remaining}</span>
                  </button>
                ) : building ? (
                  <button className="base-plot-action" onClick={() => setPanel({ kind: "facility", buildingId: building.id })}
                    aria-label={`${index + 1}번 부지 ${facility?.label ?? "시설"} 관리`}>
                    <span className="base-plot-label">{facility?.label ?? "시설"}<span className="base-wide-label"> · 관리</span></span>
                  </button>
                ) : index === settlement.plotCap ? (
                  <button className="base-plot-action" onClick={() => setPanel({ kind: "clearing", plot: index })}
                    disabled={!canOperate && !clearing}
                    aria-label={`${index + 1}번 미개척 부지`}>
                    <span className="base-plot-label">{clearing ? "개척 중" : <><span className="base-wide-label">미개척 · </span>평탄화</>}</span>
                  </button>
                ) : <span className="base-plot-label">미개척</span>}
              </div>
            );
          })}
        </div>

        <footer className="base-dock">
          <nav className="base-tools" aria-label="본거지 관리">
            <button className="base-button" onClick={() => setPanel({ kind: "pc" })}>포켓몬 <b>{state.roster.length}</b></button>
            <button className="base-button" onClick={() => setPanel({ kind: "entry" })}>엔트리</button>
            <button className="base-button" onClick={() => setPanel({ kind: "resources" })}>자원</button>
            <button className="base-button" onClick={() => setPanel({ kind: "shop" })}>상점</button>
            <button className="base-button" data-action="map"
              onPointerEnter={() => preload(atlas, { as: "image" })}
              onFocus={() => preload(atlas, { as: "image" })}
              onClick={() => transitionFieldView(() => dispatch({ type: "PATCH", patch: { screen: "map", siteViewId: null,
                mapFocusId: home ? state.mapFocusId : siteId } }), "map")}>지도</button>
            {home && <button className="base-button" data-action="settings" aria-haspopup="dialog" onClick={() => setPanel({ kind: "settings" })}>설정</button>}
          </nav>
          <p className="base-counts"><span>배치 <b>{assignedCount}/{state.roster.length}</b></span><span>개척 <b>{settlement.plotCap}/{plots.length}</b></span></p>
          <div className="base-actions">
            <button className="base-button base-explore" data-action="hunt" disabled={state.energy < HUNT_ENERGY_COST}
              onPointerEnter={() => preload(forest, { as: "image" })}
              onFocus={() => preload(forest, { as: "image" })}
              onClick={explore}>
              탐험 <small>행동력 {HUNT_ENERGY_COST}</small><span aria-hidden="true">→</span>
            </button>
            <button className="base-button base-next" id="nextTurn"
              aria-describedby={turnDetails || undefined} onClick={() => dispatch({ type: "NEXT_TURN" })}>
              다음 턴 <span aria-hidden="true">→</span>
            </button>
          </div>
        </footer>
        {goldReading && <GoldForecast id="base-gold-preview" reading={goldReading} hint={turnHint} />}
        {imminentLosses.length > 0 && (
          <p id="base-supply-warning" className="base-supply-warning" role="status">
            다음 턴에 {imminentLosses[0]}{imminentLosses.length > 1 ? ` 외 ${imminentLosses.length - 1}곳이` : "이"} 미점령지로 바뀝니다.
          </p>
        )}
        {intrusion && !intrusion.defenderId && (
          <div className="base-supply-warning base-departure-warning">
            <span id="base-intrusion-warning" role="status">적 침투 예고 · {worldMapNodes.find(node => node.id === intrusion.targetId)?.name} · 다음 턴 자금 수입 {TERRITORY_GOLD} 위험</span>
            <button className="base-button" onClick={() => transitionFieldView(() =>
              dispatch({ type: "PATCH", patch: { screen: "map", mapFocusId: intrusion.targetId } }), "map")}>치안 대응</button>
          </div>
        )}
        {observation && !observation.detectorId && (
          <div className="base-supply-warning base-departure-warning">
            <span id="base-espionage-warning" role="status">적 첩보 신호 · {settlementName(observation.targetId)} · 다음 턴 정산</span>
            <button className="base-button" onClick={() => transitionFieldView(() =>
              dispatch({ type: "PATCH", patch: { screen: "map", mapFocusId: observation.targetId } }), "map")}>첩보 탐지 대응</button>
          </div>
        )}
        {firstWarning && (
          <div className="base-supply-warning base-departure-warning">
            <span id="base-departure-warning" role="status">{firstWarning.turns === 0 ? "다음 턴 이탈 예정" : `이탈 경고까지 ${firstWarning.turns}턴`} · {firstWarning.member.pokemon.nameKr}{imminentDepartures > 1 ? ` 외 ${imminentDepartures - 1}마리` : ""}</span>
            <button className="base-button" onClick={() => setPanel({ kind: "pc", memberId: firstWarning.member.id })}>우호도 관리</button>
          </div>
        )}
        <CampaignStatus onOpen={() => setPanel({ kind: "goals" })} />
      </div>
      {panel && <BasePanels panel={panel} siteId={siteId} onClose={() => setPanel(null)} />}
    </section>
  );
}
