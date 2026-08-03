const url =
  "http://127.0.0.1:3847/api/series/" +
  encodeURIComponent("Harry Potter") +
  "/refresh";
console.log("POST", url);
const res = await fetch(url, { method: "POST" });
const text = await res.text();
console.log("status", res.status);
console.log(text.slice(0, 300));
