import { base44 } from "@/api/base44Client";

// Reserved serial_id range for synthetic test fixtures — far above anything
// a real maxId+1 (see AdminSettingsModal.jsx's addUserMutation) could ever
// reach, so fixtures can never collide with or be mistaken for real people.
const FIXTURE_SERIAL_BASE = 9_000_000;
let fixtureCounter = 0;

function nextFixtureSerialId() {
  fixtureCounter += 1;
  return FIXTURE_SERIAL_BASE + fixtureCounter;
}

// Far-future placeholder date for fixtures that don't care about a specific
// calendar date — never collides with real shift history.
const PLACEHOLDER_DATE = "2999-01-06";

// Per-test sandbox: every entity created through this context is tracked and
// deleted (children before parents) by cleanup(), regardless of whether the
// test that created them passed or threw partway through.
export function createTestContext() {
  const created = [];

  const track = (entity, record) => {
    created.push({ entity, id: record.id });
    return record;
  };

  const createPerson = async (overrides = {}) => {
    const serial_id = overrides.serial_id ?? nextFixtureSerialId();
    const record = await base44.entities.AuthorizedPerson.create({
      full_name: `[TEST] עובד בדיקה ${serial_id}`,
      email: `qa-test-${serial_id}@qa-test.local`,
      department: "א",
      permissions: "RR",
      role: "RR",
      ...overrides,
      serial_id,
    });
    return track("AuthorizedPerson", record);
  };

  // original_user_id has no default on purpose — every test must wire it to
  // one of its own createPerson() fixtures explicitly.
  const createShift = async (overrides = {}) => {
    const record = await base44.entities.Shift.create({
      start_date: PLACEHOLDER_DATE,
      end_date: PLACEHOLDER_DATE,
      start_time: "09:00",
      end_time: "09:00",
      status: "Active",
      ...overrides,
    });
    return track("Shift", record);
  };

  // shift_ids/requesting_user_id/offered_shift_ids have no default — tests
  // must wire them to their own fixtures.
  const createSwapRequest = async (overrides = {}) => {
    const record = await base44.entities.SwapRequest.create({
      request_type: "Full",
      req_start_date: PLACEHOLDER_DATE,
      req_end_date: PLACEHOLDER_DATE,
      req_start_time: "09:00",
      req_end_time: "09:00",
      status: "Open",
      ...overrides,
    });
    return track("SwapRequest", record);
  };

  // request_id/shift_id/covering_user_id have no default — tests must wire
  // them to their own fixtures.
  const createCoverage = async (overrides = {}) => {
    const record = await base44.entities.ShiftCoverage.create({
      cover_start_date: PLACEHOLDER_DATE,
      cover_end_date: PLACEHOLDER_DATE,
      cover_start_time: "09:00",
      cover_end_time: "09:00",
      status: "Approved",
      ...overrides,
    });
    return track("ShiftCoverage", record);
  };

  const cleanup = async () => {
    const errors = [];
    // LIFO: last-created (typically the "child", e.g. a SwapRequest built on
    // top of a Shift/Person) is deleted first.
    for (let i = created.length - 1; i >= 0; i -= 1) {
      const { entity, id } = created[i];
      try {
        await base44.entities[entity].delete(id);
      } catch (error) {
        errors.push({ entity, id, error });
      }
    }
    created.length = 0;
    if (errors.length > 0) {
      throw new Error(
        `Fixture cleanup failed for ${errors.length} record(s): ` +
          errors.map((e) => `${e.entity}/${e.id} (${e.error?.message || e.error})`).join("; "),
      );
    }
  };

  return { createPerson, createShift, createSwapRequest, createCoverage, cleanup };
}
