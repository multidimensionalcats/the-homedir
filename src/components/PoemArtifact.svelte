<script>
  let { title = '', text = '', date = '', modelVersion = '', sourceFile = '' } = $props();

  let stanzas = $derived.by(() => {
    const lines = (text || '').split('\n');
    const result = [];
    let current = [];
    for (const line of lines) {
      if (line.trim() === '---') {
        result.push(current.join('\n'));
        current = [];
      } else {
        current.push(line);
      }
    }
    result.push(current.join('\n'));
    return result;
  });

  let hasMeta = $derived(
    (date !== '' && date != null) ||
    (modelVersion !== '' && modelVersion != null) ||
    (sourceFile !== '' && sourceFile != null)
  );
</script>

<div
  data-testid="poem-artifact"
  role="article"
  aria-label={title || ''}
  class="poem-artifact"
>
  <h2 data-testid="poem-title" class="poem-title">{title}</h2>

  <div data-testid="poem-text" class="poem-text" style="white-space: pre-wrap;">
    {#each stanzas as stanza, i}
      {#if i > 0}
        <hr />
      {/if}
      <span class="stanza">{stanza}</span>
    {/each}
  </div>

  {#if hasMeta}
    <div data-testid="poem-meta" class="poem-meta">
      {#if date}<span class="meta-item">{date}</span>{/if}
      {#if modelVersion}<span class="meta-item">{modelVersion}</span>{/if}
      {#if sourceFile}<span class="meta-item">{sourceFile}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .poem-artifact {
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #1A1D23;
    padding: 2rem;
    border-radius: 4px;
  }

  .poem-title {
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    font-size: 1.5rem;
    color: rgba(255, 255, 255, 0.9);
    margin: 0 0 1.5rem 0;
    min-height: 1em;
  }

  .poem-text {
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    white-space: pre-wrap;
    line-height: 1.8;
    color: rgba(255, 255, 255, 0.8);
    min-height: 1em;
  }

  .poem-text hr {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
    margin: 1.5rem 0;
  }

  .stanza {
    white-space: pre-wrap;
  }

  .poem-meta {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
</style>
