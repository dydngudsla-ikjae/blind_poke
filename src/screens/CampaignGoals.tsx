import { useState } from "react";
import BaseDialog from "../components/BaseDialog";
import { GameNotice, NewGameDialog } from "../components/GameNotice";
import { RESOURCE_LABELS } from "../domain/economy";
import type { ResourceKey } from "../domain/jobs";
import { settlementName } from "../domain/settlements";
import { worldMapNodes } from "../domain/worldMap";
import { DEX_REWARDS, ENDING_SPECIES, INHERITED_RESEARCH_REWARD, inheritedDojoProgress, regionProgress, rewardEntries, rewardStorageShortfall } from "../game/campaign";
import { useGame } from "../game/GameProvider";

function rewardLabel(resources: Partial<Record<ResourceKey, number>>) {
  return rewardEntries(resources).map(([key, amount]) => `${RESOURCE_LABELS[key]} +${amount}`).join(" · ");
}

function storageNeededLabel(shortfall: ReturnType<typeof rewardStorageShortfall>) {
  return shortfall.map(([key, amount]) => `${RESOURCE_LABELS[key]} ${amount}`).join(" · ");
}

export function CampaignStatus({ onOpen }: { onOpen: () => void }) {
  const { state } = useGame();
  const regions = regionProgress(state.territories);
  const nextArea = regions.find(area => area.owned < area.total);
  const unclaimed = DEX_REWARDS.filter(reward => !state.claimedDexRewards.includes(reward.threshold));
  const earned = unclaimed.filter(reward => state.caughtSpeciesIds.length >= reward.threshold);
  const rewardStatus = earned.length ? earned.some(reward => !rewardStorageShortfall(state, reward.resources).length)
    ? "보상 수령 가능" : "보상 저장 공간 필요" : unclaimed[0] && `다음 보상 ${unclaimed[0].threshold}종`;

  return (
    <div className="base-campaign-status" aria-label="관측 목표">
      <p>{nextArea ? <>{nextArea.name} 확보 <b>{nextArea.owned}/{nextArea.total}</b></> : "전 지역 확보"}</p>
      <p>도감 <b>{state.caughtSpeciesIds.length}</b>종 {rewardStatus && <span>· {rewardStatus}</span>}</p>
      <button className="base-button" onClick={onOpen}>목표·도감 <span aria-hidden="true">→</span></button>
    </div>
  );
}

