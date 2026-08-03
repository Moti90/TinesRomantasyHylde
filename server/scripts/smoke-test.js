const health = await (await fetch("http://localhost:3847/api/health")).json();
const series = await (await fetch("http://localhost:3847/api/series")).json();
console.log("health", health);
console.log(
  "series",
  series.series.length,
  series.series[0]?.["Seriens navn"],
  series.series[0]?.["Tine-score"]
);

// roundtrip export
const exp = await fetch("http://localhost:3847/api/export");
console.log("export status", exp.status, exp.headers.get("content-type"));
const buf = Buffer.from(await exp.arrayBuffer());
console.log("export bytes", buf.length);
