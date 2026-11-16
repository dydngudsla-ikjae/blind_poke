import { useEffect, useRef, useState, type ReactNode } from "react";
import BaseDialog from "./BaseDialog";
import "./GameNotice.css";

export function GameNotice({ title, children, focus = false }: { title: string; children: ReactNode; focus?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);

  return (
    <section className="game-notice" aria-labelledby="game-notice-title">
      <header><span>야생 관측소</span><h1 id="game-notice-title" ref={heading} tabIndex={-1}>{title}</h1></header>
      {children}
    </section>
  );
}

export function NewGameDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => boolean }) {
  const [failed, setFailed] = useState(false);

  return (
    <BaseDialog title="새 게임 시작" onClose={onClose}>
      <p>현재 포켓몬, 본거지, 도감과 월드맵 기록을 지웁니다.</p>
      <div className="base-panel-actions">
        <button className="base-button" onClick={onClose}>취소</button>
        <button className="base-button base-next" onClick={() => { if (!onConfirm()) setFailed(true); }}>기록 지우고 시작</button>
      </div>
      {failed && <p role="alert">브라우저 저장소에 접근할 수 없어 새 게임을 시작하지 못했습니다.</p>}
    </BaseDialog>
  );
}
