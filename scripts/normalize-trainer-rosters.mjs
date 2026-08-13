import fs from "node:fs";

const trainerPath = "data/trainer.json";
const pokemonPath = "data/pokemon.json";
const data = JSON.parse(fs.readFileSync(trainerPath, "utf8"));
const pokemon = JSON.parse(fs.readFileSync(pokemonPath, "utf8"));
const pokemonById = new Map(pokemon.map(entry => [entry.pokemonRowid, entry]));

function firstStage(entry) {
  let current = entry;
  const visited = new Set();
  while (current.baseRowid && current.baseRowid !== current.pokemonRowid) {
    if (visited.has(current.pokemonRowid)) throw new Error(`Evolution cycle at Pokémon ${current.pokemonRowid}`);
    visited.add(current.pokemonRowid);
    const parent = pokemonById.get(current.baseRowid);
    if (!parent) throw new Error(`Missing base Pokémon ${current.baseRowid} for ${current.pokemonRowid}`);
    current = parent;
  }
  return current;
}

let replaced = 0;
let duplicatesRemoved = 0;
for (const trainer of data.trainers) {
  const normalized = new Map();
  for (const rosterEntry of trainer.pokemon) {
    const source = pokemonById.get(rosterEntry.id);
    if (!source) throw new Error(`Unknown Pokémon ${rosterEntry.id} on trainer ${trainer.id}`);
    const base = firstStage(source);
    if (base.pokemonRowid !== source.pokemonRowid) replaced += 1;
    if (normalized.has(base.pokemonRowid)) duplicatesRemoved += 1;
    normalized.set(base.pokemonRowid, { id: base.pokemonRowid, nameKr: base.nameKr });
  }
  trainer.pokemon = [...normalized.values()].sort((a, b) => a.id - b.id);
}

data.notes = data.notes.filter(note => !note.startsWith("pokemon normalization:"));
data.notes.push("pokemon normalization: every species is stored as the earliest evolution stage from pokemon.json baseRowid links, with duplicate evolution families removed per trainer.");
fs.writeFileSync(trainerPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ trainers: data.trainers.length, replaced, duplicatesRemoved }, null, 2));
