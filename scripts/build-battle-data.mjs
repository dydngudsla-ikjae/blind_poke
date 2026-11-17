import { readFile, writeFile } from "node:fs/promises";
import { parseSync } from "vite";

const pokeApi = "8a92bfa7dab2f12b84b5d151562f9857c133ff30";
const showdown = "7e743761cd13cdb361fc0f58eb5a866284894f5b";
const csvRoot = "https://raw.githubusercontent.com/PokeAPI/pokeapi/" + pokeApi + "/data/v2/csv/";
const moveSource = "https://raw.githubusercontent.com/smogon/pokemon-showdown/" + showdown + "/data/moves.ts";
const data = name => new URL("../data/" + name + ".json", import.meta.url);
const local = async name => JSON.parse(await readFile(data(name), "utf8"));
const download = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " (" + response.status + ")");
  return response.text();
};
const csvRows = text => text.trim().split(/\r?\n/).slice(1).map(row => row.split(","));

const traditional = new Set([
  "scarlet-violet", "the-teal-mask", "the-indigo-disk", "brilliant-diamond-shining-pearl",
  "sword-shield", "the-isle-of-armor", "the-crown-tundra", "lets-go-pikachu-lets-go-eevee",
  "ultra-sun-ultra-moon", "sun-moon", "omega-ruby-alpha-sapphire", "x-y", "black-2-white-2",
  "black-white", "heartgold-soulsilver", "platinum", "diamond-pearl", "emerald",
  "firered-leafgreen", "ruby-sapphire", "crystal", "gold-silver", "yellow", "red-blue",
]);
const acceptedFields = new Set([
  "num", "basePower", "accuracy", "category", "name", "pp", "priority", "flags", "target", "type",
  "contestType", "desc", "shortDesc", "isNonstandard", "zMove", "maxMove",
  "secondary", "boosts", "drain", "recoil", "selfdestruct",
]);
const attacks = new Set(["normal", "any", "adjacentFoe", "allAdjacent", "allAdjacentFoes", "randomNormal"]);
const stats = { atk: "atk", def: "def", spa: "satk", spd: "sdef", spe: "spd" };
const optionalStatusMoves = new Set([40, 47, 52, 58, 77, 78, 79, 84, 86, 92, 95, 138, 139, 147, 173, 181, 261]);
const statuses = { psn: "poison", tox: "toxic", brn: "burn", par: "paralysis", slp: "sleep", frz: "freeze" };

function properties(node) {
  if (node?.type !== "ObjectExpression") return null;
  if (!node.properties.every(property => property.type === "Property" && property.kind === "init" && !property.computed)) return null;
  return Object.fromEntries(node.properties.map(property => [property.key.name ?? property.key.value, property.value]));
}

function number(node) {
  if (node?.type === "Literal" && Number.isInteger(node.value)) return node.value;
  if (node?.type === "UnaryExpression" && node.operator === "-" && Number.isInteger(node.argument.value)) return -node.argument.value;
}

function boosts(node) {
  const fields = properties(node);
  if (!fields || !Object.keys(fields).length || Object.keys(fields).some(key => !Object.hasOwn(stats, key))) return null;
  const changes = Object.entries(fields).map(([key, value]) => [stats[key], number(value)]);
  return changes.every(([, amount]) => amount !== undefined && amount !== 0 && Math.abs(amount) <= 6)
    ? Object.fromEntries(changes) : null;
}

function ratio(node) {
  if (node?.type !== "ArrayExpression" || node.elements.length !== 2) return null;
  const pair = node.elements.map(number);
  return pair.every(value => value > 0) ? pair : null;
}

