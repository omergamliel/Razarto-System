import { previewHolidayShares } from "@/lib/holidayDivisions";

const print = (label, days, divisions, breaks = []) =>
  console.log(label, JSON.stringify(previewHolidayShares(days, { divisions, breaks })));

print("פסח div2:", ["2027-04-21", "2027-04-22", "2027-04-23", "2027-04-24"], 2);
print("שבועות div3:", ["2027-06-10", "2027-06-11", "2027-06-12"], 3);
print("ראש השנה div3:", ["2027-10-01", "2027-10-02", "2027-10-03"], 3);
print("break@1:", ["2027-04-21", "2027-04-22", "2027-04-23"], 1, [1]);
print("break@2 (Fri):", ["2027-04-21", "2027-04-22", "2027-04-23", "2027-04-24"], 2, [2]);
print("break@1,3:", ["2027-04-21", "2027-04-22", "2027-04-23", "2027-04-24", "2027-04-25"], 1, [1, 3]);