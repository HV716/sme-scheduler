import { useState, useMemo, useCallback } from "react";
import Papa from "papaparse";

/* ============================================================
   DESIGN TOKENS — "Dispatch Console"
   A live-ops scheduling board, not a marketing page. Dark
   console background, amber/green/red signal colors for
   flag states, monospace for data-dense cells, grotesque
   for UI chrome. Signature element: the workload dial — a
   small radial gauge that visualizes rolling 4-week fairness
   everywhere an SME appears.
   ============================================================ */
const T = {
  bg: "#12151A",
  panel: "#1A1E25",
  panel2: "#20252E",
  line: "#2B313C",
  text: "#E7E9EC",
  sub: "#8A93A3",
  faint: "#5C6373",
  accent: "#5FB4D9", // primary interactive
  green: "#4FA875",
  amber: "#E0A63D",
  red: "#D9614F",
  purple: "#9B8CE0",
};

const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const ui = { fontFamily: "'Inter', system-ui, sans-serif" };

/* ============================================================
   SYNTHETIC DATA
   ============================================================ */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const LEVELS = { Associate: 1, Trained: 2, Expert: 3 };
const LEVEL_LABEL = { 1: "Associate", 2: "Trained", 3: "Expert" };

// Performance floor: a global minimum historical rating (on this topic) an SME
// needs to clear to be treated as "safe" for fairness-first ranking. SMEs with
// no rating on a topic yet (new to it) are treated as meeting the floor by
// default, so newcomers aren't penalized for lacking history. Deliberately a
// single global number for the MVP — see write-up for the tiered version
// (floor scales with session requiredLevel) considered and deferred.
const PERFORMANCE_FLOOR = 3.8;

// Default relative weights for the soft-optimization score. Exposed as
// "what-if" sliders in the UI so ops can see how the draft shifts before
// committing, without needing to re-run the AI reasoning layer each time.
const DEFAULT_WEIGHTS = { fairness: 1, performance: 1, preference: 1 };

const TOPICS = [
  "React Fundamentals",
  "System Design",
  "SQL Basics",
  "Behavioral Interview Prep",
  "DSA - Arrays",
  "DSA - Graphs",
  "Python for Data Science",
  "Backend Mock Interview",
  "Career Coaching",
  "ML Foundations",
];

function seedSessions() {
  return [
    { id: "S01", topic: "React Fundamentals", day: "Mon", start: "09:00", dur: 60, mode: "Cohort Class", level: 2, cohort: "FE-14" },
    { id: "S02", topic: "SQL Basics", day: "Mon", start: "11:00", dur: 45, mode: "Doubt Clearing", level: 1, cohort: "DA-08" },
    { id: "S03", topic: "DSA - Arrays", day: "Mon", start: "18:00", dur: 60, mode: "Cohort Class", level: 2, cohort: "SDE-21" },
    { id: "S04", topic: "System Design", day: "Tue", start: "10:00", dur: 90, mode: "Cohort Class", level: 3, cohort: "SDE-21" },
    { id: "S05", topic: "Backend Mock Interview", day: "Tue", start: "14:00", dur: 45, mode: "Mock Interview", level: 3, cohort: "SDE-19" },
    { id: "S06", topic: "Behavioral Interview Prep", day: "Tue", start: "17:00", dur: 45, mode: "Mock Interview", level: 2, cohort: "SDE-19" },
    { id: "S07", topic: "Python for Data Science", day: "Wed", start: "09:00", dur: 60, mode: "Cohort Class", level: 2, cohort: "DA-08" },
    { id: "S08", topic: "DSA - Graphs", day: "Wed", start: "18:00", dur: 60, mode: "Cohort Class", level: 3, cohort: "SDE-21" },
    { id: "S09", topic: "ML Foundations", day: "Wed", start: "19:30", dur: 60, mode: "Cohort Class", level: 3, cohort: "MLE-05" },
    { id: "S10", topic: "Career Coaching", day: "Thu", start: "11:00", dur: 30, mode: "1:1", level: 1, cohort: "SDE-19" },
    { id: "S11", topic: "SQL Basics", day: "Thu", start: "18:00", dur: 45, mode: "Doubt Clearing", level: 1, cohort: "DA-08" },
    { id: "S12", topic: "Backend Mock Interview", day: "Thu", start: "20:00", dur: 45, mode: "Mock Interview", level: 3, cohort: "SDE-21" },
    { id: "S13", topic: "React Fundamentals", day: "Fri", start: "09:00", dur: 60, mode: "Doubt Clearing", level: 1, cohort: "FE-14" },
    { id: "S14", topic: "System Design", day: "Fri", start: "17:00", dur: 90, mode: "Cohort Class", level: 3, cohort: "SDE-19" },
  ];
}

