// Dependency-free assertion helpers for the in-app test runner (see
// testRunner.js) — there is no Vitest/Jest in this repo (base44's SDK is
// injected at runtime and isn't installable locally), so these tests run
// inside the live app instead of a Node test environment.

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

export function assertEqual(actual, expected, label) {
  const isEqual =
    actual === expected ||
    (Number.isNaN(actual) && Number.isNaN(expected));
  if (!isEqual) {
    throw new Error(
      `${label || "Values differ"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
