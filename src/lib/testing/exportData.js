import { base44 } from "@/api/base44Client";

// Plain client-side backup — no backend endpoint involved. Used as a safety
// net before running the live (data-mutating) test suite: even though every
// live test cleans up its own fixtures, this gives the admin something to
// fall back on if a run is interrupted (closed tab, network drop) before
// cleanup finishes.
export async function exportAllData() {
  const [authorizedPeople, shifts, swapRequests, coverages] = await Promise.all([
    base44.entities.AuthorizedPerson.list(),
    base44.entities.Shift.list(),
    base44.entities.SwapRequest.list(),
    base44.entities.ShiftCoverage.list(),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    authorizedPeople,
    shifts,
    swapRequests,
    coverages,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `razarto-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