// availability blocks are [day, startHHMM, endHHMM] the SME is free
function seedSMEs() {
  return [
    {
      id: "SME1", name: "Ananya Rao", tz: "IST",
      skills: { "React Fundamentals": 3, "System Design": 2, "DSA - Arrays": 3 },
      ratings: { "React Fundamentals": 4.8, "System Design": 4.2, "DSA - Arrays": 4.6 },
      avail: [["Mon", "08:00", "13:00"], ["Wed", "17:00", "21:00"], ["Fri", "08:00", "12:00"]],
      history4: [3, 4, 2, 4], maxPerWeek: 5, prefers: ["React Fundamentals"],
    },
    {
      id: "SME2", name: "Rohan Mehta", tz: "IST",
      skills: { "System Design": 3, "Backend Mock Interview": 3, "DSA - Graphs": 3 },
      ratings: { "System Design": 4.9, "Backend Mock Interview": 4.7, "DSA - Graphs": 4.3 },
      avail: [["Tue", "09:00", "16:00"], ["Wed", "17:00", "21:00"], ["Thu", "18:00", "22:00"], ["Fri", "16:00", "20:00"]],
      history4: [5, 5, 4, 5], maxPerWeek: 4, prefers: ["System Design"],
    },
    {
      id: "SME3", name: "Priya Nair", tz: "IST",
      skills: { "SQL Basics": 3, "Python for Data Science": 3, "ML Foundations": 2 },
      ratings: { "SQL Basics": 4.5, "Python for Data Science": 4.6, "ML Foundations": 4.0 },
      avail: [["Mon", "10:00", "13:00"], ["Wed", "08:00", "12:00"], ["Thu", "17:00", "21:00"]],
      history4: [2, 3, 3, 2], maxPerWeek: 5, prefers: ["Python for Data Science"],
    },
    {
      id: "SME4", name: "Karan Verma", tz: "IST",
      skills: { "DSA - Arrays": 2, "DSA - Graphs": 3, "System Design": 2, "Backend Mock Interview": 2 },
      ratings: { "DSA - Arrays": 4.1, "DSA - Graphs": 4.4, "System Design": 3.8, "Backend Mock Interview": 4.0 },
      avail: [["Mon", "16:00", "21:00"], ["Wed", "16:00", "21:00"], ["Thu", "18:00", "22:00"]],
      history4: [4, 3, 4, 3], maxPerWeek: 4, prefers: ["DSA - Graphs"],
    },
    {
      id: "SME5", name: "Sana Iqbal", tz: "IST",
      skills: { "Behavioral Interview Prep": 3, "Career Coaching": 3, "Backend Mock Interview": 2 },
      ratings: { "Behavioral Interview Prep": 4.9, "Career Coaching": 4.8, "Backend Mock Interview": 4.2 },
      avail: [["Tue", "16:00", "20:00"], ["Thu", "10:00", "14:00"], ["Fri", "16:00", "20:00"]],
      history4: [2, 2, 3, 2], maxPerWeek: 4, prefers: ["Career Coaching"],
    },
    {
      id: "SME6", name: "Dev Patil", tz: "IST",
      skills: { "React Fundamentals": 2, "SQL Basics": 2, "DSA - Arrays": 2 },
      ratings: { "React Fundamentals": 3.9, "SQL Basics": 4.0, "DSA - Arrays": 3.7 },
      avail: [["Mon", "08:00", "12:00"], ["Thu", "16:00", "20:00"], ["Fri", "08:00", "12:00"]],
      history4: [1, 2, 1, 2], maxPerWeek: 5, prefers: ["React Fundamentals"],
    },
    {
      id: "SME7", name: "Meera Iyer", tz: "IST",
      skills: { "ML Foundations": 3, "Python for Data Science": 2, "System Design": 1 },
      ratings: { "ML Foundations": 4.7, "Python for Data Science": 4.1, "System Design": 3.5 },
      avail: [["Wed", "18:00", "21:00"], ["Fri", "16:00", "20:00"]],
      history4: [3, 3, 2, 3], maxPerWeek: 3, prefers: ["ML Foundations"],
    },
    {
      id: "SME8", name: "Arjun Das", tz: "IST",
      skills: { "Career Coaching": 2, "Behavioral Interview Prep": 2, "SQL Basics": 1 },
      ratings: { "Career Coaching": 4.0, "Behavioral Interview Prep": 3.9, "SQL Basics": 3.6 },
      avail: [["Thu", "09:00", "13:00"], ["Mon", "10:00", "13:00"]],
      history4: [1, 1, 2, 1], maxPerWeek: 4, prefers: [],
    },
  ];
}

/* ============================================================
   TIME HELPERS
   ============================================================ */
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/* ============================================================
   INGEST LAYER
   Real-world ops export sessions/SME data from a spreadsheet, so
   CSV is the natural upload format — it mirrors what a Google
   Sheets export would look like, and needs no special software to
   author or edit. SME data has nested fields (skills, ratings,
   availability windows), so those are pipe/comma-delimited within
   a single cell, same trick many spreadsheet-to-CSV exports use for
   repeating sub-fields. Template downloads exist so ops never has
   to guess the format from scratch.
   ============================================================ */
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvBuild = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

