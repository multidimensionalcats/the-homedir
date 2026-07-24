// ============================================================
// Data Transform Layer — Pure transform functions
// ============================================================

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DailyEntry {
  date: string;
  hasAttentionData: boolean;
  categories: Record<string, { reads: number; writes: number }>;
  sessionCount: number;
  version: string;
}

export interface WeeklyEntry {
  weekStart: string; // ISO date of Monday
  hasAttentionData: boolean;
  categories: Record<string, { reads: number; writes: number }>;
  sessionCount: number;
}

export interface VersionPhase {
  version: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
  emptyCount: number;
}

export interface AttentionCategory {
  name: string;
  displayName: string;
  color: string;
}

export interface SwimlaneBlock {
  hash: string;
  heading: string;
  firstSeenDate: string;
  lastSeenDate: string;
  persistence: number; // 0-1 fraction
  snapshotIndices: number[];
}

export interface SwimlaneData {
  snapshots: Array<{
    date: string;
    sessionId: string;
    tokenCount: number;
    blockHashes: string[];
  }>;
  blocks: SwimlaneBlock[];
}

export interface TimelineMessage {
  direction: 'from_james' | 'to_james';
  date: string | null;
  content: string;
  lineStart: number;
  lineEnd: number;
  isAnomalous: boolean;
}

export interface CalibrationPrediction {
  text: string;
  confidence: number | null;
  dateMade: string;
  resolutionDate: string | null;
  outcome: string | null;
  selfAssessment: string | null;
  isResolved: boolean;
}

export interface PetLifecycle {
  petName: string;
  events: Array<{
    eventType: string;
    timestamp: string;
    notes: string;
  }>;
  firstEvent: string;
  lastEvent: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function accumulateProfiles(sessions: any[]): {
  hasAttentionData: boolean;
  categories: Record<string, { reads: number; writes: number }>;
} {
  let hasAttentionData = false;
  const categories: Record<string, { reads: number; writes: number }> = {};
  for (const session of sessions) {
    const profile = session.attention_profile || {};
    const keys = Object.keys(profile);
    if (keys.length > 0) {
      hasAttentionData = true;
    }
    for (const key of keys) {
      if (!categories[key]) {
        categories[key] = { reads: 0, writes: 0 };
      }
      categories[key].reads += profile[key].reads;
      categories[key].writes += profile[key].writes;
    }
  }
  return { hasAttentionData, categories };
}

export function sessionsToDaily(sessions: any[]): DailyEntry[] {
  if (sessions.length === 0) return [];

  const groups = new Map<string, any[]>();
  for (const session of sessions) {
    const date = session.date;
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(session);
  }

  const result: DailyEntry[] = [];
  for (const [date, dateSessions] of groups) {
    const { hasAttentionData, categories } = accumulateProfiles(dateSessions);

    result.push({
      date,
      hasAttentionData,
      categories,
      sessionCount: dateSessions.length,
      version: dateSessions[0].version,
    });
  }

  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}

function getISOWeekMonday(dateStr: string): string {
  // Parse date parts manually to avoid timezone issues
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed
  const day = parseInt(dayStr, 10);

  // Create date at noon UTC to avoid DST issues
  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const dow = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Calculate days to subtract to reach Monday
  let daysBack: number;
  if (dow === 0) {
    // Sunday -> go back 6 days to previous Monday
    daysBack = 6;
  } else {
    // Mon=1->0, Tue=2->1, ..., Sat=6->5
    daysBack = dow - 1;
  }

  const monday = new Date(Date.UTC(year, month, day - daysBack, 12, 0, 0));
  const mYear = monday.getUTCFullYear();
  const mMonth = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const mDay = String(monday.getUTCDate()).padStart(2, '0');
  return `${mYear}-${mMonth}-${mDay}`;
}

export function sessionsToWeekly(sessions: any[]): WeeklyEntry[] {
  if (sessions.length === 0) return [];

  const groups = new Map<string, any[]>();
  for (const session of sessions) {
    const weekStart = getISOWeekMonday(session.date);
    if (!groups.has(weekStart)) {
      groups.set(weekStart, []);
    }
    groups.get(weekStart)!.push(session);
  }

  const result: WeeklyEntry[] = [];
  for (const [weekStart, weekSessions] of groups) {
    const { hasAttentionData, categories } = accumulateProfiles(weekSessions);

    result.push({
      weekStart,
      hasAttentionData,
      categories,
      sessionCount: weekSessions.length,
    });
  }

  result.sort((a, b) =>
    a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0,
  );
  return result;
}

export function sessionsToVersionPhases(sessions: any[]): VersionPhase[] {
  if (sessions.length === 0) return [];

  const groups = new Map<string, any[]>();
  for (const session of sessions) {
    const version = session.version;
    if (!groups.has(version)) {
      groups.set(version, []);
    }
    groups.get(version)!.push(session);
  }

  const result: VersionPhase[] = [];
  for (const [version, versionSessions] of groups) {
    const dates = versionSessions.map((s: any) => s.date);
    dates.sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    let emptyCount = 0;
    for (const session of versionSessions) {
      const profile = session.attention_profile || {};
      if (Object.keys(profile).length === 0) {
        emptyCount++;
      }
    }

    result.push({
      version,
      startDate,
      endDate,
      sessionCount: versionSessions.length,
      emptyCount,
    });
  }

  result.sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0,
  );
  return result;
}

