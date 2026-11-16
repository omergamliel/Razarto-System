import { CATEGORY_LABELS, WEEKDAY_LABELS, categorize } from "./previewModel";

// One row per shift the run would write, in the order the calendar shows them.
// The header is Hebrew so the file opens naturally in Excel, and the same file
// can be edited and read back by parseAssignmentsCsv.
const HEADERS = ["תאריך", "יום", "שם מלא", "מספר סידורי", "קבוצה", "סוג יום"];
const BOM = "\uFEFF";

const DATE_COLUMNS = ["תאריך", "date", "start_date"];
const NAME_COLUMNS = ["שם מלא", "שם", "name", "full_name"];
const SERIAL_COLUMNS = ["מספר סידורי", "סידורי", "serial", "serial_id", "id"];

export const keyOf = (value) => String(value ?? "").slice(0, 10);

const escapeCell = (value) => {
  const text = String(value ?? "");
  return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Splits one CSV line, honouring quoted cells and doubled quotes inside them.
const splitLine = (line) => {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

// yyyy-MM-dd or the Israeli dd/MM/yyyy (also with dots or dashes).
const parseDateCell = (value) => {
  const text = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (!local) return "";
  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
};

/**
 * The preview's shifts as CSV text — the same rows the approval would create,
 * so a manager can review them in Excel, edit an owner, and load them back.
 */
export function buildAssignmentsCsv({
  assignments = [],
  people = [],
  holidayKeys = [],
  startDate,
  endDate,
}) {
  const bySerial = new Map(
    (people || []).map((person) => [Number(person.serial_id), person]),
  );
  const holidaySet = new Set((holidayKeys || []).map(keyOf));

  const rows = [...(assignments || [])]
    .map((entry) => ({ date: keyOf(entry.date), personId: Number(entry.personId) }))
    .filter((entry) => entry.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((entry) => {
      const person = bySerial.get(entry.personId);
      const date = new Date(`${entry.date}T00:00:00`);
      const valid = !Number.isNaN(date.getTime());
      return [
        entry.date,
        valid ? WEEKDAY_LABELS[date.getDay()] : "",
        person?.full_name || `#${entry.personId}`,
        entry.personId,
        person?.sign || "",
        valid ? CATEGORY_LABELS[categorize(entry.date, holidaySet)] : "",
      ]
        .map(escapeCell)
        .join(",");
    });

  return `${BOM}${[HEADERS.join(","), ...rows].join("\r\n")}`;
}

export const csvFileName = ({ startDate, endDate }) =>
  `חלוקת-משמרות_${keyOf(startDate) || "start"}_${keyOf(endDate) || "end"}.csv`;

export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Reads an edited CSV back into a schedule. Each row maps a date in the range
 * to a person (by serial id, or by full name when the id column was edited
 * away). A row with no person frees that day. The result replaces the run's
 * assignments; anything that cannot be matched comes back as a note.
 */
export function parseAssignmentsCsv(text, { people = [], startDate, endDate } = {}) {
  const bySerial = new Map();
  const byName = new Map();
  (people || []).forEach((person) => {
    bySerial.set(Number(person.serial_id), person);
    const name = String(person.full_name || "").trim();
    if (name) byName.set(name, person);
  });

  const from = keyOf(startDate);
  const to = keyOf(endDate);
  const empty = { assignments: [], errors: [], cleared: 0 };

  const lines = String(text || "")
    .replace(BOM, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) return { ...empty, errors: ["הקובץ ריק."] };

  const header = splitLine(lines[0]);
  const columnOf = (aliases) =>
    header.findIndex((cell) => aliases.includes(String(cell).toLowerCase()));
  const dateCol = columnOf(DATE_COLUMNS);
  const nameCol = columnOf(NAME_COLUMNS);
  const serialCol = columnOf(SERIAL_COLUMNS);
  if (dateCol < 0 || (nameCol < 0 && serialCol < 0)) {
    return {
      ...empty,
      errors: [
        "הקובץ אינו בפורמט של ייצוא מהתצוגה המקדימה — חסרות עמודות תאריך ושם.",
      ],
    };
  }

  const byDate = new Map();
  const errors = [];
  let cleared = 0;

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const cells = splitLine(line);
    const date = parseDateCell(cells[dateCol]);
    if (!date) {
      errors.push(`שורה ${rowNumber}: תאריך לא תקין.`);
      return;
    }
    if ((from && date < from) || (to && date > to)) {
      errors.push(`שורה ${rowNumber}: ${date} מחוץ לטווח החלוקה.`);
      return;
    }
    const serialCell = serialCol >= 0 ? String(cells[serialCol] || "").trim() : "";
    const nameCell = nameCol >= 0 ? String(cells[nameCol] || "").trim() : "";

    // An empty person cell is a deliberate "leave this day unassigned".
    if (!serialCell && !nameCell) {
      byDate.delete(date);
      cleared += 1;
      return;
    }

    const person =
      (serialCell && /^\d+$/.test(serialCell)
        ? bySerial.get(Number(serialCell))
        : null) ||
      (nameCell ? byName.get(nameCell) : null) ||
      (serialCell ? byName.get(serialCell) : null);

    if (!person) {
      errors.push(
        `שורה ${rowNumber}: האדם "${nameCell || serialCell}" לא נמצא ברשימת המשתמשים.`,
      );
      return;
    }
    if (byDate.has(date)) {
      errors.push(`שורה ${rowNumber}: ${date} מופיע יותר מפעם אחת — נשמרה השורה האחרונה.`);
    }
    byDate.set(date, { date, personId: Number(person.serial_id) });
  });

  const assignments = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return { assignments, errors, cleared };
}

// Reads a picked file, falling back to the Hebrew Windows encoding Excel saves
// as when the UTF-8 read comes back with replacement characters.
export async function readCsvFile(file) {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("\uFFFD")) {
    try {
      text = new TextDecoder("windows-1255").decode(buffer);
    } catch {
      // Keep the UTF-8 read — the notes will flag any unreadable rows.
    }
  }
  return text;
}