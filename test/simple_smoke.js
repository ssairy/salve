"use strict";

const fs = require("fs");
const path = require("path");

const { parse } = require("../build/dist/lib/salve/parse");

let assert;

before(async () => {
  ({ assert } = await import("chai"));
});

describe("simple fixture", () => {
  it("parses the basic XML without validation errors", async () => {
    const rngPath = path.join(__dirname, "simple", "simplified-rng.js");
    const xmlSource = fs.readFileSync(
      path.join(__dirname, "simple", "to_parse.xml"),
      "utf8"
    );

    const hasErrors = await parse(rngPath, xmlSource, true);
    assert.isFalse(hasErrors, "expected the simple XML to validate cleanly");
  });
});
