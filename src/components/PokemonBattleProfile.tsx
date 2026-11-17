import { battleMoves, buildCombatant, campaignLearnLevels, effectiveAttack, pickMoveset } from "../domain/battle";
import type { GameDataBundle, RosterMember } from "../domain/types";
import "./PokemonBattleProfile.css";

export function PokemonTypeBadges({ member, data }: { member: RosterMember; data: GameDataBundle }) {
  const types = [...new Set([member.pokemon.type1Rowid, member.pokemon.type2Rowid])]
    .map(id => data.types.find(type => type.typeRowid === id))
    .filter(type => type !== undefined);
  return types.length > 0 && (
    <ul className="pokemon-type-badges" aria-label="타입">
      {types.map(type => <li key={type.typeRowid} data-type={type.nameKr}>{type.nameKr}</li>)}
    </ul>
  );
}

export default function PokemonBattleProfile({ member, data, journal = false }: {
  member: RosterMember; data: GameDataBundle; journal?: boolean;
}) {
  const mon = buildCombatant(member, data, member.id);
  const current = new Set(mon.moves.map(move => move.id));
  let next;
  for (const level of campaignLearnLevels(member.pokemon, data)) {
    if (level <= member.level) continue;
    const move = effectiveAttack(pickMoveset(member.pokemon, level, data).filter(item => !current.has(item.id)), [], data);
    if (move) { next = { level, move }; break; }
  }
  const types = mon.types.map(id => data.types.find(type => type.typeRowid === id)?.nameKr).filter(Boolean);
  const stats = [
    ["hp", "최대 HP", mon.maxHp], ["atk", "공격", mon.stats.atk], ["satk", "특수공격", mon.stats.satk],
    ["spd", "스피드", mon.stats.spd], ["sdef", "특수방어", mon.stats.sdef], ["def", "방어", mon.stats.def],
  ] as const;
  const scale = Math.max(20, Math.ceil(Math.max(...stats.map(([, , value]) => value)) / 20) * 20);
  const statsShape = stats.map(([, , value], index) => {
    const angle = index * Math.PI / 3;
    const radius = 50 * value / scale;
    return `${(50 + radius * Math.sin(angle)).toFixed(2)}% ${(50 - radius * Math.cos(angle)).toFixed(2)}%`;
  }).join(", ");
  const readings = (
    <dl className="pokemon-battle-stats">
      {stats.map(([axis, name, value]) => <div key={axis} data-axis={axis}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>
  );

  return (
    <section className="pokemon-battle-profile" aria-label="배틀 능력">
      <header>
        <h3>배틀 능력</h3>
        <p>{journal ? `눈금 0–${scale}` : `Lv.${mon.level}${types.length ? " · " + types.join(" · ") : ""}`}</p>
      </header>
      {journal ? (
        <div className="pokemon-stat-chart">
          <div className="pokemon-stat-radar" aria-hidden="true">
            <i className="pokemon-radar-ring" />
            <i className="pokemon-radar-ring" />
            <i className="pokemon-radar-ring" />
            <span className="pokemon-radar-fill" style={{ clipPath: `polygon(${statsShape})` }} />
          </div>
          {readings}
        </div>
      ) : readings}
      <div className="pokemon-move-notes">
        <h3>장착 기술</h3>
        <ul>
          {battleMoves(mon).map(move => (
            <li key={move.id}><strong>{move.name}</strong><span>{[
              move.typeName, move.damageClass === 2 ? "물리" : move.damageClass === 3 ? "특수" : "변화",
              move.weightPower ? "위력 상대 체중에 따라" : move.power > 0 ? "위력 " + move.power : null,
              move.accuracy ? "명중 " + move.accuracy + "%" : "명중 판정 없음", move.maxPp ? "PP " + move.maxPp : null,
              move.selfKO ? "사용자 기절" : move.recoil ? "반동" : null,
            ].filter(Boolean).join(" · ")}</span></li>
          ))}
        </ul>
        <p>{next ? <>다음 공격기 <strong>Lv.{next.level} {next.move.name}</strong></> : "이후 장착될 새 공격기 없음"}</p>
      </div>
    </section>
  );
}
