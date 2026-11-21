import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import forest from "../../assets/observatory-forest.webp";
import BaseDialog from "../components/BaseDialog";
import EntryModal from "../components/EntryModal";
import PokemonBattleProfile from "../components/PokemonBattleProfile";
import ScanMeasurements from "../components/ScanMeasurements";
import useFieldMotion from "../components/useFieldMotion";
import { isRapidPointerRepeat, readPointerClick, type PointerClick } from "../components/pointerClick";
import { effectiveAttack, effectiveness, pickMoveset } from "../domain/battle";
import { resolveCapture, type CaptureResult } from "../domain/capture";
import { HINT_DECAY, WRONG_DECAY, nextProfessorTopic, professorTopics, type ClueNote } from "../domain/identification";
import { trainerRelation, TRAINER_RELATION_MODIFIER } from "../domain/trainerAffinity";
import { hasPokemonType, HUNT_ENERGY_COST, jobDefinitions, jobIds, type JobId } from "../domain/jobs";
import { canOperateSettlement, HOME_SITE, settlementName } from "../domain/settlements";
import type { PokemonRecord, RosterMember } from "../domain/types";
import { worldMapNodes } from "../domain/worldMap";
import { DEX_REWARDS, endingReady } from "../game/campaign";
import { useGame } from "../game/GameProvider";
import { ART, createMember, SPRITE } from "../game/gameHelpers";
import { canContinueHunt, canOfferJob } from "../game/gameReducer";
import type { FacilityOpening, GameState } from "../game/gameTypes";
import { preparedTypeLabel } from "../game/territoryReadiness";
import { buildings, QuickChargeButton } from "./BasePanels";
import transitionFieldView from "./transitionFieldView";
import "./FieldOptics.css";
import "./IdentifyScreen.css";

const LensShader = lazy(() => import("../components/HuntOpticsShader").catch(() => ({ default: () => null })));
const lensCenter = { x: .5, y: .52 };
const outcomes = {
  captured: "포획 성공",
  fled: "정체 확인 · 포획 실패",
  giveup: "식별 포기",
};

function placementHint(state: GameState, member: RosterMember, jobs: JobId[]): { text: string; opening?: FacilityOpening } | null {
  if (!jobs.length || state.counterHunt) return null;

  const returnSite = state.siteViewId ?? HOME_SITE;
  const site = canOperateSettlement(state, returnSite) ? returnSite : HOME_SITE;
  const place = site === HOME_SITE ? "본거지" : settlementName(site);
  const facilityTypes = [...new Set(jobs.map(id => jobDefinitions[id].building))];
  const facilities = state.buildings.filter(building =>
    (building.siteId ?? HOME_SITE) === site && facilityTypes.some(type => type === building.type)
  ).sort((a, b) => a.plotIndex - b.plotIndex);

  for (const facility of facilities) {
    const jobId = jobs.find(id => canOfferJob(state, facility, member, id));
    if (!jobId) continue;
    const job = jobDefinitions[jobId];
    return { text: `${place} ${facility.plotIndex + 1}번 부지에 있는 ${buildings[job.building].label}에서 ${job.name} 직무를 열어 배치할 수 있어요.`,
      opening: { buildingId: facility.id, memberId: member.id, jobId } };
  }
  const construction = facilities.find(building => building.status === "constructing");
  const job = jobs.map(id => jobDefinitions[id]).find(item => item.building === construction?.type);
  if (construction && job) return { text: `${place} ${construction.plotIndex + 1}번 부지의 ${buildings[job.building].label}이 완공되면 ${job.name} 직무에 배치할 수 있어요.` };
  if (facilities.length) return { text: `${place}에 맞는 직무 자리가 가득 찼습니다.` };
  const labels = facilityTypes.map(type => buildings[type].label).join(" · ");
  return { text: `${place} 건설 메뉴에서 다음 시설을 지으면 직무에 배치할 수 있어요. ${labels}` };
}

