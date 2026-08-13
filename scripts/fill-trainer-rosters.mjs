import fs from "node:fs";

const file = "data/trainer.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const pokemon = JSON.parse(fs.readFileSync("data/pokemon.json", "utf8"));
const pokemonById = new Map(pokemon.map(p => [p.pokemonRowid, p]));
const pageAliases = {
  "green": "Blue (game)",
  "n": "N",
  "rose": "Rose",
  "kukui": "Professor Kukui",
  "crasher-wake": "Crasher Wake",
  "lt-surge": "Lt. Surge",
  "brendan": "Brendan (game)",
  "may": "May (game)",
  "barry": "Barry (game)",
  "calem": "Calem (game)",
  "serena": "Serena (game)",
  "red": "Red (game)",
  "silver": "Silver (game)",
  "tate": "Tate and Liza",
  "liza": "Tate and Liza",
  "steven": "Steven Stone",
  "brandon": "Brandon (Frontier Brain)",
};
const excludedCoreSpecies = {
  // Black 2/White 2 downloadable "The Battle Between Legendary Pokémon" tournament.
  "sabrina": new Set([150]),
  "falkner": new Set([249]),
  "winona": new Set([384]),
  "fantina": new Set([487]),
};

async function fetchRoster(trainer) {
  const title = pageAliases[trainer.id] ?? trainer.nameEn;
  const url = new URL("https://bulbapedia.bulbagarden.net/w/api.php");
  url.search = new URLSearchParams({ action: "parse", page: title, prop: "wikitext", format: "json", origin: "*" });
  const response = await fetch(url, { headers: { "user-agent": "BlindPoke trainer data curator/1.0" } });
  if (!response.ok) return { trainer, error: `HTTP ${response.status}` };
  const json = await response.json();
  const text = json?.parse?.wikitext?.["*"];
  if (!text) return { trainer, error: json?.error?.info ?? "page unavailable" };
  const start = text.search(/==In the (?:core series )?games==/i);
  if (start < 0) return { trainer, error: "core-series section unavailable" };
  const tail = text.slice(start);
  const end = tail.slice(2).search(/\n==[^=][^\n]*==\s*\n/);
  const games = end >= 0 ? tail.slice(0, end + 2) : tail;
  const parties = [...games.matchAll(/\{\{Party\b[\s\S]*?\{\{Party\/end\}\}/gi)].map(match => {
    const block = match[0];
    const ids = [...block.matchAll(/\|\s*ndex\s*=\s*0*(\d+)/gi)].map(item => Number(item[1]));
    return { ids };
  }).filter(party => party.ids.length > 0 && party.ids.length <= 6);
  if (!parties.length) return { trainer, error: "no complete core-series party found" };
  const excluded = excludedCoreSpecies[trainer.id] ?? new Set();
  const ids = parties.flatMap(party => party.ids).filter(id => !excluded.has(id));
  const unique = [...new Set(ids)].map(id => pokemonById.get(id)).filter(Boolean)
    .map(p => ({ id: p.pokemonRowid, nameKr: p.nameKr })).sort((a, b) => a.id - b.id);
  return { trainer, pokemon: unique };
}

const missing = data.trainers;
const results = [];
for (let i = 0; i < missing.length; i += 5) {
  results.push(...await Promise.all(missing.slice(i, i + 5).map(fetchRoster)));
}
for (const result of results) {
  if (result.pokemon?.length) result.trainer.pokemon = result.pokemon;
}

data.notes = data.notes.filter(note => !note.startsWith("pokemon sources:"));
data.notes.push("pokemon sources: species union of every documented party in each trainer's core-series game section; version differences and rematches are included, while spin-off, animation, and manga parties are excluded.");
data.notes = data.notes.filter(note => !note.startsWith("pokemon exclusions:"));
data.notes.push("pokemon exclusions: the Black 2/White 2 downloadable 'The Battle Between Legendary Pokémon' tournament is excluded from Sabrina, Falkner, Winona, and Fantina.");
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const unresolved = results.filter(result => !result.pokemon?.length).map(result => ({ id: result.trainer.id, reason: result.error ?? "no Pokédex IDs found" }));
console.log(JSON.stringify({ requested: missing.length, filled: missing.length - unresolved.length, unresolved }, null, 2));
await import("./normalize-trainer-rosters.mjs");