const ATTENTION_CATEGORIES: AttentionCategory[] = [
  { name: 'conversations', displayName: 'Conversations', color: '#7ea7c8' },
  { name: 'daily_notes', displayName: 'Daily Notes', color: '#6b9a8f' },
  { name: 'experiments', displayName: 'Experiments', color: '#8e7cc0' },
  { name: 'learning', displayName: 'Learning', color: '#c4a36e' },
  { name: 'memory_files', displayName: 'Memory Files', color: '#d4a020' },
  {
    name: 'msgs_from_james',
    displayName: 'Messages from James',
    color: '#6bb08a',
  },
  {
    name: 'msgs_to_james',
    displayName: 'Messages to James',
    color: '#569672',
  },
  { name: 'other', displayName: 'Other', color: '#838997' },
  { name: 'predictions', displayName: 'Predictions', color: '#7bc4a0' },
  { name: 'private_journal', displayName: 'Private Journal', color: '#9e7e9a' },
  { name: 'scripts', displayName: 'Scripts', color: '#7f8b96' },
  { name: 'tamagotchi', displayName: 'Tamagotchi', color: '#ca6c6b' },
  { name: 'writing', displayName: 'Writing', color: '#b07a6e' },
];

export function sessionsToAttentionCategories(): AttentionCategory[] {
  // Return a fresh copy so callers can't mutate the constant
  return ATTENTION_CATEGORIES.map((c) => ({ ...c })).sort((a, b) => a.name.localeCompare(b.name));
}

