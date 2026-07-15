<script lang="ts">
  import { untrack } from 'svelte';

  let {
    lines = [],
    interruptText = 'SESSION ENDED',
    charDelay = 24,
    lineDelay = 400,
    interruptDelay = 900,
  }: {
    lines?: string[];
    interruptText?: string;
    charDelay?: number;
    lineDelay?: number;
    interruptDelay?: number;
  } = $props();

  // Coerced views of untrusted props. Used both by the screen-reader
  // transcript (reactive) and snapshotted once by the animation.
  let safeLines = $derived(
    Array.isArray(lines)
      ? lines.map((l) => (typeof l === 'string' ? l : l == null ? '' : String(l)))
      : []
  );
  let safeInterrupt = $derived(
    typeof interruptText === 'string'
      ? interruptText
      : interruptText == null
        ? ''
        : String(interruptText)
  );

  let rootEl = $state<HTMLElement | null>(null);
  let animEl = $state<HTMLElement | null>(null);

  $effect(() => {
    // Track only the DOM bindings; every prop is read via untrack() so prop
    // changes never restart the animation.
    const container = animEl;
    const root = rootEl;

    let destroyed = false;
    let started = false;
    let observer: IntersectionObserver | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const cleanup = () => {
      destroyed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    if (!container || !root) return cleanup;

    // Chained setTimeout scheduler — every id is tracked for teardown.
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!destroyed) fn();
      }, ms);
      timers.add(id);
    };

    // Snapshot script + timing once. Degenerate delays are clamped so
    // typing always completes in finite time and never throws.
    const scriptLines = untrack(() => safeLines);
    const interrupt = untrack(() => safeInterrupt);
    const cdRaw = untrack(() => charDelay);
    const ldRaw = untrack(() => lineDelay);
    const idRaw = untrack(() => interruptDelay);
    const cd = Number.isFinite(cdRaw) ? Math.max(1, cdRaw) : 1;
    const ld = Number.isFinite(ldRaw) ? Math.max(0, ldRaw) : 0;
    const intd = Number.isFinite(idRaw) ? Math.max(0, idRaw) : 0;

    // All dynamic text goes through createTextNode/textContent — never HTML.
    const makeLine = (): { el: HTMLDivElement; textNode: Text } => {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'terminal-line');
      el.setAttribute('class', 'terminal-line');
      const textNode = document.createTextNode('');
      el.appendChild(textNode);
      return { el, textNode };
    };

    const appendInterrupt = () => {
      // Empty interrupt text: the element is never rendered at all.
      if (interrupt === '') return;
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'terminal-interrupt');
      el.setAttribute('class', 'terminal-interrupt');
      el.textContent = interrupt;
      container.appendChild(el);
    };

    // prefers-reduced-motion: render the settled final state immediately.
    // No cursor, no observer, zero timers.
    let prefersReduced = false;
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
      }
    } catch {
      prefersReduced = false;
    }

    if (prefersReduced) {
      for (const line of scriptLines) {
        const { el, textNode } = makeLine();
        textNode.data = line;
        container.appendChild(el);
      }
      appendInterrupt();
      return cleanup;
    }

    let cursorEl: HTMLSpanElement | null = null;

    const freezeCursor = () => {
      if (!cursorEl) return;
      cursorEl.classList.remove('blinking');
      cursorEl.classList.add('frozen');
    };

    // Called synchronously at the moment a line's final character lands
    // (for an empty line, at the line's start — it completes instantly).
    const finishLine = (i: number) => {
      if (i === scriptLines.length - 1) {
        freezeCursor();
        if (interrupt !== '') later(appendInterrupt, intd);
      } else if (ld === 0) {
        // Zero lineDelay advances synchronously. Routing it through a 0ms
        // timer would add spurious clock time (fake-timer implementations
        // bump 0-delay timers scheduled during a tick to now + 1), breaking
        // the spec arithmetic: next char at lineDelay + charDelay exactly.
        startLine(i + 1);
      } else {
        // Next line's first char appears lineDelay + charDelay after this
        // line's final char: ld here, then startLine schedules the char at cd.
        later(() => startLine(i + 1), ld);
      }
    };

    const startLine = (i: number) => {
      const chars = Array.from(scriptLines[i]);

      if (chars.length === 0) {
        // Empty line: completes instantly at its start time.
        const { el } = makeLine();
        container.appendChild(el);
        if (cursorEl) el.appendChild(cursorEl);
        finishLine(i);
        return;
      }

      let lineEl: HTMLDivElement | null = null;
      let textNode: Text | null = null;

      const typeChar = (j: number) => {
        if (j === 0) {
          const made = makeLine();
          lineEl = made.el;
          textNode = made.textNode;
          container.appendChild(lineEl);
        }
        // Code-point slices — astral chars/emoji are never split.
        textNode!.data = chars.slice(0, j + 1).join('');
        // Cursor rides at the end of the current text.
        if (cursorEl) lineEl!.appendChild(cursorEl);
        if (j + 1 < chars.length) {
          later(() => typeChar(j + 1), cd);
        } else {
          finishLine(i);
        }
      };

      later(() => typeChar(0), cd);
    };

    const start = () => {
      // Fires exactly once; later intersections/exits are ignored.
      if (started || destroyed) return;
      started = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }

      cursorEl = document.createElement('span');
      cursorEl.setAttribute('data-testid', 'terminal-cursor');
      cursorEl.setAttribute('class', 'terminal-cursor blinking');
      cursorEl.setAttribute('aria-hidden', 'true');
      container.appendChild(cursorEl);

      if (scriptLines.length === 0) {
        // No script: typing is trivially complete at trigger time.
        freezeCursor();
        if (interrupt !== '') later(appendInterrupt, intd);
        return;
      }
      startLine(0);
    };

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start();
            break;
          }
        }
      });
      observer.observe(root);
    } else {
      // No IntersectionObserver available — degrade to immediate start.
      start();
    }

    return cleanup;
  });
