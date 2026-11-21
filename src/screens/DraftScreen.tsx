import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import baseLandscape from "../../assets/observatory-base.webp";
import forest from "../../assets/observatory-forest.webp";
import DraftAtmosphere from "../components/DraftAtmosphere";
import {
  trainerRelation,
  TRAINER_RELATION_MODIFIER,
} from "../domain/trainerAffinity";
import { useGame } from "../game/GameProvider";
import { createMember, detectPokemonType, samplePokemon, SPRITE } from "../game/gameHelpers";
import TrainerRevealScreen from "./TrainerRevealScreen";
import transitionFieldView from "./transitionFieldView";
import "./DraftScreen.css";
import "./FieldOptics.css";

const trails = [
  { x: 19, y: 52, place: "고사리 그늘" },
  { x: 50, y: 69, place: "이끼 길목" },
  { x: 81, y: 49, place: "나무뿌리 곁" },
];
const trailPosition = ({ x, y }: { x: number; y: number }) => ({
  "--target-x": `${x}%`,
  "--target-y": `${y}%`,
} as CSSProperties);
const forestWidth = 1568;
const forestHeight = 882;

export default function DraftScreen() {
  const { state, dispatch, data } = useGame();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [touchId, setTouchId] = useState<number | null>(null);
  const [arrivalIndex, setArrivalIndex] = useState<number | null>(null);
  const targetButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const nextFocus = useRef<number | null>(null);
  const pickedRound = useRef<number | null>(null);
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
  const trace = trails[activeIndex];
  const arrival = arrivalIndex === null ? null : trails[arrivalIndex];
  const newestMember = state.roster[round - 1];

  useEffect(() => {
    if (revealed) preload(baseLandscape, { as: "image" });
  }, [revealed]);

  useEffect(() => {
    if (nextFocus.current === null) return;
    targetButtons.current[Math.min(nextFocus.current, candidates.length - 1)]?.focus();
    nextFocus.current = null;
  }, [round, candidates.length]);

  function pick(pokemon: (typeof candidates)[number]["pokemon"], index: number, fromKeyboard: boolean) {
    if (pickedRound.current === round) return;
    pickedRound.current = round;
    setArrivalIndex(index);
    const relation = trainer ? trainerRelation(trainer, pokemon, data.pokemon, data.types) : "neutral";
    if (fromKeyboard && round + 1 < 3) nextFocus.current = index;
    setHoveredId(null);
    setFocusedId(null);
    setTouchId(null);
    dispatch({
      type: "PICK_STARTER",
      expectedRound: round,
      member: createMember(pokemon, state.nextMemberId, pokemon.nameKr, TRAINER_RELATION_MODIFIER[relation]),
    });
  }

  function enterBase() {
    transitionFieldView(() => dispatch({ type: "PATCH", patch: { screen: "base", introPending: false } }));
  }

  return (
    <section className={revealed ? "draft-station starter-station field-brass-station" : "draft-station starter-station"}
      aria-labelledby="draft-title">
      <div className="draft-device">
        <div
          className="draft-view starter-view"
          data-trainer-reveal={revealed}
          role="group"
          aria-label={revealed ? "트레이너 신분증" : "숲 공터"}
          onPointerLeave={revealed ? undefined : () => setHoveredId(null)}
        >
          <img className="draft-landscape" src={forest} alt="" width={forestWidth} height={forestHeight} fetchPriority="high" />
          <DraftAtmosphere reveal={revealed} focus={trace && { x: trace.x / 100, y: trace.y / 100 }}
            arrival={arrival && { x: arrival.x / 100, y: arrival.y / 100, round }} />

          <header className="draft-view-header">
            <div className="draft-mission">
              <span className="draft-location">숲 공터</span>
              <h1 id="draft-title">{revealed ? "트레이너 확인" : "첫 동료를 찾아서"}</h1>
              {!revealed && <p className="starter-intro">숲의 흔적을 살펴 동료 세 마리를 맞이하세요.</p>}
            </div>
          </header>

          {candidates.map(({ pokemon }, index) => {
            return (
              <button
                key={pokemon.pokemonRowid}
                ref={element => { targetButtons.current[index] = element; }}
                type="button"
                className="starter-target"
                data-draft-target
                data-observed={activeIndex === index}
                style={trailPosition(trails[index])}
                aria-label={trails[index].place}
                aria-controls="starter-notes"
                aria-describedby={activeIndex === index ? "starter-clues" : undefined}
                onPointerEnter={event => {
                  if (event.pointerType === "mouse") setHoveredId(pokemon.pokemonRowid);
                }}
                onPointerLeave={() => setHoveredId(current => current === pokemon.pokemonRowid ? null : current)}
                onFocus={() => {
                  setHoveredId(null);
                  setFocusedId(pokemon.pokemonRowid);
                }}
                onBlur={() => setFocusedId(current => current === pokemon.pokemonRowid ? null : current)}
                onKeyDown={event => {
                  if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
                }}
                onClick={event => {
                  const pointer = event.nativeEvent;
                  if (event.detail > 1 && (!("pointerType" in pointer) || pointer.pointerType === "mouse")) return;
                  if ("pointerType" in pointer && pointer.pointerType === "touch" && touchId !== pokemon.pokemonRowid) {
                    setHoveredId(null);
                    setFocusedId(null);
                    setTouchId(pokemon.pokemonRowid);
                    return;
                  }
                  pick(pokemon, index, event.detail === 0);
                }}
              >
                <span className="starter-trace" aria-hidden="true">
                  <span className="starter-prints"><i /><i /><i /></span>
                  <span className="starter-leaves"><i /><i /><i /></span>
                </span>
                <span className="starter-trace-tag">{trails[index].place}</span>
                {activeIndex === index && <span className="starter-invite" aria-hidden="true">동료로 맞이하기</span>}
              </button>
            );
          })}

          {!revealed && arrival && newestMember && (
            <div className="starter-arrival" key={round} style={trailPosition(arrival)} aria-hidden="true">
              <img src={SPRITE(newestMember.pokemon)} alt="" />
              <span>{newestMember.pokemon.nameKr} 영입</span>
            </div>
          )}

          {revealed && (
            <TrainerRevealScreen
              trainer={trainer}
              onContinue={enterBase}
            />
          )}
        </div>

        <div className={revealed ? "draft-controls" : "starter-journal field-note-paper"}>
          {!revealed && (
            <aside id="starter-notes" className="starter-note" aria-labelledby="starter-note-title"
              aria-live="polite" aria-atomic="true">
              <h2 id="starter-note-title">{trace?.place ?? "공터에서 들리는 세 기척"}</h2>
              {active ? (
                <dl id="starter-clues" className="starter-clues">
                  <div className="starter-type-clue"><dt>타입 단서</dt><dd>{active.shownType}</dd></div>
                  <div><dt>키</dt><dd>{active.pokemon.heightM == null ? "미확인" : `${active.pokemon.heightM} m`}</dd></div>
                  <div><dt>몸무게</dt><dd>{active.pokemon.weightKg == null ? "미확인" : `${active.pokemon.weightKg} kg`}</dd></div>
                </dl>
              ) : null}
              <p className="draft-keys">{active ? "클릭 또는 Enter로 영입" : "마우스나 Tab으로 기척 살피기"}</p>
              <p className="draft-touch-hint">{active ? "같은 자리를 다시 눌러 영입" : "기척이 들리는 자리를 눌러 살피기"}</p>
            </aside>
          )}
          <div className={revealed ? "draft-roster" : "draft-roster starter-roster"}>
            <h2>{revealed ? "동료 등록" : "동료 영입"} <b>{state.roster.length}/3</b></h2>
            <ol aria-label="선택한 동료">
              {trails.map((_, index) => {
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
            <span className="starter-recruit-status" role="status">
              {arrival && newestMember ? `${newestMember.pokemon.nameKr} 영입 · ${round}/3` : ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
