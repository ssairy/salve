# Running Tests and Reproducing Failures

This guide documents the exact steps needed to set up a fresh environment, install Saxon, and execute the test commands that currently surface failures in this repository. Share these instructions with collaborators so they can reproduce the same behaviour you are observing.

## 1. Prerequisites

- **Node.js**: use Node 18 or later (`node --version`).
- **npm**: the matching npm that ships with your Node version.
- **Java runtime (JDK 11+)**: required for Saxon; confirm with `java -version`.
- **xsltproc**: ships with macOS; on Linux install with your package manager (e.g. `sudo apt install xsltproc`).
- **Chrome & Firefox**: needed for Karma’s headless browser run. The suite only passes if at least one headless launcher (`ChromeHeadless` or `FirefoxHeadless`) is available; otherwise gulp reports missing browsers. If you lack either browser, see [Running the tests](#4-running-the-tests) for alternatives.

## 2. Install project dependencies

```bash
git clone https://github.com/raffazizzi/salve.git
cd salve
npm install
# Build once so the compiled artifacts under build/dist/ exist for the tests.
npm run build
```

## 3. Install Saxon-HE

Saxon provides the XSLT 2.0 support used by the RNG simplification tests.

1. **Download Saxon-HE (Java edition)** from [Saxonica’s download page](https://www.saxonica.com/download/java.xml). Save the `SaxonHE<version>J.zip` file locally.
2. Unzip the archive somewhere convenient, e.g.
   ```bash
   unzip SaxonHE12-9J.zip -d "$HOME/opt"
   ```
   This places the jar at `~/opt/SaxonHE12-9J/saxon-he-12.9.jar`.
3. Confirm Java can run the jar:
   ```bash
   java -jar "$HOME/opt/SaxonHE12-9J/saxon-he-12.9.jar" -? | head -n 1
   ```

### Making the jar discoverable

The repository currently hard-codes a Saxon path in two places:

- `test/rng_simplification_test.js` (around line 36)
- `lib/salve/conversion/schema-simplifiers/xsl.ts` (around line 175)

Adjust these so the tests find your jar:

_Option A – Update the hard-coded path locally_: edit the string passed to `java -jar` in both files so it matches your extracted jar location. Keep these edits local (do not commit) when sharing the reproduction.

_Option B – Create a symlink that mimics the expected location_:

```bash
mkdir -p "$HOME/Documents/MITH388/SaxonHE12-9J"
ln -sf "$HOME/opt/SaxonHE12-9J/saxon-he-12.9.jar" \
  "$HOME/Documents/MITH388/SaxonHE12-9J/saxon-he-12.9.jar"
```

Adjust the version number in the commands if you downloaded a different release. Re-run the `java -jar … -?` check afterwards; it should no longer complain about a missing Java runtime or missing jar.

## 4. Running the tests

With the build artifacts and Saxon in place, you can run the same commands that currently surface failures:

- **Full suite (build + lint + mocha + karma)**:

  ```bash
  npm test
  ```

  Without Java/Saxon this terminates quickly with `Unable to locate a Java Runtime` and `./node_modules/.bin/mocha failed with code 39`. Seeing those messages confirms you reproduced the current failure.

- **Node-driven mocha tests only**:

  ```bash
  npx gulp mocha
  ```

  This is the quickest way to exercise `test/rng_simplification_test.js`. When Saxon is missing or misconfigured you will see the same `Unable to locate a Java Runtime` output. Once Saxon is configured, the command runs the entire mocha suite; watch its exit status to check whether any tests still fail.

- **Focus on the RNG simplification XSLT tests**:

  ```bash
  npx mocha test/rng_simplification_test.js --reporter spec
  ```

  Use this targeted command to gather detailed logs for the failing cases. If the Saxon jar cannot be read you will again get the Java runtime error; otherwise mocha will report which test cases fail.

- **Browser (Karma) tests**:
  ```bash
  npx gulp karma -- --browsers ChromeHeadless FirefoxHeadless
  ```
  Ensure both Chrome and Firefox are installed and headless mode works. If you only have one browser available, pass just that launcher (e.g. `--browsers ChromeHeadless`). The tests fail immediately if neither headless browser can start.

- **Run a single named test**:
  ```bash
  npx mocha test/validation.js --grep "validates compact schema"
  ```
  Replace the quoted text with the `describe`/`it` label you need. Sharing the exact `--grep` value helps collaborators reproduce the same case.