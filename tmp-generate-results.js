"use strict";

const fs = require("fs");
const path = require("path");
const { SaxesParser } = require("saxes");
const salve = require("./build/dist");

function fileAsString(p) {
  return fs.readFileSync(path.resolve(p), "utf8").toString();
}

function errorsToString(errs) {
  if (!errs) {
    return errs;
  }

  return errs.join(",").toString();
}

function makeParser(er, walker) {
  const parser = new SaxesParser({ xmlns: true });

  const tagStack = [];
  parser.on("opentag", (node) => {
    er.recordEvent(walker, "enterContext");

    const names = Object.keys(node.attributes);
    names.sort();
    for (const name of names) {
      const attr = node.attributes[name];
      const { local, prefix, value } = attr;
      if (name === "xmlns" || prefix === "xmlns") {
        er.recordEvent(
          walker,
          "definePrefix",
          name === "xmlns" ? "" : local,
          value
        );
      }
    }

    const ename = walker.nameResolver.resolveName(
      `${node.prefix}:${node.local}`
    );
    node.uri = ename.ns;

    er.recordEvent(walker, "enterStartTag", node.uri, node.local);
    for (const name of names) {
      const attr = node.attributes[name];
      const { local, prefix, value } = attr;
      let uri = attr.uri;
      if (name === "xmlns" || prefix === "xmlns") {
        continue;
      }
      if (prefix !== "") {
        uri = walker.nameResolver.resolveName(`${prefix}:${local}`, true).ns;
      }
      er.recordEvent(walker, "attributeName", uri, local);
    er.recordEvent(walker, "attributeValue", value);
    }
    er.recordEvent(walker, "leaveStartTag", []);
    tagStack.unshift([node.uri, node.local]);
  });

  parser.on("text", (text) => {
    er.recordEvent(walker, "text", text);
  });

  parser.on("closetag", (_node) => {
    const tagInfo = tagStack.shift();
    er.recordEvent(walker, "endTag", tagInfo[0], tagInfo[1]);
    er.recordEvent(walker, "leaveContext");
  });

  return parser;
}

class EventRecorder {
  constructor(ComparisonEngine, options) {
    options = options || {
      check_fireEvent_invocation: true,
      check_possible: true,
    };

    this.events = [];
    this.recorded_states = [];
    this.ce = ComparisonEngine;
    this.dont_record_state = false;
    this.check_fireEvent_invocation = options.check_fireEvent_invocation;
    this.check_possible = options.check_possible;
  }

  recordEvent(walker) {
    this.events.push(Array.prototype.slice.call(arguments, 1));
    this.issueLastEvent(walker);
  }

  issueEventAt(walker, at) {
    this.issueEvent(walker, at, this.events[at]);
    return at < this.events.length - 1;
  }

  issueLastEvent(walker) {
    this.issueEventAt(walker, this.events.length - 1);
  }

  issueEvent(walker, evIx, ev) {
    const sliceLen = ev[0] === "leaveStartTag" ? 1 : ev.length;
    const evParams = Array.prototype.slice.call(ev, 0, sliceLen);

    if (!this.dont_record_state) {
      this.recorded_states.push([walker.clone(), this.ce.exp_ix, evIx]);
    }

    if (this.check_fireEvent_invocation) {
      this.ce.compare(
        `\ninvoking fireEvent with Event: ${evParams
          .join(", ")
          .trim()
          .replace(/\s+\n/g, "\n")}`,
        evParams
      );
    }

    let ret;
    switch (evParams[0]) {
      case "enterContext":
        walker.nameResolver.enterContext();
        ret = false;
        break;
      case "leaveContext":
        walker.nameResolver.leaveContext();
        ret = false;
        break;
      case "definePrefix":
        walker.nameResolver.definePrefix(...evParams.slice(1));
        ret = false;
        break;
      default:
        ret = walker.fireEvent(evParams[0], evParams.slice(1));
    }
    this.ce.compare(`fireEvent returned ${errorsToString(ret)}`, evParams);
    if (this.check_possible) {
      const possibleEvs = Array.from(walker.possible());
      possibleEvs.sort();
      if (
        evParams[0] !== "enterContext" &&
        evParams[0] !== "leaveContext" &&
        evParams[0] !== "definePrefix"
      ) {
        this.ce.compare(
          `possible events\n${salve.eventsToTreeString(possibleEvs)}`,
          evParams
        );
      }
    }
  }
}

class RecordingComparisonEngine {
  constructor(log) {
    this.log = log;
    this.exp_ix = 0;
  }

  compare(msg) {
    const lines = msg.split(/\n/);

    while (lines.length !== 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    this.log.push(lines.join("\n"));
    this.exp_ix += lines.length;
  }
}

function generate(dir) {
  const outputs = [];
  const ce = new RecordingComparisonEngine(outputs);
  const er = new EventRecorder(ce);
  const source = fileAsString(`test/${dir}/simplified-rng.js`);

  const tree = salve.readTreeFromJSON(source);
  let walker = tree.newWalker(new salve.DefaultNameResolver());
  const xmlSource = fileAsString(`test/${dir}/to_parse.xml`);

  const contextIndependent = tree.whollyContextIndependent();
  ce.compare(`wholly context-independent ${contextIndependent}`, [
    "*context-independent*",
  ]);

  ce.compare(
    `possible events\n${salve.eventsToTreeString(walker.possible())}`,
    ["initial"]
  );

  const parser = makeParser(er, walker);
  parser.write(xmlSource).close();

  if (er.events.length === 0) {
    throw new Error(`no events recorded for test/${dir}`);
  }

  ce.compare(`end returned ${walker.end()}`, ["*final*"]);

  const startAt = (er.recorded_states.length / 2) >> 0;
  [walker, ce.exp_ix] = er.recorded_states[startAt];
  let evIx = er.recorded_states[startAt][2];

  er.dont_record_state = true;
  let more = true;
  while (more) {
    more = er.issueEventAt(walker, evIx++);
  }

  ce.compare(`end returned ${walker.end()}`, ["*final*"]);

  return outputs.join("\n");
}

const dir = process.argv[2];

if (!dir) {
  throw new Error("usage: node tmp-generate-results.js <test-dir-name>");
}

process.stdout.write(generate(dir));