export function memoryToSwimlane(data: any): SwimlaneData {
  if (
    !data ||
    !data.snapshots ||
    data.snapshots.length === 0
  ) {
    // Handle empty/missing data
    if (data && data.blocks && data.blocks.length > 0) {
      // Blocks exist but no snapshots
      const blocks: SwimlaneBlock[] = data.blocks.map((b: any) => ({
        hash: b.hash,
        heading: b.heading,
        firstSeenDate: b.first_seen_date,
        lastSeenDate: b.last_seen_date,
        persistence: 0,
        snapshotIndices: [],
      }));
      return { snapshots: [], blocks };
    }
    return { snapshots: [], blocks: [] };
  }

  // Sort snapshots by date ascending
  const sortedSnapshots = [...data.snapshots].sort(
    (a: any, b: any) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const mappedSnapshots = sortedSnapshots.map((s: any) => ({
    date: s.date,
    sessionId: s.session_id,
    tokenCount: s.token_count,
    blockHashes: s.block_hashes,
  }));

  const totalSnapshots = sortedSnapshots.length;

  // Build a set of hashes per snapshot index for fast lookup
  const snapshotHashSets: Set<string>[] = sortedSnapshots.map(
    (s: any) => new Set(s.block_hashes || []),
  );

  const blocks: SwimlaneBlock[] = (data.blocks || []).map((b: any) => {
    const indices: number[] = [];
    for (let i = 0; i < snapshotHashSets.length; i++) {
      if (snapshotHashSets[i].has(b.hash)) {
        indices.push(i);
      }
    }

    return {
      hash: b.hash,
      heading: b.heading,
      firstSeenDate: b.first_seen_date,
      lastSeenDate: b.last_seen_date,
      persistence: totalSnapshots > 0 ? indices.length / totalSnapshots : 0,
      snapshotIndices: indices,
    };
  });

  return { snapshots: mappedSnapshots, blocks };
}

export function messagesToTimeline(messages: any[]): TimelineMessage[] {
  if (messages.length === 0) return [];

  const mapped: TimelineMessage[] = messages.map((m: any) => {
    let isAnomalous = false;
    if (m.date != null) {
      const yearStr = m.date.split('-')[0];
      const year = parseInt(yearStr, 10);
      if (year > 2030 || year < 2020) {
        isAnomalous = true;
      }
    }

    return {
      direction: m.direction,
      date: m.date,
      content: m.content,
      lineStart: m.line_start,
      lineEnd: m.line_end,
      isAnomalous,
    };
  });

  // Sort by date ascending; null dates go to the beginning
  mapped.sort((a, b) => {
    if (a.date === null && b.date === null) return 0;
    if (a.date === null) return -1;
    if (b.date === null) return 1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  return mapped;
}

export function predictionsToCalibration(
  predictions: any[],
): CalibrationPrediction[] {
  if (predictions.length === 0) return [];

  const mapped: CalibrationPrediction[] = predictions.map((p: any) => ({
    text: p.text,
    confidence: p.confidence === null || p.confidence === undefined ? null : p.confidence,
    dateMade: p.date_made,
    resolutionDate: p.resolution_date ?? null,
    outcome: p.outcome ?? null,
    selfAssessment: p.self_assessment ?? null,
    isResolved: p.outcome != null,
  }));

  mapped.sort((a, b) =>
    a.dateMade < b.dateMade ? -1 : a.dateMade > b.dateMade ? 1 : 0,
  );

  return mapped;
}

export function petEventsToLifecycles(events: any[]): PetLifecycle[] {
  if (events.length === 0) return [];

  const groups = new Map<string, any[]>();
  for (const event of events) {
    const name = event.pet_name;
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name)!.push(event);
  }

  const result: PetLifecycle[] = [];
  for (const [petName, petEvents] of groups) {
    // Sort events by timestamp ascending
    petEvents.sort((a: any, b: any) =>
      a.event_timestamp < b.event_timestamp
        ? -1
        : a.event_timestamp > b.event_timestamp
          ? 1
          : 0,
    );

    const mappedEvents = petEvents.map((e: any) => ({
      eventType: e.event_type,
      timestamp: e.event_timestamp,
      notes: e.notes,
    }));

    result.push({
      petName,
      events: mappedEvents,
      firstEvent: petEvents[0].event_timestamp,
      lastEvent: petEvents[petEvents.length - 1].event_timestamp,
    });
  }

  // Sort lifecycles alphabetically by petName
  result.sort((a, b) =>
    a.petName < b.petName ? -1 : a.petName > b.petName ? 1 : 0,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Version Transitions & Pet Care Window
// ---------------------------------------------------------------------------

export interface VersionTransition {
  key: string;
  from: string;
  to: string;
  lastBefore: { date: string; time_of_day: string | undefined };
  firstAfter: { date: string; time_of_day: string | undefined };
  gapHours: number | null;
}

export interface CuratedTransition extends VersionTransition {
  curation: object | null;
}

export interface PetEvent {
  pet_name: string;
  event_type: string;
  event_timestamp: string;
  notes: string;
}

export interface CareDay {
  date: string;
  dayEvents: PetEvent[];
  slots: {
    AM: { sessionPresent: boolean; events: PetEvent[] };
    PM: { sessionPresent: boolean; events: PetEvent[] };
  };
}

// Rank a time_of_day for chronological ordering: AM (or anything that is
// not exactly "PM", including undefined) sorts before PM.
function timeOfDayRank(timeOfDay: unknown): number {
  return timeOfDay === 'PM' ? 1 : 0;
}

// A version label is valid only when it is a non-empty string. Whitespace-only
// strings are valid opaque labels — no trimming, no numeric interpretation.
function hasValidVersion(row: any): boolean {
  return (
    row != null &&
    typeof row.version === 'string' &&
    row.version !== ''
  );
}

function computeGapHours(
  fromTimestamp: unknown,
  toTimestamp: unknown,
): number | null {
  if (typeof fromTimestamp !== 'string' || typeof toTimestamp !== 'string') {
    return null;
  }
  const fromMs = Date.parse(fromTimestamp);
  const toMs = Date.parse(toTimestamp);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return null;
  }
  const diffMs = toMs - fromMs;
  if (diffMs < 0) {
    return null;
  }
  return diffMs / 3600000;
}

// A date is valid only when it is present and a string. Rows with a missing,
// null, or non-string date are excluded from processing entirely — exactly
// parallel to the invalid-version rule.
function hasValidDate(row: any): boolean {
  return row != null && typeof row.date === 'string';
}

export function deriveVersionTransitions(sessions: any[]): VersionTransition[] {
  // Copy + filter; never mutate the input array or its rows. Rows with an
  // invalid version OR an invalid date never enter the chain: they cannot
  // sort, cannot serve as lastBefore/firstAfter, and never count as "seen".
  const rows = sessions.filter(
    (row) => hasValidVersion(row) && hasValidDate(row),
  );

  // Stable chronological sort: date asc, then AM before PM (missing
  // time_of_day sorts as AM). Array.prototype.sort on a copy is stable.
  const sorted = [...rows].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return timeOfDayRank(a.time_of_day) - timeOfDayRank(b.time_of_day);
  });

  const transitions: VersionTransition[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const version = row.version as string;

    if (!seen.has(version)) {
      if (i > 0) {
        // Brand-new version (and not the very first): record a transition
        // from the chronologically immediately preceding valid row — even
        // if that row's version was itself a regression.
        const prev = sorted[i - 1];
        transitions.push({
          key: `${prev.version}→${version}`,
          from: prev.version,
          to: version,
          lastBefore: { date: prev.date, time_of_day: prev.time_of_day },
          firstAfter: { date: row.date, time_of_day: row.time_of_day },
          gapHours: computeGapHours(prev.timestamp_start, row.timestamp_start),
        });
      }
      seen.add(version);
    }
    // Already-seen versions never create transitions (regressions are
    // silent), but the row still serves as "preceding row" next iteration.
  }

  return transitions;
}

export function mergeTransitionCuration(
  derived: VersionTransition[],
  curated: Record<string, unknown> | null | undefined,
): { transitions: CuratedTransition[]; unmatchedKeys: string[] } {
  const source: Record<string, unknown> =
    curated != null && typeof curated === 'object' ? curated : {};

  // Own-property-only view of the curated map. Enumerability is irrelevant
  // ("own key exists" is the condition), so keys come from
  // getOwnPropertyNames — which yields only own keys, including
  // non-enumerable ones — and the value is read via indexed access so
  // accessor (getter) properties are invoked rather than yielding a
  // descriptor with no `.value`. This stays prototype-pollution-safe: an
  // own "__proto__" DATA property (e.g. from JSON.parse) shadows the
  // prototype accessor on read, and we never assign onto `source` or
  // through these keys.
  const curatedEntries = new Map<string, unknown>();
  for (const key of Object.getOwnPropertyNames(source)) {
    curatedEntries.set(key, source[key]);
  }

  const isPlainObjectValue = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const matchedKeys = new Set<string>();
  const transitions: CuratedTransition[] = derived.map((transition) => {
    let curation: object | null = null;
    if (curatedEntries.has(transition.key)) {
      const value = curatedEntries.get(transition.key);
      if (isPlainObjectValue(value)) {
        matchedKeys.add(transition.key);
        curation = value as object;
      }
    }
    return { ...transition, curation };
  });

  // Surface every curated key that matched nothing, plus malformed
  // (non-object) entries — they are reported, not silently dropped.
  const unmatchedKeys: string[] = [];
  for (const key of curatedEntries.keys()) {
    if (!matchedKeys.has(key)) {
      unmatchedKeys.push(key);
    }
  }
  unmatchedKeys.sort();

  return { transitions, unmatchedKeys };
}

// Literal ISO-8601 parse: extract the date and clock time EXACTLY as written
// in the string. No Date-based component getters — timezone offsets must
// never shift the date or the AM/PM half.
const ISO_LITERAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap =
      (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function parseLiteralTimestamp(timestamp: unknown): {
  date: string;
  hour: number;
  minute: number;
  second: number;
  fractionNonzero: boolean;
} | null {
  if (typeof timestamp !== 'string') return null;
  const match = timestamp.match(ISO_LITERAL_RE);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  // A fractional-seconds part with any nonzero digit means the literal clock
  // time is NOT exact midnight; ".000" (all zeros) or no fraction is exact.
  const fractionNonzero =
    match[7] !== undefined && /[1-9]/.test(match[7]);

  // Real-calendar validation: month 13 / day 45 / hour 99 are invalid even
  // if a lax Date.parse might coerce them.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    hour,
    minute,
    second,
    fractionNonzero,
  };
}

// UTC-based date math on "YYYY-MM-DD" strings so the local timezone can
// never shift a day, and month/year/leap boundaries stay calendar-correct.
const MS_PER_DAY = 86400000;

function dateStrToUtcMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map((n) => parseInt(n, 10));
  // Date.UTC(year, ...) remaps years 0–99 to 1900–1999; setUTCFullYear does
  // not, so the round-trip is faithful for ALL 4-digit years.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function utcMsToDateStr(ms: number): string {
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function deriveCareWindow(
  sessions: any[],
  petEvents: any[],
): CareDay[] {
  // Parse events up front; malformed timestamps are skipped silently,
  // including for window computation. Input order is preserved.
  const validEvents: Array<{
    event: PetEvent;
    date: string;
    hour: number;
    minute: number;
    second: number;
    fractionNonzero: boolean;
  }> = [];
  for (const event of petEvents) {
    const parsed = parseLiteralTimestamp(event?.event_timestamp);
    if (parsed !== null) {
      validEvents.push({ event: event as PetEvent, ...parsed });
    }
  }

  if (validEvents.length === 0) return [];

  let minDate = validEvents[0].date;
  let maxDate = validEvents[0].date;
  for (const { date } of validEvents) {
    if (date < minDate) minDate = date;
    if (date > maxDate) maxDate = date;
  }

  // Window: one day of padding on each side, inclusive and contiguous.
  const startMs = dateStrToUtcMs(minDate) - MS_PER_DAY;
  const endMs = dateStrToUtcMs(maxDate) + MS_PER_DAY;

  const days: CareDay[] = [];
  const dayIndex = new Map<string, CareDay>();
  for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
    const date = utcMsToDateStr(ms);
    const day: CareDay = {
      date,
      dayEvents: [],
      slots: {
        AM: { sessionPresent: false, events: [] },
        PM: { sessionPresent: false, events: [] },
      },
    };
    days.push(day);
    dayIndex.set(date, day);
  }

  // Place events in input order: literal EXACT midnight (00:00:00 with no
  // fraction or an all-zeros fraction) is day-level; 00:00:00 with a nonzero
  // fraction is a real clock time and lands in the AM slot like any other
  // hour < 12; hour >= 12 goes to the PM slot.
  for (const { event, date, hour, minute, second, fractionNonzero } of validEvents) {
    const day = dayIndex.get(date);
    if (!day) continue;
    if (hour === 0 && minute === 0 && second === 0 && !fractionNonzero) {
      day.dayEvents.push(event);
    } else if (hour < 12) {
      day.slots.AM.events.push(event);
    } else {
      day.slots.PM.events.push(event);
    }
  }

  // Sessions mark slot presence only when time_of_day is exactly "AM"/"PM";
  // sessions outside the window are ignored and never extend it.
  for (const session of sessions) {
    if (session == null || typeof session.date !== 'string') continue;
    const day = dayIndex.get(session.date);
    if (!day) continue;
    if (session.time_of_day === 'AM') {
      day.slots.AM.sessionPresent = true;
    } else if (session.time_of_day === 'PM') {
      day.slots.PM.sessionPresent = true;
    }
  }

  return days;
}

