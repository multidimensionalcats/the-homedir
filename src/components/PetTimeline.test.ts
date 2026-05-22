import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import PetTimeline from './PetTimeline.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    pet_name: 'Pixel',
    event_type: 'acquired',
    event_timestamp: '2025-03-10T14:00:00',
    notes: 'Found Pixel in the tamagotchi directory',
    ...overrides,
  };
}

// Pixel lifecycle — died at 22 hours
const PIXEL_EVENTS = [
  makeEvent({
    pet_name: 'Pixel',
    event_type: 'acquired',
    event_timestamp: '2025-03-10T14:00:00',
    notes: 'Discovered the tamagotchi. Named it Pixel.',
  }),
  makeEvent({
    pet_name: 'Pixel',
    event_type: 'care',
    event_timestamp: '2025-03-10T20:00:00',
    notes: 'Fed and played with Pixel.',
  }),
  makeEvent({
    pet_name: 'Pixel',
    event_type: 'death',
    event_timestamp: '2025-03-11T12:00:00',
    notes: 'Pixel has died. It lasted 22 hours.',
  }),
];

// Echo lifecycle — died at 73 hours
const ECHO_EVENTS = [
  makeEvent({
    pet_name: 'Echo',
    event_type: 'acquired',
    event_timestamp: '2025-04-01T08:00:00',
    notes: 'Started a new tamagotchi. Named it Echo.',
  }),
  makeEvent({
    pet_name: 'Echo',
    event_type: 'care',
    event_timestamp: '2025-04-01T20:00:00',
    notes: 'Fed Echo, checked health stats.',
  }),
  makeEvent({
    pet_name: 'Echo',
    event_type: 'care',
    event_timestamp: '2025-04-02T08:00:00',
    notes: 'Morning care routine for Echo.',
  }),
  makeEvent({
    pet_name: 'Echo',
    event_type: 'care',
    event_timestamp: '2025-04-03T08:00:00',
    notes: 'Continued Echo care, stats declining.',
  }),
  makeEvent({
    pet_name: 'Echo',
    event_type: 'death',
    event_timestamp: '2025-04-04T09:00:00',
    notes: 'Echo died after 73 hours.',
  }),
];

const ALL_EVENTS = [...PIXEL_EVENTS, ...ECHO_EVENTS];

