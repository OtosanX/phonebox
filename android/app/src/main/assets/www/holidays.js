// Local calendar dates, independent of the weekday on which employers observe them.
function weekdayOfMonth(year, month, weekday, occurrence) {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + (weekday - first.getDay() + 7) % 7 + 7 * (occurrence - 1));
}

function lastMondayOfMay(year) {
  const last = new Date(year, 4, 31);
  return new Date(year, 4, 31 - (last.getDay() + 6) % 7);
}

// Gregorian Easter calculation from the U.S. Naval Observatory.
function easter(year) {
  const div = (a, b) => Math.trunc(a / b);
  const century = div(year, 100);
  const moonCycle = year % 19;
  const correction = div(century - 17, 25);
  let moon = (century - div(century, 4) - div(century - correction, 3) + 19 * moonCycle + 15) % 30;
  moon -= div(moon, 28) * (1 - div(moon, 28) * div(29, moon + 1) * div(21 - moonCycle, 11));
  const weekday = (year + div(year, 4) + moon + 2 - century + div(century, 4)) % 7;
  const offset = moon - weekday;
  const month = 3 + div(offset + 40, 44);
  return new Date(year, month - 1, offset + 28 - 31 * div(month, 4));
}

export function nextUsHoliday(today) {
  const year = today.getFullYear();
  const midnight = new Date(year, today.getMonth(), today.getDate()).getTime();
  const holidays = [
    ["New Year's Day", new Date(year, 0, 1)],
    ['Martin Luther King Jr. Day', weekdayOfMonth(year, 0, 1, 3)],
    ["Presidents' Day", weekdayOfMonth(year, 1, 1, 3)],
    ['Easter', easter(year)],
    ['Memorial Day', lastMondayOfMay(year)],
    ['Juneteenth', new Date(year, 5, 19)],
    ['Independence Day', new Date(year, 6, 4)],
    ['Labor Day', weekdayOfMonth(year, 8, 1, 1)],
    ['Columbus Day', weekdayOfMonth(year, 9, 1, 2)],
    ['Halloween', new Date(year, 9, 31)],
    ['Veterans Day', new Date(year, 10, 11)],
    ['Thanksgiving', weekdayOfMonth(year, 10, 4, 4)],
    ['Christmas Day', new Date(year, 11, 25)],
    ["New Year's Day", new Date(year + 1, 0, 1)],
  ];
  const [name, date] = holidays.find(([, date]) => date.getTime() >= midnight);
  return { name, date, isToday: date.getTime() === midnight };
}
