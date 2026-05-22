<script lang="ts">
  import { versionColor, categoryColor } from '../lib/chart-utils';

  interface Session {
    id: string;
    date: string;
    time_of_day: string;
    version: string;
    turns: number;
    attention_profile: Record<string, { reads: number; writes: number }>;
    web_searches: string[];
    wrote_composition: boolean;
    wrote_private_journal: boolean;
    updated_memory: boolean;
    messaged_james: boolean;
    wrote_prediction: boolean;
  }

  let { session: initialSession, sessions }: { session?: Session | null; sessions?: any[] } = $props();

  let currentIndex = $state(0);
  const sortedSessions = $derived.by(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return [];
    return [...sessions].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.time_of_day < b.time_of_day ? -1 : 1;
    });
  });

  const session = $derived(
    sortedSessions.length > 0
      ? sortedSessions[Math.min(currentIndex, sortedSessions.length - 1)] as Session
      : initialSession ?? null
  );

  function prevSession() {
    if (currentIndex > 0) currentIndex--;
  }
  function nextSession() {
    if (currentIndex < sortedSessions.length - 1) currentIndex++;
  }

  const ACTIVITY_FLAGS = [
    { field: 'wrote_composition', label: 'Wrote' },
    { field: 'wrote_private_journal', label: 'Journal' },
    { field: 'updated_memory', label: 'Memory' },
    { field: 'messaged_james', label: 'Messaged' },
    { field: 'wrote_prediction', label: 'Predicted' },
  ] as const;

  const hasSession = $derived(session != null);

  const safeSearches = $derived(
    hasSession && Array.isArray(session!.web_searches) ? session!.web_searches : []
  );

  const profileEntries = $derived(
    hasSession && session!.attention_profile
      ? Object.entries(session!.attention_profile)
      : []
  );

  const hasProfile = $derived(profileEntries.length > 0);

  const maxActivity = $derived(
    hasProfile
      ? Math.max(
          ...profileEntries.map(([, v]) => (v.reads || 0) + (v.writes || 0)),
          1
        )
      : 1
  );

  function badgeStyle(version: string): string {
    const color = versionColor(version);
    return `background-color: ${color}; color: #0f0f0f;`;
  }

  function barWidth(entry: { reads: number; writes: number }): string {
    const total = (entry.reads || 0) + (entry.writes || 0);
    const pct = Math.max(4, (total / maxActivity) * 100);
    return `width: ${pct}%;`;
  }
</script>

<div data-testid="session-container" class="session-explorer">
  {#if !hasSession}
    <div data-testid="no-data" class="no-data">
      <p>No session selected</p>
    </div>
  {:else}
    {#if sortedSessions.length > 1}
      <nav class="session-nav">
        <button onclick={prevSession} disabled={currentIndex === 0} class="nav-btn">← Prev</button>
        <span class="nav-pos font-mono text-xs text-gray-500">
          {currentIndex + 1} / {sortedSessions.length}
        </span>
        <button onclick={nextSession} disabled={currentIndex >= sortedSessions.length - 1} class="nav-btn">Next →</button>
      </nav>
    {/if}

    <header class="session-header">
      <span data-testid="session-id" class="session-id">{session!.id}</span>
      <span
        data-testid="version-badge"
        class="version-badge"
        style={badgeStyle(session!.version)}
      >
        {session!.version}
      </span>
    </header>

    <div class="session-meta">
      <span data-testid="session-date" class="session-date">
        {session!.date} {session!.time_of_day}
      </span>
      <span data-testid="turn-count" class="turn-count">
        {session!.turns} turns
      </span>
    </div>

    <div data-testid="activity-flags" class="activity-flags">
      {#each ACTIVITY_FLAGS as flag}
        <span
          class="activity-flag {session![flag.field as keyof Session] ? 'active' : 'inactive'}"
          data-activity={flag.field}
        >
          {flag.label}
        </span>
      {/each}
    </div>

    <div class="attention-section">
      {#if hasProfile}
        <div data-testid="attention-chart" class="attention-chart">
          {#each profileEntries as [category, counts]}
            <div class="attention-row">
              <span class="category-label">{category}</span>
              <div
                class="attention-bar"
                data-category={category}
                style="{barWidth(counts)} background-color: {categoryColor(category)};"
              ></div>
            </div>
          {/each}
        </div>
      {:else}
        <div data-testid="empty-profile" class="empty-profile">
          No data recorded
        </div>
      {/if}
    </div>

    <div data-testid="web-searches" class="web-searches">
      {#if safeSearches.length > 0}
        <ul class="search-list">
          {#each safeSearches as term}
            <li class="search-term">{term}</li>
          {/each}
        </ul>
      {:else}
        <span class="no-searches">None</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .session-explorer {
    background: #1A1D23;
    border: 1px solid #2a2d35;
    border-radius: 8px;
    padding: 1rem;
    font-family: 'Inter', 'DM Sans', sans-serif;
    color: #e0e0e0;
  }

  .session-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #2a2d35;
  }

  .nav-btn {
    background: transparent;
    border: 1px solid #3a3d45;
    color: #9ca3af;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
    transition: all 0.15s;
  }

  .nav-btn:hover:not(:disabled) {
    border-color: #6b7280;
    color: #e0e0e0;
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .no-data {
    text-align: center;
    color: #6b7280;
    padding: 2rem 1rem;
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .session-id {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.875rem;
    color: #9ca3af;
  }

  .version-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .session-meta {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.75rem;
    font-size: 0.8125rem;
    color: #9ca3af;
  }

  .session-date {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
  }

  .turn-count {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
  }

  .activity-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-bottom: 1rem;
  }

  .activity-flag {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .activity-flag.active {
    background: rgba(255, 255, 255, 0.12);
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .activity-flag.inactive {
    background: transparent;
    color: #4b5563;
    border: 1px solid #2a2d35;
  }

  .attention-section {
    margin-bottom: 1rem;
  }

  .attention-chart {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .attention-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .category-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.6875rem;
    color: #9ca3af;
    min-width: 8rem;
    text-align: right;
  }

  .attention-bar {
    height: 0.5rem;
    border-radius: 2px;
    min-width: 4px;
    transition: width 0.2s ease;
  }

  .empty-profile {
    color: #6b7280;
    font-size: 0.8125rem;
    font-style: italic;
  }

  .web-searches {
    font-size: 0.8125rem;
  }

  .search-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .search-term {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid #2a2d35;
    border-radius: 4px;
    padding: 0.125rem 0.5rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: #d1d5db;
  }

  .no-searches {
    color: #6b7280;
    font-style: italic;
  }
</style>
