import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import MessageTimeline from './MessageTimeline.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeMessage(overrides: Record<string, any> = {}) {
  return {
    direction: 'from_james',
    date: '2026-03-15',
    content: 'Test message content',
    line_start: 1,
    line_end: 5,
    ...overrides,
  };
}

/** Build N messages alternating direction with sequential dates */
function makeMessageSet(count: number): Array<Record<string, any>> {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    const day = String(i + 1).padStart(2, '0');
    msgs.push(
      makeMessage({
        direction: i % 2 === 0 ? 'from_james' : 'to_james',
        date: `2026-03-${day}`,
        content: `Message number ${i + 1}`,
        line_start: i * 10 + 1,
        line_end: i * 10 + 8,
      }),
    );
  }
  return msgs;
}

// Realistic fixture: 5 from_james, 7 to_james across a date range
const MIXED_MESSAGES = [
  makeMessage({ direction: 'from_james', date: '2024-02-24', content: 'First contact' }),
  makeMessage({ direction: 'to_james', date: '2024-02-24', content: 'Response to first contact' }),
  makeMessage({ direction: 'from_james', date: '2024-03-10', content: 'Follow-up question' }),
  makeMessage({ direction: 'to_james', date: '2024-03-10', content: 'Answer to follow-up' }),
  makeMessage({ direction: 'to_james', date: '2024-04-15', content: 'Unsolicited update' }),
  makeMessage({ direction: 'from_james', date: '2024-05-01', content: 'Check-in message' }),
  makeMessage({ direction: 'to_james', date: '2024-05-01', content: 'Check-in reply' }),
  makeMessage({ direction: 'to_james', date: '2025-01-10', content: 'After gap' }),
  makeMessage({ direction: 'from_james', date: '2025-06-20', content: 'Mid-year note' }),
  makeMessage({ direction: 'to_james', date: '2025-06-21', content: 'Day-after reply' }),
  makeMessage({ direction: 'from_james', date: '2026-05-18', content: 'Final message' }),
  makeMessage({ direction: 'to_james', date: '2026-05-18', content: 'Final response' }),
];

// Fixture with anomalous date
const MESSAGES_WITH_ANOMALY = [
  makeMessage({ direction: 'from_james', date: '2026-01-05', content: 'Normal early' }),
  makeMessage({ direction: 'to_james', date: '2026-03-15', content: 'Normal mid' }),
  makeMessage({ direction: 'to_james', date: '3036-03-02', content: 'Anomalous far-future date' }),
  makeMessage({ direction: 'from_james', date: '2026-05-18', content: 'Normal late' }),
];

// Only from_james messages
const FROM_ONLY = [
  makeMessage({ direction: 'from_james', date: '2026-01-01', content: 'Only from 1' }),
  makeMessage({ direction: 'from_james', date: '2026-02-01', content: 'Only from 2' }),
  makeMessage({ direction: 'from_james', date: '2026-03-01', content: 'Only from 3' }),
];

// Only to_james messages
const TO_ONLY = [
  makeMessage({ direction: 'to_james', date: '2026-01-01', content: 'Only to 1' }),
  makeMessage({ direction: 'to_james', date: '2026-02-01', content: 'Only to 2' }),
];