function Analysis({ pokemon }: { pokemon: PokemonRecord }) {
  const { state, data, dispatch } = useGame();
  const motion = useFieldMotion();
  const [candidate] = useState(() => {
    const trainer = data.trainers.find(entry => entry.id === state.trainerId);
    const relation = trainer ? trainerRelation(trainer, pokemon, data.pokemon, data.types) : "neutral";
    return createMember(pokemon, state.nextMemberId, pokemon.nameKr, TRAINER_RELATION_MODIFIER[relation]);
  });
  const [guess, setGuess] = useState("");
  const [clues, setClues] = useState<ClueNote[]>([]);
  const [consultation] = useState(() => professorTopics(pokemon, candidate.iv, data));
  const [attempts, setAttempts] = useState(0);
  const [result, setResult] = useState<CaptureResult | "giveup" | null>(null);
  const [recordedAtStart] = useState(() => state.caughtSpeciesIds.includes(pokemon.pokemonRowid));
  const [outcomePanel, setOutcomePanel] = useState<"profile" | "entry" | null>(null);
  const captureResolved = useRef(false);
  const composingGuess = useRef(false);
  const lastAnalysisClick = useRef<PointerClick>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const outcome = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const journal = useRef<HTMLDetailsElement>(null);
  const nextHunt = useRef<HTMLButtonElement>(null);
  const compared = clues.some(clue => clue.topic === "본인확인서");
  const nextConsultation = nextProfessorTopic(consultation, clues);
  const favor = Math.max(candidate.favFloor, candidate.favor - clues.length * HINT_DECAY - attempts * WRONG_DECAY);
  const probability = Math.round(favor);
  const identified = result === "captured" || result === "fled";
  const artwork = identified || (compared && !result);
  const imageMode = identified ? "identified" : artwork ? "silhouette" : "signal";
  const scan = state.selectedScan;
  const detailAt = { x: scan?.x ?? .5, y: scan?.y ?? .57 };
  const anonymous = scan ? `미확인 개체 ${scan.number}` : "미확인 개체";
  const name = identified ? pokemon.nameKr : anonymous;
  const status = result ? outcomes[result] : compared ? "외곽 대조 완료" : "대상 고정";
  const types = [pokemon.type1Rowid, pokemon.type2Rowid].map(id => data.types.find(type => type.typeRowid === id)?.nameKr)
    .filter((name, index, all): name is string => Boolean(name) && all.indexOf(name) === index);
  const jobs = jobIds.filter(id => hasPokemonType(pokemon, jobDefinitions[id].typeId));
  const counter = state.counterHunt;
  const counterSite = counter && worldMapNodes.find(site => site.id === counter.territoryId);
  const counterMove = counter && result === "captured"
    ? effectiveAttack(pickMoveset(pokemon, candidate.level, data), counter.typeIds, data) : undefined;
  const inEntry = state.entryOrder.includes(candidate.id);
  const nextPlacement = result === "captured" ? placementHint(state, candidate, jobs) : null;
  const opening = nextPlacement?.opening && (state.endingSeen || !endingReady(state)) ? nextPlacement.opening : undefined;
  const dexCount = state.caughtSpeciesIds.length;
  const reachedReward = !recordedAtStart && DEX_REWARDS.find(reward => reward.threshold === dexCount);
  const nextReward = DEX_REWARDS.find(reward => reward.threshold > dexCount);
  const lensStyle = {
    "--scan-source-x": `${detailAt.x * 100}%`,
    "--scan-source-y": `${detailAt.y * 100}%`,
    "--scan-center-x": `${lensCenter.x * 100}%`,
    "--scan-center-y": `${lensCenter.y * 100}%`,
  } as CSSProperties;

  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (result) outcome.current?.focus();
  }, [result]);
  useEffect(() => {
    if (journal.current) journal.current.open = clues.length > 0 && !result;
  }, [clues.length, result]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepInputVisible = () => {
      const element = form.current;
      if (element?.contains(document.activeElement)) element.scrollIntoView({ block: "nearest" });
    };
    viewport.addEventListener("resize", keepInputVisible);
    return () => viewport.removeEventListener("resize", keepInputVisible);
  }, []);

  function addClue(topic: string, text: string) {
    // Two activations before the journal updates refer to the same visible offer.
    setClues(current => current.length === clues.length ? [...current, { topic, text }] : current);
  }

  function consult() {
    if (!nextConsultation) return;
    const { name, options } = nextConsultation;
    const text = options.length === 1 ? options[0] : options[Math.floor(Math.random() * options.length)];
    addClue(name, text);
  }

  function compareSilhouette() {
    if (!compared) addClue("본인확인서", "본인확인서에서 외곽 실루엣을 대조했습니다.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result || captureResolved.current || composingGuess.current || !guess.trim()) return;
    if (guess.trim() !== pokemon.nameKr) {
      setAttempts(current => current === attempts ? current + 1 : current);
      return;
    }
    captureResolved.current = true;
    const capture = resolveCapture(favor);
    if (capture === "captured") dispatch({ type: "ADD_MEMBER", member: { ...candidate, favor } });
    setResult(capture);
  }

  function leaveExploration(opening?: FacilityOpening) {
    transitionFieldView(() => dispatch({ type: "END_HUNT", opening }));
  }

  return (
    <section className="draft-station identify-station field-brass-station" aria-labelledby="identify-title"
      onClickCapture={event => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (!button) return;
        const click = readPointerClick(event);
        if (isRapidPointerRepeat(lastAnalysisClick.current, click)) {
          event.preventDefault();
          event.stopPropagation();
        } else lastAnalysisClick.current = button.matches("[data-identify-action]:not(:disabled, [aria-disabled=true])") ? click : null;
      }}
      onKeyDown={event => {
        if (event.target instanceof HTMLButtonElement && event.repeat && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
        }
      }}>
      <div className="draft-device">
        <div className="identify-layout">
          <div className="draft-view identify-view" role="group" aria-label="확대 렌즈" style={lensStyle} data-result={result}>
            <div className="identify-crop">
              <img src={forest} alt="" width={1568} height={882} fetchPriority="high" />
            </div>
            {motion && (
              <div className="identify-lens-glass" aria-hidden="true">
                <Suspense fallback={null}>
                  <LensShader image={forest} imageAspect={1568 / 882} center={lensCenter} detailAt={detailAt}
                    focus={imageMode === "signal" && !result ? 1 : 0} />
                </Suspense>
              </div>
            )}
            <header className="draft-view-header">
              <div className="draft-mission">
                <span className="draft-location">{counterSite ? `${counterSite.name} 대응 탐색` : "숲 공터"}</span>
                <h1 id="identify-title" ref={title} tabIndex={-1}>개체 식별</h1>
              </div>
              <p className="draft-observation-status" data-locked={!result || result === "captured"}>
                <span className="draft-status-light" aria-hidden="true" />
                {status}
              </p>
            </header>
            <div className="identify-optics field-optic-bezel" aria-hidden="true"><div className="field-optic-rim" /></div>
            <div className="identify-subject" data-mode={imageMode}>
              {artwork ? <img
                className="identify-target-art"
                src={ART(pokemon.pokemonRowid)}
                alt={identified ? pokemon.nameKr : ""}
                decoding="sync"
                draggable={false}
              /> : !result && <span className="identify-trace field-optic-trace" aria-hidden="true" />}
            </div>
            <p className="identify-lens-label">{name}</p>
          </div>

          <aside className="identify-console field-note-paper" aria-labelledby="analysis-title">
            <header className="identify-console-header">
              <h2 id="analysis-title">개체 분석</h2>
            </header>
            <div className="identify-observation" role="group" aria-label="야외 관측 기록">
              <ScanMeasurements pokemon={pokemon} shownType={state.selectedTypeName ?? "미확인"} />
            </div>
            <div className="identify-chance">
              <div><label htmlFor="capture-chance">포획률</label><strong>{probability}%</strong></div>
              <meter id="capture-chance" min={0} max={100} value={favor} />
              {!result && <p className="identify-chance-hint">
                단서 1회 −{HINT_DECAY}%p · 오답 −{WRONG_DECAY}%p · 최저 {candidate.favFloor}%
              </p>}
            </div>

            {result ? (
              <div className="identify-outcome" data-result={result}>
                <div className="identify-outcome-heading">
                  {identified && <img src={SPRITE(pokemon)} alt="" />}
                  <div>
                    <h3 ref={outcome} tabIndex={-1}>{outcomes[result]}</h3>
                    {identified && <p className="identify-outcome-name">{name}</p>}
                  </div>
                </div>
                <p>{result === "captured" ? `${types.join(" · ")} · 초기 우호도 ${probability}`
                  : result === "fled" ? `정체를 확인했지만 포획률 ${probability}%의 판정에서 도주했습니다.`
                    : "정체를 확인하지 못한 채 탐험을 종료했습니다."}</p>
                {result === "captured" && <>
                  <div className="identify-dex-record" role="group" aria-label="도감 기록" data-new={!recordedAtStart}>
                    <div>
                      <strong>{recordedAtStart ? "도감에 기록된 종" : "도감 신규 등록"}</strong>
                      <span>누적 {dexCount}종</span>
                    </div>
                    {reachedReward ? <p>{reachedReward.threshold}종 보상 달성 · 목표·도감에서 확인</p>
                      : nextReward && <p>다음 보상까지 {nextReward.threshold - dexCount}종</p>}
                  </div>
                  {jobs.length > 0 && <p className="identify-outcome-jobs">가능 직무 · {jobs.map(id => jobDefinitions[id].name).join(" · ")}</p>}
                  {nextPlacement && <p className="identify-placement-hint">{nextPlacement.text}</p>}
                  {counter && <div className="identify-counter-reading" role="group" aria-label="거점 대응 기술">
                    <strong>{preparedTypeLabel(counter.typeIds, data)} 대응 기술</strong>
                    <p>{counterMove ? `${counterMove.name} · 상성 ${effectiveness(counterMove.typeRowid, counter.typeIds, data)}배`
                      : `Lv.${candidate.level} · 유효한 일반 공격 없음`}</p>
                  </div>}
                  <div className="identify-outcome-actions">
                    {counterMove && <button className="hunt-return identify-profile-button" type="button" aria-haspopup="dialog"
                      onClick={() => setOutcomePanel("entry")}>{inEntry ? "엔트리 확인" : "새 동료 편성"} <span aria-hidden="true">→</span></button>}
                    {opening && <button className="hunt-return identify-profile-button" type="button" aria-haspopup="dialog" onClick={() => leaveExploration(opening)}>
                      {buildings[jobDefinitions[opening.jobId].building].label} 배치 준비 <span aria-hidden="true">→</span>
                    </button>}
                    <button className="hunt-return identify-profile-button" type="button" aria-haspopup="dialog"
                      onClick={() => setOutcomePanel("profile")}>새 동료 보기 <span aria-hidden="true">→</span></button>
                  </div>
                </>}
              </div>
            ) : (
              <div className="identify-tools" aria-label="단서 조회" role="group">
                <button data-identify-action aria-disabled={!nextConsultation} onClick={consult}>
                  박사와 상담하기 <small>{nextConsultation ? `다음 단서 · ${nextConsultation.name}` : "상담 완료"}</small>
                </button>
                <button data-identify-action aria-disabled={compared} onClick={compareSilhouette}>
                  본인확인서 대조 <small>{compared ? "대조 완료" : "외곽 실루엣"}</small>
                </button>
              </div>
            )}

            <details className="identify-record" ref={journal}>
              <summary className="identify-record-header">
                <h3 id="identify-record-title">단서 기록 <b>{clues.length}</b></h3>
                <span role="status">오답 <b>{attempts}</b></span>
              </summary>
              <div className="identify-log" aria-live="polite">
                {clues.length > 0 ? (
                  <ol reversed>{clues.slice().reverse().map(clue => <li key={clue.text}>{clue.text}</li>)}</ol>
                ) : <p>아직 조회한 단서가 없습니다.</p>}
              </div>
            </details>

            {!result && (
              <form className="identify-form" ref={form} onSubmit={submit} onKeyDown={event => {
                if (event.key === "Enter" && (event.repeat || composingGuess.current || event.nativeEvent.isComposing)) {
                  event.preventDefault();
                }
              }}>
                <label htmlFor="identify-guess">포켓몬 이름</label>
                <div>
                  <input id="identify-guess" name="guess" value={guess} onChange={event => {
                    lastAnalysisClick.current = null;
                    setGuess(event.target.value);
                  }}
                    onCompositionStart={() => { composingGuess.current = true; }}
                    onCompositionEnd={() => { composingGuess.current = false; }}
                    autoComplete="off" spellCheck={false} placeholder="포켓몬 이름 입력" />
                  <button className="identify-submit" data-identify-action disabled={!guess.trim()}>식별</button>
                </div>
                <button type="button" className="identify-giveup" onClick={() => setResult("giveup")}>식별 포기</button>
              </form>
            )}
          </aside>
        </div>
        <footer className="identify-controls">
          <button className="hunt-return" onClick={() => leaveExploration()}><span aria-hidden="true">←</span> {state.counterHunt ? "월드맵으로" : "본거지로"}</button>
          {result && canContinueHunt(state) && <div className="identify-continue-actions">
            <QuickChargeButton requiredEnergy={HUNT_ENERGY_COST} nextAction={nextHunt} />
            <button className="hunt-return identify-profile-button" type="button" ref={nextHunt}
              disabled={state.energy < HUNT_ENERGY_COST}
              onClick={() => transitionFieldView(() => dispatch({ type: "CONTINUE_HUNT" }))}>
              탐험 계속 <small>행동력 {HUNT_ENERGY_COST}</small><span aria-hidden="true">→</span>
            </button>
          </div>}
        </footer>
        {outcomePanel === "profile" && result === "captured" && <BaseDialog title={pokemon.nameKr + " · 새 동료"} onClose={() => setOutcomePanel(null)} wide>
          <PokemonBattleProfile member={candidate} data={data} />
        </BaseDialog>}
        {outcomePanel === "entry" && result === "captured" && <EntryModal recruitedMemberId={candidate.id} onClose={() => setOutcomePanel(null)} />}
      </div>
    </section>
  );
}

export default function IdentifyScreen() {
  const { state, data } = useGame();
  const pokemon = data.pokemon.find(entry => entry.pokemonRowid === state.selectedPokemonId);
  return pokemon ? <Analysis key={pokemon.pokemonRowid} pokemon={pokemon} /> : null;
}
