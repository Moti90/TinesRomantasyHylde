import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const exp = await fetch("http://localhost:3847/api/export");
const buf = Buffer.from(await exp.arrayBuffer());
const path = join(tmpdir(), "tine-roundtrip.xlsx");
writeFileSync(path, buf);

const form = new FormData();
form.append("file", new Blob([buf]), "roundtrip.xlsx");
form.append("mode", "replace");
const res = await fetch("http://localhost:3847/api/import", {
  method: "POST",
  body: form,
});
const data = await res.json();
console.log("import", res.status, data.count, data.series?.[0]?.["Seriens navn"]);