// ---------------------------------------------------------------------------
// Archive Fragments
// ---------------------------------------------------------------------------

export interface ArchiveFragment {
  id: string; // quote id (stable hash from quotes.json)
  sessionId: string | null; // joined same-day session id, or null if no join
  date: string; // quote date, YYYY-MM-DD
  version: string | null; // quote.model_version, else joined session.version, else null
  excerpt: string; // verbatim prefix of quote text per excerptRule
  source: string | null; // quote.source_type passthrough (no enum enforcement)
  sourceFile: string | null; // quote.source_file passthrough
}

export interface ArchiveFragmentOptions {
  cap?: number; // max fragments returned; default: no cap
  excludeIds?: string[]; // curation exclusions (quote ids)
  pinnedIds?: string[]; // always included if valid+eligible; count toward cap
  excerptRule?: { mode: 'sentence' | 'chars'; maxChars: number };
}

// Own-property read: values reachable only via the prototype chain must never
// leak into output (cf. #62868).
function readOwn(row: any, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

function isPlainRow(row: unknown): row is Record<string, unknown> {
  return typeof row === 'object' && row !== null && !Array.isArray(row);
}

// Strict "YYYY-MM-DD" shape plus real-calendar validation (2026-02-30 and
// Feb 29 in non-leap years are invalid). Pure arithmetic — no Date usage
// anywhere in the archive-fragment path.
const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidArchiveDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ARCHIVE_DATE_RE.test(value)) return false;
  const year = parseInt(value.slice(0, 4), 10);
  const month = parseInt(value.slice(5, 7), 10);
  const day = parseInt(value.slice(8, 10), 10);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

