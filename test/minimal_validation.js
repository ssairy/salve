"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { SaxesParser } = require("saxes");

const { parse } = require("../build/dist/lib/salve/parse");
const salve = require("../build/dist");

function resolveFixtureDir() {
  const argIndex = process.argv.indexOf("--dir");
  if (argIndex !== -1 && argIndex < process.argv.length - 1) {
    return process.argv[argIndex + 1];
  }
  return null;
}

let assert;

before(async () => {
  ({ assert } = await import("chai"));
});

function getFixtureInfo(dirName) {
  const fixtureRoot = path.join(__dirname, dirName);
  const candidates = ["simplified-rng.js", `${dirName}.rng`];
  const rngPath = candidates
    .map((file) => path.join(fixtureRoot, file))
    .find((filePath) => fs.existsSync(filePath));

  if (!rngPath) {
    throw new Error(`No schema source found under test/${dirName}/`);
  }

  return { fixtureRoot, rngPath };
}

async function loadGrammarFromSchema(rngPath) {
  const rngSource = fs.readFileSync(path.resolve(rngPath), "utf8");

  let parsed;
  try {
    parsed = JSON.parse(rngSource);
  } catch (err) {
    parsed = undefined;
  }

  if (parsed !== undefined) {
    return salve.readTreeFromJSON(parsed);
  }

  const schemaUrl = new URL(pathToFileURL(path.resolve(rngPath)).href);
  const conversionResult = await salve.convertRNGToPattern(schemaUrl);
  return conversionResult.pattern;
}