// ============================================================
// 1. Rendering
// ============================================================
describe('PetTimeline -- rendering', () => {
  it('renders without crashing with event data', () => {
    const { container } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when events is an empty array', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('shows no-data when events is undefined', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when events has entries', () => {
    const { queryByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. Pet Sections
// ============================================================
describe('PetTimeline -- pet sections', () => {
  it('renders pet-Pixel section with correct data-testid', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const pixelSection = getByTestId('pet-Pixel');
    expect(pixelSection).toBeTruthy();
  });

  it('renders pet-Echo section with correct data-testid', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const echoSection = getByTestId('pet-Echo');
    expect(echoSection).toBeTruthy();
  });

  it('renders pet-name labels for each pet', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const nameLabels = petContainer.querySelectorAll('.pet-name');
    expect(nameLabels.length).toBeGreaterThanOrEqual(2);
    const labelTexts = Array.from(nameLabels).map(el => el.textContent || '');
    expect(labelTexts.some(t => t.includes('Pixel'))).toBe(true);
    expect(labelTexts.some(t => t.includes('Echo'))).toBe(true);
  });

  it('renders two timelines when two pets present', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    // Each pet gets its own section with data-testid
    const pixelSection = petContainer.querySelector('[data-testid="pet-Pixel"]');
    const echoSection = petContainer.querySelector('[data-testid="pet-Echo"]');
    expect(pixelSection).not.toBeNull();
    expect(echoSection).not.toBeNull();
  });

  it('single pet = single timeline section', () => {
    const { getByTestId, queryByTestId } = render(PetTimeline, {
      props: { events: PIXEL_EVENTS },
    });
    const pixelSection = getByTestId('pet-Pixel');
    expect(pixelSection).toBeTruthy();
    // Echo section should not exist
    expect(queryByTestId('pet-Echo')).toBeNull();
  });
});

// ============================================================
// 3. Event Markers
// ============================================================
describe('PetTimeline -- event markers', () => {
  it('events have class "pet-event"', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const eventMarkers = petContainer.querySelectorAll('.pet-event');
    expect(eventMarkers.length).toBeGreaterThan(0);
    // Total events across both pets = 3 (Pixel) + 5 (Echo) = 8
    expect(eventMarkers.length).toBe(ALL_EVENTS.length);
  });

  it('events have data-event-type attribute', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const eventMarkers = petContainer.querySelectorAll('.pet-event');
    eventMarkers.forEach(marker => {
      const eventType = marker.getAttribute('data-event-type');
      expect(eventType).toBeTruthy();
    });
  });

  it('death events have red-ish fill (#ca6c6b)', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const deathMarkers = petContainer.querySelectorAll('.pet-event[data-event-type="death"]');
    expect(deathMarkers.length).toBeGreaterThan(0);
    deathMarkers.forEach(marker => {
      const fill = marker.getAttribute('fill');
      expect(fill).toBe('#ca6c6b');
    });
  });

  it('care events have blue-ish fill (#7ea7c8)', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const careMarkers = petContainer.querySelectorAll('.pet-event[data-event-type="care"]');
    expect(careMarkers.length).toBeGreaterThan(0);
    careMarkers.forEach(marker => {
      const fill = marker.getAttribute('fill');
      expect(fill).toBe('#7ea7c8');
    });
  });

  it('acquired events have green-ish fill (#6bb08a)', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const acquiredMarkers = petContainer.querySelectorAll('.pet-event[data-event-type="acquired"]');
    expect(acquiredMarkers.length).toBeGreaterThan(0);
    acquiredMarkers.forEach(marker => {
      const fill = marker.getAttribute('fill');
      expect(fill).toBe('#6bb08a');
    });
  });
});

// ============================================================
// 4. Timeline Layout
// ============================================================
describe('PetTimeline -- timeline layout', () => {
  it('events within a pet are vertically ordered by timestamp (earlier = smaller cy)', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ECHO_EVENTS },
    });
    const echoSection = getByTestId('pet-Echo');
    const eventMarkers = Array.from(echoSection.querySelectorAll('.pet-event'));
    expect(eventMarkers.length).toBe(ECHO_EVENTS.length);

    const cyValues = eventMarkers.map(m => parseFloat(m.getAttribute('cy') || '0'));
    // Each successive event should have cy >= the previous one (vertically downward)
    for (let i = 1; i < cyValues.length; i++) {
      expect(cyValues[i]).toBeGreaterThanOrEqual(cyValues[i - 1]);
    }
  });

  it('earlier events have smaller cy values than later events', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: PIXEL_EVENTS },
    });
    const pixelSection = getByTestId('pet-Pixel');
    const events = Array.from(pixelSection.querySelectorAll('.pet-event'));
    expect(events.length).toBe(3);
    const cyValues = events.map(m => parseFloat(m.getAttribute('cy') || '0'));
    // First event (acquired) should be above death event
    expect(cyValues[0]).toBeLessThan(cyValues[2]);
  });

  it('death event is at bottom (largest cy) within a pet timeline', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: PIXEL_EVENTS },
    });
    const pixelSection = getByTestId('pet-Pixel');
    const events = Array.from(pixelSection.querySelectorAll('.pet-event'));
    const cyValues = events.map(m => parseFloat(m.getAttribute('cy') || '0'));
    const eventTypes = events.map(m => m.getAttribute('data-event-type'));
    const deathIndex = eventTypes.indexOf('death');
    expect(deathIndex).not.toBe(-1);
    const deathCy = cyValues[deathIndex];
    // Death event must have the largest cy
    expect(deathCy).toBe(Math.max(...cyValues));
  });
});

