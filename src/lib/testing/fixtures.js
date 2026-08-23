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

  // Cancel is now a hard delete of the coverage row, so tests that exercise a
  // cancel delete a tracked fixture themselves. Untracking it keeps cleanup()
  // from trying to delete the same id a second time (which would throw).
  const untrack = (id) => {
    const idx = created.findIndex((c) => c.id === id);
    if (idx !== -1) created.splice(idx, 1);
  };

  const createPerson = async (overrides = {}) => {
    const serial_id = overrides.serial_id ?? nextFixtureSerialId();
    const record = await base44.entities.AuthorizedPerson.create({
      full_name: `[TEST] עובד בדיקה ${serial_id}`,
      email: `qa-test-${serial_id}@qa-test.local`,
      department: "א",
      permissions: "RR",
      ...overrides,
      serial_id,
    });
    return track("AuthorizedPerson", record);
  };

  // A Shift is now a pure time slot — ownership lives in a base "assignment"
  // ShiftCoverage row (Phase 4), not on the shift. Pass `owner` (a serial_id)
  // to have the fixture create that assignment row too; most tests want an
  // owned shift, so they pass it. There is no default owner on purpose.
  const createShift = async (overrides = {}) => {
    const { owner, ...shiftFields } = overrides;
    const record = await base44.entities.Shift.create({
      start_date: PLACEHOLDER_DATE,
      end_date: PLACEHOLDER_DATE,
      start_time: "09:00",
      end_time: "09:00",
      ...shiftFields,
    });
    track("Shift", record);
    if (owner != null) {
      await createCoverage({
        shift_id: record.id,
        covering_user_id: Number(owner),
        type: "assignment",
        cover_start_date: record.start_date,
        cover_end_date: record.end_date,
        cover_start_time: record.start_time,
        cover_end_time: record.end_time,
      });
    }
    return record;
  };

  // The base "assignment" ShiftCoverage row records who owns a shift; "who works
  // window W" is a cover row overlapping W if one exists, else this row.
  const getOwner = async (shiftId) => {
    const rows = await base44.entities.ShiftCoverage.filter({
      shift_id: shiftId,
      type: "assignment",
    });
    return rows[0] ? Number(rows[0].covering_user_id) : undefined;
  };

  // shift_ids/requesting_user_id/offered_shift_ids have no default — tests
  // must wire them to their own fixtures.
  const createSwapRequest = async (overrides = {}) => {
    const record = await base44.entities.SwapRequest.create({
      request_type: "General",
      req_start_date: PLACEHOLDER_DATE,
      req_end_date: PLACEHOLDER_DATE,
      req_start_time: "09:00",
      req_end_time: "09:00",
      status: "Open",
      ...overrides,
    });
    return track("SwapRequest", record);
  };

  // shift_id/covering_user_id have no default — tests must wire them to their
  // own fixtures. `type` defaults to "cover" (a helper taking a window);
  // ownership rows pass type:"assignment" explicitly. Cancel = delete the row
  // (there is no status field anymore).
  const createCoverage = async (overrides = {}) => {
    const record = await base44.entities.ShiftCoverage.create({
      type: "cover",
      cover_start_date: PLACEHOLDER_DATE,
      cover_end_date: PLACEHOLDER_DATE,
      cover_start_time: "09:00",
      cover_end_time: "09:00",
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

  return { createPerson, createShift, getOwner, createSwapRequest, createCoverage, untrack, cleanup };
}
