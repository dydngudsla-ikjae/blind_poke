import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import arena from "../../assets/observatory-battle.webp";
import useFieldMotion from "../components/useFieldMotion";
import { isRapidPointerRepeat, readPointerClick, type PointerClick } from "../components/pointerClick";
import type { BattleEffect } from "../components/BattleShader";
import {
  adjustedBattleStage, battleMoves, battleStatNames, buildCombatant, calculateDamage, createBattle, effectiveAttack, effectiveness, moveAccuracy, movePower,
  resolveBattleTurn, statusMoveImmune, STRUGGLE, TACKLE, type BattleAction, type BattleMove, type BattleSide, type BattleStep, type Combatant,
} from "../domain/battle";
import type { BattleStat, GameDataBundle } from "../domain/types";
import { worldMapNodes } from "../domain/worldMap";
import { statusLabels } from "../domain/battleStatus";
import { GROWTH_ITEM_ENERGY_COST } from "../domain/economy";
import { suppliedTerritories, TERRITORY_GOLD } from "../domain/territorySupply";
import { useGame } from "../game/GameProvider";
import { ART, duplicateRosterLabels, SPRITE } from "../game/gameHelpers";
import type { BattleSetup } from "../game/gameTypes";
import { battleEntries } from "../game/territoryBattle";
import { describeFirstVictoryReward } from "../game/campaign";
import { PcPanel } from "./BasePanels";
import transitionFieldView from "./transitionFieldView";
import InheritanceChoice from "./InheritanceChoice";
import "./BattleScreen.css";

const BattleShader = lazy(() => import("../components/BattleShader").catch(() => ({ default: () => null })));
const moveColors: Record<string, string> = {
  불꽃: "#ffab75", 물: "#9bd8ff", 풀: "#bfe58e", 전기: "#f7dc82", 얼음: "#b5edf3",
  독: "#ddade9", 에스퍼: "#ffaecb", 고스트: "#ccbbf7", 땅: "#dac195",
};

function roundReading(step: BattleStep) {
  const { strike } = step;
  const side: BattleSide | "settlement" = strike?.side ?? step.actor ?? "settlement";
  const result = strike && (strike.damage > 0 ? `${strike.damage} 피해${strike.fainted ? " · 기절" : ""}`
    : strike.outcome === "miss" ? "빗나감" : strike.outcome === "immune" ? immunityLabel(strike.statusImmune) : undefined);
  const text = strike && result ? `${step.state.teams[strike.side][step.state.active[strike.side]].name}의 ${strike.move.name}`
    : step.lines.join(" ");
  const targetSide = strike?.side === "player" ? "enemy" : "player";
  const targetFainted = strike?.fainted ? `${step.state.teams[targetSide][step.state.active[targetSide]].name}이(가) 쓰러졌다!` : null;
  return { side, text, result, effects: result ? step.lines.slice(2).filter(line => line !== targetFainted) : [] };
}

function immunityLabel(statusImmune?: boolean) {
  return statusImmune ? "상태이상 효과 없음" : "효과 없음";
}

const readingLabels = { player: "아군", enemy: "상대", settlement: "정산" };

function readAttack(move: BattleMove, actor: Combatant, target: Combatant, data: GameDataBundle) {
  const power = movePower(move, target);
  const accuracy = moveAccuracy(move, actor);
  const matchup = power > 0 || move.statusTypeCheck ? effectiveness(move.typeRowid, target.types, data) : null;
  const hasPp = move.pp > 0 || move.id === STRUGGLE.id;
  const asleep = actor.status?.kind === "sleep" && actor.status.remaining > 0;
  const meetsSleepConditions = (move.requiresSleep === "actor" ? asleep : !asleep) &&
    (move.requiresSleep !== "target" || target.status?.kind === "sleep");
  const damage = hasPp && meetsSleepConditions && power > 0 && matchup !== 0
    ? Math.min(target.curHp, calculateDamage(actor, target, move, data)) : 0;
  const damageLabel = accuracy === null ? `${damage} 피해` : `명중 시 ${damage} 피해`;
  return { power, accuracy, matchup, hasPp, damage, damageLabel };
}

