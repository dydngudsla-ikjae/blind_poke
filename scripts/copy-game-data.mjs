import { cp } from "node:fs/promises";

await cp(new URL("../data/", import.meta.url), new URL("../dist/data/", import.meta.url), {
  recursive: true,
});