export function CampaignGoals({ onClose }: { onClose: () => void }) {
  const { state, data, dispatch, startNewGame } = useGame();
  const [confirm, setConfirm] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const regions = regionProgress(state.territories);
  const owned = regions.reduce((total, region) => total + region.owned, 0);
  const count = state.caughtSpeciesIds.length;
  const records = [...state.caughtSpeciesIds].sort((a, b) => a - b);
  const names = new Map(data.pokemon.map(record => [record.pokemonRowid, record.nameKr]));
  const challenge = inheritedDojoProgress(state);
  const site = challenge.siteId ? settlementName(challenge.siteId) : undefined;
  const facility = challenge.outpostRoute ? "점령지 훈련소" : "승계 훈련소";
  const rewardReady = challenge.step === "complete" && !state.inheritedResearchRewardClaimed;
  const researchShortfall = rewardReady ? rewardStorageShortfall(state, INHERITED_RESEARCH_REWARD) : [];
  const challengeHint = {
    inherit: "훈련소가 후보인 트레이너 거점을 확보하고 훈련소를 승계하세요.",
    unavailable: "승계가 남은 거점과 승계 기록이 있는 훈련소가 없습니다.",
    recapture: `${site}을 다시 확보해 훈련소를 가동하세요.`,
    supply: `${site}까지 본거지 보급로를 연결하세요.`,
    build: `${site}에 훈련소를 건설하세요.`,
    clear: `${site}에서 부지를 개척한 뒤 훈련소를 건설하세요.`,
    constructing: `${site}의 훈련소를 완공하세요.`,
    buildUnavailable: "점령지 훈련소를 마련하려면 건설 또는 개척이 가능한 거점 부지가 필요합니다.",
    assign: `${site}의 ${facility}에 육성 연구원을 배치하세요.`,
    storage: "사탕을 사용해 다음 턴에 훈련소가 생산할 공간을 확보하세요.",
    produce: `${site}의 ${facility}에서 다음 턴에 사탕을 생산합니다.`,
    complete: `보급이 연결된 ${facility}에서 경험치 사탕을 생산했습니다.`,
  }[challenge.step];

  return (
    <>
      <BaseDialog title="관측 목표와 도감" onClose={onClose}>
        <p className="base-help campaign-final-goal">최종 목표 · 거점 {owned}/{worldMapNodes.length}곳 확보 · 도감 {Math.min(count, ENDING_SPECIES)}/{ENDING_SPECIES}종 등록</p>
        <ul className="base-panel-list" aria-label="지역 확보 현황">
          {regions.map(region => <li key={region.name}><span>{region.name}</span><b className="base-number">{region.owned}/{region.total}</b></li>)}
        </ul>
        <h3>도감 보상 · {count}종 기록</h3>
        <ul className="base-panel-list" aria-label="도감 보상">
          {DEX_REWARDS.map(reward => {
            const claimed = state.claimedDexRewards.includes(reward.threshold);
            const reached = count >= reward.threshold;
            const shortfall = reached && !claimed ? rewardStorageShortfall(state, reward.resources) : [];
            return (
              <li key={reward.threshold}>
                <div><b>{reward.threshold}종 기록</b><br /><small>{rewardLabel(reward.resources)}</small>
                  {shortfall.length > 0 && <p className="base-help">필요한 저장 공간 · {storageNeededLabel(shortfall)}</p>}
                </div>
                {claimed ? <span>수령 완료</span> : reached ? (
                  <button className="base-button" disabled={shortfall.length > 0} onClick={() => dispatch({ type: "CLAIM_DEX_REWARD", threshold: reward.threshold })}>
                    {shortfall.length ? "저장 공간 부족" : "보상 받기"}
                  </button>
                ) : <span>{reward.threshold - count}종 남음</span>}
              </li>
            );
          })}
        </ul>
        <h3 id="campaign-challenges-title">선택 도전 과제</h3>
        <ul className="base-panel-list" aria-labelledby="campaign-challenges-title">
          <li>
            <div>
              <b>{facility}에서 사탕 생산하기</b>
              <p className="base-help">{challengeHint}</p>
              <small>보상 · {rewardLabel(INHERITED_RESEARCH_REWARD)}</small>
              {researchShortfall.length > 0 && <p className="base-help">필요한 저장 공간 · {storageNeededLabel(researchShortfall)}</p>}
            </div>
            <div>
              <p className="base-help base-number">{challenge.step === "complete" ? "달성"
                : ["unavailable", "buildUnavailable"].includes(challenge.step) ? "진행 불가" : "진행 중"}</p>
              {state.inheritedResearchRewardClaimed && <span role="status">수령 완료</span>}
              {rewardReady && <button className="base-button" disabled={researchShortfall.length > 0}
                onClick={() => dispatch({ type: "CLAIM_INHERITED_RESEARCH_REWARD" })}>
                {researchShortfall.length ? "저장 공간 부족" : "과제 보상 받기"}
              </button>}
            </div>
          </li>
        </ul>
        <details className="base-catalog" onToggle={event => setShowCatalog(event.currentTarget.open)}>
          <summary>기록한 포켓몬 {count}종</summary>
          {showCatalog && <ul>{records.map(id => <li key={id}><span>#{id}</span> {names.get(id) ?? "미등록 이름"}</li>)}</ul>}
        </details>
        <button className="base-button" onClick={() => setConfirm(true)}>새 게임</button>
      </BaseDialog>
      {confirm && <NewGameDialog onClose={() => setConfirm(false)} onConfirm={startNewGame} />}
    </>
  );
}

export function EndingScreen() {
  const { state, dispatch, startNewGame } = useGame();
  const [confirm, setConfirm] = useState(false);

  return (
    <GameNotice title="관측 임무 완료" focus>
      <p>함께한 포켓몬들과 모든 거점을 확보하고 도감 목표를 달성했습니다.</p>
      <p>확보 거점 <strong>{worldMapNodes.length}곳</strong> · 누적 도감 <strong>{state.caughtSpeciesIds.length}종</strong></p>
      <div className="base-panel-actions">
        <button className="base-button base-next" onClick={() => dispatch({ type: "CONTINUE_AFTER_ENDING" })}>계속 플레이</button>
        <button className="base-button" onClick={() => setConfirm(true)}>새 게임</button>
      </div>
      {confirm && <NewGameDialog onClose={() => setConfirm(false)} onConfirm={startNewGame} />}
    </GameNotice>
  );
}
