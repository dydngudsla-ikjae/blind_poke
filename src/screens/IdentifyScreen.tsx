import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import forest from "../../assets/observatory-forest.webp";
import unknownSignal from "../../assets/unknown-presence.webp";
import DraftAtmosphere from "../components/DraftAtmosphere";
import { resolveCapture, type CaptureResult } from "../domain/capture";
import { HINT_DECAY, WRONG_DECAY, professorClues } from "../domain/identification";
import { trainerRelation, TRAINER_RELATION_MODIFIER } from "../domain/trainerAffinity";
import type { PokemonRecord } from "../domain/types";
import { useGame } from "../game/GameProvider";
import { ART, createMember } from "../game/gameHelpers";
import transitionFieldView from "./transitionFieldView";
import "./IdentifyScreen.css";

const lensCenter = { x: 50, y: 52 };
const outcomes = {
  captured: "포획 성공",
  fled: "정체 확인 · 포획 실패",
  giveup: "식별 포기",
};

function Analysis({ pokemon }: { pokemon: PokemonRecord }) {
  const { state, data, dispatch } = useGame();
  const [candidate] = useState(() => {
    const trainer = data.trainers.find(entry => entry.id === state.trainerId);
    const relation = trainer ? trainerRelation(trainer, pokemon, data.pokemon, data.types) : "neutral";
    return createMember(pokemon, state.nextMemberId, pokemon.nameKr, TRAINER_RELATION_MODIFIER[relation]);
  });
  const [guess, setGuess] = useState("");
  const [clues, setClues] = useState<string[]>([]);
  const [favor, setFavor] = useState(candidate.favor);
  const [attempts, setAttempts] = useState(0);
  const [compared, setCompared] = useState(false);
  const [result, setResult] = useState<CaptureResult | "giveup" | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const outcome = useRef<HTMLHeadingElement>(null);
  const probability = Math.round(favor);
  const identified = result === "captured" || result === "fled";
  const artwork = identified || (compared && !result);
  const imageMode = identified ? "identified" : artwork ? "silhouette" : "signal";
  const scan = state.selectedScan;
  const anonymous = scan ? `미확인 개체 ${scan.number}` : "미확인 개체";
  const name = identified ? pokemon.nameKr : anonymous;
  const status = result ? outcomes[result] : compared ? "외곽 대조 완료" : "대상 고정";
  const lensStyle = {
    "--scan-source-x": `${(scan?.x ?? .5) * 100}%`,
    "--scan-source-y": `${(scan?.y ?? .57) * 100}%`,
    "--scan-center-x": `${lensCenter.x}%`,
    "--scan-center-y": `${lensCenter.y}%`,
  } as CSSProperties;

  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (result) outcome.current?.focus();
  }, [result]);

  function addClue(text: string) {
    setClues(current => [...current, text]);
    setFavor(current => Math.max(candidate.favFloor, current - HINT_DECAY));
  }

  function consult() {
    const pool = professorClues(pokemon, candidate, data);
    addClue(pool[clues.length % pool.length]);
  }

  function compareSilhouette() {
    setCompared(true);
    addClue("본인확인서에서 외곽 실루엣을 대조했습니다.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result || !guess.trim()) return;
    if (guess.trim() !== pokemon.nameKr) {
      setAttempts(current => current + 1);
      setFavor(current => Math.max(candidate.favFloor, current - WRONG_DECAY));
      return;
    }
    const capture = resolveCapture(favor);
    if (capture === "captured") dispatch({ type: "ADD_MEMBER", member: { ...candidate, favor } });
    setResult(capture);
  }

  function leaveExploration() {
    transitionFieldView(() => dispatch({ type: "END_HUNT" }));
  }

  return (
    <section className="draft-station identify-station" aria-labelledby="identify-title">
      <div className="draft-device">
        <div className="identify-layout">
          <div className="draft-view identify-view" role="group" aria-label="확대 렌즈" style={lensStyle} data-resolved={Boolean(result)}>
            <div className="identify-crop">
              <img src={forest} alt="" width={1568} height={882} fetchPriority="high" />
            </div>
            <DraftAtmosphere
              target={result === "giveup" ? undefined : lensCenter}
              fieldScan
              analysisPass={clues.length + attempts + (identified ? 1 : 0)}
              analysisResolved={identified}
            />
            <header className="draft-view-header">
              <div className="draft-mission">
                <span className="draft-location">숲 공터</span>
                <h1 id="identify-title" ref={title} tabIndex={-1}>개체 식별</h1>
              </div>
              <p className="draft-scanner-status" data-locked={!result || result === "captured"}>
                <span className="draft-status-light" aria-hidden="true" />
                {status}
              </p>
            </header>
            <div className="identify-optics" aria-hidden="true" />
            <div className="identify-subject" data-mode={imageMode}>
              <img
                className="identify-target-art"
                src={artwork ? ART(pokemon.pokemonRowid) : unknownSignal}
                alt={identified ? pokemon.nameKr : ""}
                draggable={false}
              />
            </div>
            <p className="identify-lens-label">{name}</p>
          </div>

          <aside className="identify-console" aria-labelledby="analysis-title">
            <header className="identify-console-header">
              <h2 id="analysis-title">개체 분석</h2>
              <span>감지 타입 <b>{state.selectedTypeName ?? "미확인"}</b></span>
            </header>
            <div className="identify-chance">
              <div><label htmlFor="capture-chance">포획률</label><strong>{probability}%</strong></div>
              <meter id="capture-chance" min={0} max={100} value={favor} />
            </div>

            {result ? (
              <div className="identify-outcome" data-result={result}>
                <h3 ref={outcome} tabIndex={-1}>{outcomes[result]}</h3>
                <p className="identify-outcome-name">{name}</p>
                <p>{result === "captured" ? `우호도 ${probability}로 동료가 되었습니다.`
                  : result === "fled" ? `정체를 확인했지만 포획률 ${probability}%의 판정에서 도주했습니다.`
                    : "정체를 확인하지 못한 채 탐험을 종료했습니다."}</p>
              </div>
            ) : (
              <div className="identify-tools" aria-label="단서 조회" role="group">
                <button onClick={consult}>박사와 상담하기 <small>능력치·기술·특성·타입</small></button>
                <button onClick={() => addClue(`신체 정보: 키 ${pokemon.heightM ?? "?"} m · 몸무게 ${pokemon.weightKg ?? "?"} kg`)}>
                  직접 관찰하기 <small>키·몸무게</small>
                </button>
                <button data-compared={compared} onClick={compareSilhouette}>
                  본인확인서 대조 <small>외곽 실루엣</small>
                </button>
              </div>
            )}

            <section className="identify-record" aria-labelledby="identify-record-title">
              <div className="identify-record-header">
                <h3 id="identify-record-title">단서 기록 <b>{clues.length}</b></h3>
                <span role="status">오답 <b>{attempts}</b></span>
              </div>
              <div className="identify-log" aria-live="polite">
                {clues.length > 0 ? (
                  <ol reversed>{clues.slice().reverse().map((clue, index) => <li key={clues.length - index}>{clue}</li>)}</ol>
                ) : <p>아직 조회한 단서가 없습니다.</p>}
              </div>
            </section>

            {!result && (
              <form className="identify-form" onSubmit={submit}>
                <label htmlFor="identify-guess">포켓몬 이름</label>
                <div>
                  <input id="identify-guess" name="guess" value={guess} onChange={event => setGuess(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
                    }}
                    autoComplete="off" spellCheck={false} placeholder="포켓몬 이름 입력" />
                  <button className="identify-submit" disabled={!guess.trim()}>식별</button>
                </div>
                <button type="button" className="identify-giveup" onClick={() => setResult("giveup")}>식별 포기</button>
              </form>
            )}
          </aside>
        </div>
        <footer className="identify-controls">
          <button className="hunt-return" onClick={leaveExploration}><span aria-hidden="true">←</span> {state.counterHunt ? "월드맵으로" : "본거지로"}</button>
          <span className="draft-device-name">BlindPoke</span>
        </footer>
      </div>
    </section>
  );
}

export default function IdentifyScreen() {
  const { state, data } = useGame();
  const pokemon = data.pokemon.find(entry => entry.pokemonRowid === state.selectedPokemonId);
  return pokemon ? <Analysis key={pokemon.pokemonRowid} pokemon={pokemon} /> : null;
}
