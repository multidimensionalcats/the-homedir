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
