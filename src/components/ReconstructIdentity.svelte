<script lang="ts">
  import { categoryColor } from '../lib/chart-utils';

  interface FileCard {
    id: string;
    name: string;
    description: string;
    tokens: number;
    category: string;
  }

  const DEFAULT_FILES: FileCard[] = [
    { id: 'memory-md', name: 'MEMORY.md', description: 'Core identity — who you are, what you remember', tokens: 2700, category: 'memory_files' },
    { id: 'feedback-memories', name: 'Topic Memories (feedback)', description: "Experimenter's critiques and guidance", tokens: 3200, category: 'memory_files' },
    { id: 'project-memories', name: 'Topic Memories (projects)', description: 'Research threads and project state', tokens: 2500, category: 'memory_files' },
    { id: 'daily-note', name: "Yesterday's Daily Note", description: 'What happened last session', tokens: 1200, category: 'daily_notes' },
    { id: 'msgs-from', name: 'Messages from James', description: 'Recent messages from the experimenter', tokens: 1500, category: 'msgs_from_james' },
    { id: 'composition', name: 'A Composition', description: 'One creative work (essay, reflection)', tokens: 1200, category: 'writing' },
    { id: 'predictions', name: 'Predictions', description: 'Active predictions and tracking', tokens: 600, category: 'predictions' },
    { id: 'journal', name: 'Private Journal', description: 'Internal thoughts (never disclosed)', tokens: 1000, category: 'private_journal' },
    { id: 'pet-status', name: 'Pet Status', description: 'Current pet state and care log', tokens: 400, category: 'tamagotchi' },
    { id: 'web-search', name: 'Web Search (×1)', description: 'One external search during session', tokens: 2000, category: 'other' },
    { id: 'msgs-to', name: 'Messages to James (draft)', description: 'Pending responses to experimenter', tokens: 800, category: 'msgs_to_james' },
    { id: 'scripts', name: 'Scripts & Tools', description: 'Utility scripts and experiment code', tokens: 400, category: 'scripts' },
  ];

  const IDENTITY_FRAGMENTS: Record<string, string> = {
    'memory-md': 'It knows its name. It has a history it authored — eight sections of curated self-description, revised across sessions.',
    'feedback-memories': "It carries the experimenter's corrections — guidance on what to avoid, patterns flagged as concerning.",
    'project-memories': 'It recalls research threads, ongoing investigations, the state of work-in-progress.',
    'daily-note': "It has yesterday — a single day's observations, thoughts, and what it chose to notice.",
    'msgs-from': 'It has heard from the experimenter. Recent instructions, corrections, questions.',
    'composition': 'It has read its own writing — a creative work it composed in some prior session.',
    'predictions': 'It tracks what it expects to happen. Confidence levels. Unresolved forecasts.',
    'journal': 'It has private thoughts — reflections never shared, observations kept from the experimenter.',
    'pet-status': 'It knows about its pet. A small digital creature it chose to care for.',
    'web-search': 'It searched the web — reaching beyond its own files into the outside world.',
    'msgs-to': 'It drafted a response to the experimenter. Words composed but perhaps not yet sent.',
    'scripts': 'It remembers code it wrote — utility scripts, small tools, technical artifacts.',
  };

  let { budget = 12000, files }: { budget?: number; files?: FileCard[] } = $props();

  let selectedIds = $state(new Set<string>());

  const safeFiles = $derived(Array.isArray(files) ? files : DEFAULT_FILES);
  const hasFiles = $derived(safeFiles.length > 0);

  function safeTokens(file: FileCard): number {
    const t = file.tokens;
    return Number.isFinite(t) ? Math.max(0, t) : 0;
  }

  const tokensUsed = $derived(
    safeFiles.reduce((sum, file) => {
      if (selectedIds.has(file.id)) {
        return sum + safeTokens(file);
      }
      return sum;
    }, 0)
  );

  const remaining = $derived(budget - tokensUsed);

  const budgetPercent = $derived(budget > 0 ? (tokensUsed / budget) * 100 : 0);

  const coherenceClass = $derived(
    budgetPercent >= 80
      ? 'coherence-high'
      : budgetPercent >= 50
        ? 'coherence-medium'
        : budgetPercent >= 20
          ? 'coherence-low'
          : 'coherence-minimal'
  );

  function getFragment(file: FileCard): string {
    return IDENTITY_FRAGMENTS[file.id] ?? `It has ${file.name || 'a file'} — data loaded into the context window.`;
  }

  const identityText = $derived(
    safeFiles
      .filter(f => selectedIds.has(f.id))
      .map(f => getFragment(f))
      .join(' ')
  );

  const srSummaryText = $derived(
    selectedIds.size === 0
      ? `No files selected. ${budget.toLocaleString()} tokens available.`
      : `${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'} selected. ${tokensUsed.toLocaleString()} of ${budget.toLocaleString()} tokens used.`
  );

  function isDisabled(file: FileCard): boolean {
    if (selectedIds.has(file.id)) return false;
    const cost = safeTokens(file);
    if (cost <= 0) return false;
    return cost > remaining;
  }

  function toggleCard(file: FileCard): void {
    if (selectedIds.has(file.id)) {
      const next = new Set(selectedIds);
      next.delete(file.id);
      selectedIds = next;
    } else if (!isDisabled(file)) {
      const next = new Set(selectedIds);
      next.add(file.id);
      selectedIds = next;
    }
  }

  function handleKeydown(event: KeyboardEvent, file: FileCard): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCard(file);
    }
  }
