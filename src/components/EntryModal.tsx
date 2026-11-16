import { useState, type DragEvent } from "react";
import { useGame } from "../game/GameProvider";
import { SPRITE } from "../game/gameHelpers";
import BaseDialog from "./BaseDialog";

export default function EntryModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useGame();
  const [dragged, setDragged] = useState<string | null>(null);
  const { entryCap, entryOrder, roster } = state;
  const entryMembers = entryOrder
    .map(id => roster.find(member => member.id === id))
    .filter(member => member !== undefined);

  function setOrder(memberIds: string[]) {
    dispatch({ type: "SET_ENTRY_ORDER", memberIds });
  }

  function place(id: string, index = entryOrder.length) {
    if (!entryOrder.includes(id) && entryOrder.length >= entryCap) return;
    const next = entryOrder.filter(value => value !== id);
    next.splice(index, 0, id);
    setOrder(next);
  }

  function remove(id: string) {
    setOrder(entryOrder.filter(value => value !== id));
  }

  function startDrag(event: DragEvent, id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDragged(id);
  }

  function drop(event: DragEvent, index?: number) {
    event.preventDefault();
    if (dragged) {
      if (index === undefined) remove(dragged);
      else place(dragged, index);
    }
    setDragged(null);
  }

  return (
    <BaseDialog title={`전투 엔트리 편성 · ${entryMembers.length}/${entryCap}`} onClose={onClose} wide>
      <h3>PC</h3>
      <p className="base-help">포켓몬을 선택하거나 슬롯으로 드래그해 편성하세요.</p>
      <div className="base-member-grid" data-entry-pc onDragOver={event => event.preventDefault()} onDrop={drop}>
        {roster.map(member => {
          const index = entryOrder.indexOf(member.id);
          return (
            <button key={member.id} className="base-member" data-pc-member={member.id} aria-pressed={index >= 0}
              aria-disabled={index < 0 && entryOrder.length >= entryCap} draggable
              onDragStart={event => startDrag(event, member.id)} onDragEnd={() => setDragged(null)}
              onClick={() => index >= 0 ? remove(member.id) : place(member.id)}>
              <img src={SPRITE(member.pokemon)} alt="" />
              <span>{member.pokemon.nameKr}</span>
              {index >= 0 && <b aria-hidden="true">{index + 1}</b>}
            </button>
          );
        })}
      </div>
      <h3>출전 순서</h3>
      <p className="base-help">첫 번째 포켓몬이 선봉으로 출전합니다.</p>
      <ol className="base-entry-slots">
        {Array.from({ length: entryCap }, (_, index) => {
          const member = entryMembers[index];
          return (
            <li key={index} data-entry-slot={index} className="base-entry-slot" data-filled={Boolean(member)}
              onDragOver={event => event.preventDefault()} onDrop={event => drop(event, index)}>
              <span className="base-entry-index">{index + 1}</span>
              {member ? (
                <>
                  <div className="base-entry-member" draggable
                    onDragStart={event => startDrag(event, member.id)} onDragEnd={() => setDragged(null)}>
                    <img src={SPRITE(member.pokemon)} alt="" />
                    <span>{member.pokemon.nameKr} <small>Lv.{member.level}</small></span>
                  </div>
                  <div className="base-entry-controls">
                    <button className="base-button" aria-label={`${member.pokemon.nameKr} 앞 순서로 이동`}
                      disabled={index === 0} onClick={() => place(member.id, index - 1)}>↑</button>
                    <button className="base-button" aria-label={`${member.pokemon.nameKr} 뒤 순서로 이동`}
                      disabled={index === entryMembers.length - 1} onClick={() => place(member.id, index + 1)}>↓</button>
                    <button className="base-button" aria-label={`${member.pokemon.nameKr} 엔트리 해제`}
                      onClick={() => remove(member.id)}>×</button>
                  </div>
                </>
              ) : <span>빈 슬롯</span>}
            </li>
          );
        })}
      </ol>
    </BaseDialog>
  );
}