function downloadText(filename, text, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sessionsToCSV(sessions) {
  const header = ["id", "topic", "day", "start", "duration", "mode", "level", "cohort"];
  const rows = sessions.map((s) => [s.id, s.topic, s.day, s.start, s.dur, s.mode, LEVEL_LABEL[s.level], s.cohort]);
  return csvBuild([header, ...rows]);
}

function smesToCSV(smes) {
  const header = ["id", "name", "timezone", "maxPerWeek", "skills", "ratings", "availability", "history4", "prefers"];
  const rows = smes.map((sme) => [
    sme.id, sme.name, sme.tz, sme.maxPerWeek,
    Object.entries(sme.skills).map(([t, l]) => `${t}:${LEVEL_LABEL[l]}`).join("|"),
    Object.entries(sme.ratings).map(([t, r]) => `${t}:${r}`).join("|"),
    sme.avail.map(([d, f, to]) => `${d}:${f}-${to}`).join("|"),
    sme.history4.join(","),
    sme.prefers.join("|"),
  ]);
  return csvBuild([header, ...rows]);
}

// Parses "Topic A:Expert|Topic B:Trained" into { "Topic A": 3, "Topic B": 2 }
function parseSkillMap(cell) {
  const out = {};
  if (!cell) return out;
  cell.split("|").forEach((pair) => {
    const [topic, levelName] = pair.split(":").map((x) => x?.trim());
    if (topic && levelName && LEVELS[levelName] !== undefined) out[topic] = LEVELS[levelName];
  });
  return out;
}
// Parses "Topic A:4.8|Topic B:4.2" into { "Topic A": 4.8, "Topic B": 4.2 }
function parseRatingMap(cell) {
  const out = {};
  if (!cell) return out;
  cell.split("|").forEach((pair) => {
    const [topic, rating] = pair.split(":").map((x) => x?.trim());
    if (topic && rating && !isNaN(Number(rating))) out[topic] = Number(rating);
  });
  return out;
}
// Parses "Mon:08:00-13:00|Wed:17:00-21:00" into [["Mon","08:00","13:00"], ...]
function parseAvailability(cell) {
  if (!cell) return [];
  return cell.split("|").map((block) => {
    const [day, range] = block.split(":").length > 2
      ? [block.split(":")[0], block.split(":").slice(1).join(":")]
      : block.split(":");
    const [from, to] = (range || "").split("-").map((x) => x?.trim());
    return [day?.trim(), from, to];
  }).filter((b) => b[0] && b[1] && b[2]);
}

function parseSessionsCSV(text) {
  const { data, errors } = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  if (errors.length) return { error: `CSV parse error: ${errors[0].message} (row ${errors[0].row})` };
  const required = ["id", "topic", "day", "start", "duration", "mode", "level", "cohort"];
  const missing = required.filter((c) => !(c in (data[0] || {})));
  if (data.length === 0) return { error: "No rows found in the file." };
  if (missing.length) return { error: `Missing required column(s): ${missing.join(", ")}` };

  const sessions = [];
  for (const [i, row] of data.entries()) {
    if (!DAYS.includes(row.day)) return { error: `Row ${i + 2}: "${row.day}" is not a valid day (expected Mon–Fri).` };
    if (!/^\d{2}:\d{2}$/.test(row.start)) return { error: `Row ${i + 2}: start time "${row.start}" should look like "09:00".` };
    if (LEVELS[row.level] === undefined) return { error: `Row ${i + 2}: level "${row.level}" should be Associate, Trained, or Expert.` };
    if (isNaN(Number(row.duration)) || Number(row.duration) <= 0) return { error: `Row ${i + 2}: duration "${row.duration}" should be a positive number of minutes.` };
    sessions.push({
      id: row.id || `S${i + 1}`, topic: row.topic, day: row.day, start: row.start,
      dur: Number(row.duration), mode: row.mode, level: LEVELS[row.level], cohort: row.cohort,
    });
  }
  return { sessions };
}

function parseSMEsCSV(text) {
  const { data, errors } = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  if (errors.length) return { error: `CSV parse error: ${errors[0].message} (row ${errors[0].row})` };
  const required = ["id", "name", "timezone", "maxPerWeek", "skills", "ratings", "availability", "history4", "prefers"];
  const missing = required.filter((c) => !(c in (data[0] || {})));
  if (data.length === 0) return { error: "No rows found in the file." };
  if (missing.length) return { error: `Missing required column(s): ${missing.join(", ")}` };

  const smes = [];
  for (const [i, row] of data.entries()) {
    const tz = (row.timezone || "").trim().toUpperCase() || "IST";
    if (TZ_OFFSETS[tz] === undefined) {
      return { error: `Row ${i + 2} (${row.name || row.id}): "${tz}" isn't a recognized timezone. Supported: ${Object.keys(TZ_OFFSETS).join(", ")}.` };
    }
    const skills = parseSkillMap(row.skills);
    if (Object.keys(skills).length === 0) return { error: `Row ${i + 2} (${row.name || row.id}): "skills" column has no valid "Topic:Level" pairs.` };
    const history4raw = (row.history4 || "").split(",").map((x) => Number(x.trim()));
    if (history4raw.length !== 4 || history4raw.some(isNaN)) return { error: `Row ${i + 2} (${row.name || row.id}): "history4" should be exactly 4 comma-separated numbers, e.g. "3,4,2,4".` };
    if (isNaN(Number(row.maxPerWeek)) || Number(row.maxPerWeek) <= 0) return { error: `Row ${i + 2} (${row.name || row.id}): "maxPerWeek" should be a positive number.` };
    smes.push({
      id: row.id, name: row.name, tz,
      skills, ratings: parseRatingMap(row.ratings), avail: parseAvailability(row.availability),
      history4: history4raw, maxPerWeek: Number(row.maxPerWeek),
      prefers: (row.prefers || "").split("|").map((x) => x.trim()).filter(Boolean),
    });
  }
  return { smes };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Sessions are scheduled in the org's reference timezone (IST). SME
// availability is stored in the SME's own local timezone, so it must be
// converted into the reference timezone before comparing against a session's
// time — this is the actual timezone-handling edge case named in the
// assignment, not just a display label. Unknown/blank timezones default to
// the reference zone (no shift) as a safe fallback.
// Supported timezone abbreviations. This is a fixed, documented list — not
// the full ~400-zone IANA database — and doesn't auto-resolve daylight saving
// (EST vs EDT is the uploader's choice, not computed from the date). An
// unrecognized value is rejected at upload time (see parseSMEsCSV) rather
// than silently treated as zero-shift, since a silent wrong assumption here
// would produce a schedule that looks correct but isn't.
const TZ_OFFSETS = {
  IST: 5.5, UTC: 0, GMT: 0,
  EST: -5, EDT: -4, CST: -6, CDT: -5, PST: -8, PDT: -7,
  CET: 1, CEST: 2, SGT: 8, AEST: 10, AEDT: 11, ACST: 9.5,
  JST: 9, KST: 9, NZST: 12, HST: -10, AKST: -9, MSK: 3,
};
const REFERENCE_TZ = "IST";

function shiftDay(day, delta) {
  const idx = DAYS.indexOf(day);
  if (idx === -1) return null;
  const newIdx = idx + delta;
  return newIdx >= 0 && newIdx < DAYS.length ? DAYS[newIdx] : null; // falls outside the Mon–Fri week
}

// Converts an SME's local-time availability windows into reference-timezone
// minutes, splitting any window that crosses midnight after conversion into
// two same-day segments rather than dropping it.
function availabilityInReferenceTz(avail, smeTz) {
  const localOffset = TZ_OFFSETS[smeTz] ?? TZ_OFFSETS[REFERENCE_TZ];
  const deltaMinutes = Math.round((TZ_OFFSETS[REFERENCE_TZ] - localOffset) * 60);
  const segments = [];
  avail.forEach(([day, from, to]) => {
    let fromMin = toMin(from) + deltaMinutes;
    let toMinVal = toMin(to) + deltaMinutes;
    const dayShift = Math.floor(fromMin / 1440);
    fromMin -= dayShift * 1440;
    toMinVal -= dayShift * 1440;
    const day1 = shiftDay(day, dayShift);
    if (toMinVal <= 1440) {
      if (day1) segments.push([day1, fromMin, toMinVal]);
    } else {
      if (day1) segments.push([day1, fromMin, 1440]);
      const day2 = shiftDay(day, dayShift + 1);
      if (day2) segments.push([day2, 0, toMinVal - 1440]);
    }
  });
  return segments;
}

function isAvailable(sme, session) {
  const sStart = toMin(session.start);
  const sEnd = sStart + session.dur;
  const availRef = availabilityInReferenceTz(sme.avail, sme.tz);
  return availRef.some(([day, fromMin, toMinVal]) => day === session.day && sStart >= fromMin && sEnd <= toMinVal);
}

/* ============================================================
   MATCHING ENGINE — deterministic rules + scoring
   ============================================================ */
const poolAvg4 = (smes) =>
  smes.reduce((sum, s) => sum + s.history4.reduce((a, b) => a + b, 0) / 4, 0) / smes.length;

function scoreCandidate(sme, session, thisWeekCount, avgPool, weights) {
  const rating = sme.ratings[session.topic] ?? 3.5; // historical performance
  const rollingAvg = sme.history4.reduce((a, b) => a + b, 0) / 4;
  const projected = rollingAvg === 0 ? thisWeekCount : (rollingAvg * 4 + thisWeekCount) / 5;
  // fairness: reward SMEs currently below the pool's rolling average
  const fairness = Math.max(0, avgPool - projected) * 2.2;
  const levelBonus = sme.skills[session.topic] === session.level ? 0.6 : sme.skills[session.topic] > session.level ? 0.3 : 0;
  const prefBonus = sme.prefers.includes(session.topic) ? 0.5 : 0;
  const loadPenalty = thisWeekCount * 0.9; // discourage piling onto one SME within the same run
  // whether they clear the performance floor on THIS topic (new-to-topic = benign default: treated as meeting it)
  const meetsFloor = sme.ratings[session.topic] === undefined || sme.ratings[session.topic] >= PERFORMANCE_FLOOR;
  const score =
    rating * weights.performance +
    fairness * weights.fairness +
    prefBonus * weights.preference +
    levelBonus -
    loadPenalty;
  return {
    score: Number(score.toFixed(2)),
    rating,
    fairness: Number(fairness.toFixed(2)),
    rollingAvg: Number(rollingAvg.toFixed(2)),
    meetsFloor,
  };
}

function candidatesFor(session, smes, weekCounts, busy, avgPool, weights) {
  return smes
    .map((sme) => {
      const reasons = [];
      const skillLevel = sme.skills[session.topic];
      if (skillLevel === undefined) reasons.push("no expertise in topic");
      else if (skillLevel < session.level) reasons.push(`below required level (${LEVEL_LABEL[skillLevel]} < ${LEVEL_LABEL[session.level]})`);
      if (!isAvailable(sme, session)) reasons.push("not available at this slot");
      const key = `${sme.id}`;
      const clash = (busy[key] || []).some((b) => b.day === session.day && overlaps(toMin(b.start), toMin(b.start) + b.dur, toMin(session.start), toMin(session.start) + session.dur));
      if (clash) reasons.push("double-booked this week");
      if ((weekCounts[sme.id] || 0) >= sme.maxPerWeek) reasons.push("at weekly session cap");
      const qualifies = reasons.length === 0;
      const s = qualifies ? scoreCandidate(sme, session, weekCounts[sme.id] || 0, avgPool, weights) : null;
      return { sme, qualifies, reasons, ...s };
    })
    .sort((a, b) => (b.qualifies - a.qualifies) || ((b.score ?? -99) - (a.score ?? -99)));
}

// Confidence: how decisively the top candidate beat the runner-up, mapped to
// 0-100. A wide gap (or no runner-up at all) reads as high confidence; a
// razor-thin gap reads as low confidence, which is exactly the situation a
// "tie" flag also captures — confidence makes that judgment visible on every
// assignment, not just the flagged edge cases.
function computeConfidence(top, second) {
  if (!second) return 96;
  const gap = top.score - second.score;
  const pct = Math.round(55 + gap * 28);
  return Math.max(30, Math.min(99, pct));
}

function runMatchingEngine(sessions, smes, weights = DEFAULT_WEIGHTS) {
  const avgPool = poolAvg4(smes);
  const weekCounts = {};
  const busy = {};
  const assignments = [];
  const flags = [];
  const ties = [];

  // Stable order: harder-to-fill (higher required level, fewer qualified SMEs) first
  const ordered = [...sessions].sort((a, b) => b.level - a.level);

  for (const session of ordered) {
    const ranked = candidatesFor(session, smes, weekCounts, busy, avgPool, weights);
    const qualified = ranked.filter((r) => r.qualifies);

    if (qualified.length === 0) {
      const allReasons = Array.from(new Set(ranked.flatMap((r) => r.reasons)));
      assignments.push({ sessionId: session.id, smeId: null, status: "unfilled" });
      flags.push({
        type: "unfilled",
        severity: "high",
        sessionId: session.id,
        reason:
          allReasons.length === 1
            ? `No qualified SME: ${allReasons[0]}.`
            : `No qualified SME available — ${allReasons.slice(0, 2).join("; ")}.`,
      });
      continue;
    }

    // Performance floor: rank fairness/performance/preference only among
    // candidates who clear the floor on this topic. If NOBODY clears it,
    // fall back to the full qualified pool (still safe on hard rules — just
    // not "strong" on this topic) and flag it loudly rather than leaving the
    // session unfilled.
    const clearsFloor = qualified.filter((r) => r.meetsFloor);
    const pool = clearsFloor.length > 0 ? clearsFloor : qualified;
    const belowFloorFallback = clearsFloor.length === 0;

    const top = pool[0];
    const second = pool[1];
    const isTie = second && Math.abs(top.score - second.score) < 0.35;
    const confidence = computeConfidence(top, second);

    assignments.push({
      sessionId: session.id, smeId: top.sme.id, status: "assigned",
      score: top.score, runnerUp: second?.sme.id, confidence, belowFloorFallback,
    });
    weekCounts[top.sme.id] = (weekCounts[top.sme.id] || 0) + 1;
    busy[top.sme.id] = [...(busy[top.sme.id] || []), { day: session.day, start: session.start, dur: session.dur }];

    if (belowFloorFallback) {
      flags.push({
        type: "below_floor",
        severity: "medium",
        sessionId: session.id,
        reason: `${top.sme.name} is the strongest available option, but no qualified SME clears the performance floor (${PERFORMANCE_FLOOR}★) for "${session.topic}" this week — recommend reviewing before publishing.`,
      });
    }

    if (isTie) {
      ties.push({
        sessionId: session.id,
        topic: session.topic,
        a: { id: top.sme.id, name: top.sme.name, score: top.score, rating: top.rating },
        b: { id: second.sme.id, name: second.sme.name, score: second.score, rating: second.rating },
      });
      flags.push({ type: "tie", severity: "low", sessionId: session.id, reason: `Close call between ${top.sme.name} and ${second.sme.name} — pending rationale.` });
    }
  }

  // fairness violation pass — after full run, projected week load vs pool average
  const fairnessFlags = [];
  for (const sme of smes) {
    const count = weekCounts[sme.id] || 0;
    const rollingAvg = sme.history4.reduce((a, b) => a + b, 0) / 4;
    if (count > rollingAvg * 1.6 + 1) {
      fairnessFlags.push({ smeId: sme.id, name: sme.name, count, rollingAvg: Number(rollingAvg.toFixed(1)) });
      flags.push({
        type: "fairness",
        severity: "medium",
        smeId: sme.id,
        reason: `${sme.name} assigned ${count} sessions this week vs. a ${rollingAvg.toFixed(1)}-session rolling average — overloaded relative to peers.`,
      });
    }
    if (count === 0 && Object.keys(sme.skills).some((t) => sessions.some((s) => s.topic === t))) {
      flags.push({
        type: "fairness",
        severity: "low",
        smeId: sme.id,
        reason: `${sme.name} received 0 sessions this week despite matching skills — check for under-utilization.`,
      });
    }
  }

  return { assignments, flags, ties, fairnessFlags, weekCounts, avgPool };
}

/* ============================================================
   LLM REASONING LAYER
   One batched call: tie-break rationale + fairness narrative +
   an ops-facing executive summary. Deterministic flags (unfilled,
   availability, cap) don't need the model — only judgment calls do.
   ============================================================ */
async function getLLMReasoning({ ties, fairnessFlags, unfilledCount, totalSessions }) {
  const prompt = `You are assisting an ops team reviewing an auto-generated SME-to-session teaching schedule.
Return ONLY minified JSON, no markdown, matching exactly this shape:
{"tieBreaks":[{"sessionId":"","explanation":""}],"fairnessNotes":[{"smeId":"","note":""}],"summary":""}

Rules:
- tieBreaks: one entry per tie below, a 1-sentence, ops-friendly explanation of why the FIRST candidate (a) is the marginally better pick over the second (b), referencing rating/fit, not raw scores.
- fairnessNotes: one short, constructive sentence per fairness flag suggesting a rebalancing action for next week.
- summary: 2 sentences, plain language, for a curriculum ops manager: overall fill rate and the single biggest risk in this draft.

Ties: ${JSON.stringify(ties)}
FairnessFlags: ${JSON.stringify(fairnessFlags)}
UnfilledCount: ${unfilledCount}
TotalSessions: ${totalSessions}`;

  const response = await fetch("/api/reason", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) throw new Error(`reasoning endpoint returned ${response.status}`);
  const data = await response.json();
  const text = data.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

/* ============================================================
   SMALL UI PRIMITIVES
   ============================================================ */
function WorkloadDial({ count, avg, size = 34 }) {
  const ratio = avg > 0 ? Math.min(count / (avg * 1.6), 1.4) : count > 0 ? 1.4 : 0;
  const pct = Math.min(ratio / 1.4, 1);
  const color = count > avg * 1.6 + 1 ? T.red : count < avg * 0.6 ? T.amber : T.green;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.line} strokeWidth="3.5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3.5"
        strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fill={T.text} fontSize="10.5" style={mono}>{count}</text>
    </svg>
  );
}

function Badge({ children, tone = "sub" }) {
  const colors = { green: T.green, amber: T.amber, red: T.red, accent: T.accent, sub: T.faint, purple: T.purple };
  const c = colors[tone];
  return (
    <span style={{
      ...mono, fontSize: 10.5, letterSpacing: 0.4, color: c, border: `1px solid ${c}55`,
      background: `${c}18`, borderRadius: 4, padding: "2px 6px", textTransform: "uppercase", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

/* ============================================================
   MAIN APP
   ============================================================ */
export default function SchedulerApp() {
  const [sessions, setSessions] = useState(seedSessions);
  const [smes, setSmes] = useState(seedSMEs);
  const [dataSource, setDataSource] = useState({ sessions: "sample", smes: "sample" }); // "sample" | "uploaded"
  const [ingestError, setIngestError] = useState(null);
  const [showIngest, setShowIngest] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | matching | reasoning | draft | submitted
  const [engineOut, setEngineOut] = useState(null);
  const [aiOut, setAiOut] = useState(null);
  const [overrides, setOverrides] = useState({}); // sessionId -> smeId
  const [approved, setApproved] = useState({}); // sessionId -> bool
  const [tab, setTab] = useState("schedule");
  const [aiError, setAiError] = useState(null);
  const [droppedNote, setDroppedNote] = useState(null);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [aiStale, setAiStale] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const avgPool = useMemo(() => poolAvg4(smes), [smes]);

  const runReasoning = useCallback(async (out) => {
    try {
      const ai = await getLLMReasoning({
        ties: out.ties,
        fairnessFlags: out.fairnessFlags,
        unfilledCount: out.flags.filter((f) => f.type === "unfilled").length,
        totalSessions: sessions.length,
      });
      setAiOut(ai);
      setAiError(null);
    } catch (e) {
      setAiError("AI reasoning layer unavailable — showing rule-based flags only.");
      setAiOut({ tieBreaks: [], fairnessNotes: [], summary: null });
    }
    setAiStale(false);
  }, [sessions]);

  const runAll = useCallback(async () => {
    setPhase("matching");
    setOverrides({});
    setApproved({});
    setDroppedNote(null);
    setAiError(null);
    setWeights(DEFAULT_WEIGHTS);
    await new Promise((r) => setTimeout(r, 350)); // let the UI show the matching step
    const out = runMatchingEngine(sessions, smes, DEFAULT_WEIGHTS);
    setEngineOut(out);
    setPhase("reasoning");
    await runReasoning(out);
    setPhase("draft");
  }, [sessions, smes, runReasoning]);

  // "What-if" sliders: re-run the deterministic engine instantly on every
  // weight change — pure client-side recompute, no API call, so it feels
  // live. The AI explanations (tie rationale, fairness notes, summary) stay
  // as-is until ops explicitly asks to refresh them, so nudging a slider
  // never triggers a surprise API call or cost.
  const updateWeight = (key, value) => {
    const next = { ...weights, [key]: value };
    setWeights(next);
    const out = runMatchingEngine(sessions, smes, next);
    setEngineOut(out);
    setAiStale(true);
  };

  const reanalyze = async () => {
    if (!engineOut) return;
    setReanalyzing(true);
    await runReasoning(engineOut);
    setReanalyzing(false);
  };

  // Uploading new data invalidates any existing draft — ops should re-run
  // matching against the freshly ingested week rather than see stale results.
  const resetDraftState = () => {
    setEngineOut(null);
    setAiOut(null);
    setOverrides({});
    setApproved({});
    setPhase("idle");
    setDroppedNote(null);
  };

  const handleSessionsUpload = async (file) => {
    setIngestError(null);
    try {
      const text = await readFileAsText(file);
      const { sessions: parsed, error } = parseSessionsCSV(text);
      if (error) return setIngestError(`Sessions file: ${error}`);
      setSessions(parsed);
      setDataSource((d) => ({ ...d, sessions: "uploaded" }));
      resetDraftState();
    } catch (e) {
      setIngestError("Couldn't read that file. Make sure it's a .csv file exported from a spreadsheet.");
    }
  };

  const handleSMEsUpload = async (file) => {
    setIngestError(null);
    try {
      const text = await readFileAsText(file);
      const { smes: parsed, error } = parseSMEsCSV(text);
      if (error) return setIngestError(`SME pool file: ${error}`);
      setSmes(parsed);
      setDataSource((d) => ({ ...d, smes: "uploaded" }));
      resetDraftState();
    } catch (e) {
      setIngestError("Couldn't read that file. Make sure it's a .csv file exported from a spreadsheet.");
    }
  };

  const resetToSampleData = () => {
    setSessions(seedSessions());
    setSmes(seedSMEs());
    setDataSource({ sessions: "sample", smes: "sample" });
    setIngestError(null);
    resetDraftState();
  };

  const smeById = (id) => smes.find((s) => s.id === id);
  const sessionById = (id) => sessions.find((s) => s.id === id);

  const finalAssignment = (sessionId) => {
    if (overrides[sessionId] !== undefined) return overrides[sessionId];
    return engineOut?.assignments.find((a) => a.sessionId === sessionId)?.smeId ?? null;
  };

  const currentWeekCounts = useMemo(() => {
    if (!engineOut) return {};
    const counts = {};
    for (const s of sessions) {
      const smeId = finalAssignment(s.id);
      if (smeId) counts[smeId] = (counts[smeId] || 0) + 1;
    }
    return counts;
  }, [engineOut, overrides, sessions]);

  const qualifiedFor = (session) => smes.filter((sme) => {
    const lvl = sme.skills[session.topic];
    return lvl !== undefined && lvl >= session.level && isAvailable(sme, session);
  });

  const simulateDropout = (sessionId) => {
    const smeId = finalAssignment(sessionId);
    if (!smeId) return;
    const sme = smeById(smeId);
    setOverrides((o) => ({ ...o, [sessionId]: "__DROPPED__" }));
    setApproved((a) => ({ ...a, [sessionId]: false }));
    setDroppedNote(`${sme.name} dropped out of ${sessionById(sessionId).topic} (${sessionId}, ${sessionById(sessionId).day} ${sessionById(sessionId).start}). Re-matching against remaining pool — pick a replacement below.`);
  };

  const stats = useMemo(() => {
    if (!engineOut) return null;
    const total = sessions.length;
    const unfilled = sessions.filter((s) => !finalAssignment(s.id) || finalAssignment(s.id) === "__DROPPED__").length;
    const approvedCount = Object.values(approved).filter(Boolean).length;
    return { total, filled: total - unfilled, unfilled, approvedCount };
  }, [engineOut, overrides, approved, sessions]);

  // Export to Sheets: this is the read/write seam where a real Google Sheets
  // API write-back would plug in (see write-up §2/§6). For the prototype it
  // generates a CSV in the exact shape ops would paste into or import as a
  // Google Sheet — same columns, same one-row-per-session structure — without
  // needing OAuth credentials for a synthetic-data demo.
  const csvField = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const exportToSheet = () => {
    const header = ["Session ID", "Day", "Time", "Topic", "Mode", "Cohort", "Required Level", "Assigned SME", "Status", "Confidence %", "Approved"];
    const rows = [...sessions]
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || toMin(a.start) - toMin(b.start))
      .map((s) => {
        const smeId = finalAssignment(s.id);
        const dropped = smeId === "__DROPPED__";
        const sme = smeId && !dropped ? smeById(smeId) : null;
        const eng = engineOut.assignments.find((a) => a.sessionId === s.id);
        const confidence = overrides[s.id] === undefined ? eng?.confidence ?? "" : "";
        const status = sme ? "Assigned" : dropped ? "Needs reassignment" : "Unfilled";
        return [s.id, s.day, s.start, s.topic, s.mode, s.cohort, LEVEL_LABEL[s.level], sme?.name || "—", status, confidence, approved[s.id] ? "Yes" : "No"];
      });
    const csv = [header, ...rows].map((r) => r.map(csvField).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sme-schedule-week-${sessions[0]?.day || "draft"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ ...ui, background: T.bg, color: T.text, minHeight: 640, borderRadius: 10, overflow: "hidden", border: `1px solid ${T.line}` }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${T.line}`, background: T.panel }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}>Dispatch — SME Scheduling</div>
          <div style={{ fontSize: 11.5, color: T.sub, ...mono }}>Week of Mon Aug 31 – Fri Sep 04, 2026 · {sessions.length} sessions · {smes.length} SMEs · IST</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {phase === "draft" && stats && (
            <span style={{ fontSize: 11.5, color: T.sub, ...mono, marginRight: 6 }}>
              fill {stats.filled}/{stats.total} · approved {stats.approvedCount}/{stats.total}
            </span>
          )}
          <button onClick={() => setShowIngest((v) => !v)} style={{
            ...mono, fontSize: 11.5, color: showIngest ? "#0E1013" : T.text, background: showIngest ? T.accent : T.panel2,
            border: `1px solid ${T.line}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer",
          }}>
            📄 Data {dataSource.sessions === "uploaded" || dataSource.smes === "uploaded" ? "●" : ""}
          </button>
          <button onClick={runAll} disabled={phase === "matching" || phase === "reasoning"} style={{
            ...mono, fontSize: 12, fontWeight: 600, color: "#0E1013", background: T.accent, border: "none",
            borderRadius: 6, padding: "8px 14px", cursor: "pointer", opacity: phase === "matching" || phase === "reasoning" ? 0.6 : 1,
          }}>
            {phase === "idle" ? "▶ Run Matching" : phase === "matching" ? "Matching…" : phase === "reasoning" ? "Reasoning…" : "↻ Re-run Week"}
          </button>
        </div>
      </div>

      {showIngest && (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.line}`, background: T.panel2 }}>
          <div style={{ fontSize: 10.5, color: T.faint, ...mono, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Ingest — upload this week's data (or keep the sample dataset below)
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Sessions</span>
                <Badge tone={dataSource.sessions === "uploaded" ? "green" : "sub"}>{dataSource.sessions === "uploaded" ? "uploaded" : "sample data"}</Badge>
              </div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 8 }}>{sessions.length} sessions loaded</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <label style={{ ...mono, fontSize: 10.5, color: "#0E1013", background: T.accent, borderRadius: 5, padding: "5px 9px", cursor: "pointer" }}>
                  Upload CSV
                  <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handleSessionsUpload(e.target.files[0])} />
                </label>
                <button onClick={() => downloadText("sessions-template.csv", sessionsToCSV(sessions))} style={{
                  ...mono, fontSize: 10.5, color: T.text, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 5, padding: "5px 9px", cursor: "pointer",
                }}>Download template</button>
              </div>
            </div>
            <div style={{ flex: "1 1 280px", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>SME Pool</span>
                <Badge tone={dataSource.smes === "uploaded" ? "green" : "sub"}>{dataSource.smes === "uploaded" ? "uploaded" : "sample data"}</Badge>
              </div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 8 }}>{smes.length} SMEs loaded</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <label style={{ ...mono, fontSize: 10.5, color: "#0E1013", background: T.accent, borderRadius: 5, padding: "5px 9px", cursor: "pointer" }}>
                  Upload CSV
                  <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handleSMEsUpload(e.target.files[0])} />
                </label>
                <button onClick={() => downloadText("sme-pool-template.csv", smesToCSV(smes))} style={{
                  ...mono, fontSize: 10.5, color: T.text, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 5, padding: "5px 9px", cursor: "pointer",
                }}>Download template</button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <div style={{ fontSize: 10.5, color: T.faint, lineHeight: 1.5, maxWidth: 560 }}>
              SME columns encode nested fields as <code>Topic:Level</code> or <code>Day:start-end</code> pairs separated by <code>|</code> — download a template to see a filled example before editing. Timezone must be one of: IST, EST, EDT, CST, CDT, PST, PDT, UTC, GMT, CET, CEST, SGT, AEST, AEDT, ACST, JST, KST, NZST, HST, AKST, MSK.
            </div>
            {(dataSource.sessions === "uploaded" || dataSource.smes === "uploaded") && (
              <button onClick={resetToSampleData} style={{ ...mono, fontSize: 10.5, color: T.amber, background: "transparent", border: `1px solid ${T.amber}55`, borderRadius: 5, padding: "5px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>
                ↺ Reset to sample data
              </button>
            )}
          </div>
          {ingestError && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: `${T.red}15`, border: `1px solid ${T.red}45`, borderRadius: 6, fontSize: 11.5, color: T.text }}>
              ⚠ {ingestError}
            </div>
          )}
        </div>
      )}

      {phase === "draft" && engineOut && (
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "9px 20px", borderBottom: `1px solid ${T.line}`, background: T.panel2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: T.faint, ...mono, textTransform: "uppercase", letterSpacing: 0.6 }}>What-if weights</span>
          {[
            ["fairness", "Fairness", T.green],
            ["performance", "Performance", T.accent],
            ["preference", "Preference", T.purple],
          ].map(([key, label, color]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ color: T.sub }}>{label}</span>
              <input
                type="range" min="0" max="2" step="0.1" value={weights[key]}
                onChange={(e) => updateWeight(key, Number(e.target.value))}
                style={{ accentColor: color, width: 80 }}
              />
              <span style={{ ...mono, color, width: 26, display: "inline-block" }}>{weights[key].toFixed(1)}×</span>
            </label>
          ))}
          {aiStale && (
            <button onClick={reanalyze} disabled={reanalyzing} style={{
              ...mono, fontSize: 10.5, color: "#0E1013", background: T.amber, border: "none", borderRadius: 5,
              padding: "4px 9px", cursor: "pointer", marginLeft: "auto", opacity: reanalyzing ? 0.6 : 1,
            }}>
              {reanalyzing ? "Refreshing…" : "↻ Refresh AI notes for new weights"}
            </button>
          )}
        </div>
      )}

      {phase === "idle" && (
        <div style={{ padding: 60, textAlign: "center", color: T.sub }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>No draft yet.</div>
          <div style={{ fontSize: 12 }}>Run the matcher to ingest this week's sessions and SME pool, apply hard rules + fair-rotation scoring, and generate a reviewable draft.</div>
        </div>
      )}

      {(phase === "matching" || phase === "reasoning") && (
        <div style={{ padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: T.sub, ...mono }}>
            {phase === "matching" ? "Applying hard filters (availability, expertise, caps) and fairness scoring…" : "Calling reasoning layer for tie-breaks, fairness notes and summary…"}
          </div>
        </div>
      )}

      {phase === "draft" && engineOut && (
        <div style={{ display: "flex" }}>
          {/* Main panel */}
          <div style={{ flex: 1, borderRight: `1px solid ${T.line}` }}>
            <div style={{ display: "flex", gap: 2, padding: "10px 16px 0" }}>
              {[["schedule", "Draft Schedule"], ["pool", "SME Pool"]].map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} style={{
                  ...mono, fontSize: 11.5, padding: "7px 12px", borderRadius: "6px 6px 0 0", border: "none", cursor: "pointer",
                  background: tab === k ? T.panel2 : "transparent", color: tab === k ? T.text : T.sub,
                }}>{label}</button>
              ))}
            </div>

            {aiOut?.summary && (
              <div style={{ margin: "12px 16px 0", padding: "10px 12px", background: `${T.accent}12`, border: `1px solid ${T.accent}40`, borderRadius: 6, fontSize: 12.5, lineHeight: 1.5 }}>
                <span style={{ color: T.accent, fontWeight: 700, marginRight: 6 }}>AI SUMMARY</span>{aiOut.summary}
              </div>
            )}
            {aiError && <div style={{ margin: "12px 16px 0", fontSize: 11.5, color: T.amber, ...mono }}>{aiError}</div>}
            {droppedNote && <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: `${T.red}15`, border: `1px solid ${T.red}45`, borderRadius: 6, fontSize: 12 }}>⚠ {droppedNote}</div>}

            {tab === "schedule" && (
              <div style={{ padding: 16 }}>
                {DAYS.map((day) => {
                  const daySessions = sessions.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start));
                  if (daySessions.length === 0) return null;
                  return (
                    <div key={day} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, color: T.faint, ...mono, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{day}</div>
                      {daySessions.map((s) => {
                        const assignedId = finalAssignment(s.id);
                        const dropped = assignedId === "__DROPPED__";
                        const sme = assignedId && !dropped ? smeById(assignedId) : null;
                        const flag = engineOut.flags.find((f) => f.sessionId === s.id);
                        const tie = engineOut.ties.find((t) => t.sessionId === s.id);
                        const tieAi = aiOut?.tieBreaks?.find((t) => t.sessionId === s.id);
                        const isApproved = approved[s.id];
                        const qualified = qualifiedFor(s);
                        const engAssignment = engineOut.assignments.find((a) => a.sessionId === s.id);
                        const confidence = overrides[s.id] === undefined ? engAssignment?.confidence : null;
                        const belowFloor = overrides[s.id] === undefined && engAssignment?.belowFloorFallback;

                        return (
                          <div key={s.id} style={{
                            display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", marginBottom: 6,
                            background: T.panel, border: `1px solid ${dropped || (flag?.type === "unfilled") ? T.red + "50" : T.line}`, borderRadius: 7,
                          }}>
                            <div style={{ width: 92, ...mono, fontSize: 11.5, color: T.sub, paddingTop: 2 }}>{s.start} · {s.dur}m</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.topic}</span>
                                <Badge tone="sub">{s.mode}</Badge>
                                <Badge tone="sub">{LEVEL_LABEL[s.level]}+</Badge>
                                <Badge tone="sub">{s.cohort}</Badge>
                                <span style={{ fontSize: 10.5, color: T.faint, ...mono }}>{s.id}</span>
                              </div>

                              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                {sme ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <WorkloadDial count={currentWeekCounts[sme.id] || 0} avg={avgPool} size={26} />
                                    <span style={{ fontSize: 12.5 }}>{sme.name}</span>
                                    <span style={{ fontSize: 11, color: T.sub, ...mono }}>★{sme.ratings[s.topic]?.toFixed(1) ?? "—"}</span>
                                    {confidence != null && (
                                      <Badge tone={confidence >= 75 ? "green" : confidence >= 55 ? "amber" : "red"}>
                                        {confidence}% confidence
                                      </Badge>
                                    )}
                                    {belowFloor && <Badge tone="amber">below perf. floor</Badge>}
                                  </div>
                                ) : (
                                  <Badge tone="red">{dropped ? "needs reassignment" : "unfilled"}</Badge>
                                )}

                                <select
                                  value={assignedId && !dropped ? assignedId : ""}
                                  onChange={(e) => { setOverrides((o) => ({ ...o, [s.id]: e.target.value || null })); setApproved((a) => ({ ...a, [s.id]: false })); }}
                                  style={{ ...mono, fontSize: 11, background: T.panel2, color: T.text, border: `1px solid ${T.line}`, borderRadius: 5, padding: "3px 6px" }}
                                >
                                  <option value="">— unassigned —</option>
                                  {qualified.map((q) => (
                                    <option key={q.id} value={q.id}>{q.name}{q.id === assignedId ? " (matched)" : ""}</option>
                                  ))}
                                </select>

                                {sme && (
                                  <button onClick={() => simulateDropout(s.id)} style={{
                                    ...mono, fontSize: 10.5, color: T.amber, background: "transparent", border: `1px solid ${T.amber}55`,
                                    borderRadius: 5, padding: "3px 7px", cursor: "pointer",
                                  }}>simulate drop-out</button>
                                )}

                                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sub, marginLeft: "auto" }}>
                                  <input type="checkbox" checked={!!isApproved} disabled={!sme} onChange={(e) => setApproved((a) => ({ ...a, [s.id]: e.target.checked }))} />
                                  approve
                                </label>
                              </div>

                              {flag && (
                                <div style={{ marginTop: 6, fontSize: 11.5, color: flag.severity === "high" ? T.red : T.amber, lineHeight: 1.4 }}>
                                  ⚑ {flag.reason}
                                </div>
                              )}
                              {tie && (
                                <div style={{ marginTop: 4, fontSize: 11.5, color: T.purple, lineHeight: 1.4 }}>
                                  ⚖ {tieAi?.explanation || `Tie between ${tie.a.name} and ${tie.b.name} — awaiting AI rationale.`}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => {
                    const all = {};
                    sessions.forEach((s) => { if (finalAssignment(s.id) && finalAssignment(s.id) !== "__DROPPED__") all[s.id] = true; });
                    setApproved(all);
                  }} style={{ ...mono, fontSize: 11.5, color: T.text, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 6, padding: "7px 12px", cursor: "pointer" }}>
                    Approve all filled sessions
                  </button>
                  <button onClick={exportToSheet} style={{ ...mono, fontSize: 11.5, color: T.accent, background: "transparent", border: `1px solid ${T.accent}55`, borderRadius: 6, padding: "7px 12px", cursor: "pointer" }}>
                    ⬇ Export to Sheets (.csv)
                  </button>
                  <button onClick={() => setPhase("submitted")} style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: "#0E1013", background: T.green, border: "none", borderRadius: 6, padding: "7px 12px", cursor: "pointer" }}>
                    Submit approvals →
                  </button>
                </div>
              </div>
            )}

            {tab === "pool" && (
              <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {smes.map((sme) => {
                  const count = currentWeekCounts[sme.id] || 0;
                  const rollingAvg = sme.history4.reduce((a, b) => a + b, 0) / 4;
                  return (
                    <div key={sme.id} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <WorkloadDial count={count} avg={avgPool} size={36} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{sme.name}</div>
                          <div style={{ fontSize: 10.5, color: T.sub, ...mono }}>rolling avg {rollingAvg.toFixed(1)}/wk · cap {sme.maxPerWeek} · this week {count}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {Object.entries(sme.skills).map(([topic, lvl]) => (
                          <Badge key={topic} tone={lvl === 3 ? "green" : lvl === 2 ? "accent" : "sub"}>{topic} · {LEVEL_LABEL[lvl]}</Badge>
                        ))}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 10.5, color: T.faint, ...mono }}>4wk history: {sme.history4.join(" → ")}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right rail — flags */}
          <div style={{ width: 300, padding: 16, background: T.panel }}>
            <div style={{ fontSize: 11, color: T.faint, ...mono, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Flags &amp; Conflicts ({engineOut.flags.length})
            </div>
            {engineOut.flags.length === 0 && <div style={{ fontSize: 12, color: T.sub }}>No conflicts detected.</div>}
            {["high", "medium", "low"].map((sev) => {
              const items = engineOut.flags.filter((f) => f.severity === sev);
              if (items.length === 0) return null;
              const tone = sev === "high" ? T.red : sev === "medium" ? T.amber : T.purple;
              return (
                <div key={sev} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, ...mono, color: tone, marginBottom: 6, textTransform: "uppercase" }}>{sev} priority</div>
                  {items.map((f, i) => {
                    const aiNote = f.type === "fairness" && f.smeId ? aiOut?.fairnessNotes?.find((n) => n.smeId === f.smeId) : null;
                    return (
                      <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, padding: "8px 10px", background: T.panel2, borderRadius: 6, marginBottom: 6, border: `1px solid ${tone}30` }}>
                        <div style={{ color: T.text }}>{f.reason}</div>
                        {aiNote && <div style={{ marginTop: 4, color: T.accent, fontSize: 11 }}>↳ {aiNote.note}</div>}
                        {f.sessionId && <div style={{ marginTop: 4, color: T.faint, ...mono, fontSize: 10 }}>{f.sessionId}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === "submitted" && (
        <div style={{ padding: 50, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.green, marginBottom: 8 }}>Schedule submitted ✓</div>
          <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 4 }}>
            {stats.approvedCount} of {stats.total} sessions approved · {stats.unfilled} still need ops follow-up.
          </div>
          <div style={{ fontSize: 11.5, color: T.faint, ...mono, marginBottom: 20 }}>In production this write-back would push directly to the Google Sheet / Calendar via the FastAPI service — the CSV export below is that same read/write seam, standing in for a live Sheets API call in this synthetic-data prototype.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={exportToSheet} style={{ ...mono, fontSize: 11.5, color: T.accent, background: "transparent", border: `1px solid ${T.accent}55`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>
              ⬇ Export to Sheets (.csv)
            </button>
            <button onClick={() => setPhase("draft")} style={{ ...mono, fontSize: 11.5, color: T.text, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>← back to draft</button>
          </div>
        </div>
      )}
    </div>
  );
}
