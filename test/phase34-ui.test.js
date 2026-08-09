import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { renderDetail, renderList } from "../public/js/ui/list.js";

describe("Fase 3 og 4 i brugerfladen", () => {
  it("kan indlæse detalje- og listevisningen", () => {
    assert.equal(typeof renderDetail, "function");
    assert.equal(typeof renderList, "function");
  });

  it("viser danske navne for de to beslutningsscorer", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8"
    );
    const listSource = readFileSync(
      new URL("../public/js/ui/list.js", import.meta.url),
      "utf8"
    );
    assert.match(html, /Match \/ læs nu/);
    assert.match(listSource, /Indholdsmatch/);
    assert.match(listSource, /Læseprioritet nu/);
    assert.match(listSource, /analysegrundlag/);
    assert.match(listSource, /Hvor kilderne er uenige/);
    assert.match(listSource, /data-label="Serie"/);
    assert.match(listSource, /data-label="Match \/ læs nu"/);
  });
});