function reserveAttackReading(ally: Combatant, opponent: Combatant, data: GameDataBundle) {
  const attacks = battleMoves(ally).map(move => {
    const { damage, accuracy, damageLabel } = readAttack(move, ally, opponent, data);
    return { move, damage, accuracy, damageLabel, score: damage * (accuracy ?? 100) };
  });
  const best = attacks.sort((a, b) => b.score - a.score)[0];
  if (!best?.damage) return "현재 피해를 줄 기술 없음";

  const { move, accuracy, damageLabel } = best;
  return [move.name, damageLabel,
    accuracy !== null && accuracy < 100 ? `명중 ${accuracy}%` : "",
    move.maxPp > 0 ? `PP ${move.pp}/${move.maxPp}` : "",
    move.id === STRUGGLE.id ? "반동 HP ¼" : move.selfKO ? "사용자 기절" : "",
  ].filter(Boolean).join(" · ");
}

function statMovePreview(move: BattleMove, player: Combatant, enemy: Combatant) {
  const boost = move.boosts;
  if (!boost || move.damageClass !== 1) return [];
  const self = boost.target === "actor";
  const { stages } = self ? player : enemy;
  return (Object.entries(boost.changes) as [BattleStat, number][]).map(([stat, change]) => {
    const current = stages[stat] ?? 0;
    const delta = adjustedBattleStage(current, change) - current;
    const label = `${self ? "자신" : "상대"} ${battleStatNames[stat]}`;
    return {
      stat,
      atLimit: delta === 0,
      text: delta === 0 ? `${label} ${change > 0 ? "최고" : "최저"}` : `${label} ${Math.abs(delta)}단계 ${delta > 0 ? "상승" : "하락"}`,
    };
  });
}