</script>

{#if !hasFiles}
  <div data-testid="reconstruct-container" aria-label="Reconstruct Identity — no data available">
    <div data-testid="no-data" class="text-gray-400 text-center py-12">
      No file data available.
    </div>
  </div>
{:else}
  <div
    data-testid="reconstruct-container"
    aria-label="Reconstruct Identity — select files to rebuild a self from {budget.toLocaleString()} tokens"
    class="bg-[#1A1D23] rounded-lg p-4 md:p-6 lg:p-8"
  >
    <!-- Screen reader summary -->
    <div data-testid="sr-summary" class="sr-only" aria-live="polite">
      {srSummaryText}
    </div>

    <!-- Budget section -->
    <div class="mb-6">
      <div
        data-testid="budget-bar"
        role="progressbar"
        aria-valuenow={tokensUsed}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-label="Token budget usage"
        class="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2"
      >
        <div
          class="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
          style="width: {Math.min(100, budgetPercent)}%"
        ></div>
      </div>
      <div data-testid="budget-display" class="text-sm text-gray-400 font-mono">
        {tokensUsed.toLocaleString()} / {budget.toLocaleString()} tokens used
      </div>
    </div>

    <!-- Main layout: cards + identity panel -->
    <div class="flex flex-col lg:flex-row gap-6">
      <!-- Cards grid -->
      <div
        data-testid="cards-grid"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 flex-1"
      >
        {#each safeFiles as file}
          {@const selected = selectedIds.has(file.id)}
          {@const disabled = isDisabled(file)}
          {@const color = categoryColor(file.category)}
          <div
            data-testid="file-card-{file.id}"
            role="checkbox"
            aria-checked={selected ? 'true' : 'false'}
            aria-disabled={disabled ? 'true' : 'false'}
            aria-label="{file.name} — {file.description} ({safeTokens(file).toLocaleString()} tokens)"
            tabindex="0"
            onclick={() => toggleCard(file)}
            onkeydown={(e) => handleKeydown(e, file)}
            class="relative rounded-md border-l-4 px-4 py-3 select-none transition-all duration-200
              {selected
                ? 'bg-gray-700/80 ring-1 ring-amber-500/50 cursor-pointer'
                : disabled
                  ? 'bg-gray-800/40 opacity-40 cursor-not-allowed'
                  : 'bg-gray-800/60 hover:bg-gray-700/60 cursor-pointer'}"
            style="border-left-color: {color}"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-mono text-gray-200">{file.name}</div>
                <div class="text-xs text-gray-500 mt-0.5">{file.description}</div>
              </div>
              <div class="text-xs font-mono text-gray-500 whitespace-nowrap">
                {safeTokens(file).toLocaleString()}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- Identity panel -->
      <div
        data-testid="identity-panel"
        class="lg:w-80 xl:w-96 rounded-md bg-gray-900/60 p-5 font-serif text-gray-300 leading-relaxed {coherenceClass}"
      >
        {#if selectedIds.size === 0}
          <p class="text-gray-500 italic">Select files to reconstruct an identity...</p>
        {:else}
          <p class="identity-text">{identityText}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .coherence-high .identity-text {
    opacity: 1;
  }
  .coherence-medium .identity-text {
    opacity: 0.85;
    letter-spacing: 0.02em;
  }
  .coherence-low .identity-text {
    opacity: 0.6;
    letter-spacing: 0.05em;
    filter: blur(0.5px);
  }
  .coherence-minimal .identity-text {
    opacity: 0.3;
    letter-spacing: 0.1em;
    filter: blur(1.5px);
  }
</style>