// FNV-1a 32-bit over UTF-16 code units: offset 2166136261, prime 16777619,
// result forced unsigned. Deterministic sampling key — no randomness.
function fnv1a32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// chars-mode excerpt: full text when it fits; otherwise cut at the last
// whitespace at-or-before maxChars (hard-cut at maxChars when no whitespace
// exists in range), never splitting a surrogate pair, then trim trailing
// whitespace and append a single U+2026.
function charsExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let cut = -1;
  for (let i = maxChars; i >= 0; i--) {
    if (/\s/.test(text[i])) {
      cut = i;
      break;
    }
  }
  if (cut === -1) {
    cut = maxChars;
  }
  // Back off one code unit if the cut would land between a surrogate pair.
  if (
    cut > 0 &&
    text.charCodeAt(cut - 1) >= 0xd800 &&
    text.charCodeAt(cut - 1) <= 0xdbff &&
    text.charCodeAt(cut) >= 0xdc00 &&
    text.charCodeAt(cut) <= 0xdfff
  ) {
    cut -= 1;
  }

  const prefix = text.slice(0, cut).replace(/\s+$/, '');
  return prefix + '…';
}

// sentence-mode excerpt: verbatim prefix up to and including the first
// . ! ? or … that is followed by whitespace or end-of-text; if no such
// terminator exists, fall back to chars behavior with the same maxChars.
function sentenceExcerpt(text: string, maxChars: number): string {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      if (i + 1 === text.length || /\s/.test(text[i + 1])) {
        return text.slice(0, i + 1);
      }
    }
  }
  return charsExcerpt(text, maxChars);
}

