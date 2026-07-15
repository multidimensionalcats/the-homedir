<script lang="ts">
  import type { CareDay, PetEvent } from '../lib/transforms';

  let {
    days = [],
    caption = 'Sessions during the care window',
  }: { days?: CareDay[]; caption?: string } = $props();

  // Exact literal event-type colors — no trimming, no case folding.
  // Own-property lookup so hostile keys ("__proto__", "constructor")
  // can never walk the prototype chain.
  const EVENT_COLORS: Record<string, string> = {
    acquired: '#6bb08a',
    care: '#7ea7c8',
    death: '#ca6c6b',
  };
  const FALLBACK_COLOR = '#838997';

  function eventColor(eventType: unknown): string {
    if (
      typeof eventType === 'string' &&
      Object.prototype.hasOwnProperty.call(EVENT_COLORS, eventType)
    ) {
      return EVENT_COLORS[eventType];
    }
    return FALLBACK_COLOR;
  }

  const MONTH_ABBREV = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  // Format "YYYY-MM-DD" as "Feb 1" by string parsing only — no Date object,
  // so the local timezone can never shift the day. Non-conforming strings
  // fall back to the raw string (rendered as inert text).
  function formatDayLabel(date: unknown): string {
    if (typeof date !== 'string') return '';
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return date;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12) return date;
    return `${MONTH_ABBREV[month - 1]} ${day}`;
  }

  interface NormalizedSlot {
    present: boolean;
    events: PetEvent[];
  }

  interface NormalizedDay {
    date: string;
    dayEvents: PetEvent[];
    am: NormalizedSlot;
    pm: NormalizedSlot;
    hasDeath: boolean;
    hasDeathLabel: boolean;
  }

  function normalizeEvents(value: unknown): PetEvent[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (e): e is PetEvent => e != null && typeof e === 'object',
    );
  }

  function normalizeSlot(value: any): NormalizedSlot {
    return {
      present: value?.sessionPresent === true,
      events: normalizeEvents(value?.events),
    };
  }

  // Defensive pet_name read: only plain strings count as an identity.
  // Throwing getters and non-string values yield null (no identity).
  function readPetName(event: PetEvent): string | null {
    try {
      const raw: unknown = (event as any).pet_name;
      return typeof raw === 'string' ? raw : null;
    } catch {
      return null;
    }
  }

  // Malformed-row strategy: null/undefined/non-object entries are skipped
  // entirely (no column, no table row), as are rows whose `date` cannot be
  // read as a plain string — a throwing getter, or any non-string value
  // (objects with hostile toString would otherwise be coerced by the
  // template and kill sibling rendering). Admitted rows only ever hand
  // plain strings to the template. Object rows with missing pieces
  // (no slots, no dayEvents, no slots.AM/PM) are rendered inert with
  // absent slots and no events, so sibling valid days always render fully.
  // Input order preserved; no sorting, no deduplication.
  // Death-LABEL dedup: a day earns a death label only for a pet's FIRST
  // death event, first by occurrence order in the input array (per
  // pet_name). Later deaths of the same pet keep their dots but never
  // label their day. Different pets dedup independently. Deaths whose
  // pet_name is unreadable (throwing getter / non-string) share a single
  // anonymous bucket: the first such death labels, later ones do not.
  const validDays = $derived.by((): NormalizedDay[] => {
    const list = Array.isArray(days) ? days : [];
    const out: NormalizedDay[] = [];
    const labeledPets = new Set<string>();
    let labeledAnonymous = false;
    for (const row of list) {
      if (row == null || typeof row !== 'object') continue;
      let date: string;
      try {
        const raw: unknown = (row as any).date;
        if (typeof raw !== 'string') continue;
        date = raw;
      } catch {
        // Hostile `date` getter — row is malformed; skip it so
        // sibling rows still render.
        continue;
      }
      const slots = (row as any).slots;
      const am = normalizeSlot(slots?.AM);
      const pm = normalizeSlot(slots?.PM);
      const dayEvents = normalizeEvents((row as any).dayEvents);
      const hasDeath =
        dayEvents.some((e) => e.event_type === 'death') ||
        am.events.some((e) => e.event_type === 'death') ||
        pm.events.some((e) => e.event_type === 'death');
      let hasDeathLabel = false;
      if (hasDeath) {
        for (const e of [...dayEvents, ...am.events, ...pm.events]) {
          if (e.event_type !== 'death') continue;
          const name = readPetName(e);
          if (name === null) {
            if (!labeledAnonymous) {
              labeledAnonymous = true;
              hasDeathLabel = true;
            }
          } else if (!labeledPets.has(name)) {
            labeledPets.add(name);
            hasDeathLabel = true;
          }
        }
      }
      out.push({ date, dayEvents, am, pm, hasDeath, hasDeathLabel });
    }
    return out;
  });

  const hasData = $derived(validDays.length > 0);

  // Sparse labels: first day, last day, and any day carrying a pet's
  // FIRST literal "death" event (see dedup above). A single-day window
  // yields exactly one label.
  function isLabeled(index: number, day: NormalizedDay): boolean {
    return index === 0 || index === validDays.length - 1 || day.hasDeathLabel;
  }
