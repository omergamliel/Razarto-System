import { base44 } from "@/api/base44Client";

// Deleting a whole range of shifts. Record-by-record deletes exhaust the
// per-record delete limit long before a year's worth is gone (which left most
// of the range in place and reported a failure), so the range goes in bulk
// batches — and the rows pointing at those shifts (covers, swap requests) are
// cleared first, because a shift that is still referenced can't be deleted.
const BATCH_SIZE = 200;

const batchesOf = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    out.push(list.slice(i, i + BATCH_SIZE));
  }
  return out;
};

export async function deleteShiftsInRange(shiftIds) {
  const ids = (shiftIds || []).filter(Boolean);
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);

  const [coverages, requests] = await Promise.all([
    base44.entities.ShiftCoverage.list(),
    base44.entities.SwapRequest.list(),
  ]);
  const coverageIds = coverages
    .filter((c) => idSet.has(c.shift_id))
    .map((c) => c.id);
  const requestIds = requests
    .filter(
      (r) =>
        (r.shift_ids || []).some((id) => idSet.has(id)) ||
        (r.offered_shift_ids || []).some((id) => idSet.has(id)),
    )
    .map((r) => r.id);

  for (const batch of batchesOf(coverageIds)) {
    await base44.entities.ShiftCoverage.deleteMany({ id: { $in: batch } });
  }
  for (const batch of batchesOf(requestIds)) {
    await base44.entities.SwapRequest.deleteMany({ id: { $in: batch } });
  }
  for (const batch of batchesOf(ids)) {
    await base44.entities.Shift.deleteMany({ id: { $in: batch } });
  }
  return ids.length;
}