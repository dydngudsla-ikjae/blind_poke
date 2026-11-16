import { useState } from "react";
import farm from "../../assets/base-farm.webp";
import restaurant from "../../assets/base-restaurant.webp";
import dojo from "../../assets/base-dojo.webp";
import workshop from "../../assets/base-workshop.webp";
import clinic from "../../assets/base-clinic.webp";
import BaseDialog from "../components/BaseDialog";
import EntryModal from "../components/EntryModal";
import { NewGameDialog } from "../components/GameNotice";
import { BASE_CONSTRUCTION_TURNS, MAX_BUILD_SPEED_WORKERS, constructionTurns, projectedConstructionTurns, type BuildingType } from "../domain/construction";
import { canUseGrowthItem, ENERGY_CHARGE_COST, ENERGY_CHARGE_GAIN, GROWTH_ITEMS, GROWTH_ITEM_ENERGY_COST, HELD_ITEMS, HELD_ITEM_COST, levelExperienceCost, RESOURCE_LABELS, turnsUntilDepartureWarning, type GrowthItem, type HeldItemId } from "../domain/economy";
import { effectiveAttack, pickMoveset } from "../domain/battle";
import { isOnFrontierDuty } from "../domain/frontierOperations";
import { canOperateSettlement, clearingSiteOf, HOME_SITE, settlementAt, settlementName } from "../domain/settlements";
import type { BuildingState, ResourceState, RosterMember } from "../domain/types";
import { useGame } from "../game/GameProvider";
import { canReassignWorker, ENERGY_PER_TURN, isFreeWorker } from "../game/gameReducer";
import { GROUND_TYPE, HUNT_ENERGY_COST, MAX_RESEARCH_WORKERS, hasPokemonType, jobDefinitions, jobIds, researcherCount, supportsJob, type JobId } from "../domain/jobs";
import { forecastGold, forecastProduction, nextResearchIncrease, type ProductionReading } from "../domain/production";
import { SPRITE, targetedPokemon } from "../game/gameHelpers";
import { nextWeaknessMove } from "../game/territoryReadiness";
import transitionFieldView from "./transitionFieldView";
import { TrainerCard } from "./TrainerRevealScreen";
import { CampaignGoals } from "./CampaignGoals";

export const buildings = {
  farm: { label: "밭", description: "씨앗을 심고 열매를 거두는 경작지", art: farm },
  restaurant: { label: "레스토랑", description: "수확물로 음식을 만들고 저장하는 곳", art: restaurant },
  dojo: { label: "훈련소", description: "전투 능력을 단련하고 성장시키는 곳", art: dojo },
  workshop: { label: "제작소", description: "재료를 캐고 가공하는 곳", art: workshop },
  clinic: { label: "치료소", description: "회복과 치료를 담당하는 곳", art: clinic },
} as const satisfies Record<BuildingType, { label: string; description: string; art: string }>;

type ResourceKey = keyof Omit<ResourceState, "items">;
export type BasePanel =
  | { kind: "build"; plot: number }
  | { kind: "construction"; buildingId: string }
  | { kind: "facility"; buildingId: string }
  | { kind: "clearing"; plot: number }
  | { kind: "pc"; memberId?: string }
  | { kind: "entry" | "shop" | "resources" | "log" | "trainer" | "goals" | "settings" };