</script>

<div data-testid="care-calendar" class="care-calendar">
  {#if caption !== ''}
    <div data-testid="care-calendar-caption" class="caption">{caption}</div>
  {/if}

  {#if !hasData}
    <div data-testid="care-calendar-empty" class="empty-state">
      No days in the care window.
    </div>
  {:else}
    <div class="grid-scroll" aria-hidden="true">
      <div class="grid">
        {#each validDays as day, i}
          <div data-testid="care-day" data-date={day.date} class="day">
            <div class="label-slot">
              {#if isLabeled(i, day)}
                <span data-testid="care-day-label" class="day-label"
                  >{formatDayLabel(day.date)}</span
                >
              {/if}
            </div>
            <div
              data-testid="care-slot-am"
              class="slot {day.am.present ? 'session-present' : 'session-absent'}"
            >
              {#each day.am.events as event}
                <span
                  data-testid="care-event"
                  data-event-type={event.event_type}
                  class="event"
                  style="background-color: {eventColor(event.event_type)};"
                  title={event.pet_name}
                ></span>
              {/each}
            </div>
            <div
              data-testid="care-slot-pm"
              class="slot {day.pm.present ? 'session-present' : 'session-absent'}"
            >
              {#each day.pm.events as event}
                <span
                  data-testid="care-event"
                  data-event-type={event.event_type}
                  class="event"
                  style="background-color: {eventColor(event.event_type)};"
                  title={event.pet_name}
                ></span>
              {/each}
            </div>
            <div data-testid="care-day-events" class="day-events">
              {#each day.dayEvents as event}
                <span
                  data-testid="care-event"
                  data-event-type={event.event_type}
                  class="event"
                  style="background-color: {eventColor(event.event_type)};"
                  title={event.pet_name}
                ></span>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <table data-testid="care-calendar-table" class="sr-only">
    {#if caption !== ''}
      <caption class="sr-only">{caption}</caption>
    {/if}
    <thead>
      <tr>
        <th scope="col">Date</th>
        <th scope="col">AM</th>
        <th scope="col">PM</th>
        <th scope="col">Events</th>
      </tr>
    </thead>
    <tbody>
      {#each validDays as day}
        <tr>
          <td>{day.date}</td>
          <td>{day.am.present ? 'session' : 'no session'}</td>
          <td>{day.pm.present ? 'session' : 'no session'}</td>
          <td>
            {#each [...day.am.events, ...day.pm.events, ...day.dayEvents] as event}
              <span class="sr-event"
                >{event.pet_name} {event.event_type} {event.notes}; </span
              >
            {/each}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .care-calendar {
    background: #0f0f0f;
    color: #e0e0e0;
    padding: 1.5rem;
  }

  .caption {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 1rem;
    overflow-wrap: anywhere;
  }

  .empty-state {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.35);
    padding: 2rem 0;
  }

  /* Horizontal scroll keeps ~17 columns usable at 375px without reflow */
  .grid-scroll {
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }

  .grid {
    display: flex;
    gap: 2px;
    width: max-content;
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 1.25rem;
    flex: 0 0 auto;
  }

  .label-slot {
    height: 1rem;
  }

  .day-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    display: block;
  }

  /* Absence dominates: empty cells are near-void; presence is a subtle
     lightening plus a thin border. No animation, no transitions. */
  .slot {
    height: 1.25rem;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    overflow: hidden;
  }

  .slot.session-absent {
    background: #14161a;
    border: 1px solid #1a1d23;
  }

  .slot.session-present {
    background: #232730;
    border: 1px solid #3a3f4a;
  }

  .day-events {
    min-height: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    flex-wrap: wrap;
    overflow: hidden;
  }

  .event {
    display: inline-block;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
