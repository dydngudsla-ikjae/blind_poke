import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { preload } from "react-dom";
import atlas from "../../assets/observatory-atlas.webp";
import chart from "../../assets/field-chart.webp";
import arena from "../../assets/observatory-battle.webp";
import useFieldMotion from "../components/useFieldMotion";
import EntryModal from "../components/EntryModal";
import { worldMapNodes } from "../domain/worldMap";
import { activeDefensePreparation, activeIntrusion, activeObservation } from "../domain/frontierOperations";
import { forecastSupplyRoute, isolatedTurnsRemaining, MAX_LOYALTY, suppliedTerritories, TERRITORY_GOLD } from "../domain/territorySupply";
import { describeFirstVictoryReward, hasFirstVictory, REGION_NAMES, regionProgress } from "../game/campaign";
import { useGame } from "../game/GameProvider";
import type { TerritoryState } from "../game/gameTypes";
import { BATTLE_ENERGY_COST, battleEntries, canScoutTerritory, canTargetTerritory, prepareTerritoryBattle, territoryEnemyLevel, trainerGrowth } from "../game/territoryBattle";
import { territoryFaction } from "../game/territoryFactions";
import { atlasNodes, atlasRoutes } from "./atlasRoutes";
import { BasePanels, QuickChargeButton } from "./BasePanels";
import { trainerPortrait } from "./TrainerRevealScreen";
import transitionFieldView from "./transitionFieldView";
import TerritoryReadiness from "./TerritoryReadiness";
import FrontierOrders, { EnemyWorkshopOrders } from "./FrontierOrders";
import InheritanceChoice from "./InheritanceChoice";
import "./MapScreen.css";

const AtlasShader = lazy(() => import("../components/AtlasShader").catch(() => ({ default: () => null })));
const overview = { zoom: 1, x: 0, y: 0 };
const maxZoom = 2.5;
const statuses = {
  owned: "내 거점",
  scoutable: "정찰 가능",
  unknown: "미확인",
  trainer: "트레이너 점유",
  free: "미점령",
  locked: "준비 중인 지역",
};

function territoryStatus(territory: TerritoryState | undefined, scoutable: boolean) {
  if (!territory?.active) return "locked";
  if (territory.owner === "player") return "owned";
  if (!territory.scouted) return scoutable ? "scoutable" : "unknown";
  return territory.owner === "trainer" ? "trainer" : "free";
}

function clampPan(pan: number, zoom: number) {
  return Math.max(1 - zoom, Math.min(0, pan));
}