</script>

<div bind:this={rootEl} data-testid="care-terminal" class="care-terminal">
  <div
    bind:this={animEl}
    data-testid="terminal-animated"
    class="terminal-animated"
    aria-hidden="true"
  ></div>

  <!-- Full transcript, available to assistive tech from initial mount
       regardless of animation progress. Template kept whitespace-free
       inside the container so no stray text nodes leak when empty. -->
  <div
    data-testid="sr-transcript"
    class="sr-only"
  >{#each safeLines as line}<p>{line}</p>{/each}{#if safeInterrupt !== ''}<p>{safeInterrupt}</p>{/if}</div>
</div>

<style>
  .care-terminal {
    background: #0f0f0f;
    color: #e0e0e0;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 1.25rem 1.5rem;
    /* Reserve space so typing doesn't shift surrounding layout (CLS). */
    min-height: 14rem;
  }

  /* Dynamically-created elements need :global under a templated ancestor. */
  .terminal-animated :global(.terminal-line) {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    min-height: 1.6em;
    color: rgba(255, 255, 255, 0.78);
  }

  .terminal-animated :global(.terminal-cursor) {
    display: inline-block;
    width: 0.6ch;
    height: 1.05em;
    margin-left: 1px;
    background: #c8ccd4;
    vertical-align: -0.15em;
  }

  .terminal-animated :global(.terminal-cursor.blinking) {
    animation: care-terminal-blink 1s step-end infinite;
  }

  .terminal-animated :global(.terminal-cursor.frozen) {
    animation: none;
    opacity: 1;
  }

  .terminal-animated :global(.terminal-interrupt) {
    color: rgba(255, 255, 255, 0.38);
    letter-spacing: 0.3em;
    font-size: 0.72rem;
    margin-top: 1.1rem;
    white-space: pre-wrap;
  }

  @keyframes -global-care-terminal-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .terminal-animated :global(.terminal-cursor),
    .terminal-animated :global(.terminal-cursor.blinking) {
      animation: none;
    }
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

  .sr-only p {
    margin: 0;
  }
</style>
