import { addDays, format, startOfWeek } from "date-fns";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";

const anchor = startOfWeek(new Date(), { weekStartsOn: 0 });
const startDate = format(anchor, "yyyy-MM-dd");
const endDate = format(addDays(anchor, 13), "yyyy-MM-dd");
const res = distributeShifts({
  people: [
    { serial_id: 1, full_name: "A" },
    { serial_id: 2, full_name: "B" },
  ],
  existingShifts: [],
  startDate,
  endDate,
});
const dow = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
res.assignments.forEach((a) => {
  console.log(a.date, dow[new Date(a.date).getDay()], "->", a.personId);
});
console.log("weeklyOverflow", JSON.stringify(res.weeklyOverflow));
console.log("relaxations", res.relaxations.length, "skipped", res.skipped.length);