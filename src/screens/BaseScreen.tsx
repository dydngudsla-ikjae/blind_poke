import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import town from "../../assets/observatory-base.webp";
import forest from "../../assets/observatory-forest.webp";
import atlas from "../../assets/observatory-atlas.webp";
import brassScope from "../../assets/field-observation-scope.webp";
import chart from "../../assets/field-chart.webp";
import hourglass from "../../assets/field-hourglass.webp";
import ball from "../../assets/field-ball.webp";
import rosterCards from "../../assets/field-roster.webp";
import satchel from "../../assets/field-satchel.webp";
import stall from "../../assets/field-stall.webp";
import gear from "../../assets/field-gear.webp";
import buildSign from "../../assets/field-build-sign.webp";
import clearSign from "../../assets/field-clear-sign.webp";
import credential from "../../assets/field-credential.webp";
import useFieldMotion from "../components/useFieldMotion";
import { isRapidPointerRepeat, readPointerClick, type PointerClick } from "../components/pointerClick";
import { ENERGY_PER_TURN, isFreeWorker } from "../game/gameReducer";
import { departureWarnings, ENERGY_CHARGE_COST, HELD_ITEM_COST } from "../domain/economy";
import { HUNT_ENERGY_COST } from "../domain/jobs";
import { forecastGold, forecastIntrusionLoss } from "../domain/production";
import { advanceTerritoryLoyalty } from "../domain/territorySupply";
import { activeIntrusion, activeObservation } from "../domain/frontierOperations";
import { worldMapNodes } from "../domain/worldMap";
import { canOperateSettlement, HOME_SITE, settlementAt, settlementName } from "../domain/settlements";
import { useGame } from "../game/GameProvider";
import { duplicateRosterLabels, SPRITE } from "../game/gameHelpers";
import { BasePanels, buildings, GoldForecast, QuickChargeButton, type BasePanel } from "./BasePanels";
import { CampaignStatus } from "./CampaignGoals";
import InheritanceChoice from "./InheritanceChoice";
import { trainerPortrait } from "./TrainerRevealScreen";
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
const managementTools = [
  { kind: "pc", label: "포켓몬", art: ball },
  { kind: "entry", label: "엔트리", art: rosterCards },
  { kind: "resources", label: "자원", art: satchel },
  { kind: "shop", label: "상점", art: stall },
  { kind: "settings", label: "설정", art: gear },
] as const;
const BaseWaterShader = lazy(() => import("../components/BaseWaterShader").catch(() => ({ default: () => null })));

type OpenMap = (siteId: string | null, showReport?: boolean) => void;

export default function BaseScreen({ onOpenMap }: { onOpenMap: OpenMap }) {
  const { state } = useGame();
  const siteId = state.siteViewId ?? HOME_SITE;
  return <SettlementScreen key={siteId} siteId={siteId} onOpenMap={onOpenMap} />;
}

