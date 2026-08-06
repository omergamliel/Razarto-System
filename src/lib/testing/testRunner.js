import { pureTests } from "./pureTests";
import { liveTests } from "./liveTests";
import { createTestContext } from "./fixtures";

async function runOne(test, run) {
  const startedAt = performance.now();
  try {
    await run();
    return {
      id: test.id,
      name: test.name,
      category: test.category,
      status: "passed",
      error: null,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      id: test.id,
      name: test.name,
      category: test.category,
      status: "failed",
      error: error?.message || String(error),
      durationMs: performance.now() - startedAt,
    };
  }
}

// No backend I/O — always safe, no confirmation needed.
export async function runPureTests() {
  const results = [];
  for (const test of pureTests) {
    results.push(await runOne(test, () => test.run()));
  }
  return results;
}

// Each test gets its own fixture sandbox; cleanup runs even if the test
// throws, and one test's cleanup failure doesn't stop the rest of the suite
// from running.
export async function runLiveTests() {
  const results = [];
  for (const test of liveTests) {
    const ctx = createTestContext();
    const result = await runOne(test, () => test.run(ctx));
    try {
      await ctx.cleanup();
    } catch (cleanupError) {
      results.push({
        id: `${test.id}-cleanup`,
        name: `${test.name} (fixture cleanup)`,
        category: "live",
        status: "failed",
        error: cleanupError?.message || String(cleanupError),
        durationMs: 0,
      });
    }
    results.push(result);
  }
  return results;
}

export async function runFullSuite() {
  const pureResults = await runPureTests();
  const liveResults = await runLiveTests();
  return [...pureResults, ...liveResults];
}
