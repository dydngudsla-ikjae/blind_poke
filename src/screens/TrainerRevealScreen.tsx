import { useEffect, useId, useRef, useState } from "react";
import type { TrainerRecord } from "../domain/types";
import "./TrainerRevealScreen.css";

const portraits = import.meta.glob<string>("../../assets/trainers/*.png", {
  eager: true, query: "?url&no-inline", import: "default",
});

export function trainerPortrait(id: string) {
  return portraits[`../../assets/trainers/${id}.png`];
}
const regions: Record<string, string> = {
  Kanto: "관동", Johto: "성도", Hoenn: "호연", Sinnoh: "신오", Unova: "하나",
  Kalos: "칼로스", Alola: "알로라", Galar: "가라르", Hisui: "히스이", Paldea: "팔데아",
  Kitakami: "북신", Blueberry: "블루베리",
};

export function TrainerCard({
  trainer,
  onContinue,
}: {
  trainer?: TrainerRecord;
  onContinue?: () => void;
}) {
  const title = useId();
  const name = useRef<HTMLHeadingElement>(null);
  const [failedImage, setFailedImage] = useState<string>();
  const isReveal = Boolean(onContinue);
  useEffect(() => {
    if (isReveal) name.current?.focus({ preventScroll: true });
  }, [isReveal]);

  const types = trainer?.specialtyTypes ?? [];
  const portrait = trainer && trainerPortrait(trainer.id);
  const hasPortrait = portrait && portrait !== failedImage;

  return (
      <article className="trainer-credential" aria-labelledby={title}>
        <header className="trainer-credential-header">
          <span className="trainer-credential-mark" aria-hidden="true" />
          <span>야생 관측소 신분증</span>
        </header>
        <div className="trainer-credential-body">
          <div className="trainer-portrait">
            {trainer && hasPortrait ? (
              <img src={portrait} alt={`${trainer.nameKr} 트레이너`} fetchPriority={onContinue ? "high" : "auto"}
                onError={() => setFailedImage(portrait)} />
            ) : <span aria-hidden="true" className="trainer-portrait-placeholder" />}
          </div>
          <div className="trainer-credential-identity">
            <h2 id={title} tabIndex={onContinue ? -1 : undefined} ref={name}>{trainer?.nameKr ?? "미확인 트레이너"}</h2>
            {trainer?.nameEn && <p lang="en">{trainer.nameEn}</p>}
          <dl className="trainer-credential-data">
            <div>
              <dt>지역</dt>
              <dd>{trainer ? regions[trainer.region] ?? trainer.region : "미확인"}</dd>
            </div>
            <div>
              <dt>선호 타입</dt>
              <dd>
                {types.length ? (
                  <ul className="trainer-credential-types">
                    {types.map(type => <li key={type.id}>{type.nameKr}</li>)}
                  </ul>
                ) : "없음"}
              </dd>
            </div>
          </dl>
          </div>
        </div>
        {onContinue && <footer className="trainer-credential-footer">
          <button type="button" className="trainer-continue" onClick={onContinue}>
            본거지로 이동 <span aria-hidden="true">→</span>
          </button>
        </footer>}
      </article>
  );
}

export default function TrainerRevealScreen(props: { trainer?: TrainerRecord; onContinue: () => void }) {
  return (
    <div className="trainer-reveal-slot">
      <TrainerCard {...props} />
    </div>
  );
}