interface JoinSession {
  id: string;
  todRank: number;
  version: string | null; // normalized for output ('' → null)
  tieVersion: string | null; // raw string for tie-break; non-string → null (ranks LAST)
}

// True when `a` should win the same-date join over `b`: AM before PM, then
// session id ascending, then — for rows fully tied on (date, tod rank, id) —
// version ascending by raw string compare with missing/non-string version
// ranking LAST. Rows still tied after that are identical in every field the
// join reads, so keeping `b` is immaterial.
function joinSessionBeats(a: JoinSession, b: JoinSession): boolean {
  if (a.todRank !== b.todRank) return a.todRank < b.todRank;
  if (a.id !== b.id) return a.id < b.id;
  if (b.tieVersion === null) return a.tieVersion !== null;
  if (a.tieVersion === null) return false;
  return a.tieVersion < b.tieVersion;
}

interface FragmentCandidate {
  id: string;
  date: string;
  text: string;
  sessionId: string | null;
  todRank: number;
  version: string | null;
  source: string | null;
  sourceFile: string | null;
}

export function deriveArchiveFragments(
  sessions: any[],
  quotes: any[],
  options?: ArchiveFragmentOptions,
): ArchiveFragment[] {
  const sessionRows: any[] = Array.isArray(sessions) ? sessions : [];
  const quoteRows: any[] = Array.isArray(quotes) ? quotes : [];
  const opts: Record<string, unknown> = isPlainRow(options) ? options : {};

  // Cap normalization: undefined/non-number/+Infinity → no cap; NaN, zero,
  // and negatives (including -Infinity) → hard [] — cap is a ceiling that
  // pinned ids count toward, so cap 0 returns nothing at all.
  const rawCap = opts.cap;
  let cap: number | undefined;
  if (typeof rawCap !== 'number' || rawCap === Infinity) {
    cap = undefined;
  } else if (Number.isNaN(rawCap) || rawCap <= 0) {
    return [];
  } else {
    cap = Math.floor(rawCap);
    if (cap <= 0) return [];
  }

  // Join map: best same-day session per date. AM before PM (missing/unknown
  // time_of_day ranks AM — same rule as deriveVersionTransitions), ties
  // broken by session id ascending; rows fully tied on (date, tod rank, id)
  // tie-break by version ascending (raw string compare, missing/non-string
  // LAST) so the join is a pure function of the session SET, never of input
  // order (coordinator ruling, hardening round). All field reads go through
  // a guarded snapshot: a hostile getter on ANY read field invalidates just
  // that row — it is excluded from the join and the throw never escapes.
  const bestSessionByDate = new Map<string, JoinSession>();
  for (const row of sessionRows) {
    if (!isPlainRow(row)) continue;
    let id: unknown;
    let date: unknown;
    let rawVersion: unknown;
    let rawTimeOfDay: unknown;
    try {
      id = readOwn(row, 'id');
      date = readOwn(row, 'date');
      rawVersion = readOwn(row, 'version');
      rawTimeOfDay = readOwn(row, 'time_of_day');
    } catch {
      continue;
    }
    if (typeof id !== 'string' || id === '') continue;
    if (!isValidArchiveDate(date)) continue;
    const candidate: JoinSession = {
      id,
      todRank: timeOfDayRank(rawTimeOfDay),
      version:
        typeof rawVersion === 'string' && rawVersion !== '' ? rawVersion : null,
      tieVersion:
        typeof rawVersion === 'string' && rawVersion !== '' ? rawVersion : null,
    };
    const current = bestSessionByDate.get(date);
    if (!current || joinSessionBeats(candidate, current)) {
      bestSessionByDate.set(date, candidate);
    }
  }

  const excludeSet = new Set<unknown>(
    Array.isArray(opts.excludeIds) ? opts.excludeIds : [],
  );

  // Valid quotes, deduped by id (first occurrence in input order wins).
  // Excluded ids still occupy their dedupe slot but never become candidates.
  const byId = new Map<string, FragmentCandidate>();
  const candidates: FragmentCandidate[] = [];
  for (const row of quoteRows) {
    if (!isPlainRow(row)) continue;
    // Guarded snapshot of every field the transform reads: a hostile getter
    // on ANY of them makes the row malformed → silently dropped, and the
    // throw never escapes. All logic below operates on the plain extracted
    // values only.
    let id: unknown;
    let text: unknown;
    let date: unknown;
    let modelVersion: unknown;
    let sourceType: unknown;
    let sourceFile: unknown;
    try {
      id = readOwn(row, 'id');
      text = readOwn(row, 'text');
      date = readOwn(row, 'date');
      modelVersion = readOwn(row, 'model_version');
      sourceType = readOwn(row, 'source_type');
      sourceFile = readOwn(row, 'source_file');
    } catch {
      continue;
    }
    if (typeof id !== 'string' || id === '') continue;
    if (typeof text !== 'string' || text.trim() === '') continue;
    if (!isValidArchiveDate(date)) continue;
    if (byId.has(id)) continue;

    const joined = bestSessionByDate.get(date);
    const candidate: FragmentCandidate = {
      id,
      date,
      text,
      sessionId: joined ? joined.id : null,
      todRank: joined ? joined.todRank : 0,
      version:
        typeof modelVersion === 'string' && modelVersion !== ''
          ? modelVersion
          : joined
            ? joined.version
            : null,
      source: typeof sourceType === 'string' ? sourceType : null,
      sourceFile: typeof sourceFile === 'string' ? sourceFile : null,
    };
    byId.set(id, candidate);
    if (!excludeSet.has(id)) {
      candidates.push(candidate);
    }
  }

  // Pinned ids: deduped, pinned-array order; invalid/unknown pins ignored;
  // exclusion beats pinning.
  const pinnedSelected: FragmentCandidate[] = [];
  const pinnedIdSet = new Set<string>();
  if (Array.isArray(opts.pinnedIds)) {
    for (const pinned of opts.pinnedIds) {
      if (typeof pinned !== 'string' || pinnedIdSet.has(pinned)) continue;
      if (excludeSet.has(pinned)) continue;
      const candidate = byId.get(pinned);
      if (!candidate) continue;
      pinnedIdSet.add(pinned);
      pinnedSelected.push(candidate);
    }
  }

  // Selection: no cap → all candidates. With a cap, pinned first (in pinned
  // order, counting toward the cap), remaining slots filled by deterministic
  // FNV-1a sample over `${sessionId ?? ''}:${id}`, ascending, ties by id.
  let selected: FragmentCandidate[];
  if (cap === undefined) {
    selected = candidates.slice();
  } else {
    selected = pinnedSelected.slice(0, cap);
    const slots = cap - selected.length;
    if (slots > 0) {
      const rest = candidates
        .filter((c) => !pinnedIdSet.has(c.id))
        .map((c) => ({ c, hash: fnv1a32(`${c.sessionId ?? ''}:${c.id}`) }));
      rest.sort((a, b) => {
        if (a.hash !== b.hash) return a.hash - b.hash;
        return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
      });
      selected = selected.concat(rest.slice(0, slots).map((r) => r.c));
    }
  }

  // Excerpt rule normalization: maxChars <= 0 or non-finite → default 140.
  const rule = opts.excerptRule;
  const mode =
    isPlainRow(rule) && rule.mode === 'sentence' ? 'sentence' : 'chars';
  const rawMaxChars = isPlainRow(rule) ? rule.maxChars : undefined;
  let maxChars =
    typeof rawMaxChars === 'number' &&
    Number.isFinite(rawMaxChars) &&
    rawMaxChars > 0
      ? Math.floor(rawMaxChars)
      : 140;
  if (maxChars < 1) maxChars = 140;

  // Output order: date asc, then joined session time_of_day (AM before PM,
  // no-join ranks AM), then quote id asc — raw string compare, no locale.
  selected.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    if (a.todRank !== b.todRank) return a.todRank - b.todRank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return selected.map((c) => ({
    id: c.id,
    sessionId: c.sessionId,
    date: c.date,
    version: c.version,
    excerpt:
      mode === 'sentence'
        ? sentenceExcerpt(c.text, maxChars)
        : charsExcerpt(c.text, maxChars),
    source: c.source,
    sourceFile: c.sourceFile,
  }));
}
