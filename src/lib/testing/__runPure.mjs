// Headless shim so the app's pure tests can run in Node.
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = {
  location: { href: "http://localhost/", search: "", pathname: "/", hash: "" },
  history: { replaceState: () => {}, pushState: () => {} },
  localStorage: storage,
};
globalThis.document = { title: "test" };
globalThis.localStorage = storage;

const { pureTests } = await import("./pureTests.js");

let failed = 0;
for (const t of pureTests) {
  try {
    await t.run();
    console.log("PASS", t.id);
  } catch (error) {
    failed += 1;
    console.log("FAIL", t.id, "—", error?.message || error);
  }
}
console.log(`\n${pureTests.length - failed}/${pureTests.length} passed`);