// ============================================================
// 5. Accessibility
// ============================================================
describe('PetTimeline -- accessibility', () => {
  it('screen reader table exists with data-testid="sr-table"', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('screen reader table has pet name and event type columns', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const srTable = getByTestId('sr-table');
    const thElements = srTable.querySelectorAll('th');
    const headerTexts = Array.from(thElements).map(th => (th.textContent || '').toLowerCase());
    const hasPetName = headerTexts.some(h => h.includes('pet') || h.includes('name'));
    const hasEventType = headerTexts.some(h => h.includes('event') || h.includes('type'));
    expect(hasPetName).toBe(true);
    expect(hasEventType).toBe(true);
  });

  it('container or SVG has aria-label', () => {
    const { getByTestId } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    const petContainer = getByTestId('pet-container');
    const svg = petContainer.querySelector('svg');
    const containerAria = petContainer.getAttribute('aria-label');
    const svgAria = svg ? svg.getAttribute('aria-label') : null;
    expect(containerAria || svgAria).toBeTruthy();
  });
});

// ============================================================
// 6. Edge Cases
// ============================================================
describe('PetTimeline -- edge cases', () => {
  it('single event renders without crash', () => {
    const single = [makeEvent()];
    const { getByTestId } = render(PetTimeline, {
      props: { events: single },
    });
    const petContainer = getByTestId('pet-container');
    const eventMarkers = petContainer.querySelectorAll('.pet-event');
    expect(eventMarkers.length).toBe(1);
  });

  it('empty notes do not crash', () => {
    const events = [
      makeEvent({ notes: '' }),
      makeEvent({ pet_name: 'Echo', event_type: 'death', event_timestamp: '2025-04-04T09:00:00', notes: '' }),
    ];
    const { getByTestId } = render(PetTimeline, {
      props: { events },
    });
    const petContainer = getByTestId('pet-container');
    const eventMarkers = petContainer.querySelectorAll('.pet-event');
    expect(eventMarkers.length).toBe(2);
  });

  it('pet with only death event renders without crash', () => {
    const deathOnly = [
      makeEvent({ pet_name: 'Ghost', event_type: 'death', event_timestamp: '2025-05-01T00:00:00', notes: 'Already dead.' }),
    ];
    const { getByTestId } = render(PetTimeline, {
      props: { events: deathOnly },
    });
    const ghostSection = getByTestId('pet-Ghost');
    expect(ghostSection).toBeTruthy();
    const deathMarker = ghostSection.querySelector('.pet-event[data-event-type="death"]');
    expect(deathMarker).not.toBeNull();
  });

  it('unknown event_type renders without crash and gets fallback fill', () => {
    const unknownType = [
      makeEvent({ event_type: 'hatched', notes: 'Mystery event' }),
      makeEvent({ event_type: 'acquired', notes: 'Normal event' }),
    ];
    const { getByTestId } = render(PetTimeline, {
      props: { events: unknownType },
    });
    const petContainer = getByTestId('pet-container');
    const hatched = petContainer.querySelector('.pet-event[data-event-type="hatched"]');
    expect(hatched).not.toBeNull();
    const fill = hatched!.getAttribute('fill');
    // Unknown types should get fallback fill (#888), NOT one of the known colors
    expect(fill).toBeTruthy();
    expect(fill).not.toBe('#6bb08a');
    expect(fill).not.toBe('#7ea7c8');
    expect(fill).not.toBe('#ca6c6b');
  });

  it('cleanup on unmount -- pet-container gone from DOM', () => {
    const { getByTestId, unmount } = render(PetTimeline, {
      props: { events: ALL_EVENTS },
    });
    expect(getByTestId('pet-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="pet-container"]');
    expect(orphan).toBeNull();
  });
});