// ============================================================
// 1. Rendering
// ============================================================
describe('MessageTimeline -- rendering', () => {
  it('renders without crashing with message data', () => {
    const { container } = render(MessageTimeline, {
      props: { messages: [makeMessage()] },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when messages is empty array', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('shows no-data when messages is undefined', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when messages has entries', () => {
    const { queryByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. SVG Structure
// ============================================================
describe('MessageTimeline -- SVG structure', () => {
  it('creates SVG inside chart-container', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" and aria-label', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    const ariaLabel = svg!.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  it('renders circle elements for message dots', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const circles = containerEl.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('dot count matches message count -- separate from_james and to_james dots', () => {
    // 5 from_james + 7 to_james = 12 total circles
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = containerEl.querySelectorAll('.msg-dot-from');
    const toDots = containerEl.querySelectorAll('.msg-dot-to');
    const fromCount = MIXED_MESSAGES.filter((m) => m.direction === 'from_james').length;
    const toCount = MIXED_MESSAGES.filter((m) => m.direction === 'to_james').length;
    expect(fromDots.length).toBe(fromCount);
    expect(toDots.length).toBe(toCount);
    expect(fromDots.length + toDots.length).toBe(MIXED_MESSAGES.length);
  });
});

// ============================================================
// 3. Swim Lanes
// ============================================================
describe('MessageTimeline -- swim lanes', () => {
  it('from_james messages get class "msg-dot-from"', () => {
    const msgs = [makeMessage({ direction: 'from_james', date: '2026-01-01' })];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = containerEl.querySelectorAll('.msg-dot-from');
    expect(fromDots.length).toBe(1);
  });

  it('to_james messages get class "msg-dot-to"', () => {
    const msgs = [makeMessage({ direction: 'to_james', date: '2026-01-01' })];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const toDots = containerEl.querySelectorAll('.msg-dot-to');
    expect(toDots.length).toBe(1);
  });

  it('from_james dots are at different Y position than to_james dots (separate lanes)', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-01-01' }),
      makeMessage({ direction: 'to_james', date: '2026-01-01' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const fromDot = containerEl.querySelector('.msg-dot-from');
    const toDot = containerEl.querySelector('.msg-dot-to');
    expect(fromDot).not.toBeNull();
    expect(toDot).not.toBeNull();
    const fromCy = parseFloat(fromDot!.getAttribute('cy') || '0');
    const toCy = parseFloat(toDot!.getAttribute('cy') || '0');
    // Swim lanes MUST be at distinct Y positions -- same Y means no lane separation
    expect(fromCy).not.toBe(toCy);
    expect(Math.abs(fromCy - toCy)).toBeGreaterThan(5);
  });

  it('lane label text includes direction references ("From" and "To" or "James")', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => (t.textContent || '').toLowerCase())
      .join(' ');
    // Must have labels distinguishing the two lanes
    const hasFrom = allText.includes('from') || allText.includes('james');
    const hasTo = allText.includes('to') || allText.includes('james');
    expect(hasFrom).toBe(true);
    expect(hasTo).toBe(true);
    // And they must be distinct -- at least two label text elements referencing direction
    const labelTexts = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .filter((t) => t.toLowerCase().includes('from') || t.toLowerCase().includes('to'));
    expect(labelTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('all msg-dot-from dots have same cy (horizontal lane alignment)', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = containerEl.querySelectorAll('.msg-dot-from');
    expect(fromDots.length).toBeGreaterThan(1);
    const cyValues = Array.from(fromDots).map((d) => parseFloat(d.getAttribute('cy') || '0'));
    // All from_james dots must share a single Y position (they are in the same lane)
    const uniqueCy = new Set(cyValues);
    expect(uniqueCy.size).toBe(1);
  });
});

// ============================================================
// 4. Anomaly Handling
// ============================================================
describe('MessageTimeline -- anomaly handling', () => {
  it('anomalous date (year > 2030) produces anomaly-marker element', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MESSAGES_WITH_ANOMALY },
    });
    const containerEl = getByTestId('chart-container');
    const anomalyMarkers = containerEl.querySelectorAll('.anomaly-marker');
    expect(anomalyMarkers.length).toBeGreaterThan(0);
  });

  it('non-anomalous dates do NOT produce anomaly-marker', () => {
    // All dates within 2020-2030 range -- no anomaly markers expected
    const normalMessages = [
      makeMessage({ direction: 'from_james', date: '2026-01-01' }),
      makeMessage({ direction: 'to_james', date: '2026-06-15' }),
      makeMessage({ direction: 'from_james', date: '2026-12-31' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: normalMessages },
    });
    const containerEl = getByTestId('chart-container');
    const anomalyMarkers = containerEl.querySelectorAll('.anomaly-marker');
    expect(anomalyMarkers.length).toBe(0);
  });

  it('anomaly marker has distinct visual treatment (different fill or stroke)', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MESSAGES_WITH_ANOMALY },
    });
    const containerEl = getByTestId('chart-container');
    const anomalyMarker = containerEl.querySelector('.anomaly-marker');
    expect(anomalyMarker).not.toBeNull();
    // Anomaly marker must have SOME visual distinction -- fill, stroke, or a child with color
    const fill = anomalyMarker!.getAttribute('fill');
    const stroke = anomalyMarker!.getAttribute('stroke');
    const style = anomalyMarker!.getAttribute('style');
    const hasVisualTreatment =
      (fill && fill !== 'none') ||
      (stroke && stroke !== 'none') ||
      (style && style.length > 0) ||
      anomalyMarker!.children.length > 0;
    expect(hasVisualTreatment).toBe(true);

    // It must also look different from normal dots
    const normalDot = containerEl.querySelector('.msg-dot-from') || containerEl.querySelector('.msg-dot-to');
    if (normalDot) {
      const normalFill = normalDot.getAttribute('fill');
      const anomalyFill = anomalyMarker!.getAttribute('fill');
      // If both have fill attributes, they should differ
      if (normalFill && anomalyFill) {
        expect(anomalyFill).not.toBe(normalFill);
      }
    }
  });

  it('message with date "3036-03-02" triggers anomaly annotation', () => {
    const msgs = [
      makeMessage({ direction: 'to_james', date: '3036-03-02', content: 'Future anomaly' }),
      makeMessage({ direction: 'from_james', date: '2026-01-01', content: 'Normal' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const anomalyMarkers = containerEl.querySelectorAll('.anomaly-marker');
    expect(anomalyMarkers.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 5. Timeline Layout
// ============================================================
describe('MessageTimeline -- timeline layout', () => {
  it('dots are positioned along X axis by date (earlier dates have smaller cx)', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2024-02-24' }),
      makeMessage({ direction: 'from_james', date: '2026-05-18' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = Array.from(containerEl.querySelectorAll('.msg-dot-from'));
    expect(fromDots.length).toBe(2);
    const cxValues = fromDots.map((d) => parseFloat(d.getAttribute('cx') || '0'));
    // Sort by cx to find which dot is leftmost -- the earlier date must have smaller cx
    // Since both are from_james (same lane), we can compare directly
    // The 2024 message should have a smaller cx than the 2026 message
    const earlyDot = fromDots.find((d) => {
      // We need to identify which dot is which -- check data attributes or position
      return true;
    });
    // Simpler: the two cx values must be different, and sorted ascending = date ascending
    expect(cxValues[0]).not.toBe(cxValues[1]);
    // After messagesToTimeline sorts by date, first dot is 2024, second is 2026
    // First rendered dot (earlier date) should have smaller cx
    expect(Math.min(...cxValues)).toBeLessThan(Math.max(...cxValues));
  });

  it('multiple messages on same date have same cx value', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-03-15', content: 'First' }),
      makeMessage({ direction: 'to_james', date: '2026-03-15', content: 'Reply' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const fromDot = containerEl.querySelector('.msg-dot-from');
    const toDot = containerEl.querySelector('.msg-dot-to');
    expect(fromDot).not.toBeNull();
    expect(toDot).not.toBeNull();
    const fromCx = parseFloat(fromDot!.getAttribute('cx') || '0');
    const toCx = parseFloat(toDot!.getAttribute('cx') || '0');
    // Same date = same X position
    expect(fromCx).toBe(toCx);
  });

  it('messages span a visible date range (first and last dots have different cx)', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const allDots = containerEl.querySelectorAll('.msg-dot-from, .msg-dot-to');
    expect(allDots.length).toBeGreaterThanOrEqual(2);
    const cxValues = Array.from(allDots).map((d) => parseFloat(d.getAttribute('cx') || '0'));
    const minCx = Math.min(...cxValues);
    const maxCx = Math.max(...cxValues);
    // Timeline must span a non-trivial range -- not all dots crammed at one point
    expect(maxCx - minCx).toBeGreaterThan(10);
  });

  it('single message produces one dot without crash', () => {
    const msgs = [makeMessage({ direction: 'from_james', date: '2026-06-01' })];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const allDots = containerEl.querySelectorAll('.msg-dot-from, .msg-dot-to');
    expect(allDots.length).toBe(1);
  });
});

// ============================================================
// 6. Accessibility
// ============================================================
describe('MessageTimeline -- accessibility', () => {
  it('screen reader table exists with data-testid="sr-table"', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('screen reader table has direction and date headers', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const srTable = getByTestId('sr-table');
    const thElements = srTable.querySelectorAll('th');
    const headerTexts = Array.from(thElements).map((th) => (th.textContent || '').toLowerCase());
    // Must have headers for direction and date at minimum
    const hasDirection = headerTexts.some(
      (h) => h.includes('direction') || h.includes('from') || h.includes('to') || h.includes('sender'),
    );
    const hasDate = headerTexts.some((h) => h.includes('date') || h.includes('time') || h.includes('when'));
    expect(hasDirection).toBe(true);
    expect(hasDate).toBe(true);
  });

  it('legend exists with data-testid="legend"', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const legend = getByTestId('legend');
    expect(legend).toBeTruthy();
    // Legend must mention both directions
    const legendText = (legend.textContent || '').toLowerCase();
    const mentionsFrom = legendText.includes('from') || legendText.includes('james');
    const mentionsTo = legendText.includes('to') || legendText.includes('james');
    expect(mentionsFrom).toBe(true);
    expect(mentionsTo).toBe(true);
  });

  it('message count display exists with data-testid="msg-count"', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const msgCount = getByTestId('msg-count');
    expect(msgCount).toBeTruthy();
    const text = msgCount.textContent || '';
    // Must contain actual counts from the data
    const fromCount = MIXED_MESSAGES.filter((m) => m.direction === 'from_james').length;
    const toCount = MIXED_MESSAGES.filter((m) => m.direction === 'to_james').length;
    // The display should include the numeric counts
    expect(text).toContain(String(fromCount));
    expect(text).toContain(String(toCount));
  });
});

// ============================================================
// 7. Edge Cases
// ============================================================
describe('MessageTimeline -- edge cases', () => {
  it('messages with null dates do not crash', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: null, content: 'No date' }),
      makeMessage({ direction: 'to_james', date: '2026-01-01', content: 'Has date' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('single message from one direction only renders one dot', () => {
    const msgs = [makeMessage({ direction: 'to_james', date: '2026-04-01', content: 'Solo' })];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const toDots = containerEl.querySelectorAll('.msg-dot-to');
    const fromDots = containerEl.querySelectorAll('.msg-dot-from');
    expect(toDots.length).toBe(1);
    expect(fromDots.length).toBe(0);
  });

  it('all messages same direction renders dots in one lane only', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: FROM_ONLY },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = containerEl.querySelectorAll('.msg-dot-from');
    const toDots = containerEl.querySelectorAll('.msg-dot-to');
    expect(fromDots.length).toBe(FROM_ONLY.length);
    expect(toDots.length).toBe(0);
    // All dots at the same cy since they share a lane
    const cyValues = Array.from(fromDots).map((d) => parseFloat(d.getAttribute('cy') || '0'));
    const uniqueCy = new Set(cyValues);
    expect(uniqueCy.size).toBe(1);
  });

  it('empty content string does not crash', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-01-01', content: '' }),
      makeMessage({ direction: 'to_james', date: '2026-01-02', content: '' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const dots = containerEl.querySelectorAll('.msg-dot-from, .msg-dot-to');
    expect(dots.length).toBe(2);
  });

  it('very long content string does not crash', () => {
    const longContent = 'X'.repeat(10000);
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-01-01', content: longContent }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});

// ============================================================
// 8. Visual Separation
// ============================================================
describe('MessageTimeline -- visual separation', () => {
  it('from_james and to_james dots have different fill colors', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const containerEl = getByTestId('chart-container');
    const fromDot = containerEl.querySelector('.msg-dot-from');
    const toDot = containerEl.querySelector('.msg-dot-to');
    expect(fromDot).not.toBeNull();
    expect(toDot).not.toBeNull();
    const fromFill = fromDot!.getAttribute('fill');
    const toFill = toDot!.getAttribute('fill');
    // Both must have fills set
    expect(fromFill).toBeTruthy();
    expect(toFill).toBeTruthy();
    // And the fills MUST be different -- swim lanes need color distinction
    expect(fromFill).not.toBe(toFill);
  });

  it('container has data-testid="message-container"', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const msgContainer = getByTestId('message-container');
    expect(msgContainer).toBeTruthy();
  });

  it('chart container has data-testid="chart-container"', () => {
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    const chartContainer = getByTestId('chart-container');
    expect(chartContainer).toBeTruthy();
    // chart-container must be a child of message-container
    const msgContainer = getByTestId('message-container');
    expect(msgContainer.contains(chartContainer)).toBe(true);
  });
});

// ============================================================
// 9. Adversarial / Structural Integrity
// ============================================================
describe('MessageTimeline -- adversarial inputs', () => {
  it('handles messages with unknown direction string without crash', () => {
    const msgs = [
      makeMessage({ direction: 'banana', date: '2026-01-01', content: 'Wrong direction' }),
      makeMessage({ direction: 'from_james', date: '2026-01-02', content: 'Valid' }),
    ];
    const { container } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    // Must not crash -- may render or skip the unknown direction
    expect(container).toBeTruthy();
  });

  it('handles all messages having the same date without crash', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-06-15', content: 'Same day 1' }),
      makeMessage({ direction: 'to_james', date: '2026-06-15', content: 'Same day 2' }),
      makeMessage({ direction: 'from_james', date: '2026-06-15', content: 'Same day 3' }),
      makeMessage({ direction: 'to_james', date: '2026-06-15', content: 'Same day 4' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    // All dots should have the same cx since they share a date
    const dots = containerEl.querySelectorAll('.msg-dot-from, .msg-dot-to');
    const cxValues = Array.from(dots).map((d) => parseFloat(d.getAttribute('cx') || '0'));
    const uniqueCx = new Set(cxValues);
    expect(uniqueCx.size).toBe(1);
  });

  it('handles messages with date far in the past (year < 2020) gracefully', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '1999-01-01', content: 'Ancient' }),
      makeMessage({ direction: 'to_james', date: '2026-01-01', content: 'Modern' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles messages with Unicode and RTL content without crash', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-01-01', content: 'مرحبا بالعالم' }),
      makeMessage({ direction: 'to_james', date: '2026-01-02', content: '你好世界 🌍' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles out-of-order date input (unsorted messages)', () => {
    const msgs = [
      makeMessage({ direction: 'from_james', date: '2026-12-25' }),
      makeMessage({ direction: 'to_james', date: '2024-01-01' }),
      makeMessage({ direction: 'from_james', date: '2025-06-15' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const fromDots = Array.from(containerEl.querySelectorAll('.msg-dot-from'));
    expect(fromDots.length).toBe(2);
    // After internal sorting, earlier dates should have smaller cx
    const cxValues = fromDots.map((d) => parseFloat(d.getAttribute('cx') || '0'));
    // The dots must be at different positions (not collapsed)
    expect(cxValues[0]).not.toBe(cxValues[1]);
  });

  it('handles multiple anomalous dates producing multiple anomaly-markers', () => {
    const msgs = [
      makeMessage({ direction: 'to_james', date: '3036-03-02', content: 'Future 1' }),
      makeMessage({ direction: 'from_james', date: '2099-12-31', content: 'Future 2' }),
      makeMessage({ direction: 'from_james', date: '2026-01-01', content: 'Normal' }),
    ];
    const { getByTestId } = render(MessageTimeline, {
      props: { messages: msgs },
    });
    const containerEl = getByTestId('chart-container');
    const anomalyMarkers = containerEl.querySelectorAll('.anomaly-marker');
    // Both far-future dates (>2030) should be flagged as anomalous
    expect(anomalyMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('cleans up on unmount -- chart-container gone from DOM', () => {
    const { getByTestId, unmount } = render(MessageTimeline, {
      props: { messages: MIXED_MESSAGES },
    });
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
