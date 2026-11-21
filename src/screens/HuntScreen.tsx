import { useEffect, useRef, useState, type CSSProperties } from "react";
import forest from "../../assets/observatory-forest.webp";
import focusClick from "../../assets/field-observation-detent.wav";
import HuntOptics from "../components/HuntOptics";
import ScanMeasurements from "../components/ScanMeasurements";
import { useGame } from "../game/GameProvider";
import { huntCandidates } from "../game/gameHelpers";
import { counterHuntPool, preparedTypeLabel } from "../game/territoryReadiness";
import transitionFieldView from "./transitionFieldView";
import "./FieldOptics.css";
import "./HuntScreen.css";

const positions = [
  { x: 22, y: 60 },
  { x: 50, y: 69 },
  { x: 77, y: 56 },
];
const forestWidth = 1568;
const forestHeight = 882;
const forestPositionY = .54;

export default function HuntScreen() {
  const { data, state, dispatch } = useGame();
  const request = data.types.find(type => type.typeRowid === state.huntTypeId);
  const [candidates] = useState(() => huntCandidates(data.pokemon, data.types, positions.length, state.huntTypeId,
    state.counterHunt ? counterHuntPool(data, state.counterHunt.typeIds) : undefined));
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [touchTarget, setTouchTarget] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const viewfinder = useRef<HTMLDivElement>(null);
  const latch = useRef<HTMLAudioElement>(null);
  const activeIndex = hovered ?? focused ?? touchTarget;
  const target = activeIndex === null ? undefined : positions[activeIndex];
  const active = activeIndex === null ? undefined : candidates[activeIndex];

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function playFocusClick() {
    const sound = latch.current;
    if (!sound || !navigator.userActivation?.hasBeenActive) return;
    sound.currentTime = 0;
    sound.volume = .19;
    void sound.play().catch(() => {});
  }

  function identify({ pokemon, shownType }: (typeof candidates)[number], index: number, button: HTMLButtonElement) {
    const view = viewfinder.current;
    if (!view) return;
    const { clientWidth: width, clientHeight: height } = view;
    const scale = Math.max(width / forestWidth, height / forestHeight);
    const imageWidth = forestWidth * scale;
    const imageHeight = forestHeight * scale;
    const position = positions[index];
    // Match the viewfinder's object-fit: cover and center 54% positioning.
    const x = (position.x * width / 100 + (imageWidth - width) / 2) / imageWidth;
    const y = (position.y * height / 100 + (imageHeight - height) * forestPositionY) / imageHeight;
    button.dataset.scanTransfer = "";
    transitionFieldView(() => dispatch({
      type: "PATCH",
      patch: {
        screen: "identify",
        selectedPokemonId: pokemon.pokemonRowid,
        selectedTypeName: shownType,
        selectedScan: { x, y, number: index + 1 },
      },
    }), "analysis");
  }

  return (
    <section className="draft-station hunt-station field-brass-station" aria-labelledby="hunt-title">
      <div className="draft-device">
        <div
          ref={viewfinder}
          className="draft-view hunt-view"
          role="group"
          aria-label="야생 개체 뷰파인더"
          onPointerLeave={() => setHovered(null)}
        >
          <img className="draft-landscape" src={forest} alt="" width={forestWidth} height={forestHeight} fetchPriority="high" />
          <HuntOptics target={target} image={forest} imageAspect={forestWidth / forestHeight} imagePositionY={forestPositionY} />
          <audio ref={latch} src={focusClick} preload="auto" />

          <header className="draft-view-header">
            <div className="draft-mission">
              <span className="draft-location">{state.counterHunt ? `${preparedTypeLabel(state.counterHunt.typeIds, data)} 대응 탐색`
                : request ? `${request.nameKr} 타입 탐색` : "숲 공터"}</span>
              <h1 id="hunt-title" ref={heading} tabIndex={-1}>야생 탐험</h1>
            </div>
            <div className="draft-observation-status" data-locked={Boolean(target)}>
              <span className="draft-status-light" aria-hidden="true" />
              {target ? "초점 맞음" : "초점 탐색 중"}
            </div>
          </header>

          {candidates.map((candidate, index) => {
            const { x, y } = positions[index];
            return (
              <button
                key={candidate.pokemon.pokemonRowid}
                type="button"
                className="draft-target hunt-target"
                data-locked={activeIndex === index}
                data-counter={candidate.counter || undefined}
                aria-label={`미확인 개체 ${index + 1}${candidate.counter ? " · 유효 공격 후보" : ""}`}
                style={{ "--target-x": `${x}%`, "--target-y": `${y}%` } as CSSProperties}
                onPointerEnter={event => {
                  if (event.pointerType === "mouse") {
                    setHovered(index);
                    if (activeIndex !== index) playFocusClick();
                  }
                }}
                onPointerLeave={() => setHovered(current => current === index ? null : current)}
                onFocus={event => {
                  setHovered(null);
                  setFocused(index);
                  if (activeIndex !== index && event.currentTarget.matches(":focus-visible")) playFocusClick();
                }}
                onBlur={() => setFocused(current => current === index ? null : current)}
                onClick={event => {
                  const pointer = event.nativeEvent;
                  if ("pointerType" in pointer && pointer.pointerType === "touch" && touchTarget !== index) {
                    setHovered(null);
                    setFocused(null);
                    setTouchTarget(index);
                    playFocusClick();
                    return;
                  }
                  identify(candidate, index, event.currentTarget);
                }}
              >
                <span className="hunt-optical-trace field-optic-trace" aria-hidden="true" />
              </button>
            );
          })}

          <aside className="hunt-readout field-note-paper" aria-label="관측 패널" aria-live="polite" aria-atomic="true">
            <p className="hunt-field-note-label">야외 관측표</p>
            <h2>{activeIndex === null ? "관측 대기" : `미확인 개체 ${activeIndex + 1}`}</h2>
            {active?.counter && <p className="hunt-counter-note">유효 공격 후보</p>}
            <ScanMeasurements pokemon={active?.pokemon} shownType={active?.shownType} />
            <p className="hunt-note-hint draft-touch-hint">
              {target ? "같은 흔적을 다시 눌러 식별" : "흔적을 눌러 관측"}
            </p>
          </aside>
        </div>

        <footer className="hunt-controls">
          <button className="hunt-return" id="backToBase" onClick={() => {
            transitionFieldView(() => dispatch({ type: "END_HUNT" }));
          }}>
            <span aria-hidden="true">←</span> {state.counterHunt ? "월드맵으로" : "본거지로"}
          </button>
          <p className="draft-keys">
            <span><kbd>마우스</kbd><kbd>Tab</kbd> 조준</span>
            <span><kbd>클릭</kbd><kbd>Enter</kbd> 식별</span>
          </p>
        </footer>
      </div>
    </section>
  );
}
