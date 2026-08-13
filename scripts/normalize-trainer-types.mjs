import fs from "node:fs";

const trainerPath = "data/trainer.json";
const data = JSON.parse(fs.readFileSync(trainerPath, "utf8"));
const types = JSON.parse(fs.readFileSync("data/type.json", "utf8"));
const byEnglishName = new Map(types.map(type => [type.nameEn.toLowerCase(), type]));
const byId = new Map(types.map(type => [type.typeRowid, type]));

for (const trainer of data.trainers) {
  trainer.specialtyTypes = trainer.specialtyTypes.map(value => {
    if (typeof value === "string") {
      const type = byEnglishName.get(value.toLowerCase());
      if (!type) throw new Error(`Unknown specialty type '${value}' on trainer ${trainer.id}`);
      return { id: type.typeRowid, nameKr: type.nameKr };
    }
    const type = byId.get(value.id);
    if (!type) throw new Error(`Unknown specialty type ID '${value.id}' on trainer ${trainer.id}`);
    return { id: type.typeRowid, nameKr: type.nameKr };
  });
}

data.notes = data.notes.filter(note => !note.startsWith("specialtyTypes:"));
data.notes.push("specialtyTypes: stored as { id, nameKr }; game rules compare the stable type ID while the Korean name keeps the JSON readable.");
fs.writeFileSync(trainerPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Normalized specialty types for ${data.trainers.length} trainers.`);
