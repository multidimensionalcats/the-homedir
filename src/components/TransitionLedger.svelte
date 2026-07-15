<script lang="ts">
  import type { CuratedTransition } from '../lib/transforms';
  import { versionColor } from '../lib/chart-utils';

  let {
    transitions = [],
    title = 'Version boundaries',
  }: { transitions?: CuratedTransition[]; title?: string } = $props();

  // Read a property defensively: a hostile getter on a malformed row must
  // never take down sibling entries.
  function readProp(obj: unknown, key: string): unknown {
    try {
      return (obj as any)?.[key];
    } catch {
      return undefined;
    }
  }

  // Coerce to display text without ever producing "undefined", "null",
  // "NaN" via accidental template coercion. Strings pass through verbatim
  // (no trimming, no reformatting); other primitives stringify; objects
  // and nullish values become empty text.
  function textOf(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '';
    }
    if (typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return '';
  }

  // Matches chart-utils' unexported VERSION_FALLBACK. Kept as a local
  // constant (CareCalendar precedent) rather than probing versionColor
  // with a sentinel key.
  const FALLBACK_COLOR = '#3A3F4B';

  // versionColor does a plain index lookup, so prototype-chain keys
  // ("__proto__", "constructor", "toString") can return non-string
  // values. Anything that is not a string collapses to the fallback.
  function safeVersionColor(version: string): string {
    let color: unknown;
    try {
      color = versionColor(version);
    } catch {
      color = undefined;
    }
    if (typeof color === 'string' && color !== '') return color;
    return FALLBACK_COLOR;
  }

  // gapHours must be a genuinely finite number; everything else — null,
  // NaN, ±Infinity, strings, objects — reads as unrecorded. Never renders
  // "NaN" or "Infinity". Magnitudes >= 1e21 are malformed upstream data
  // (toFixed would emit scientific notation, e.g. "1e+21"), so they also
  // read as unrecorded.
  function formatGap(raw: unknown): string {
    if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) < 1e21) {
      return `${raw.toFixed(1)} h`;
    }
    return 'interval unrecorded';
  }

  // A curated sub-field exists only when it is a non-empty string.
  // Empty string means missing, for every sub-field.
  function curatedString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }

  interface LedgerEntry {
    key: string;
    from: string;
    to: string;
    fromColor: string;
    toColor: string;
    beforeDate: string;
    beforeTime: string;
    afterDate: string;
    afterTime: string;
    gapText: string;
    label: string | null;
    note: string | null;
    excerptText: string | null;
    excerptSource: string | null;
  }

  // Malformed-row strategy: null/undefined/non-object rows are skipped
  // entirely; object rows with missing sub-objects render with the pieces
  // that exist. Input order preserved — no sorting, no deduplication, so
  // duplicate keys render twice. An uncurated transition (curation: null)
  // renders as a complete minimal entry with none of the curated fields.
  const entries = $derived.by((): LedgerEntry[] => {
    const list = Array.isArray(transitions) ? transitions : [];
    const out: LedgerEntry[] = [];
    for (const row of list) {
      if (row == null || typeof row !== 'object') continue;

      const before = readProp(row, 'lastBefore');
      const after = readProp(row, 'firstAfter');
      const from = textOf(readProp(row, 'from'));
      const to = textOf(readProp(row, 'to'));

      let label: string | null = null;
      let note: string | null = null;
      let excerptText: string | null = null;
      let excerptSource: string | null = null;

      const curation = readProp(row, 'curation');
      if (curation != null && typeof curation === 'object') {
        label = curatedString(readProp(curation, 'label'));
        note = curatedString(readProp(curation, 'note'));
        const excerpt = readProp(curation, 'excerpt');
        if (excerpt != null && typeof excerpt === 'object') {
          excerptText = curatedString(readProp(excerpt, 'text'));
          if (excerptText !== null) {
            excerptSource = curatedString(readProp(excerpt, 'source'));
          }
        }
      }

      out.push({
        key: textOf(readProp(row, 'key')),
        from,
        to,
        fromColor: safeVersionColor(from),
        toColor: safeVersionColor(to),
        beforeDate: textOf(readProp(before, 'date')),
        beforeTime: textOf(readProp(before, 'time_of_day')),
        afterDate: textOf(readProp(after, 'date')),
        afterTime: textOf(readProp(after, 'time_of_day')),
        gapText: formatGap(readProp(row, 'gapHours')),
        label,
        note,
        excerptText,
        excerptSource,
      });
    }
    return out;
  });

  const hasData = $derived(entries.length > 0);
