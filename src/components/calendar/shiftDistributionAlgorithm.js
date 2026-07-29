// Fair shift distribution algorithm — to be implemented.
//
// Consumed by AdminSettingsModal (the "חלוקת משמרות" tab) via:
//   import { distributeShifts } from "./shiftDistributionAlgorithm";
//
// Expected signature:
//   distributeShifts({ people, existingShifts, startDate, endDate, holidayDates })
//     -> { assignments: [{ date, personId }], justiceTable: [{ personId, name, totalShifts }], skipped: [{ date, ... }] }
//
// Constraints the UI advertises to the admin:
//   - Only assign shifts to free days in the chosen range (never overwrite existing shifts).
//   - Max 2 shifts per person per ISO week (Sun..Sat).
//   - Friday + Saturday always go to the same person.
//   - Holiday dates (keys of holidayDates set) always go to the same person as the
//     surrounding Fri/Sat block.
//   - Pick the person with the fewest all-time shifts so far ("justice table").
export const distributeShifts = () => {
  throw new Error("shiftDistributionAlgorithm.distributeShifts not implemented yet");
};