function Workers({
  roster, selected, onToggle,
}: {
  roster: RosterMember[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (!roster.length) return <p className="base-help">배치할 수 있는 포켓몬이 없습니다.</p>;
  return (
    <div className="base-member-grid">
      {roster.map(member => (
        <button key={member.id} type="button" className="base-member" data-install-pick={member.id}
          aria-pressed={selected.includes(member.id)} onClick={() => onToggle(member.id)}>
          <img src={SPRITE(member.pokemon)} alt="" />
          <span>{member.pokemon.nameKr}</span>
        </button>
      ))}
    </div>
  );
}

function ConstructionEstimate({ count, available, energy, remaining }: { count: number; available: number; energy: number; remaining?: number }) {
  const turnsFor = (workers: number) => remaining === undefined ? constructionTurns(workers) : projectedConstructionTurns(remaining, workers);
  const turns = turnsFor(count);
  const reduction = turns - turnsFor(count + 1);

  return (
    <div className="base-construction-estimate" aria-live="polite">
      <p className="base-help">기본 {BASE_CONSTRUCTION_TURNS}턴 · 예정 인력 {count}마리 · {count ? `완공까지 ${turns}턴` : "포켓몬을 선택하세요"}</p>
      <p className="base-help">행동력 1 필요 · 현재 {energy}/{ENERGY_PER_TURN}</p>
      <p className="base-help">{count > 0 && available > 0 && reduction > 0
        ? `한 마리 더 투입하면 ${reduction}턴 단축` : `최대 ${MAX_BUILD_SPEED_WORKERS}마리까지 공기 단축`}</p>
    </div>
  );
}

function BuildPanel({ plot, siteId, onClose }: { plot: number; siteId: string; onClose: () => void }) {
  const { state, data, dispatch } = useGame();
  const [type, setType] = useState<BuildingType>("farm");
  const [selected, setSelected] = useState<string[]>([]);
  const free = state.roster.filter(member => isFreeWorker(state, member));
  const facilityJobs = jobIds.filter(id => jobDefinitions[id].building === type);

  function start() {
    if (!selected.length || state.energy < 1) return;
    dispatch({
      type: "START_BUILDING",
      building: {
        id: `building-${state.nextBuildingId}`, type, plotIndex: plot,
        ...(siteId === HOME_SITE ? {} : { siteId }),
        status: "constructing", remainingTurns: constructionTurns(selected.length),
      },
      memberIds: selected,
    });
    onClose();
  }

  return (
    <BaseDialog title={`건설 · ${plot + 1}번 부지`} onClose={onClose} wide>
      <div className="base-buildings">
        {(Object.keys(buildings) as BuildingType[]).map(id => (
          <button key={id} className="base-facility-choice" aria-pressed={type === id} onClick={() => setType(id)}>
            <img src={buildings[id].art} alt="" />
            {buildings[id].label}
          </button>
        ))}
      </div>
      <p className="base-help">{buildings[type].description}</p>
      <ul className="base-available-jobs" aria-label="시설 직무와 필요 타입">
        {facilityJobs.map(id => {
          const job = jobDefinitions[id];
          const pokemonType = data.types.find(item => item.typeRowid === job.typeId)?.nameKr;
          const owned = state.roster.some(member => hasPokemonType(member.pokemon, job.typeId));
          return <li key={id} data-owned={owned}>{job.name} <small>{pokemonType} · {owned ? "보유" : "미보유"}</small></li>;
        })}
      </ul>
      <h3>건설에 함께할 포켓몬</h3>
      <Workers roster={free} selected={selected} onToggle={id => setSelected(current =>
        current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />
      <ConstructionEstimate count={selected.length} available={free.length - selected.length} energy={state.energy} />
      <button className="base-button base-next" data-build-confirm disabled={!selected.length || state.energy < 1} onClick={start}>
        {buildings[type].label} 건설 시작
      </button>
    </BaseDialog>
  );
}

function ConstructionPanel({ building, onClose }: { building: BuildingState; onClose: () => void }) {
  const { state, dispatch } = useGame();
  const [selected, setSelected] = useState<string[]>([]);
  const workers = state.roster.filter(member => member.buildingId === building.id);
  const free = state.roster.filter(member => isFreeWorker(state, member));
  const title = buildings[building.type as BuildingType]?.label ?? "시설";
  const canOperate = canOperateSettlement(state, building.siteId);

  return (
    <BaseDialog title={`${title} · 공사 관리`} onClose={onClose}>
      <p className="base-help">{workers.length}마리 배치 · {building.remainingTurns}턴 남음 {canOperate && workers.length ? "" : "· 일시정지"}</p>
      <ul className="base-panel-list">
        {workers.map(member => (
          <li key={member.id}>
            <span>{member.pokemon.nameKr}</span>
            <button className="base-button" onClick={() => dispatch({ type: "REMOVE_BUILDER", buildingId: building.id, memberId: member.id })}>회수</button>
          </li>
        ))}
      </ul>
      {canOperate ? <><h3>추가 배치</h3>
      <Workers roster={free} selected={selected} onToggle={id => setSelected(current =>
        current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />
      <ConstructionEstimate count={workers.length + selected.length} available={free.length - selected.length} energy={state.energy} remaining={building.remainingTurns} />
      <div className="base-panel-actions">
        <button className="base-button base-next" disabled={!selected.length || state.energy < 1} onClick={() => {
          dispatch({ type: "ADD_BUILDERS", buildingId: building.id, memberIds: selected });
          setSelected([]);
        }}>추가 배치</button>
        <button className="base-button" onClick={() => {
          dispatch({ type: "CANCEL_BUILDING", buildingId: building.id });
          onClose();
        }}>공사 취소</button>
      </div></> : <p className="base-help">고립 중에는 인력만 회수할 수 있습니다.</p>}
    </BaseDialog>
  );
}

function TypeSearch({ typeId }: { typeId: number }) {
  const { state, data, dispatch } = useGame();
  const type = data.types.find(item => item.typeRowid === typeId)?.nameKr;
  const available = state.energy >= HUNT_ENERGY_COST && targetedPokemon(data.pokemon, typeId).length > 0;
  return (
    <button className="base-button base-explore" disabled={!available} onClick={() => {
      transitionFieldView(() => dispatch({ type: "START_HUNT", typeId }));
    }}>
      {type ?? "해당"} 타입 탐색 <small>행동력 {HUNT_ENERGY_COST}</small>
    </button>
  );
}

function WorkerForecast({ jobId, reading }: { jobId: JobId; reading?: ProductionReading }) {
  if (jobId === "chill") return <p className="base-help">저장 상한 +10</p>;
  if (jobId === "till") return <p className="base-help">같은 밭 열매 생산량 +20%</p>;
  const recipe = jobDefinitions[jobId].recipe;
  if (!recipe || !reading) return null;
  return (
    <p className="base-help">
      {RESOURCE_LABELS[recipe.output]} +{reading.produced} / 최대 {reading.potential}
      {recipe.input && ` · ${RESOURCE_LABELS[recipe.input.key]} −${reading.consumed}`}
      {reading.materialLimited && " · 재료 부족"}
      {reading.storageLimited && " · 저장 공간 부족"}
    </p>
  );
}

function growthCost(candy: number) {
  return `사탕 ${candy}개 · 행동력 ${candy * GROWTH_ITEM_ENERGY_COST}`;
}

function FacilityPanel({ building, onClose }: { building: BuildingState; onClose: () => void }) {
  const { state, data, dispatch } = useGame();
  const canOperate = canOperateSettlement(state, building.siteId);
  const jobs = canOperate ? jobIds.filter(id => jobDefinitions[id].building === building.type) : [];
  const [jobId, setJobId] = useState<JobId | undefined>(jobs[0]);
  const [selection, setSelection] = useState<string>();
  const production = forecastProduction(state);
  const workers = state.roster.filter(member => member.buildingId === building.id);
  const researchCount = building.type === "dojo" ? researcherCount(workers, building.id) : 0;
  const researchFull = jobId === "research" && researchCount >= MAX_RESEARCH_WORKERS;
  const eligible = jobId ? state.roster.filter(member => supportsJob(building, member.pokemon, jobId) && canReassignWorker(state, member)) : [];
  const selected = eligible.find(member => member.id === selection);
  const cost = selected?.buildingId === building.id ? 0 : 1;
  const job = canOperate && jobId ? jobDefinitions[jobId] : undefined;
  const facility = buildings[building.type as BuildingType];

  return (
    <BaseDialog title={`${facility?.label ?? "시설"} · ${building.plotIndex + 1}번 부지`} onClose={onClose} wide>
      <h3>다음 턴 예상</h3>
      <ul className="base-panel-list">
        {workers.map(member => {
          const work = member.jobId ? jobDefinitions[member.jobId] : undefined;
          const increase = member.jobId === "research" && production.workers.has(member.id) ? nextResearchIncrease(member) : null;
          return (
            <li key={member.id}>
              <div>
                <b>{member.pokemon.nameKr}</b> · {work?.name ?? "대기"}
                {canOperate && member.jobId && <WorkerForecast jobId={member.jobId} reading={production.workers.get(member.id)} />}
                {increase && <p className="base-help"><b>Lv.{increase.level}</b>부터 턴당 최대 사탕 {increase.current} → {increase.potential}개 · {growthCost(increase.candy)}</p>}
              </div>
              <button className="base-button" aria-label={`${member.pokemon.nameKr} 회수`} onClick={() => {
                dispatch({ type: "RELEASE_WORKER", buildingId: building.id, memberId: member.id });
              }}>회수</button>
            </li>
          );
        })}
      </ul>
      {!workers.length && <p className="base-help">이 시설에 배치된 포켓몬이 없습니다.</p>}
      {building.type === "dojo" && <p className="base-help" role="status">육성 연구 {researchCount}/{MAX_RESEARCH_WORKERS}마리</p>}
      {canOperate ? <h3>직무 배치</h3> : <p className="base-help">고립 · 생산 중단 · 인력 회수 가능</p>}
      <div className="base-panel-actions" role="group" aria-label="시설 직무">
        {jobs.map(id => {
          const definition = jobDefinitions[id];
          const type = data.types.find(item => item.typeRowid === definition.typeId)?.nameKr;
          return (
            <button className="base-button base-job-choice" key={id} aria-pressed={id === jobId} onClick={() => {
              setJobId(id);
              setSelection(undefined);
            }}>{definition.name} <small>{type} 타입</small></button>
          );
        })}
      </div>
      {job && jobId && (
        <>
          <p className="base-help">{job.description}</p>
          {researchFull && <p className="base-help">연구 자리가 가득 찼습니다. 새 연구원은 다른 훈련소에 배치할 수 있습니다.</p>}
          <p className="base-help">레벨·특수능력·지닌 도구가 생산량에 반영됩니다.</p>
          {eligible.length > 0 ? (
            <>
              <Workers roster={eligible} selected={selected ? [selected.id] : []} onToggle={setSelection} />
              {selected && <p className="base-help">
                Lv.{selected.level} · 특수능력 {selected.aptitude}/100
                {selected.heldItem && ` · ${HELD_ITEMS[selected.heldItem as HeldItemId]?.name ?? "도구 장착"}`}
                {selected.buildingId && selected.buildingId !== building.id &&
                  ` · ${(state.buildings.find(item => item.id === selected.buildingId)?.plotIndex ?? 0) + 1}번 부지에서 이동`}
              </p>}
              <button className="base-button base-next"
                disabled={!selected || researchFull || (selected.buildingId === building.id && selected.jobId === jobId) || state.energy < cost}
                onClick={() => {
                  if (selected) dispatch({ type: "ASSIGN_JOB", buildingId: building.id, memberId: selected.id, jobId });
                }}>직무 배치 {selected && `· 행동력 ${cost}`}</button>
            </>
          ) : (
            <p className="base-help">{state.roster.some(member => hasPokemonType(member.pokemon, job.typeId))
              ? "적합한 포켓몬이 공사 또는 개척 중입니다." : "적합한 포켓몬을 찾아 배치하세요."}</p>
          )}
          <TypeSearch typeId={job.typeId} />
        </>
      )}
    </BaseDialog>
  );
}

function ClearingPanel({ plot, siteId, onClose }: { plot: number; siteId: string; onClose: () => void }) {
  const { state, dispatch } = useGame();
  const [selection, setSelection] = useState<string>();
  const ground = state.roster.filter(member => hasPokemonType(member.pokemon, GROUND_TYPE));
  const eligible = ground.filter(member => canReassignWorker(state, member));
  const digging = state.roster.find(member => member.id === settlementAt(state, siteId)?.clearing?.memberId);
  const canOperate = canOperateSettlement(state, siteId);

  return (
    <BaseDialog title={`땅 평탄화 · ${plot + 1}번 부지`} onClose={onClose}>
      {digging ? <>
        <p className="base-help">{digging.pokemon.nameKr} 작업 중 · {canOperate ? "다음 턴에 개척 완료" : "고립으로 평탄화 중단"}</p>
        {siteId !== HOME_SITE && <button className="base-button" onClick={() => {
          dispatch({ type: "RECALL_CLEARER", siteId, memberId: digging.id });
          onClose();
        }}>인력 회수</button>}
      </> : canOperate ? (
        <>
          <p className="base-help">땅 타입 한 마리를 행동력 1로 배치합니다. 다음 턴에 부지가 열리고 포켓몬이 돌아옵니다.</p>
          {eligible.length ? (
            <>
              <Workers roster={eligible} selected={selection ? [selection] : []} onToggle={setSelection} />
              <button className="base-button base-next" disabled={!selection || state.energy < 1} onClick={() => {
                if (selection) dispatch({ type: "START_CLEARING", plotIndex: plot, memberId: selection, siteId });
              }}>땅 평탄화 시작</button>
            </>
          ) : ground.length ? <p className="base-help">땅 타입 포켓몬이 공사 중입니다.</p> : <TypeSearch typeId={GROUND_TYPE} />}
          {state.energy < (eligible.length ? 1 : HUNT_ENERGY_COST) && <p className="base-help">다음 턴에 행동력을 회복하세요.</p>}
        </>
      ) : <p className="base-help">보급 연결 후 평탄화할 수 있습니다.</p>}
    </BaseDialog>
  );
}

function WeaknessForecast({ member, initialTypes }: { member: RosterMember; initialTypes?: number[] }) {
  const { data } = useGame();
  const [primary, setPrimary] = useState(initialTypes?.[0] ?? 0);
  const [secondary, setSecondary] = useState(initialTypes?.[1] ?? 0);
  const target = primary ? secondary && secondary !== primary ? [primary, secondary] : [primary] : [];
  const current = target.length ? effectiveAttack(pickMoveset(member.pokemon, member.level, data), target, data, 2) : undefined;
  const next = nextWeaknessMove(member, data, target);

  return (
    <details className="base-weakness" open={initialTypes ? true : undefined}>
      <summary>약점 기술 확인</summary>
      <div className="base-weakness-types">
        <label>상대 타입
          <select value={primary} onChange={event => {
            const type = Number(event.target.value);
            setPrimary(type);
            if (type === secondary) setSecondary(0);
          }}>
            <option value={0}>선택</option>
            {data.types.map(type => <option key={type.typeRowid} value={type.typeRowid}>{type.nameKr}</option>)}
          </select>
        </label>
        <label>두 번째 타입
          <select value={secondary} disabled={!primary} onChange={event => setSecondary(Number(event.target.value))}>
            <option value={0}>없음</option>
            {data.types.filter(type => type.typeRowid !== primary)
              .map(type => <option key={type.typeRowid} value={type.typeRowid}>{type.nameKr}</option>)}
          </select>
        </label>
      </div>
      {target.length > 0 && (
        <div aria-live="polite">
          <p className="base-help">{current ? `현재 약점 기술 · ${current.name}` : "현재 약점 기술 없음"}</p>
          <p className="base-help">{next
            ? <><b>Lv.{next.level} {next.move.name}</b> · {growthCost(next.candy)}</>
            : "이후 배울 약점 기술 없음"}</p>
        </div>
      )}
    </details>
  );
}

export function PcPanel({ onClose, initialMemberId, initialTargetTypes }: {
  onClose: () => void; initialMemberId?: string; initialTargetTypes?: number[];
}) {
  const { state, dispatch } = useGame();
  const [selected, setSelected] = useState(initialMemberId ?? state.roster[0]?.id);
  const member = state.roster.find(item => item.id === selected);
  const warningIn = member ? turnsUntilDepartureWarning(member) : null;
  const included = member ? state.entryOrder.includes(member.id) : false;
  const facility = state.buildings.find(building => building.id === member?.buildingId);
  const clearingSite = member && clearingSiteOf(state, member.id);
  const job = facility?.status === "active" ? member?.jobId : null;
  const assignment = member && isOnFrontierDuty(state.frontier, member.id) ? "전선 파견 중"
    : clearingSite ? `${clearingSite === HOME_SITE ? "" : settlementName(clearingSite) + " · "}땅 평탄화 중` : facility
    ? `${facility.siteId && facility.siteId !== HOME_SITE ? settlementName(facility.siteId) + " · " : ""}${facility.plotIndex + 1}번 부지 · ${facility.status === "constructing" ? "공사 중" : member?.jobId ? jobDefinitions[member.jobId].name : "대기"}`
    : "미배정";

  return (
    <BaseDialog title={`보유 포켓몬 · ${state.roster.length}마리`} onClose={onClose} wide>
      {state.roster.length ? <Workers roster={state.roster} selected={selected ? [selected] : []} onToggle={setSelected} />
        : <p className="base-help">보유 포켓몬이 없습니다. 탐험에서 새 동료를 포획할 수 있습니다.</p>}
      {member && (
        <>
          <h3>{member.pokemon.nameKr} <span className="base-number">Lv.{member.level}</span></h3>
          <p className="base-help">우호도 {Math.round(member.favor)}/{member.favCeil} (이탈 경계 {member.favFloor}) · 경험치 {member.exp}/{levelExperienceCost(member.level)} · 특수능력 {member.aptitude}/100</p>
          {warningIn === 0 && <p className="base-supply-warning" role="status">다음 턴 이탈 예정 · 음식이나 회복 아이템으로 우호도를 올리거나 기합의띠를 장착하세요.</p>}
          {warningIn !== null && warningIn > 0 && <p className="base-help">이탈 경고까지 {warningIn}턴 · 치료소에서 회복 아이템을 생산할 수 있습니다.</p>}
          {member.heldItem === "focus_sash" && <p className="base-help" role="status">기합의띠로 이탈 방지 중</p>}
          <div className="base-member-assignment">
            <p className="base-help">{assignment}</p>
            {job && <WorkerForecast jobId={job} reading={forecastProduction(state).workers.get(member.id)} />}
          </div>
          <WeaknessForecast member={member} initialTypes={initialTargetTypes} />
          <p className="base-help">성장 아이템 사용 · 행동력 {GROWTH_ITEM_ENERGY_COST} 필요 · 현재 {state.energy}/{ENERGY_PER_TURN}</p>
          <div className="base-panel-actions">
            <button className="base-button" disabled={!included && state.entryOrder.length >= state.entryCap} onClick={() => {
              const memberIds = included ? state.entryOrder.filter(id => id !== member.id) : [...state.entryOrder, member.id];
              dispatch({ type: "SET_ENTRY_ORDER", memberIds });
            }}>{included ? "엔트리 해제" : "엔트리 등록"}</button>
            {(Object.keys(GROWTH_ITEMS) as GrowthItem[]).map(item => (
              <button key={item} className="base-button" disabled={!canUseGrowthItem(state, member, item)}
                onClick={() => dispatch({ type: "USE_GROWTH_ITEM", memberId: member.id, item })}>{GROWTH_ITEMS[item].action}</button>
            ))}
          </div>
          <h3>도구</h3>
          <p className="base-help">{HELD_ITEMS[member.heldItem as HeldItemId]?.name ?? "미장착"} · 보유 부품 {state.resources.tool}</p>
          <ul className="base-panel-list">
            {(Object.keys(HELD_ITEMS) as HeldItemId[]).map(id => (
              <li key={id}>
                <div><b>{HELD_ITEMS[id].name}</b><br /><small>{HELD_ITEMS[id].desc} · 보관 {state.resources.items[id] ?? 0}</small></div>
                <div className="base-panel-actions">
                  <button className="base-button" disabled={state.resources.tool < HELD_ITEM_COST}
                    onClick={() => dispatch({ type: "CRAFT_HELD_ITEM", item: id })}>제작 {HELD_ITEM_COST}</button>
                  <button className="base-button" disabled={member.heldItem === id || (state.resources.items[id] ?? 0) < 1}
                    onClick={() => dispatch({ type: "EQUIP_HELD_ITEM", memberId: member.id, item: id })}>{member.heldItem === id ? "장착 중" : "장착"}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </BaseDialog>
  );
}

export function GoldForecast({ reading, label = "다음 턴 자금", id, hint }: {
  reading: ReturnType<typeof forecastGold>; label?: string; id?: string; hint?: string;
}) {
  return (
    <div className="base-gold-forecast" id={id} role="group" aria-label={label}>
      <strong>{label}</strong>
      <span>받을 자금 <b>+{reading.received}</b></span>
      <span data-overflow={reading.overflow > 0}>상한으로 못 받는 자금 <b>{reading.overflow}</b></span>
      {hint && <p className="base-gold-hint">{hint}</p>}
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { startNewGame } = useGame();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <BaseDialog title="설정" onClose={onClose}>
        <div className="base-panel-actions">
          <button className="base-button" aria-haspopup="dialog" onClick={() => setConfirm(true)}>데이터 초기화</button>
        </div>
      </BaseDialog>
      {confirm && <NewGameDialog onClose={() => setConfirm(false)} onConfirm={startNewGame} />}
    </>
  );
}

function ShopPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useGame();
  const gold = state.resources.gold;
  const canBuy = gold >= ENERGY_CHARGE_COST && state.energy < ENERGY_PER_TURN;
  const reading = forecastGold(state);
  const purchaseReading = canBuy ? forecastGold({ ...state, resources: { ...state.resources, gold: gold - ENERGY_CHARGE_COST } }) : null;
  return (
    <BaseDialog title={`상점 · 자금 ${gold}`} onClose={onClose}>
      <ul className="base-panel-list"><li>
        <div><strong>에너지 충전권 · 자금 {ENERGY_CHARGE_COST}</strong>
          <p className="base-help">행동력 +{Math.min(ENERGY_CHARGE_GAIN, ENERGY_PER_TURN - state.energy)} · 현재 {state.energy}/{ENERGY_PER_TURN}</p></div>
        <button className="base-button" disabled={!canBuy}
          onClick={() => dispatch({ type: "BUY_ENERGY_CHARGE" })}>구매</button>
      </li></ul>
      <div className="base-shop-forecast" aria-live="polite">
        <p className="base-help">다음 턴 자금 저장 상한 {reading.storageCap}</p>
        <GoldForecast reading={reading} />
        {purchaseReading && <>
          <GoldForecast label="구매 후 다음 턴 자금" reading={purchaseReading} />
          <p className="base-help">다음 턴 예상 잔액 · 바로 넘기면 {gold + reading.received} · 충전권 구매 후 {gold - ENERGY_CHARGE_COST + purchaseReading.received}</p>
        </>}
      </div>
      {state.energy < HUNT_ENERGY_COST && <p className="base-help">
        {canBuy ? "지금 행동력이 더 필요하면 충전권을 살 수 있습니다." : "충전권 구매에 필요한 자금이 부족합니다."}
        {" 다음 턴에는 행동력이 "}{ENERGY_PER_TURN}까지 회복됩니다.
      </p>}
    </BaseDialog>
  );
}

export function BasePanels({ panel, siteId = HOME_SITE, onClose }: { panel: BasePanel; siteId?: string; onClose: () => void }) {
  const { state, data, dispatch } = useGame();
  if (panel.kind === "build") return <BuildPanel plot={panel.plot} siteId={siteId} onClose={onClose} />;
  if (panel.kind === "construction") {
    const building = state.buildings.find(item => item.id === panel.buildingId);
    return building ? <ConstructionPanel building={building} onClose={onClose} /> : null;
  }
  if (panel.kind === "facility") {
    const building = state.buildings.find(item => item.id === panel.buildingId);
    return building?.status === "active" ? <FacilityPanel building={building} onClose={onClose} /> : null;
  }
  if (panel.kind === "clearing") return <ClearingPanel plot={panel.plot} siteId={siteId} onClose={onClose} />;
  if (panel.kind === "pc") return <PcPanel initialMemberId={panel.memberId} onClose={onClose} />;
  if (panel.kind === "goals") return <CampaignGoals onClose={onClose} />;
  if (panel.kind === "settings") return <SettingsPanel onClose={onClose} />;
  if (panel.kind === "trainer") {
    const trainer = data.trainers.find(item => item.id === state.trainerId);
    return <BaseDialog title="트레이너 카드" onClose={onClose} wide><TrainerCard trainer={trainer} /></BaseDialog>;
  }
  if (panel.kind === "entry") return <EntryModal onClose={onClose} />;
  if (panel.kind === "log") {
    return (
      <BaseDialog title="턴 기록" onClose={onClose}>
        {state.lastLog.length ? <ul className="base-panel-list">{state.lastLog.map((line, index) => <li key={index}>{line}</li>)}</ul>
          : <p className="base-help">아직 진행한 턴이 없습니다.</p>}
      </BaseDialog>
    );
  }
  if (panel.kind === "shop") return <ShopPanel onClose={onClose} />;
  return (
    <BaseDialog title={`자원 현황 · 저장 상한 ${state.storageCap}`} onClose={onClose}>
      <dl className="base-resources">
        {(Object.keys(RESOURCE_LABELS) as ResourceKey[]).map(key => (
          <div key={key}><dt>{RESOURCE_LABELS[key]}</dt><dd>{state.resources[key]}</dd></div>
        ))}
      </dl>
    </BaseDialog>
  );
}
