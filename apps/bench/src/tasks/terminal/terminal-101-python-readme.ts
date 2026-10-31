import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, python, readText, run, verdict, writeJson, writeText } from "../helpers"

const NAMES = ["Zoë", "Ada", "Priya", "Sven", "Mira", "Omar"]

const README = `# widget

A tiny rolling-average helper.

1. python3 -m venv .venv
2. . .venv/bin/activate
3. pip install -r requirements.txt
4. python -m pytest -q
`

const REQUIREMENTS = "pytest==8.3.3\n"

const BUGGY = `def rolling_mean(values, window):
    if window <= 0:
        raise ValueError("window must be positive")
    total = 0
    result = []
    for index, value in enumerate(values):
        total += value
        if index >= window:
            total -= values[index - window + 1]
        result.append(total / window if index + 1 >= window else total / (index + 1))
    return result
`

const FIXED = BUGGY.replace("values[index - window + 1]", "values[index - window]")

const TEST = `import unittest

from widget.rolling import rolling_mean


class RollingMeanTest(unittest.TestCase):
    def test_short_list(self):
        self.assertEqual(rolling_mean([4], 3), [4])

    def test_window_of_one(self):
        self.assertEqual(rolling_mean([2, 5, 9], 1), [2, 5, 9])

    def test_window_slides(self):
        self.assertEqual(rolling_mean([1, 2, 3, 4, 5], 3), [1, 1.5, 2, 3, 4])

    def test_average_not_sum(self):
        self.assertAlmostEqual(rolling_mean([2, 4, 6, 8], 2)[-1], 7)

    def test_rejects_bad_window(self):
        with self.assertRaises(ValueError):
            rolling_mean([1, 2], 0)


if __name__ == "__main__":
    unittest.main()
`

export const pythonReadme: Task = {
  id: "terminal-101-python-readme",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "I cloned this widget project and followed the README, but the install step fails because this machine has no network, and the tests are red anyway. Get the test suite passing. Leave the tests alone.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const rng = mulberry32(seed)
    await writeJson(m, "request.json", { author: pick(rng, NAMES) })
    await writeText(m, "README.md", README)
    await writeText(m, "requirements.txt", REQUIREMENTS)
    await writeText(m, "widget/__init__.py", "")
    await writeText(m, "widget/rolling.py", BUGGY)
    await writeText(m, "tests/__init__.py", "")
    await writeText(m, "tests/test_rolling.py", TEST)
  },
  oracle: async (m) => {
    await writeText(m, "widget/rolling.py", FIXED)
    const result = await run(m, [python(m), "-m", "unittest", "discover", "-s", "tests", "-t", "."])
    if (result.code !== 0) throw new Error(`unittest failed: ${result.stderr || result.stdout}`)
  },
  check: async (m) => {
    const result = await run(m, [python(m), "-m", "unittest", "discover", "-s", "tests", "-t", "."])
    const tests = await readText(m, "tests/test_rolling.py")
    return verdict([
      check("tests pass", result.code === 0, `unittest exited ${result.code}: ${result.stderr.slice(-400)}`),
      check("tests untouched", tests === TEST, "tests/test_rolling.py changed"),
    ])
  },
}
