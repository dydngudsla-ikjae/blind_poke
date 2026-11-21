import type { PokemonRecord } from "../domain/types";

export default function ScanMeasurements({
  pokemon,
  shownType,
  typeLabel = "감지 타입",
}: {
  pokemon?: PokemonRecord;
  shownType?: string;
  typeLabel?: string;
}) {
  return (
    <dl className="draft-measurements">
      <div className="draft-detected-type"><dt>{typeLabel}</dt><dd>{shownType ?? "—"}</dd></div>
      <div><dt>키</dt><dd>{pokemon ? pokemon.heightM == null ? "미확인" : `${pokemon.heightM} m` : "—"}</dd></div>
      <div><dt>몸무게</dt><dd>{pokemon ? pokemon.weightKg == null ? "미확인" : `${pokemon.weightKg} kg` : "—"}</dd></div>
    </dl>
  );
}
