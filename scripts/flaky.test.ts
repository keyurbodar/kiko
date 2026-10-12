import { expect, test } from "bun:test";
import { flakyLines } from "./flaky.ts";

// apps/server runs apps/server/scripts/test-each.ts, which prints a FAIL line per file and then a few
// filtered detail lines. The error line comes before the (fail) line, so it is the first assertion.
test("test-each output names every failing file with its first assertion", () => {
  const output = [
    "cached test/alpha.test.ts",
    "FAIL test/room-receive.test.ts  12 pass, 1 fail",
    "error: expect(received).toBe(expected)",
    "(fail) receive > delivers the message [1.20ms]",
    "FAIL test/other.test.ts  3 pass, 2 fail",
    "error: expect(received).toEqual(expected)",
    "(fail) other > matches the shape [0.90ms]",
    "",
    "14 pass, 3 fail, 2 cached across 20 files",
    "error: script \"test\" exited with code 1",
  ].join("\n");
  expect(flakyLines(output)).toEqual([
    "      test/room-receive.test.ts: error: expect(received).toBe(expected)",
    "      test/other.test.ts: error: expect(received).toEqual(expected)",
  ]);
});

// Every other package runs bun test, which prints the file path and a colon as a header for each file
// that failed; passing files get no block.
test("bun test output names the failing file under its header", () => {
  const output = [
    "bun test v1.3.14 (0d9b296a)",
    "",
    "test/b.test.ts:",
    '1 | import { expect, test } from "bun:test"',
    '3 | test("b bad", () => { expect(1).toBe(2) })',
    "                                    ^",
    "error: expect(received).toBe(expected)",
    "",
    "Expected: 2",
    "Received: 1",
    "",
    "(fail) b bad [0.14ms]",
    "",
    " 2 pass",
    " 1 fail",
    "Ran 3 tests across 2 files. [13.00ms]",
    'error: script "test" exited with code 1',
  ].join("\n");
  expect(flakyLines(output)).toEqual(["      test/b.test.ts: error: expect(received).toBe(expected)"]);
});

// bun run's trailing script-exit line is not a failing assertion, so a header with no detail line
// still names the file rather than parroting the script error.
test("the script-exit line is not mistaken for a failing assertion", () => {
  expect(flakyLines('test/b.test.ts:\nerror: script "test" exited with code 1')).toEqual(["      test/b.test.ts"]);
});

test("a passing run has nothing to summarize", () => {
  expect(flakyLines(" 12 pass\n 0 fail\nRan 12 tests across 3 files. [40.00ms]")).toEqual([]);
});
