/* eslint-env node */

"use strict";

const { URL } = require("url");
const util = require("util");

global.URL = URL;
global.TextEncoder = util.TextEncoder;

if (typeof global.fetch !== "function") {
  const dynamicImport = new Function(
    "modulePath",
    "return import(modulePath);",
  );

  const nodeFetchPromise = dynamicImport("node-fetch");

  const fetchProxy = (...args) =>
    nodeFetchPromise.then(mod => {
      const fetchFn = mod.default ?? mod;
      return fetchFn(...args);
    });

  global.fetch = fetchProxy;

  nodeFetchPromise.then(mod => {
    const fetchFn = mod.default ?? mod;
    global.fetch = fetchFn;

    ["Headers", "Request", "Response", "FormData", "Blob", "File"].forEach(key => {
      if (mod[key] !== undefined && global[key] === undefined) {
        global[key] = mod[key];
      }
    });
  }).catch(error => {
    process.nextTick(() => {
      throw error;
    });
  });
}

const Mocha = require("mocha");

const oldRun = Mocha.prototype.run;
Mocha.prototype.run = function run() {
  this.reporter(process.env.CONTINUOUS_INTEGRATION === undefined ?
                "dot" : "spec");
  // eslint-disable-next-line prefer-rest-params
  return oldRun.apply(this, arguments);
};