export default function MapScreen() {
  const { state, data, dispatch } = useGame();
  const [selectedId, setSelectedId] = useState(() => state.mapFocusId && atlasNodes.has(state.mapFocusId) ? state.mapFocusId : "home");
  const [view, setView] = useState(overview);
  const [reportOpen, setReportOpen] = useState(true);
  const [panel, setPanel] = useState<"entry" | "shop" | null>(null);
  const [scannedId, setScannedId] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; start: typeof overview } | null>(null);
  const markerTouch = useRef<{ id: number; x: number; y: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const report = useRef<HTMLHeadingElement>(null);
  const challengeCommand = useRef<HTMLButtonElement>(null);
  const reportFocus = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const showEffects = useFieldMotion();

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (scannedId) report.current?.focus({ preventScroll: true }); }, [scannedId]);
  useLayoutEffect(() => {
    if (!reportFocus.current) return;
    reportFocus.current = false;
    report.current?.focus();
  }, [selectedId, reportOpen]);

  const territory = state.territories[selectedId];
  const selected = atlasNodes.get(selectedId)!;
  const scanTarget = scannedId ? atlasNodes.get(scannedId) : undefined;
  const { progress, observedRivals, observedFactions, player, supplied } = useMemo(() => {
    const trainers = new Map(data.trainers.map(trainer => [trainer.id, trainer]));
    const revealed = new Map(worldMapNodes.flatMap(node => {
      const spot = state.territories[node.id];
      return spot.active && spot.scouted && spot.owner === "trainer"
        ? [[node.id, { node, trainer: spot.trainerId ? trainers.get(spot.trainerId) : undefined }]] as const : [];
    }));
    const groups = new Map<string, { faction: NonNullable<ReturnType<typeof territoryFaction>>; known: typeof worldMapNodes }>();
    for (const node of worldMapNodes) {
      const spot = state.territories[node.id];
      const faction = spot.active && spot.scouted && territoryFaction(node.id, spot.factionId);
      if (!faction) continue;
      const group = groups.get(faction.id);
      if (group) group.known.push(node);
      else groups.set(faction.id, { faction, known: [node] });
    }
    return { progress: regionProgress(state.territories), observedRivals: revealed, observedFactions: groups,
      player: state.trainerId ? trainers.get(state.trainerId) : undefined, supplied: suppliedTerritories(state.territories) };
  }, [data.trainers, state.territories, state.trainerId]);
  const currentRegion = progress.find(region => region.owned < region.total);
  const totalOwned = progress.reduce((total, region) => total + region.owned, 0);
  const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
  const observation = activeObservation(state.territories, state.frontier.espionage?.observation, supplied);
  const preparation = activeDefensePreparation(state, selectedId);
  const ghostReport = state.frontier.intel[selectedId];

  const status = territoryStatus(territory, canScoutTerritory(state, selectedId));
  const opposition = status === "trainer" || status === "free";
  const training = !hasFirstVictory(state);
  const opponentLevel = opposition && !training ? territoryEnemyLevel(state, selected.region, selectedId) : null;
  const growth = opposition && !training ? trainerGrowth(state, selectedId, selected.region) : null;
  const territoryName = status === "scoutable" || status === "unknown" ? "미확인 거점" : selected.name;
  const trainer = status === "owned" ? player : observedRivals.get(selectedId)?.trainer;
  const occupierName = trainer?.nameKr ?? (status === "trainer" ? "정체 기록 없음" : "내 세력");
  const faction = territory.scouted && territoryFaction(selectedId, territory.factionId);
  const supply = status === "owned" && selected.region > 1 ? supplied.has(selectedId) ? "supplied" : "isolated" : undefined;
  const portrait = trainer && trainerPortrait(trainer.id);
  const canChallenge = canTargetTerritory(state, selectedId);
  const showSupplyPlan = selected.region > 1 && (supply === "isolated" || (opposition && canChallenge));
  const supplyPlan = useMemo(() => showSupplyPlan ? forecastSupplyRoute(state.territories, selectedId, supplied) : null,
    [showSupplyPlan, selectedId, state.territories, supplied]);
  const nextSupplySite = supplyPlan?.missing[0];
  const supplyPath = supplyPlan?.path ?? [];
  const previewRoutes = new Set(supplyPath.slice(1).map((id, index) => [supplyPath[index], id].sort().join("|")));
  const needsEntry = battleEntries(state).length === 0;
  const energyShort = state.energy < BATTLE_ENERGY_COST;
  const battleUnavailable = needsEntry && state.roster.length === 0 ? "탐험에서 동료를 포획하세요."
    : !needsEntry && energyShort ? "행동력이 부족합니다." : null;
  const description = {
    owned: "현재 확보한 거점입니다.",
    scoutable: selected.region === 1 ? "확보한 거점에서 이어지는 길입니다. 정찰하면 이름과 점유 상태를 확인할 수 있습니다."
      : "정찰하면 점유 상태와 수비 트레이너를 확인할 수 있습니다.",
    unknown: "확보한 거점과 연결되면 정찰할 수 있습니다.",
    trainer: canChallenge ? null : "인접 거점을 확보하면 도전할 수 있습니다.",
    free: "현재 점유한 트레이너가 없습니다.",
    locked: `${REGION_NAMES[selected.region - 2]}을 모두 확보하면 이 지역이 열립니다.`,
  }[status];

  function startBattle() {
    const setup = prepareTerritoryBattle(state, data, selectedId);
    if (setup) transitionFieldView(() => dispatch({ type: "START_TERRITORY_BATTLE", setup }), "battle");
  }

  function zoomBy(amount: number, x = .5, y = .5) {
    setView(current => {
      const zoom = Math.max(1, Math.min(maxZoom, current.zoom + amount));
      const ratio = zoom / current.zoom;
      return { zoom, x: clampPan(x - (x - current.x) * ratio, zoom), y: clampPan(y - (y - current.y) * ratio, zoom) };
    });
  }

  function panBy(x: number, y: number, start?: typeof overview) {
    setView(current => {
      const source = start ?? current;
      return { ...current, x: clampPan(source.x + x, current.zoom), y: clampPan(source.y + y, current.zoom) };
    });
  }

  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? .2 : -.2, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => surface.removeEventListener("wheel", wheel);
  }, []);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || view.zoom <= 1 || (event.target as Element).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: view };
    event.currentTarget.dataset.dragging = "";
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    panBy((event.clientX - gesture.x) / bounds.width, (event.clientY - gesture.y) / bounds.height, gesture.start);
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  }

  function handleMapKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case "ArrowLeft": panBy(.12, 0); break;
      case "ArrowRight": panBy(-.12, 0); break;
      case "ArrowUp": panBy(0, .12); break;
      case "ArrowDown": panBy(0, -.12); break;
      case "+": case "=": zoomBy(.25); break;
      case "-": zoomBy(-.25); break;
      case "0": setView(overview); break;
      default: return;
    }
    event.preventDefault();
  }

  function keepNodeVisible(x: number, y: number) {
    setView(current => {
      const px = current.x + x / 100 * current.zoom;
      const py = current.y + y / 100 * current.zoom;
      if (px >= .06 && px <= .94 && py >= .07 && py <= .9) return current;
      return {
        ...current,
        x: clampPan(.5 - x / 100 * current.zoom, current.zoom),
        y: clampPan(.5 - y / 100 * current.zoom, current.zoom),
      };
    });
  }

  function selectKnownSite(id: string) {
    const node = atlasNodes.get(id)!;
    if (id === selectedId && reportOpen) report.current?.focus();
    else reportFocus.current = true;
    selectSite(id);
    keepNodeVisible(node.x, node.y);
  }

  function selectSite(id: string) {
    setSelectedId(id);
    setScannedId(null);
    setReportOpen(true);
  }

  function trackMarkerTouch(event: PointerEvent<HTMLButtonElement>) {
    if (view.zoom > 1 && event.isPrimary && event.pointerType === "touch") {
      markerTouch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  }

  function cancelMarkerSwipe(event: PointerEvent<HTMLButtonElement>) {
    const touch = markerTouch.current;
    if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) {
      markerTouch.current = null;
    }
  }

  function finishMarkerTouch(event: PointerEvent<HTMLButtonElement>, id: string) {
    cancelMarkerSwipe(event);
    if (markerTouch.current?.id !== event.pointerId) return;
    markerTouch.current = null;
    selectSite(id);
  }

  return (
    <section className="draft-station atlas-station" aria-labelledby="atlas-title">
      <div className="draft-device">
        <header className="atlas-header">
          <div className="atlas-title">
            <img src={chart} alt="" width="168" height="168" />
            <h1 id="atlas-title" ref={heading} tabIndex={-1}>월드맵</h1>
          </div>
          <p>{currentRegion && <span>{currentRegion.name} 확보 <b>{currentRegion.owned}/{currentRegion.total}</b></span>}
            <span>전체 거점 확보 <b>{totalOwned}/{worldMapNodes.length}</b></span></p>
        </header>
        <div className="atlas-layout">
          <div className="atlas-view">
            <div className="atlas-viewport" tabIndex={0} ref={viewport} role="group" aria-label="섬 지도"
              aria-describedby="atlas-instructions"
              data-zoomed={view.zoom > 1}
              onPointerDown={startDrag} onPointerMove={moveDrag}
              onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
              onKeyDown={handleMapKeys}>
              <div className="atlas-board" style={{ transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.zoom})` }}>
                <img className="atlas-landscape" src={atlas} alt="" width={1672} height={941} draggable={false} fetchPriority="high" />
                {showEffects && (
                  <Suspense fallback={null}><AtlasShader target={scanTarget} /></Suspense>
                )}
                <svg className="atlas-routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {atlasRoutes.map(route => {
                    const from = state.territories[route.from];
                    const to = state.territories[route.to];
                    const unlocked = from?.active && to?.active;
                    const isSelected = route.from === selectedId || route.to === selectedId;
                    const direct = from?.owner === "player" || to?.owner === "player";
                    const bothOwned = unlocked && from.owner === "player" && to.owner === "player";
                    const suppliedRoute = bothOwned && supplied.has(route.from) && supplied.has(route.to);
                    return <g key={route.key}>
                      <path d={route.path} vectorEffect="non-scaling-stroke"
                      data-route={route.key} data-crossing={route.crossing}
                      data-owned-route={suppliedRoute}
                      data-supply-preview={previewRoutes.has(route.key)}
                      data-isolated-route={bothOwned && !supplied.has(route.from) && !supplied.has(route.to)}
                      data-route-state={unlocked ? isSelected ? "selected" : direct ? "reachable" : "open" : "locked"} />
                      {suppliedRoute && showEffects && <path className="atlas-supply-flow" d={route.path} vectorEffect="non-scaling-stroke" />}
                    </g>;
                  })}
                </svg>
                {worldMapNodes.map(node => {
                  const nodeStatus = territoryStatus(state.territories[node.id], canScoutTerritory(state, node.id));
                  const known = nodeStatus === "owned" || nodeStatus === "trainer" || nodeStatus === "free";
                  const active = selectedId === node.id;
                  const rivalName = observedRivals.get(node.id)?.trainer?.nameKr;
                  const nodeSupply = nodeStatus === "owned" && node.region > 1 ? supplied.has(node.id) ? "supplied" : "isolated" : undefined;
                  const supplyLabel = nodeSupply ? nodeSupply === "supplied" ? ", 보급 연결" : ", 고립" : "";
                  const label = known ? `${node.name}, ${statuses[nodeStatus]}${rivalName ? `, ${rivalName}` : ""}${supplyLabel}` : `${statuses[nodeStatus]} 거점`;
                  return (
                    <button key={node.id} className="atlas-node" data-node={node.id} data-status={nodeStatus} data-supply={nodeSupply}
                      data-label-align={node.x < 15 ? "left" : node.x > 85 ? "right" : "center"}
                      disabled={nodeStatus === "locked"} aria-pressed={active} aria-label={label}
                      style={{ left: `${node.x}%`, top: `${node.y}%`, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }}
                      onPointerDown={trackMarkerTouch} onPointerMove={cancelMarkerSwipe}
                      onPointerUp={event => finishMarkerTouch(event, node.id)}
                      onPointerCancel={() => { markerTouch.current = null; }}
                      onClick={event => {
                        // Chrome can suppress a touch click immediately after a map drag.
                        if (view.zoom > 1 && "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "touch") return;
                        selectSite(node.id);
                      }}
                      onFocus={event => {
                        // A touch click must hit the same marker that received pointerdown.
                        if (event.currentTarget.matches(":focus-visible")) keepNodeVisible(node.x, node.y);
                      }}>
                      <span className="atlas-marker" aria-hidden="true" />
                      {(active || node.id === "home") && <span className="atlas-node-label" aria-hidden="true">{rivalName ?? (known ? node.name : statuses[nodeStatus])}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="atlas-zoom" role="group" aria-label="지도 배율">
              <button onClick={() => zoomBy(-.25)} disabled={view.zoom === 1} aria-label="지도 축소">−</button>
              <button onClick={() => setView(overview)} aria-label="지도 전체 보기"><b>{Math.round(view.zoom * 100)}%</b></button>
              <button onClick={() => zoomBy(.25)} disabled={view.zoom === maxZoom} aria-label="지도 확대">+</button>
            </div>
          </div>

          <aside className="atlas-report" aria-labelledby="atlas-report-title" data-open={reportOpen}>
            <div className="atlas-report-header">
              <h2 id="atlas-report-title">정찰 기록</h2>
              <button type="button" className="atlas-report-toggle" aria-expanded={reportOpen} aria-controls="atlas-report-detail"
                onClick={() => setReportOpen(open => !open)}>
                <span>{territoryName}</span><span>{reportOpen ? "보고 접기" : "보고 펴기"}</span>
              </button>
            </div>
            <div id="atlas-report-detail" className="atlas-report-detail">
              <div className="atlas-report-body" aria-live="polite">
                <p className="atlas-report-status" data-status={status}><i className="atlas-marker" aria-hidden="true" />{statuses[status]}<span>{REGION_NAMES[selected.region - 1]}</span></p>
                <h3 ref={report} tabIndex={-1} data-atlas-report-heading>{territoryName}</h3>
                {(status === "owned" || status === "trainer") && <div className="atlas-faction-card" data-status={status}>
                  {portrait && <img src={portrait} alt="" width="48" height="48" />}
                  <div><p>{status === "owned" ? "내 세력" : "점유 트레이너"}</p><strong>{occupierName}</strong>
                    {trainer?.specialtyTypes.length ? <p className="atlas-specialty">선호 타입 <b>{trainer.specialtyTypes.map(type => type.nameKr).join(" · ")}</b></p> : null}
                  </div>
                </div>}
                {faction && <p>{faction.name} · {selectedId === faction.leader ? "대표 거점" : "외곽 거점"}</p>}
                {supply && (
                  <p className="atlas-supply" data-supply={supply}>
                    <strong>{supply === "supplied" ? "보급 연결" : "고립 · 보급 중단"}</strong>
                    <span>충성도 {territory.loyalty ?? MAX_LOYALTY}/{MAX_LOYALTY}</span>
                    <span>턴당 자금 +{supply === "supplied" ? TERRITORY_GOLD : 0}</span>
                  </p>
                )}
                {description && <p>{description}</p>}
                {opponentLevel !== null && <p className="atlas-readiness">
                  예상 수비 레벨 <b>Lv.{opponentLevel}–{opponentLevel + 1}</b>
                  {status === "trainer" && growth && (growth.nextIn === null ? ` · 성장 +${growth.bonus} (상한)`
                    : ` · 성장 +${growth.bonus} · 다음 강화까지 ${growth.nextIn}턴`)}
                </p>}
                {canChallenge && !hasFirstVictory(state) && <p>첫 승리 보상 · {describeFirstVictoryReward(state)}</p>}
              </div>
              {showSupplyPlan && (
                <section className="atlas-readiness atlas-supply-plan" aria-label="보급로 전망">
                  {supply === "isolated" ? <p>미점령 전환까지 <strong>{isolatedTurnsRemaining(territory.loyalty)}턴</strong></p>
                    : <p><strong>{supplyPlan && !nextSupplySite ? "확보하면 보급 연결" : "확보하면 고립"}</strong></p>}
                  {supplyPlan && nextSupplySite && (
                    <>
                      <p>{supply === "isolated" ? "보급을 복구하려면" : "확보한 뒤 보급하려면"} 거점 {supplyPlan.missing.length}곳을 더 확보하세요.</p>
                      <button className="base-button" type="button" onClick={() => selectKnownSite(nextSupplySite)}>보급로 첫 거점 보기</button>
                    </>
                  )}
                  {!supplyPlan && <p>현재 열린 지역에서 이어지는 보급로가 없습니다.</p>}
                  {supplyPlan && !nextSupplySite && !supply && <p>턴당 자금 +{TERRITORY_GOLD}</p>}
                </section>
              )}
              {status === "scoutable" && (
                <button className="atlas-scout" data-scout={selectedId} onClick={() => {
                  if (!canScoutTerritory(state, selectedId)) return;
                  dispatch({ type: "SCOUT_TERRITORY", territoryId: selectedId });
                  setScannedId(selectedId);
                }}>정찰하기 <span aria-hidden="true">→</span></button>
              )}
              {intrusion && !intrusion.defenderId && intrusion.targetId !== selectedId && (
                <button className="atlas-scout" onClick={() => selectKnownSite(intrusion.targetId)}>
                  침투 예고 · {atlasNodes.get(intrusion.targetId)?.name}
                </button>
              )}
              {observation && !observation.detectorId && observation.targetId !== selectedId && (
                <button className="atlas-scout" onClick={() => selectKnownSite(observation.targetId)}>
                  첩보 신호 · {atlasNodes.get(observation.targetId)?.name}
                </button>
              )}
              {preparation && (!ghostReport || ghostReport.memberId) && (
                <p className="atlas-readiness" role="status">적 수비 선봉 준비 · 관측한 타입 기준 · {preparation.expiresTurn - state.turnCount}턴 남음</p>
              )}
              <FrontierOrders key={selectedId} territoryId={selectedId} />
              <EnemyWorkshopOrders key={`workshop-${selectedId}`} territoryId={selectedId} />
              {status === "owned" && state.outposts[selectedId] && <>
                <InheritanceChoice siteId={selectedId} />
                <button className="atlas-scout" onClick={() => transitionFieldView(() =>
                  dispatch({ type: "OPEN_OUTPOST", siteId: selectedId }), "map")}>거점 관리 <span aria-hidden="true">→</span></button>
              </>}
              {canChallenge && (
                <>
                  {territory.scouted && <TerritoryReadiness key={selectedId} territoryId={selectedId} />}
                  {needsEntry && state.roster.length > 0 && (
                    <button className="atlas-scout" type="button" aria-haspopup="dialog" onClick={() => setPanel("entry")}>
                      엔트리 편성 <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button ref={challengeCommand} className="atlas-scout" disabled={needsEntry || energyShort} onClick={startBattle}
                    onPointerEnter={() => preload(arena, { as: "image" })} onFocus={() => preload(arena, { as: "image" })}>
                    거점 도전 <small>행동력 {BATTLE_ENERGY_COST}</small><span aria-hidden="true">→</span>
                  </button>
                  {battleUnavailable && <p className="atlas-battle-note" id="atlas-battle-note">{battleUnavailable}</p>}
                  {!needsEntry && (
                    <div className="atlas-charge-options">
                      <QuickChargeButton requiredEnergy={BATTLE_ENERGY_COST} nextAction={challengeCommand} />
                      {energyShort && <button className="base-button" type="button" aria-describedby="atlas-battle-note" aria-haspopup="dialog"
                        onClick={() => setPanel("shop")}>충전권 확인</button>}
                    </div>
                  )}
                </>
              )}
              <section className="atlas-factions" aria-labelledby="atlas-factions-title">
                <h3 id="atlas-factions-title">확인된 세력</h3>
                <ul>
                  <li><button data-faction-site="home" data-status="owned" aria-current={selectedId === "home" ? "location" : undefined} onClick={() => selectKnownSite("home")}>
                    <i className="atlas-marker" aria-hidden="true" /><strong>{player?.nameKr ?? "내 세력"}</strong><small>내 거점 {totalOwned}곳</small>
                  </button></li>
                  {[...observedRivals.values()].filter(({ node }) => !state.territories[node.id].factionId).map(({ node, trainer: rival }) => (
                    <li key={node.id}><button data-faction-site={node.id} data-status="trainer" aria-current={selectedId === node.id ? "location" : undefined} onClick={() => selectKnownSite(node.id)}>
                      <i className="atlas-marker" aria-hidden="true" /><strong>{rival?.nameKr ?? "정체 기록 없음"}</strong><small>{node.name}</small>
                    </button></li>
                  ))}
                  {[...observedFactions.values()].map(({ faction: group, known }) => {
                    const complete = group.sites.every(id => state.territories[id].owner === "player");
                    return (
                      <li key={group.id} className="atlas-faction-group" data-faction={group.id}>
                        <strong>{group.name}</strong>{complete && <small>확보 완료</small>}
                        <ul aria-label={group.name}>
                          {known.map(node => {
                            const nodeStatus = territoryStatus(state.territories[node.id], false);
                            const rival = observedRivals.get(node.id)?.trainer;
                            return (
                              <li key={node.id}><button data-faction-site={node.id} data-status={nodeStatus}
                                aria-current={selectedId === node.id ? "location" : undefined} onClick={() => selectKnownSite(node.id)}>
                                <i className="atlas-marker" aria-hidden="true" />
                                <strong>{rival?.nameKr ?? node.name}</strong>
                                <small>{node.id === group.leader ? "대표" : "외곽"} · {rival ? node.name : statuses[nodeStatus]}</small>
                              </button></li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <ul className="atlas-legend" aria-label="거점 상태">
                {Object.entries(statuses).map(([value, label]) => (
                  <li key={value} data-status={value}><i className="atlas-marker" aria-hidden="true" />{label}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
        <footer className="atlas-controls">
          <button id="backToBase" className="hunt-return" onClick={() => {
            transitionFieldView(() => dispatch({ type: "PATCH", patch: { screen: "base", siteViewId: null } }), "map");
          }}><span aria-hidden="true">←</span> 본거지로</button>
          <p id="atlas-instructions">
            <span className="atlas-key-hint">휠·<kbd>+</kbd><kbd>−</kbd> 확대·축소 <span>드래그·<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 이동</span></span>
            <span className="atlas-touch-hint">확대 후 드래그로 이동</span>
          </p>
        </footer>
      </div>
      {panel === "entry" && <EntryModal onClose={() => setPanel(null)} />}
      {panel === "shop" && <BasePanels panel={{ kind: "shop" }} onClose={() => setPanel(null)} />}
    </section>
  );
}