function SettlementScreen({ siteId, onOpenMap }: { siteId: string; onOpenMap: OpenMap }) {
  const { state, dispatch } = useGame();
  const [panel, setPanel] = useState<BasePanel | null>(() => state.facilityOpening
    ? { kind: "facility", ...state.facilityOpening } : null);
  const heading = useRef<HTMLHeadingElement>(null);
  const exploreCommand = useRef<HTMLButtonElement>(null);
  const lastTurnClick = useRef<PointerClick>(null);
  const showWater = useFieldMotion();
  const settlement = settlementAt(state, siteId)!;
  const home = siteId === HOME_SITE;
  const canOperate = canOperateSettlement(state, siteId);
  const name = settlementName(siteId);
  const portrait = state.trainerId ? trainerPortrait(state.trainerId) : undefined;
  const resting = state.roster.filter(member => isFreeWorker(state, member)).slice(0, trail.length);
  const assignedCount = state.roster.filter(member => !isFreeWorker(state, member)).length;
  const craftableTools = Math.floor(state.resources.tool / HELD_ITEM_COST);
  const imminentLosses = useMemo(() => advanceTerritoryLoyalty(state.territories).lost, [state.territories]);
  const favorWarnings = departureWarnings(state.roster);
  const firstWarning = favorWarnings[0];
  const warningName = firstWarning && (duplicateRosterLabels(state.roster).get(firstWarning.member.id) ?? firstWarning.member.pokemon.nameKr);
  const imminentDepartures = favorWarnings.filter(({ turns }) => turns === 0).length;
  const firstLostSite = worldMapNodes.find(node => node.name === imminentLosses[0]);
  const favorNotice = firstWarning && (
    <div className="base-supply-warning base-departure-warning">
      <span id="base-departure-warning" role="status">{firstWarning.turns === 0 ? "다음 턴 이탈 예정" : `이탈 경고까지 ${firstWarning.turns}턴`} · {warningName}{imminentDepartures > 1 ? ` 외 ${imminentDepartures - 1}마리` : ""}</span>
      <button className="base-button" aria-haspopup="dialog" onClick={() => setPanel({ kind: "pc", memberId: firstWarning.member.id, prioritizeWarnings: true })}>우호도 관리</button>
    </div>
  );
  const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
  const observation = activeObservation(state.territories, state.frontier.espionage?.observation);
  const undefended = intrusion && !intrusion.defenderId;
  const undetected = observation && !observation.detectorId;
  const hasTurnWarning = imminentLosses.length > 0 || imminentDepartures > 0 || Boolean(undefended || undetected);
  const turnDetails = [home && "base-gold-preview", imminentLosses.length && "base-supply-warning", firstWarning && "base-departure-warning",
    undefended && "base-intrusion-warning", undetected && "base-espionage-warning"].filter(Boolean).join(" ");
  const goldReading = useMemo(() => home ? forecastGold(state) : null, [home, state]);
  const turnHint = state.energy < HUNT_ENERGY_COST
    ? state.resources.gold >= ENERGY_CHARGE_COST
      ? "행동력이 더 필요하면 상점에서 충전권 구매 전후를 비교하세요."
      : `다음 턴에 행동력이 ${ENERGY_PER_TURN}까지 회복됩니다.`
    : undefined;

  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (state.facilityOpening) dispatch({ type: "PATCH", patch: { facilityOpening: undefined } });
  }, [state.facilityOpening, dispatch]);

  function explore() {
    transitionFieldView(() => dispatch({ type: "START_HUNT" }));
  }

  return (
    <section className="field-base" aria-labelledby="base-title" data-home={home} onClickCapture={event => {
      if (event.target instanceof Element && !event.target.closest("#nextTurn")) lastTurnClick.current = null;
    }}>
      <div className="base-stage">
        <header className="base-hud">
          <h1 className="base-title" id="base-title" data-base-heading ref={heading} tabIndex={-1}>{name}</h1>
          <div className="base-readouts">
            <button className="base-button base-turn" type="button" aria-haspopup="dialog"
              onClick={() => setPanel({ kind: "log" })} aria-label={`${state.turnCount}턴, 턴 기록`}>
              <span>턴 기록</span><b>{String(state.turnCount).padStart(2, "0")}</b>
            </button>
            <div className="base-energy" role="group" aria-label={`행동력 ${state.energy}/${ENERGY_PER_TURN}`}>
              <span>행동력</span>
              <b>{state.energy}/{ENERGY_PER_TURN}</b>
              <div className="base-energy-cells" aria-hidden="true">
                {Array.from({ length: ENERGY_PER_TURN }, (_, index) => <i key={index} data-filled={index < state.energy} />)}
              </div>
            </div>
          </div>
          <button className="base-trainer-button" type="button" aria-label="트레이너 카드" aria-haspopup="dialog"
            onClick={() => setPanel({ kind: "trainer" })}>
            <span className="base-trainer-credential" aria-hidden="true">
              <img src={credential} alt="" width="176" height="112" />
              {portrait && <img className="base-credential-portrait" src={portrait} alt="" />}
            </span>
          </button>
        </header>

        <div className="base-board" role="group" aria-label={`${name} 조감도`}>
          <img className="base-landscape" src={town} width={1672} height={941} alt="" fetchPriority="high" />
          {showWater && (
            <div className="base-water" aria-hidden="true">
              <Suspense fallback={null}><BaseWaterShader turn={state.turnCount} /></Suspense>
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
                    <span className="base-plot-sign">
                      <img src={buildSign} alt="" width="224" height="194" />
                      <span>건설</span>
                    </span>
                  </button>
                ) : building && constructing ? (
                  <button className="base-plot-action" data-plot-construction={building.id} onClick={() => setPanel({ kind: "construction", buildingId: building.id })} aria-label={`${facility?.label ?? "시설"} 공사 관리, ${remaining}`}>
                    <span className="base-plot-label">{remaining}</span>
                  </button>
                ) : building ? (
                  <button className="base-plot-action" onClick={() => setPanel({ kind: "facility", buildingId: building.id })}
                    aria-label={`${index + 1}번 부지 ${facility?.label ?? "시설"} 관리`}>
                    <span className="base-plot-label">{facility?.label ?? "시설"}</span>
                  </button>
                ) : index === settlement.plotCap ? (
                  <button className="base-plot-action" onClick={() => setPanel({ kind: "clearing", plot: index })}
                    disabled={!canOperate && !clearing}
                    aria-label={`${index + 1}번 미개척 부지`}>
                    <span className="base-plot-sign">
                      <img src={clearSign} alt="" width="224" height="194" />
                      <span>{clearing ? "개척 중" : "평탄화"}</span>
                    </span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <footer className="base-dock">
          <nav className="base-tools" aria-label="본거지 관리">
            {managementTools.filter(({ kind }) => home || kind !== "settings").map(({ kind, label, art }) => (
              <button type="button" className="base-button" key={kind} aria-haspopup="dialog"
                aria-label={kind === "resources" ? label : undefined}
                aria-describedby={kind === "resources" && craftableTools > 0 ? "base-tools-ready" : undefined}
                data-action={kind === "settings" ? "settings" : undefined} onClick={() => setPanel({ kind })}>
                <img className="base-tool-art" src={art} alt="" width="112" height="112" />
                <span>{label}{kind === "pc" && <> <b>{state.roster.length}</b></>}</span>
                {kind === "resources" && craftableTools > 0 && (
                  <small className="base-action-cost base-tools-ready" id="base-tools-ready">제작 {craftableTools}개</small>
                )}
              </button>
            ))}
          </nav>
          <nav className="base-actions" aria-label="마을 명령">
            <button ref={exploreCommand} className="base-button base-explore" data-action="hunt" disabled={state.energy < HUNT_ENERGY_COST}
              aria-label={`탐험 행동력 ${HUNT_ENERGY_COST}`}
              onPointerEnter={() => preload(forest, { as: "image" })}
              onFocus={() => preload(forest, { as: "image" })}
              onClick={explore}>
              <img src={brassScope} className="base-command-art" alt="" width="256" height="256" />
              <span>탐험</span>
              <small className="base-action-cost" aria-hidden="true">−{HUNT_ENERGY_COST}</small>
            </button>
            <button className="base-button base-map" data-action="map"
              onPointerEnter={() => preload(atlas, { as: "image" })}
              onFocus={() => preload(atlas, { as: "image" })}
              onClick={() => onOpenMap(home ? state.mapFocusId : siteId)}>
              <img src={chart} className="base-command-art" alt="" width="168" height="168" />
              <span>지도</span>
            </button>
            <button className="base-button base-next" id="nextTurn" type="button"
              data-risk={hasTurnWarning}
              aria-describedby={turnDetails || undefined}
              onKeyDown={event => {
                if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
              }}
              onClick={event => {
                const click = readPointerClick(event);
                if (isRapidPointerRepeat(lastTurnClick.current, click)) return;
                lastTurnClick.current = click;
                dispatch({ type: "NEXT_TURN", expectedTurn: state.turnCount });
              }}>
              <img src={hourglass} className="base-command-art" alt="" width="168" height="168" key={state.turnCount} data-turned={state.turnCount > 0} />
              {hasTurnWarning && <i className="base-next-alert" aria-hidden="true">!</i>}
              <span>다음 턴</span>
            </button>
          </nav>
        </footer>
      </div>
      {hasTurnWarning && (
        <section className="base-turn-notices" aria-label="다음 턴 경고">
          {imminentDepartures > 0 && favorNotice}
          {firstLostSite && (
            <div className="base-supply-warning base-departure-warning">
              <span id="base-supply-warning" role="status">
                다음 턴에 {firstLostSite.name}{imminentLosses.length > 1 ? ` 외 ${imminentLosses.length - 1}곳이` : "이"} 미점령지로 바뀝니다.
              </span>
              <button className="base-button" onClick={() => onOpenMap(firstLostSite.id, true)}>보급로 보기</button>
            </div>
          )}
          {undefended && (
            <div className="base-supply-warning base-departure-warning">
              <span id="base-intrusion-warning" role="status">적 침투 예고 · {settlementName(intrusion.targetId)} · 다음 턴 자금 손실 예상 {forecastIntrusionLoss(state)}</span>
              <button className="base-button" onClick={() => onOpenMap(intrusion.targetId, true)}>치안 대응</button>
            </div>
          )}
          {undetected && (
            <div className="base-supply-warning base-departure-warning">
              <span id="base-espionage-warning" role="status">적 첩보 신호 · {settlementName(observation.targetId)} · 다음 턴 정산</span>
              <button className="base-button" onClick={() => onOpenMap(observation.targetId, true)}>첩보 탐지 대응</button>
            </div>
          )}
        </section>
      )}
      <div className="base-charge-line"><QuickChargeButton requiredEnergy={HUNT_ENERGY_COST} nextAction={exploreCommand} /></div>
      <div className="base-ledger">
        <div className="base-ledger-strip" data-income={Boolean(goldReading)}>
          <dl className="base-settlement-metrics" aria-label="운영 현황">
            <div>
              <dt>배치</dt>
              <dd>{assignedCount}<small>/{state.roster.length}</small></dd>
            </div>
            <div>
              <dt>개척</dt>
              <dd>{settlement.plotCap}<small>/{plots.length}</small>
                <span className="base-plot-ticks" aria-hidden="true">
                  {plots.map((_, index) => <i key={index} data-open={index < settlement.plotCap} />)}
                </span>
              </dd>
            </div>
          </dl>
          {goldReading && <GoldForecast id="base-gold-preview" reading={goldReading} hint={turnHint} />}
          <CampaignStatus onOpen={() => setPanel({ kind: "goals" })} />
        </div>
        {!home && <div className="base-supply-warning base-departure-warning" role="group" aria-label="거점 운영 상태">
          <span>{canOperate ? "보급 연결 · 본거지와 재고 공유" : "고립 · 공사·개척·생산 중단"}</span>
          <button className="base-button" onClick={() => dispatch({ type: "PATCH", patch: { siteViewId: null } })}>본거지로</button>
        </div>}
        {!home && <InheritanceChoice siteId={siteId} />}
        {imminentDepartures === 0 && favorNotice}
      </div>
      {panel && <BasePanels panel={panel} siteId={siteId} onClose={() => setPanel(null)} />}
    </section>
  );
}