async function collectValidationErrors(dirName) {
  const { fixtureRoot, rngPath } = getFixtureInfo(dirName);
  const grammar = await loadGrammarFromSchema(rngPath);
  const nameResolver = new salve.DefaultNameResolver();
  const walker = grammar.newWalker(nameResolver);
  const xmlSource = fs.readFileSync(
    path.join(fixtureRoot, "to_parse.xml"),
    "utf8"
  );

  const parser = new SaxesParser({ xmlns: true });
  const tagStack = [];
  const errors = [];
  let textBuffer = "";

  function fireEvent(name, args) {
    const ret = walker.fireEvent(name, args);
    if (Array.isArray(ret)) {
      errors.push(...ret);
    }
  }

  function flushText() {
    if (textBuffer !== "") {
      fireEvent("text", [textBuffer]);
      textBuffer = "";
    }
  }

  parser.on("opentag", (node) => {
    flushText();
    const names = Object.keys(node.attributes);
    const nsDefinitions = [];
    const attributeEvents = [];
    names.sort();

    for (const name of names) {
      const attr = node.attributes[name];
      if (name === "xmlns") {
        nsDefinitions.push(["", attr.value]);
      } else if (attr.prefix === "xmlns") {
        nsDefinitions.push([attr.local, attr.value]);
      } else {
        attributeEvents.push(["attributeName", attr.uri, attr.local]);
        attributeEvents.push(["attributeValue", attr.value]);
      }
    }

    if (nsDefinitions.length !== 0) {
      nameResolver.enterContext();
      for (const [prefix, uri] of nsDefinitions) {
        nameResolver.definePrefix(prefix, uri);
      }
    }

    fireEvent("enterStartTag", [node.uri || "", node.local || ""]);
    for (const event of attributeEvents) {
      fireEvent(event[0], event.slice(1));
    }
    fireEvent("leaveStartTag", []);
    tagStack.push({
      uri: node.uri || "",
      local: node.local || "",
      hasContext: nsDefinitions.length !== 0,
    });
  });

  parser.on("text", (text) => {
    textBuffer += text;
  });

  parser.on("closetag", () => {
    flushText();
    const tagInfo = tagStack.pop();
    if (!tagInfo) {
      throw new Error("stack underflow");
    }
    fireEvent("endTag", [tagInfo.uri, tagInfo.local]);
    if (tagInfo.hasContext) {
      nameResolver.leaveContext();
    }
  });

  const entityRe = /^<!ENTITY\s+([^\s]+)\s+(['"])(.*?)\2\s*>\s*/;
  parser.on("doctype", (doctype) => {
    let cleaned = doctype
      .replace(/^.*?\[/, "")
      .replace(/].*?$/, "")
      .replace(/<!--(?:.|\n|\r)*?-->/g, "")
      .trim();

    while (cleaned.length !== 0) {
      const match = entityRe.exec(cleaned);
      if (match !== null) {
        const name = match[1];
        const value = match[3];
        cleaned = cleaned.slice(match[0].length);
        if (parser.ENTITIES[name] !== undefined) {
          throw new Error(`redefining entity: ${name}`);
        }
        parser.ENTITIES[name] = value;
      } else {
        throw new Error(`unexpected construct in DOCTYPE: ${doctype}`);
      }
    }
  });

  parser.on("end", () => {
    flushText();
    const result = walker.end();
    if (Array.isArray(result)) {
      errors.push(...result);
    }
  });

  parser.on("error", (err) => {
    throw err;
  });

  parser.write(xmlSource).close();
  return errors;
}

function makeValidationTest(dirName) {
  return async function validationTest() {
    const { fixtureRoot, rngPath } = getFixtureInfo(dirName);
    const xmlSource = fs.readFileSync(
      path.join(fixtureRoot, "to_parse.xml"),
      "utf8"
    );

    const hasErrors = await parse(rngPath, xmlSource, true);
    assert.isFalse(
      hasErrors,
      `expected the ${dirName} XML to validate cleanly`
    );
  };
}

function makeInvalidTest(dirName, expectedErrorTypes) {
  return async function invalidTest() {
    const errors = await collectValidationErrors(dirName);
    assert.isAbove(
      errors.length,
      0,
      `expected the ${dirName} XML to yield validation errors`
    );
    assert.strictEqual(
      errors.length,
      expectedErrorTypes.length,
      `expected ${expectedErrorTypes.length} errors from ${dirName}, got ${errors.length}`
    );
    errors.forEach((error, index) => {
      const ExpectedError = expectedErrorTypes[index];
      assert.instanceOf(
        error,
        ExpectedError,
        `error ${index + 1} for ${dirName} should be ${ExpectedError.name}`
      );
    });
  };
}

describe("fixture RNG validation", () => {
  const fixtureDir = resolveFixtureDir();
  if (fixtureDir) {
    it("validates the requested fixture", makeValidationTest(fixtureDir));
  } else {
    it("validates test/simple explicitly", makeValidationTest("simple"));

    it("validates test/minimal explicitly", makeValidationTest("minimal"));

    it("choice matching", makeValidationTest("choice_matching"));

    it("a tei file", makeValidationTest("tei"));

    it("a tei file, with namespaces", makeValidationTest("namespaces"));

    it(
      "a tei file using a more complex schema",
      makeValidationTest("tei-with-modules")
    );

    it("an old error case (1)", makeValidationTest("old-error-case-1"));

    it("a schema using anyName, etc.", makeValidationTest("names"));

    describe("reports meaningful validation errors", () => {
      it(
        "choice_not_chosen emits a ChoiceError",
        makeInvalidTest("choice_not_chosen", [salve.ChoiceError])
      );

      it(
        "choice_ended_by_following_item emits ElementNameError then ChoiceError",
        makeInvalidTest("choice_ended_by_following_item", [
          salve.ElementNameError,
          salve.ChoiceError,
        ])
      );

      it(
        "invalid_attribute emits AttributeNameErrors",
        makeInvalidTest("invalid_attribute", [
          salve.AttributeNameError,
          salve.AttributeNameError,
        ])
      );

      it(
        "one_or_more_not_satisfied emits an ElementNameError",
        makeInvalidTest("one_or_more_not_satisfied", [salve.ElementNameError])
      );

      it(
        "name_error1 emits ElementNameErrors",
        makeInvalidTest("name_error1", [
          salve.ElementNameError,
          salve.ElementNameError,
        ])
      );

      it(
        "name_error2 emits ElementNameErrors",
        makeInvalidTest("name_error2", [
          salve.ElementNameError,
          salve.ElementNameError,
        ])
      );

      it(
        "name_error3 emits ElementNameErrors",
        makeInvalidTest("name_error3", [
          salve.ElementNameError,
          salve.ElementNameError,
        ])
      );

      it(
        "element_in_interleave emits ElementNameErrors",
        makeInvalidTest("element_in_interleave", [
          salve.ElementNameError,
          salve.ElementNameError,
        ])
      );

      it(
        "text_in_interleave emits a ValidationError",
        makeInvalidTest("text_in_interleave", [salve.ValidationError])
      );
    });
  }
});