function moveRule(node, catalog) {
  const f = properties(node);
  if (!f) return null;
  const id = number(f.num);
  const weightPower = [67, 447].includes(id) && f.basePowerCallback?.type === "FunctionExpression";
  // These two hit hooks only block Dynamax, which is absent from territory battles.
  if (Object.keys(f).some(key => !acceptedFields.has(key) && !(weightPower && ["basePowerCallback", "onTryHit"].includes(key)))) return null;
  const move = catalog.get(id);
  const flags = properties(f.flags);
  if (!move || move.descriptionKr?.includes("사용할 수 없는") || id === 165 || !flags || flags.charge || flags.recharge) return null;
  if (f.isNonstandard && f.isNonstandard.value !== "Past") return null;

  const rule = {};
  const isStatus = f.category?.value === "Status";
  if (isStatus !== (move.details.damageClass === 1) || !move.details.pp) return null;
  if (isStatus) {
    if (!f.boosts || !["self", ...attacks].includes(f.target?.value)) return null;
  } else if (!(move.details.power > 0 || weightPower) || !attacks.has(f.target?.value)) return null;
  if (weightPower) rule.weightPower = true;
  if (!isStatus && flags.contact) rule.contact = true;
  if (f.boosts) {
    if (!isStatus) return null;
    const changes = boosts(f.boosts);
    if (!changes) return null;
    rule.boosts = { target: f.target.value === "self" ? "actor" : "target", changes };
  }

  const priority = number(f.priority);
  if (priority) rule.priority = priority;
  if (f.secondary && f.secondary.value !== null) {
    const secondary = properties(f.secondary);
    if (!secondary || Object.keys(secondary).some(key => !["chance", "boosts", "volatileStatus", "self"].includes(key))) return null;
    const chance = number(secondary.chance);
    if (!chance || chance > 100) return null;

    if (secondary.volatileStatus?.value === "flinch" && !secondary.boosts && !secondary.self) {
      rule.secondary = { chance, flinch: true };
    } else {
      const self = secondary.self && properties(secondary.self);
      if (secondary.volatileStatus || (secondary.self && (!self || Object.keys(self).join() !== "boosts" || secondary.boosts))) return null;
      const changes = boosts(self?.boosts ?? secondary.boosts);
      if (!changes) return null;
      rule.secondary = { chance, boosts: { target: self ? "actor" : "target", changes } };
    }
  }

  for (const key of ["drain", "recoil"]) {
    if (!f[key]) continue;
    const pair = ratio(f[key]);
    if (!pair) return null;
    rule[key] = pair;
  }
  if (f.selfdestruct) {
    if (![120, 153].includes(id) || f.selfdestruct.value !== "always") return null;
    rule.selfKO = true;
  }
  return [id, rule];
}

function statusRule(node, catalog) {
  const f = properties(node);
  const id = number(f?.num);
  const move = catalog.get(id);
  if (!optionalStatusMoves.has(id) || !move?.details.pp || move.descriptionKr?.includes("사용할 수 없는") ||
    (f.isNonstandard && f.isNonstandard.value !== "Past") || !attacks.has(f.target?.value)) return null;

  const flags = properties(f.flags);
  const secondary = properties(f.secondary);
  const status = statuses[f.status?.value];
  const secondaryStatus = statuses[secondary?.status?.value];
  const chance = number(secondary?.chance);
  if (status && move.details.damageClass === 1) {
    return [id, { status, ...(flags?.powder && { powder: true }), ...(f.ignoreImmunity?.value === false && { statusTypeCheck: true }) }];
  }
  if (!(move.details.power > 0)) return null;
  if (id === 138 && f.onTryImmunity && ratio(f.drain)) return [id, { requiresSleep: "target", drain: ratio(f.drain) }];
  if (id === 173 && f.sleepUsable?.value && secondary?.volatileStatus?.value === "flinch" && chance) {
    return [id, { requiresSleep: "actor", secondary: { chance, flinch: true } }];
  }
  return secondaryStatus && chance ? [id, { ...(flags?.contact && { contact: true }), secondary: { chance, status: secondaryStatus } }] : null;
}

const [pokemon, moves, groupsCsv, learnCsv, source, speciesCsv, formsCsv] = await Promise.all([
  local("pokemon"), local("move"), download(csvRoot + "version_groups.csv"),
  download(csvRoot + "pokemon_moves.csv"), download(moveSource),
  download(csvRoot + "pokemon_species.csv"), download(csvRoot + "pokemon.csv"),
]);
const pokemonIds = new Set(pokemon.map(mon => mon.pokemonRowid));
const catalog = new Map(moves.map(move => [move.moveRowid, move]));
const groups = new Map(csvRows(groupsCsv).filter(([, name]) => traditional.has(name))
  .map(([id, name, , order]) => [Number(id), name === "scarlet-violet" ? Infinity : Number(order)]));
const { program, errors } = parseSync("moves.ts", source);
const declaration = program.body.flatMap(statement => statement.declaration?.declarations ?? [])
  .find(item => item.id.name === "Moves");
const definitions = properties(declaration?.init);
if (errors.length || !definitions) throw new Error("Cannot read the pinned Showdown move definitions");

