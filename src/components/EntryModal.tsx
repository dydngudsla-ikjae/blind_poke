import { useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { effectiveAttack, nextOrdinaryAttack, pickMoveset } from "../domain/battle";
import { useGame } from "../game/GameProvider";
import { duplicateRosterLabels, SPRITE } from "../game/gameHelpers";
import BaseDialog from "./BaseDialog";
import { isRapidPointerRepeat, readPointerClick, type PointerClick } from "./pointerClick";

export default function EntryModal({ onClose, initialMemberId, recruitedMemberId }: {
  onClose: () => void; initialMemberId?: string; recruitedMemberId?: string;
}) {
  const { state, data, dispatch } = useGame();
  const attackNotePrefix = useId();
  const [dragged, setDragged] = useState<string | null>(null);
  const book = useRef<HTMLDivElement>(null);
  const openingCard = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<{ memberId: string; direction?: "up" | "down" } | null>(null);
  const lastClick = useRef<PointerClick>(null);
  const { entryCap, entryOrder, roster } = state;
  const memberLabels = duplicateRosterLabels(roster);
  const recruited = roster.find(member => member.id === recruitedMemberId);
  const openingMemberId = recruited?.id ?? initialMemberId;
  const displayRoster = recruited ? [recruited, ...roster.filter(member => member !== recruited)] : roster;
  const entryMembers = entryOrder
    .map(id => roster.find(member => member.id === id))
    .filter(member => member !== undefined);
  const attackNotes = useMemo(() => {
    const notes = new Map<string, string>();
    for (const { id, pokemon, level } of roster) {
      if (effectiveAttack(pickMoveset(pokemon, level, data), [], data)) continue;
      const next = nextOrdinaryAttack(pokemon, level, data);
      notes.set(id, next ? `일반 공격기 없음 · Lv.${next.level} ${next.move.name}` : "일반 공격기 없음");
    }
    return notes;
  }, [data, roster]);

  useLayoutEffect(() => {
    const request = focusRequest.current;
    const entryBook = book.current;
    if (!request || !entryBook) return;
    focusRequest.current = null;
    const index = entryOrder.indexOf(request.memberId);
    if (index < 0) {
      entryBook.querySelector<HTMLButtonElement>(`[data-pc-member="${CSS.escape(request.memberId)}"]`)?.focus();
      return;
    }
    const slot = entryBook.querySelector<HTMLLIElement>(`[data-entry-slot="${index}"]`);
    const arrow = slot?.querySelector<HTMLButtonElement>(`[data-entry-direction="${request.direction}"]:enabled`);
    (arrow ?? slot)?.focus();
  }, [entryOrder]);

  function setOrder(memberIds: string[]) {
    dispatch({ type: "SET_ENTRY_ORDER", memberIds });
  }

  function place(id: string, index = entryOrder.length, focusDirection?: "up" | "down") {
    if (!entryOrder.includes(id) && entryOrder.length >= entryCap) return;
    if (focusDirection) focusRequest.current = { memberId: id, direction: focusDirection };
    const next = entryOrder.filter(value => value !== id);
    next.splice(index, 0, id);
    setOrder(next);
  }

  function remove(id: string, focusCard = false) {
    if (focusCard) focusRequest.current = { memberId: id };
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
    <BaseDialog title={`전투 엔트리 편성 · ${entryMembers.length}/${entryCap}`} onClose={onClose} initialFocus={openingCard} wide>
      <div className="base-entry-book" ref={book}
        onClickCapture={event => {
          if (!(event.target instanceof Element) || !event.target.closest("button")) return;
          const click = readPointerClick(event);
          // Moving or removing a slot can put a different member at the same location.
          if (isRapidPointerRepeat(lastClick.current, click)) {
            event.preventDefault();
            event.stopPropagation();
          } else lastClick.current = click;
        }}
        onKeyDown={event => {
          if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}>
        <section aria-label="PC">
          <h3>PC</h3>
          <p className="base-help">포켓몬을 선택하거나 슬롯으로 드래그해 편성하세요.</p>
          {openingMemberId && !entryOrder.includes(openingMemberId) && entryOrder.length >= entryCap && (
            <p className="base-help">엔트리가 가득 찼습니다. 출전 순서에서 한 자리를 비우면 동료를 편성할 수 있습니다.</p>
          )}
          <div className="base-member-grid" data-entry-pc onDragOver={event => event.preventDefault()} onDrop={drop}>
            {displayRoster.map((member, cardIndex) => {
              const index = entryOrder.indexOf(member.id);
              const label = memberLabels.get(member.id);
              const attackNote = attackNotes.get(member.id);
              const noteId = `${attackNotePrefix}-${cardIndex}`;
              return (
                <button key={member.id} className="base-member" data-pc-member={member.id} aria-pressed={index >= 0}
                  aria-describedby={attackNote ? noteId : undefined}
                  ref={member.id === openingMemberId ? openingCard : undefined}
                  data-new-partner={member === recruited || undefined}
                  aria-disabled={index < 0 && entryOrder.length >= entryCap} draggable
                  onDragStart={event => startDrag(event, member.id)} onDragEnd={() => setDragged(null)}
                  onClick={() => index >= 0 ? remove(member.id) : place(member.id)}>
                  <img src={SPRITE(member.pokemon)} alt="" />
                  <span>{label ?? member.pokemon.nameKr}</span>
                  {label && <small className="base-member-level">Lv.{member.level}</small>}
                  {member === recruited && <small className="base-member-level">새 동료</small>}
                  {attackNote && <small className="base-entry-attack-note" id={noteId} aria-hidden="true">{attackNote}</small>}
                  {index >= 0 && <b aria-hidden="true">{index + 1}</b>}
                </button>
              );
            })}
          </div>
        </section>
        <section aria-label="출전 순서">
          <h3>출전 순서</h3>
          <p className="base-help">첫 번째 포켓몬이 선봉으로 출전합니다.</p>
          <ol className="base-entry-slots">
            {Array.from({ length: entryCap }, (_, index) => {
              const member = entryMembers[index];
              const name = member && (memberLabels.get(member.id) ?? member.pokemon.nameKr);
              const position = index === 0 ? "선봉" : `${index + 1}번 출전`;
              const attackNote = member && attackNotes.get(member.id);
              return (
                <li key={index} data-entry-slot={index} className="base-entry-slot" data-filled={Boolean(member)}
                  tabIndex={member ? -1 : undefined} aria-label={member ? `${position} · ${name}` : undefined}
                  onDragOver={event => event.preventDefault()} onDrop={event => drop(event, index)}>
                  <span className="base-entry-index">{index + 1}</span>
                  {member ? (
                    <>
                      <div className="base-entry-member" draggable
                        onDragStart={event => startDrag(event, member.id)} onDragEnd={() => setDragged(null)}>
                        <img src={SPRITE(member.pokemon)} alt="" />
                        <div className="base-entry-member-info">
                          <span>{name} <small>Lv.{member.level}</small></span>
                          {attackNote && <small className="base-entry-attack-note">{attackNote}</small>}
                        </div>
                      </div>
                      <div className="base-entry-controls">
                        <button className="base-button" type="button" aria-label={`${name} 앞 순서로 이동`} data-entry-direction="up"
                          disabled={index === 0} onClick={event => place(member.id, index - 1, event.detail === 0 ? "up" : undefined)}>↑</button>
                        <button className="base-button" type="button" aria-label={`${name} 뒤 순서로 이동`} data-entry-direction="down"
                          disabled={index === entryMembers.length - 1}
                          onClick={event => place(member.id, index + 1, event.detail === 0 ? "down" : undefined)}>↓</button>
                        <button className="base-button" type="button" aria-label={`${name} 엔트리 해제`}
                          onClick={event => remove(member.id, event.detail === 0)}>×</button>
                      </div>
                    </>
                  ) : <span>빈 슬롯</span>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </BaseDialog>
  );
}
