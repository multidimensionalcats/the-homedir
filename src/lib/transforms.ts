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