const rules = Object.fromEntries(Object.values(definitions).map(node => moveRule(node, catalog)).filter(Boolean));
const statusRules = Object.fromEntries(Object.values(definitions).map(node => statusRule(node, catalog)).filter(Boolean));
if (Object.keys(statusRules).length !== optionalStatusMoves.size) throw new Error("Unexpected status move coverage");
const selected = new Map();
const speciesByForm = new Map(csvRows(formsCsv).map(([id, , species]) => [Number(id), Number(species)]));
const defaultForm = new Map(csvRows(formsCsv).filter(row => row[7] === "1").map(([id, , species]) => [Number(species), Number(id)]));
const preEvolution = new Map(csvRows(speciesCsv).map(([id, , , parent]) => [Number(id), Number(parent)]));
const defaults = new Set(defaultForm.values());
const sourceRows = new Map();
for (const [species, version, move, method, level, order] of csvRows(learnCsv)) {
  const id = Number(species);
  const preference = groups.get(Number(version));
  if (method !== "1" || preference === undefined) continue;
  const supported = Number(level) > 0 && (Object.hasOwn(rules, move) || Object.hasOwn(statusRules, move));
  const row = { move: Number(move), level: Number(level), order: Number(order) };
  if (supported && defaults.has(id)) {
    const key = id + ":" + version;
    if (!sourceRows.has(key)) sourceRows.set(key, []);
    sourceRows.get(key).push(row);
  }
  if (!pokemonIds.has(id)) continue;
  let entry = selected.get(id);
  if (!entry || preference > entry.preference) {
    entry = { preference, version: Number(version), rows: [] };
    selected.set(id, entry);
  }
  if (entry.version === Number(version) && supported) entry.rows.push(row);
}
const used = new Set([33, 153]);
const statusLearnsets = {};
const campaignUnlocks = {};
const inheritedAttacks = {};
const learnOrder = (a, b) => b.level - a.level || b.order - a.order || a.move - b.move;
const learnsets = Object.fromEntries([...pokemonIds].sort((a, b) => a - b).map(id => {
  const entry = selected.get(id);
  const rows = (entry?.rows ?? []).sort(learnOrder);
  const unlocks = new Map();
  const inherits = [];
  for (let parent = preEvolution.get(speciesByForm.get(id)); parent; parent = preEvolution.get(parent)) {
    const records = sourceRows.get(defaultForm.get(parent) + ":" + entry?.version) ?? [];
    const parentLevels = new Map();
    for (const { move, level } of [...records].sort(learnOrder)) {
      const rule = rules[move] ?? statusRules[move];
      const attack = catalog.get(move)?.details;
      if (attack && attack.damageClass !== 1 && (attack.power > 0 || rule.weightPower) && !rule.requiresSleep && !rule.selfKO) {
        inherits.push([move, level]);
      }
      parentLevels.set(move, level);
    }
    for (const [move, level] of parentLevels) if (!unlocks.has(move)) unlocks.set(move, level);
  }
  const primary = [];
  const optional = [];
  const overrides = new Map();
  for (const row of rows) {
    used.add(row.move);
    (Object.hasOwn(statusRules, row.move) ? optional : primary).push([row.move, row.level]);
    const level = unlocks.get(row.move);
    if (row.level === 1 && level > 1) overrides.set(row.move, level);
  }
  if (optional.length) statusLearnsets[id] = optional;
  if (overrides.size) {
    campaignUnlocks[id] = [...overrides];
    if (inherits.length) inheritedAttacks[id] = inherits;
    for (const [move] of inherits) used.add(move);
  }
  return [id, primary];
}));
const battle = {
  sources: { pokeApi, showdown }, learnsets,
  statusLearnsets,
  campaignUnlocks,
  inheritedAttacks,
  moves: Object.fromEntries(Object.entries({ ...rules, ...statusRules }).filter(([id]) => used.has(Number(id)))),
};
if (!battle.moves[33] || !battle.moves[153]?.selfKO || !battle.moves[67]?.weightPower || selected.size < pokemonIds.size * .95) {
  throw new Error("Unexpected learnset or move rule coverage");
}
const tables = { learnsets, statusLearnsets, campaignUnlocks, inheritedAttacks };
let output = JSON.stringify({ ...battle, ...Object.fromEntries(Object.keys(tables).map(name => [name, null])) }, null, 2);
for (const [name, table] of Object.entries(tables)) {
  const key = JSON.stringify(name);
  const lines = Object.entries(table).map(([id, rows]) => "    " + JSON.stringify(id) + ": " + JSON.stringify(rows));
  output = output.replace(key + ": null", key + ": {\n" + lines.join(",\n") + "\n  }");
}
await writeFile(data("battle"), output + "\n", "utf8");
console.log("Pinned learnsets: " + selected.size + "/" + pokemonIds.size + ", battle moves: " + Object.keys(battle.moves).length);