</script>

<div data-testid="transition-ledger" class="transition-ledger">
  {#if title !== ''}
    <h2 class="ledger-title">{title}</h2>
  {/if}

  {#if !hasData}
    <p data-testid="ledger-empty" class="empty-state">
      No version boundaries recorded.
    </p>
  {:else}
    <!-- Visual list is hidden from AT: the sr summary below carries the
         accessible rendition, so exposing both would double-read. -->
    <ul class="entries" aria-hidden="true">
      {#each entries as entry}
        <li data-testid="ledger-entry" data-key={entry.key} class="entry">
          <div class="entry-head">
            <span class="chips">
              <span
                data-testid="ledger-chip-from"
                class="chip"
                style="color: {entry.fromColor};">{entry.from}</span
              >
              <span class="arrow" aria-hidden="true">&rarr;</span>
              <span
                data-testid="ledger-chip-to"
                class="chip"
                style="color: {entry.toColor};">{entry.to}</span
              >
            </span>
            {#if entry.label !== null}
              <span data-testid="ledger-label" class="label">{entry.label}</span>
            {/if}
          </div>

          <div data-testid="ledger-boundary" class="boundary">
            <span class="boundary-side"
              >{entry.beforeDate}{#if entry.beforeTime !== ''}<span class="tod">
                  {entry.beforeTime}</span
                >{/if}</span
            >
            <span class="arrow" aria-hidden="true">&rarr;</span>
            <span class="boundary-side"
              >{entry.afterDate}{#if entry.afterTime !== ''}<span class="tod">
                  {entry.afterTime}</span
                >{/if}</span
            >
          </div>

          <div class="gap-row">
            <span class="field-label" aria-hidden="true">gap</span>
            <span data-testid="ledger-gap" class="gap">{entry.gapText}</span>
          </div>

          {#if entry.note !== null}
            <p data-testid="ledger-note" class="note">{entry.note}</p>
          {/if}

          {#if entry.excerptText !== null}
            <blockquote data-testid="ledger-excerpt" class="excerpt">
              <p class="excerpt-text">{entry.excerptText}</p>
              {#if entry.excerptSource !== null}
                <cite class="excerpt-source">{entry.excerptSource}</cite>
              {/if}
            </blockquote>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div data-testid="ledger-sr" class="sr-only">
    {#if hasData}
      {#each entries as entry}
        <p>
          {entry.key}: {entry.beforeDate} to {entry.afterDate}, {entry.gapText}{#if entry.label !== null}
            — {entry.label}{/if}
        </p>
      {/each}
    {:else}
      <p>No version boundaries recorded.</p>
    {/if}
  </div>
</div>

<style>
  .transition-ledger {
    background: #0f0f0f;
    color: #e0e0e0;
    padding: 1.5rem;
  }

  .ledger-title {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 1rem;
    overflow-wrap: anywhere;
  }

  .empty-state {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.35);
    padding: 2rem 0;
    margin: 0;
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Thin rules between entries — ledger lines, not cards. */
  .entry {
    padding: 1rem 0;
    border-top: 1px solid #1a1d23;
  }

  .entry:first-child {
    border-top: none;
    padding-top: 0;
  }

  .entry-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }

  .chips {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.85rem;
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .chip {
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .arrow {
    color: rgba(255, 255, 255, 0.3);
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
  }

  .label {
    font-family: 'Inter', 'DM Sans', sans-serif;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    overflow-wrap: anywhere;
  }

  .boundary {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .boundary-side {
    overflow-wrap: anywhere;
  }

  .tod {
    color: rgba(255, 255, 255, 0.4);
  }

  .gap-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .field-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .gap {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .note {
    font-family: 'Inter', 'DM Sans', sans-serif;
    font-size: 0.8rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
    margin: 0.6rem 0 0;
    max-width: 42rem;
    overflow-wrap: anywhere;
  }

  .excerpt {
    margin: 0.75rem 0 0;
    padding: 0 0 0 0.85rem;
    border-left: 2px solid #2a2f38;
    max-width: 42rem;
  }

  .excerpt-text {
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    font-style: italic;
    font-size: 0.9rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .excerpt-source {
    display: block;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-style: normal;
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 0.35rem;
    overflow-wrap: anywhere;
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
