import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { preload } from "react-dom";
import baseLandscape from "../../assets/observatory-base.webp";
import forest from "../../assets/observatory-forest.webp";
import unknownSignal from "../../assets/unknown-presence.webp";
import DraftAtmosphere from "../components/DraftAtmosphere";
import ScanMeasurements from "../components/ScanMeasurements";
import {
  trainerRelation,
  TRAINER_RELATION_MODIFIER,
} from "../domain/trainerAffinity";
import { useGame } from "../game/GameProvider";
import { createMember, detectPokemonType, samplePokemon, SPRITE } from "../game/gameHelpers";
import TrainerRevealScreen from "./TrainerRevealScreen";
import transitionFieldView from "./transitionFieldView";
import "./DraftScreen.css";

const positions = [
  { x: 23, y: 63 },
  { x: 50, y: 70 },
  { x: 77, y: 63 },
];

export default function DraftScreen() {
  const { state, dispatch, data } = useGame();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [touchId, setTouchId] = useState<number | null>(null);
  const targetButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const nextFocus = useRef<number | null>(null);
  const round = state.draftRound;
  const revealed = state.screen === "trainerReveal";
  const candidates = useMemo(() => {
    if (revealed) return [];
    const excluded = new Set(state.roster.map(member => member.pokemon.pokemonRowid));
    return samplePokemon(data.pokemon, 3, excluded).map(pokemon => ({
      pokemon,
      shownType: detectPokemonType(pokemon, data.types),
    }));
  }, [data.pokemon, data.types, revealed, round, state.roster]);
  const trainer = data.trainers.find(entry => entry.id === state.trainerId);
  const activeIndex = candidates.findIndex(({ pokemon }) => pokemon.pokemonRowid === (hoveredId ?? focusedId ?? touchId));
  const active = candidates[activeIndex];
  const target = positions[activeIndex];

  useEffect(() => {
    if (revealed) preload(baseLandscape, { as: "image" });
  }, [revealed]);

  useEffect(() => {
    if (nextFocus.current === null) return;
    targetButtons.current[Math.min(nextFocus.current, candidates.length - 1)]?.focus();
    nextFocus.current = null;
  }, [round, candidates.length]);

  function pick(pokemon: (typeof candidates)[number]["pokemon"], index: number, fromKeyboard: boolean) {
    const relation = trainer ? trainerRelation(trainer, pokemon, data.pokemon, data.types) : "neutral";
    const next = round + 1;
    if (fromKeyboard && next < 3) nextFocus.current = index;
    setHoveredId(null);
    setFocusedId(null);
    setTouchId(null);
    dispatch({
      type: "ADD_MEMBER",
      member: createMember(pokemon, state.nextMemberId, pokemon.nameKr, TRAINER_RELATION_MODIFIER[relation]),
    });
    dispatch({ type: "PATCH", patch: { draftRound: next, screen: next >= 3 ? "trainerReveal" : "draft" } });
  }

  function moveSight(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const view = event.currentTarget;
    const bounds = view.getBoundingClientRect();
    view.style.setProperty("--aim-x", `${event.clientX - bounds.left}px`);
    view.style.setProperty("--aim-y", `${event.clientY - bounds.top}px`);
    view.dataset.aiming = "true";
  }

  function enterBase() {
    transitionFieldView(() => dispatch({ type: "PATCH", patch: { screen: "base", introPending: false } }));
  }

  return (
    <section className="draft-station starter-station" aria-labelledby="draft-title">
      <div className="draft-device">
        <div
          className="draft-view"
          data-trainer-reveal={revealed}
          role="group"
          aria-label={revealed ? "트레이너 신분증 뷰파인더" : "스타팅 스캐너"}
          data-focused={Boolean(target)}
          onPointerMove={revealed ? undefined : moveSight}
          onPointerLeave={revealed ? undefined : event => {
            delete event.currentTarget.dataset.aiming;
            setHoveredId(null);
          }}
          style={target && {
            "--focus-x": `${target.x}%`,
            "--focus-y": `${target.y}%`,
          } as CSSProperties | undefined}
        >
          <img className="draft-landscape" src={forest} alt="" width={1568} height={882} fetchPriority="high" />
          <DraftAtmosphere target={target} trainerRevealed={revealed} />
          {!revealed && <div className="draft-aim" aria-hidden="true"><span /></div>}
          {target && <div className="draft-lock" aria-hidden="true" />}

          <div className="draft-view-header">
            <div className="draft-mission">
              <span className="draft-location">숲 공터</span>
              <h1 id="draft-title">{revealed ? "트레이너 확인" : "동료 탐색"}</h1>
            </div>
            <div className="draft-scanner-status" data-locked={revealed || Boolean(active)}>
              <span className="draft-status-light" aria-hidden="true" />
              <span>{revealed ? "확인 완료" : active ? "관측 중" : `신호 ${candidates.length}개 감지`}</span>
            </div>
          </div>

          {candidates.map(({ pokemon }, index) => {
            const { x, y } = positions[index];
            return (
              <button
                key={pokemon.pokemonRowid}
                ref={element => { targetButtons.current[index] = element; }}
                type="button"
                className="draft-target"
                data-draft-target
                data-locked={activeIndex === index}
                style={{ "--target-x": `${x}%`, "--target-y": `${y}%` } as CSSProperties}
                aria-label={`미확인 개체 ${index + 1}`}
                onPointerEnter={event => {
                  if (event.pointerType === "mouse") setHoveredId(pokemon.pokemonRowid);
                }}
                onPointerLeave={() => setHoveredId(current => current === pokemon.pokemonRowid ? null : current)}
                onFocus={() => {
                  setHoveredId(null);
                  setFocusedId(pokemon.pokemonRowid);
                }}
                onBlur={() => setFocusedId(current => current === pokemon.pokemonRowid ? null : current)}
                onClick={event => {
                  const pointer = event.nativeEvent;
                  if ("pointerType" in pointer && pointer.pointerType === "touch" && touchId !== pokemon.pokemonRowid) {
                    setHoveredId(null);
                    setFocusedId(null);
                    setTouchId(pokemon.pokemonRowid);
                    return;
                  }
                  pick(pokemon, index, event.detail === 0);
                }}
              >
                <img className="draft-signal-art" src={unknownSignal} alt="" draggable={false} />
                <span className="scanner-contact" aria-hidden="true" />
              </button>
            );
          })}

          <div className="draft-readout" aria-live="polite" aria-atomic="true">
            {active && (
              <div
                className="draft-reading"
                data-align={activeIndex === 2 ? "left" : "right"}
              >
                <h2>미확인 개체 {activeIndex + 1}</h2>
                <ScanMeasurements pokemon={active.pokemon} shownType={active.shownType} />
              </div>
            )}
          </div>
          {revealed && (
            <TrainerRevealScreen
              trainer={trainer}
              onContinue={enterBase}
            />
          )}
        </div>

        <div className="draft-controls">
          <div className="draft-roster">
            <h2>{revealed ? "동료 등록" : "스타팅 선택"} <b>{revealed ? state.roster.length : round + 1}/3</b></h2>
            <ol aria-label="선택한 동료">
              {positions.map((_, index) => {
                const member = state.roster[index];
                return (
                  <li key={index} className={member ? "filled" : index === round ? "current" : undefined}>
                    {member ? <img src={SPRITE(member.pokemon)} alt={member.pokemon.nameKr} /> : (
                      <span className="draft-slot-empty" aria-label={`${index + 1}번 빈 자리`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <span className="draft-device-name">BlindPoke</span>
          {!revealed && (
            <>
              <p className="draft-keys">
                <span><kbd>마우스</kbd><kbd>Tab</kbd> 조준</span>
                <span><kbd>클릭</kbd><kbd>Enter</kbd> 선택</span>
              </p>
              <p className="draft-touch-hint">눌러서 관측 · 다시 눌러 선택</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