function Fighter({ mon, side, action, selected, typeLabel }: {
  mon: Combatant; side: BattleSide; action: string | undefined; selected: string; typeLabel: string;
}) {
  const [fallback, setFallback] = useState(false);
  const artwork = fallback ? SPRITE(mon.pokemon) : ART(mon.pokemon.pokemonRowid);
  // Blastoise's official artwork faces right. Most battle art faces left.
  const facesRight = !fallback && mon.pokemon.pokemonRowid === 9;
  const mirrored = side === "player" ? !facesRight : facesRight;
  const activeStages = (Object.entries(mon.stages) as [BattleStat, number][]).filter(([, stage]) => stage !== 0);
  return (
    <>
      <div className="duel-fighter" data-side={side} data-fainted={mon.fainted} aria-hidden="true">
        <span className="duel-shadow" />
        <div className="duel-gesture" key={selected} data-action={action}>
          <img src={artwork} alt="" draggable={false} data-mirrored={mirrored}
            onError={fallback ? undefined : () => setFallback(true)} />
        </div>
      </div>
      <div className="duel-vitals" data-side={side} data-species-id={mon.pokemon.pokemonRowid}>
        <p className="duel-side">{side === "player" ? "내 포켓몬" : "상대 포켓몬"}</p>
        <div><h2>{mon.name}</h2><b>Lv.{mon.level}</b></div>
        <p className="duel-types">{typeLabel}{mon.status && <span className="duel-condition" data-condition={mon.status.kind}>{statusLabels[mon.status.kind]}</span>}</p>
        <meter aria-label={`${mon.name} 체력`} min={0} max={mon.maxHp} low={mon.maxHp / 4} high={mon.maxHp / 2}
          optimum={mon.maxHp} value={mon.curHp} />
        <p className="duel-hp"><span>HP</span> {mon.curHp}<span> / {mon.maxHp}</span></p>
        {activeStages.length > 0 && (
          <ul className="duel-stages" aria-label={`${mon.name} 능력치 변화`}>
            {activeStages.map(([stat, stage]) => (
              <li key={stat} data-raised={stage > 0}>{battleStatNames[stat]} {stage > 0 ? "+" : "−"}{Math.abs(stage)}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Duel({ setup }: { setup: BattleSetup }) {
  const { state, data, dispatch } = useGame();
  const [battle, setBattle] = useState(() => {
    const labels = duplicateRosterLabels(state.roster);
    const allies = battleEntries(state).map((member, index) => {
      const combatant = buildCombatant(member, data, `p-${index}`);
      return { ...combatant, name: labels.get(member.id) ?? combatant.name };
    });
    const enemies = setup.enemyTeam.flatMap((entry, index) => {
      const pokemon = data.pokemon.find(record => record.pokemonRowid === entry.pokemonId);
      if (!pokemon) return [];
      const combatant = buildCombatant({ pokemon, level: entry.level }, data, `e-${index}`);
      return [setup.firstVictory ? { ...combatant, moves: [TACKLE] } : combatant];
    });
    return createBattle(allies, enemies);
  });
  const [reward] = useState(() => setup.firstVictory ? describeFirstVictoryReward(state) : "");
  const [rewardPcOpen, setRewardPcOpen] = useState(false);
  const [logs, setLogs] = useState(["양쪽 포켓몬이 대치합니다."]);
  const [roundReport, setRoundReport] = useState<{ round: number; readings: ReturnType<typeof roundReading>[] }>();
  const [exchange, setExchange] = useState<{ steps: BattleStep[]; index: number; round: number; replacement: boolean } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [keyboardMove, setKeyboardMove] = useState<number>();
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 790px)").matches);
  const showShader = useFieldMotion();
  const field = useRef<HTMLDivElement>(null);
  const [strikePoints, setStrikePoints] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const outcome = useRef<HTMLHeadingElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const switchAction = useRef<HTMLButtonElement>(null);
  const focusAction = useRef<"first" | "switch" | null>(null);
  const lastCommandPointer = useRef<PointerClick & { kind: BattleAction["kind"] }>(null);
  const commandPending = useRef(false);
  const territory = worldMapNodes.find(node => node.id === setup.territoryId);
  const player = battle.teams.player[battle.active.player];
  const enemy = battle.teams.enemy[battle.active.enemy];
  const step = exchange?.steps[exchange.index];
  const strike = step?.strike;
  const result = battle.phase === "command" || battle.phase === "replacement" ? null : battle.phase;
  const firstWin = result === "win" && Boolean(reward) && state.territories[setup.territoryId]?.owner === "player";
  const isolatedVictory = result === "win" && territory && territory.region > 1 && !suppliedTerritories(state.territories).has(territory.id);
  const replacingFainted = battle.phase === "replacement";
  const selectingAlly = switching || replacingFainted;
  const round = battle.round;
  const cue = exchange ? `${round}-${exchange.index}` : "idle";
  const impactSide = strike?.outcome === "blocked" || (strike?.damage === 0 && strike.move.boosts?.target === "actor")
    ? strike.side : strike?.side === "player" ? "enemy" : "player";
  const strikeEffect: BattleEffect | "blocked" | undefined = strike?.outcome !== "hit" ? strike?.outcome
    : strike.move.damageClass === 1 ? "status" : strike.move.contact ? "contact" : "projectile";

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const scene = field.current;
    if (!scene || !strike) return;
    const bounds = scene.getBoundingClientRect();
    function center(side: BattleSide) {
      const fighter = scene?.querySelector(`.duel-fighter[data-side="${side}"]`)?.getBoundingClientRect();
      return fighter ? {
        x: (fighter.left + fighter.width / 2 - bounds.left) / bounds.width,
        y: (fighter.top + fighter.height * .58 - bounds.top) / bounds.height,
      } : { x: .5, y: .5 };
    }
    setStrikePoints({ from: center(strike.side), to: center(impactSide) });
  }, [cue, strike, impactSide]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const view = matchMedia("(max-width: 790px)");
    const update = () => setCompact(view.matches);
    view.addEventListener("change", update);
    return () => view.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (result) outcome.current?.focus();
    else if (!exchange) {
      if (focusAction.current === "switch") switchAction.current?.focus({ preventScroll: true });
      else if (focusAction.current === "first" || replacingFainted) firstAction.current?.focus({ preventScroll: true });
      focusAction.current = null;
    }
  }, [exchange, result, selectingAlly, replacingFainted]);

  useEffect(() => {
    if (!exchange || !step) return;
    const timer = window.setTimeout(() => {
      setBattle(step.state);
      if (step.lines.length) setLogs(current => [step.lines.join(" "), ...current].slice(0, 8));
      if (exchange.index + 1 < exchange.steps.length) {
        setExchange({ ...exchange, index: exchange.index + 1 });
        return;
      }
      if (step.state.phase === "win") dispatch({ type: "CLAIM_TERRITORY", territoryId: setup.territoryId });
      if (!exchange.replacement) setRoundReport({ round: exchange.round,
        readings: exchange.steps.filter(action => action.lines.length).map(roundReading) });
      commandPending.current = false;
      setExchange(null);
    }, reduced || !step.strike ? 0 : step.strike.outcome === "blocked" ? 140 : 320);
    return () => window.clearTimeout(timer);
  }, [exchange, step, reduced, dispatch, setup.territoryId]);

  function command(action: BattleAction, event: MouseEvent<HTMLButtonElement>) {
    if (commandPending.current || (action.kind === "cure" && state.resources.cureItem < 1)) return;
    const fromKeyboard = event.detail === 0;
    const pointer = readPointerClick(event);
    const previous = lastCommandPointer.current;
    // A fast second tap can land on a different command when the replacement choices change.
    if ((replacingFainted || previous?.kind === "switch") && isRapidPointerRepeat(previous, pointer)) return;
    const steps = resolveBattleTurn(battle, action, data);
    if (!steps.length) return;
    commandPending.current = true;
    lastCommandPointer.current = pointer && { ...pointer, kind: action.kind };
    if (action.kind === "cure") dispatch({ type: "USE_BATTLE_CURE", territoryId: setup.territoryId, round: battle.round });
    focusAction.current = fromKeyboard ? "first" : null;
    setKeyboardMove(fromKeyboard && action.kind === "move" ? action.moveId : undefined);
    setSwitching(false);
    setExchange({ steps, index: 0, round: battle.round, replacement: replacingFainted });
  }

  function cancelSwitch() {
    focusAction.current = "switch";
    setSwitching(false);
  }

  function returnToMap() {
    transitionFieldView(() => {
      dispatch({ type: "PATCH", patch: { screen: "map", battle: null, mapFocusId: setup.territoryId } });
    }, "battle");
  }

  if (!player || !enemy) {
    return (
      <section className="draft-station duel-unavailable">
        <h1>거점 배틀</h1>
        <p>출전할 포켓몬을 불러오지 못했습니다.</p>
        <button className="hunt-return" onClick={returnToMap}>월드맵으로</button>
      </section>
    );
  }

  const outcomeNames = { win: "승리", lose: "패배", draw: "무승부" };
  const battleStatus = result ? outcomeNames[result] : strike?.move.name ?? (selectingAlly ? "포켓몬 교체" : "기술 선택");
  const impactColor = strike ? moveColors[strike.move.typeName] ?? "#ffe1a6" : "#ffe1a6";
  const impact = strike && (strike.damage > 0 ? `−${strike.damage} HP${strike.fainted ? " · 기절" : ""}`
    : strike.outcome === "miss" ? "빗나감" : strike.outcome === "immune" ? immunityLabel(strike.statusImmune) :
      strike.outcome === "blocked" ? "행동 실패" : step.lines.slice(1).join(" "));
  const eligibleAllies = battle.teams.player.flatMap((mon, index) => mon.fainted || index === battle.active.player ? [] : [{ mon, index }]);
  const canAttack = (mon: Combatant) => effectiveAttack(mon.moves, enemy.types, data, 0, {
    actor: mon.status?.kind === "sleep" && mon.status.remaining > 0, target: enemy.status?.kind === "sleep",
  });
  const needsCounter = !result && !exchange && (player.fainted || !canAttack(player));
  const counterAlly = needsCounter ? eligibleAllies.find(({ mon }) => canAttack(mon))?.mon : undefined;
  const moves = battleMoves(player);
  const availableMoves = moves.filter(move => move.pp > 0 || move.id === STRUGGLE.id);
  const focusMove = (availableMoves.find(move => move.id === keyboardMove) ?? availableMoves[0])?.id;
  const impactStyle = {
    "--impact-tint": impactColor,
    ...(strikePoints && {
      "--source-x": `${strikePoints.from.x * 100}%`, "--source-y": `${strikePoints.from.y * 100}%`,
      "--target-x": `${strikePoints.to.x * 100}%`, "--target-y": `${strikePoints.to.y * 100}%`,
    }),
  } as CSSProperties;

  return (
    <section className="draft-station duel-station" aria-labelledby="duel-title">
      <div className="draft-device">
        <div className="duel-arena draft-view" ref={field} role="group" aria-label="포켓몬 대치 장면">
          <img className="duel-landscape" src={arena} alt="" width={1672} height={941} fetchPriority="high" />
          {showShader && (
            <Suspense fallback={null}>
              <BattleShader effect={strikeEffect === "blocked" ? undefined : strikeEffect}
                from={strikePoints?.from} to={strikePoints?.to} cue={cue} color={impactColor} />
            </Suspense>
          )}
          <header className="draft-view-header">
            <div className="draft-mission">
              <span className="draft-location">{territory?.name ?? "미확인 거점"}</span>
              <h1 id="duel-title" ref={heading} tabIndex={-1}>거점 배틀</h1>
            </div>
            <p className="duel-opponent">{setup.enemyName}</p>
          </header>
          {([["player", player], ["enemy", enemy]] as const).map(([side, mon]) => (
            <Fighter key={mon.key} mon={mon} side={side} selected={cue}
              typeLabel={mon.types.map(id => data.types.find(type => type.typeRowid === id)?.nameKr).filter(Boolean).join(" · ")}
              action={strike && strike.outcome !== "blocked" ? strike.side === side && strike.move.contact ? "attack" :
                impactSide === side && strike.damage > 0 ? "impact" : undefined : undefined} />
          ))}
          {strike && <div key={cue} className="duel-impact" aria-hidden="true" data-source={strike.side} data-target={impactSide}
            data-effect={strikeEffect} style={impactStyle}>
            <span className="duel-impact-trail" />
            <span className="duel-impact-label">{impact}</span>
          </div>}
        </div>

        <div className="duel-console">
          <div className="duel-command" data-terminal={Boolean(result)} onKeyDown={event => {
            if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
            if (switching && event.key === "Escape") {
              event.preventDefault();
              cancelSwitch();
            }
          }}>
            <header className="duel-command-heading">
              {!result && <h2>{replacingFainted ? "다음 포켓몬 선택" : selectingAlly ? "포켓몬 교체" : "기술 선택"}</h2>}
              <p className="duel-turn" aria-label={`${round}턴, ${battleStatus}`}>
                {strike && <span>{strike.move.name}</span>}
                <span>턴</span> <b>{String(round).padStart(2, "0")}</b>
              </p>
            </header>
            <div className="duel-latest" role="status" aria-label="직전 배틀 기록" data-round={roundReport?.round}>
              {roundReport && <>
                <b>직전 {roundReport.round}턴</b>
                <div className="duel-round-readings">
                  {roundReport.readings.map(({ side, text, result, effects }, index) => (
                    <div className="duel-round-reading" data-side={side} key={index}>
                      <span>{readingLabels[side]}</span><span title={text}>{text}</span>{result && <strong>{result}</strong>}
                      {effects.length > 0 && <ul className="duel-round-effects">
                        {effects.map((line, effectIndex) => <li key={effectIndex}>{line}</li>)}
                      </ul>}
                    </div>
                  ))}
                </div>
              </>}
            </div>
            {result ? (
              <div className="duel-outcome" data-result={result}>
                <div>
                  <h2 ref={outcome} tabIndex={-1}>거점 배틀 {outcomeNames[result]}</h2>
                  <p>{result === "win" ? `${territory?.name ?? "거점"} 확보 · ${isolatedVictory ? "보급로 연결 필요" : `매 턴 자금 +${TERRITORY_GOLD}`}` : "포켓몬을 데리고 월드맵으로 돌아갑니다."}</p>
                  {result === "win" && reward && <p className="duel-reward-line">첫 승리 보상 · {reward}</p>}
                  {firstWin && state.resources.candy > 0 && (
                    <p className="duel-reward-help">
                      {state.energy < GROWTH_ITEM_ENERGY_COST ? "행동력이 회복되면 사탕을 쓸 수 있습니다."
                        : `경험치 사탕을 먹이는 데 행동력 ${GROWTH_ITEM_ENERGY_COST}이 듭니다.`} 다음 거점을 정찰한 뒤 써도 됩니다.
                    </p>
                  )}
                  {result === "win" && <InheritanceChoice siteId={setup.territoryId} />}
                </div>
                <div className="duel-outcome-actions">
                  {firstWin && <button className="duel-switch" type="button" aria-haspopup="dialog" onClick={() => setRewardPcOpen(true)}>포켓몬 살피기</button>}
                  <button className="duel-continue" type="button" onClick={returnToMap}>월드맵으로 <span aria-hidden="true">→</span></button>
                </div>
              </div>
            ) : selectingAlly ? (
              <>
                <p className="duel-switch-note" id="duel-switch-note">{replacingFainted
                  ? `${player.name} 기절 · 교체한 뒤 바로 기술을 선택합니다.` : "교체로 이 턴을 사용합니다. 상대 포켓몬은 교체 직후 행동합니다."}</p>
                <div className="duel-moves" role="group" aria-label="교체할 포켓몬" aria-describedby="duel-switch-note">
                  {eligibleAllies.map(({ mon, index }, order) => (
                    <button className="duel-move duel-ally" key={mon.key} ref={order === 0 ? firstAction : undefined}
                      data-switch-index={index} disabled={Boolean(exchange)}
                      onClick={event => command({ kind: "switch", index }, event)}>
                      <img src={SPRITE(mon.pokemon)} alt="" />
                      <div><strong>{mon.name}</strong><span>Lv.{mon.level} · HP {mon.curHp}/{mon.maxHp}{mon.status && ` · ${statusLabels[mon.status.kind]}`}</span></div>
                      <small className="duel-ally-preview">{reserveAttackReading(mon, enemy, data)}</small>
                    </button>
                  ))}
                </div>
                {!replacingFainted && <button className="duel-switch" onClick={cancelSwitch}>취소</button>}
              </>
            ) : (
              <>
                <div className="duel-moves" role="group" aria-label="사용할 기술">
                  {moves.map(move => {
                    const { power, accuracy, matchup, hasPp, damage, damageLabel } = readAttack(move, player, enemy, data);
                    const powerLabel = power === 0 ? "변화" : `위력 ${power}`;
                    const label = matchup === null ? "" : matchup === 0 ? "효과 없음" : matchup < 1 ? "반감" : matchup > 1 ? "약점" : "보통";
                    const consequence = move.id === STRUGGLE.id ? "반동 HP ¼" : move.selfKO ? "사용자 기절" : "";
                    const condition = move.requiresSleep === "actor" ? "잠든 상태" : move.requiresSleep === "target" ? "잠든 상대" :
                      move.status ? statusLabels[move.status] : move.secondary?.status ? `${statusLabels[move.secondary.status]} ${move.secondary.chance}%` : "";
                    const details = [label, damage > 0 ? powerLabel : "", move.maxPp > 0 ? `PP ${move.pp}/${move.maxPp}` : "",
                      condition, consequence].filter(Boolean).join(" · ");
                    const statusNote = statusMoveImmune(move, enemy) ? "상태이상 효과 없음"
                      : move.status && power === 0 && matchup !== 0 && enemy.status ? "상대는 이미 상태이상" : "";
                    const statPreview = statMovePreview(move, player, enemy);
                    return (
                      <button className="duel-move" key={move.id} ref={move.id === focusMove ? firstAction : undefined}
                        data-move-id={move.id} data-matchup={matchup}
                        disabled={Boolean(exchange) || !hasPp}
                        onClick={event => command({ kind: "move", moveId: move.id }, event)}>
                        <strong>{move.name}</strong>
                        <span className="duel-move-type" style={{ "--move-color": moveColors[move.typeName] } as CSSProperties}>{move.typeName}</span>
                        <small className="duel-move-power">
                          {damage > 0 ? <b>{damageLabel}</b> : powerLabel} · {accuracy === null ? "명중 판정 없음" : `명중 ${accuracy}%`}
                        </small>
                        <small className="duel-move-detail">{details}</small>
                        {statusNote && <small className="duel-move-effect" data-at-limit="true">{statusNote}</small>}
                        {statPreview.map(({ stat, text, atLimit }) => (
                          <small key={stat} className="duel-move-effect" data-at-limit={atLimit}>{text}</small>
                        ))}
                      </button>
                    );
                  })}
                </div>
                {eligibleAllies.length > 0 && <button ref={switchAction} className="duel-switch" disabled={Boolean(exchange)} onClick={() => {
                  focusAction.current = "first";
                  setSwitching(true);
                }}>교체</button>}
                {player.status && !player.fainted && <button className="duel-switch" disabled={Boolean(exchange) || state.resources.cureItem < 1}
                  onClick={event => command({ kind: "cure" }, event)}>
                  치료 아이템 사용 <small>보유 {state.resources.cureItem}개</small>
                </button>}
              </>
            )}
            {needsCounter && (
              <div className="duel-counter-note">
                {counterAlly ? <p>{counterAlly.name}(으)로 교체하면 유효한 공격을 쓸 수 있습니다.</p> : (
                  <>
                    <p>현재 상대에게 피해를 줄 일반 공격이 남아 있지 않습니다. 기권하면 도전 행동력은 돌아오지 않습니다.</p>
                    <button className="duel-switch" onClick={() => {
                      if (commandPending.current) return;
                      commandPending.current = true;
                      transitionFieldView(() => dispatch({ type: "CONCEDE_TERRITORY", territoryId: setup.territoryId }), "battle");
                    }}>기권하고 돌아가기</button>
                  </>
                )}
              </div>
            )}
          </div>
          <section className="duel-record" aria-label="전투 기록">
            <details open={!compact}>
              <summary>전투 기록</summary>
              <ol>{logs.map((line, index) => <li key={index}>{line}</li>)}</ol>
            </details>
          </section>
        </div>
      </div>
      {firstWin && rewardPcOpen && <PcPanel onClose={() => setRewardPcOpen(false)} />}
    </section>
  );
}

export default function BattleScreen() {
  const { state } = useGame();
  return state.battle ? <Duel key={state.battle.territoryId} setup={state.battle} /> : null;
}
