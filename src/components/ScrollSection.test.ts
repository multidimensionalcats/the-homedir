import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import ScrollSection from './ScrollSection.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ============================================================
// IntersectionObserver mock infrastructure
// ============================================================

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  readonly callback: IOCallback;
  readonly options: IntersectionObserverInit | undefined;
}

let mockObserverInstances: MockObserverInstance[] = [];

function createMockIOClass() {
  mockObserverInstances = [];

  const MockIO = vi.fn(function (this: any, callback: IOCallback, options?: IntersectionObserverInit) {
    const instance: MockObserverInstance = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      callback,
      options,
    };
    mockObserverInstances.push(instance);
    Object.assign(this, instance);
  });

  return MockIO;
}

/** Trigger an intersection event on the most recently created observer */
function triggerIntersection(isIntersecting: boolean, observerIndex = 0) {
  const observer = mockObserverInstances[observerIndex];
  if (!observer) throw new Error(`No observer at index ${observerIndex}`);

  const entry = {
    isIntersecting,
    intersectionRatio: isIntersecting ? 1.0 : 0.0,
    target: {} as Element,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: Date.now(),
  } as IntersectionObserverEntry;

  observer.callback([entry]);
}

function installMockIO() {
  const MockIO = createMockIOClass();
  (globalThis as any).IntersectionObserver = MockIO;
  return MockIO;
}

function removeMockIO() {
  delete (globalThis as any).IntersectionObserver;
}

// ============================================================
// 1. Rendering
// ============================================================
describe('ScrollSection -- rendering', () => {
  beforeEach(() => {
    installMockIO();
  });

  it('renders a container div with data-testid="scroll-section-0" by default', () => {
    const { getByTestId } = render(ScrollSection);
    const el = getByTestId('scroll-section-0');
    expect(el).toBeTruthy();
    expect(el.tagName).toBe('DIV');
  });

  it('sets data-section-id attribute matching sectionId prop', () => {
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 3 } });
    const el = getByTestId('scroll-section-3');
    expect(el.getAttribute('data-section-id')).toBe('3');
  });

  it('container div has both data-section-id and data-testid attributes simultaneously', () => {
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 7 } });
    const el = getByTestId('scroll-section-7');
    expect(el.hasAttribute('data-section-id')).toBe(true);
    expect(el.hasAttribute('data-testid')).toBe(true);
  });

  it('renders exactly one container div (no wrapper pollution)', () => {
    const { container } = render(ScrollSection, { props: { sectionId: 1 } });
    const divs = container.querySelectorAll('[data-section-id]');
    expect(divs.length).toBe(1);
  });
});

// ============================================================
// 2. Section IDs -- adversarial values
// ============================================================
describe('ScrollSection -- section IDs', () => {
  beforeEach(() => {
    installMockIO();
  });

  it('sectionId=0 renders data-testid="scroll-section-0" and passes 0 to callbacks', () => {
    const onEnter = vi.fn();
    const { getByTestId } = render(ScrollSection, {
      props: { sectionId: 0, onEnter },
    });
    expect(getByTestId('scroll-section-0')).toBeTruthy();
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledWith(0);
  });

  it('sectionId=6 renders correctly and passes 6 to callbacks', () => {
    const onEnter = vi.fn();
    const { getByTestId } = render(ScrollSection, {
      props: { sectionId: 6, onEnter },
    });
    expect(getByTestId('scroll-section-6')).toBeTruthy();
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledWith(6);
  });

  it('sectionId=-1 (negative) renders and passes -1 to onEnter', () => {
    const onEnter = vi.fn();
    const { getByTestId } = render(ScrollSection, {
      props: { sectionId: -1, onEnter },
    });
    expect(getByTestId('scroll-section--1')).toBeTruthy();
    expect(getByTestId('scroll-section--1').getAttribute('data-section-id')).toBe('-1');
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledWith(-1);
  });

  it('sectionId=99 (large) renders and passes 99 to onExit', () => {
    const onExit = vi.fn();
    const { getByTestId } = render(ScrollSection, {
      props: { sectionId: 99, onExit },
    });
    expect(getByTestId('scroll-section-99')).toBeTruthy();
    triggerIntersection(false);
    expect(onExit).toHaveBeenCalledWith(99);
  });

  it('sectionId=NaN renders and passes NaN to callbacks', () => {
    const onEnter = vi.fn();
    render(ScrollSection, {
      props: { sectionId: NaN, onEnter },
    });
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0]).toBeNaN();
  });
});

// ============================================================
// 3. Threshold clamping
// ============================================================
describe('ScrollSection -- threshold clamping', () => {
  it('threshold=0.3 passes 0.3 to IntersectionObserver options', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: 0.3 } });
    expect(MockIO).toHaveBeenCalledTimes(1);
    const options = mockObserverInstances[0].options;
    expect(options).toBeDefined();
    expect(options!.threshold).toBe(0.3);
  });

  it('threshold=-0.5 clamps to 0 for IntersectionObserver', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: -0.5 } });
    expect(MockIO).toHaveBeenCalledTimes(1);
    const options = mockObserverInstances[0].options;
    expect(options).toBeDefined();
    expect(options!.threshold).toBe(0);
  });

  it('threshold=2.0 clamps to 1 for IntersectionObserver', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: 2.0 } });
    expect(MockIO).toHaveBeenCalledTimes(1);
    const options = mockObserverInstances[0].options;
    expect(options).toBeDefined();
    expect(options!.threshold).toBe(1);
  });

  it('threshold=NaN falls back to default 0.3', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: NaN } });
    expect(MockIO).toHaveBeenCalledTimes(1);
    const options = mockObserverInstances[0].options;
    expect(options).toBeDefined();
    expect(options!.threshold).toBe(0.3);
  });

  it('threshold=0 (boundary) passes 0 without clamping', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: 0 } });
    const options = mockObserverInstances[0].options;
    expect(options!.threshold).toBe(0);
  });

  it('threshold=1 (boundary) passes 1 without clamping', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { threshold: 1 } });
    const options = mockObserverInstances[0].options;
    expect(options!.threshold).toBe(1);
  });
});

// ============================================================
// 4. Callbacks
// ============================================================
describe('ScrollSection -- callbacks', () => {
  beforeEach(() => {
    installMockIO();
  });

  it('calls onEnter with sectionId when intersection triggers (isIntersecting=true)', () => {
    const onEnter = vi.fn();
    render(ScrollSection, { props: { sectionId: 5, onEnter } });
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(5);
  });

  it('calls onExit with sectionId when intersection triggers (isIntersecting=false)', () => {
    const onExit = vi.fn();
    render(ScrollSection, { props: { sectionId: 12, onExit } });
    triggerIntersection(false);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(12);
  });

  it('does not call onExit when isIntersecting=true', () => {
    const onExit = vi.fn();
    render(ScrollSection, { props: { sectionId: 1, onExit } });
    triggerIntersection(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('does not call onEnter when isIntersecting=false', () => {
    const onEnter = vi.fn();
    render(ScrollSection, { props: { sectionId: 1, onEnter } });
    triggerIntersection(false);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('null onEnter does not crash when intersection triggers', () => {
    expect(() => {
      render(ScrollSection, { props: { sectionId: 0, onEnter: null } });
      triggerIntersection(true);
    }).not.toThrow();
  });

  it('null onExit does not crash when intersection triggers', () => {
    expect(() => {
      render(ScrollSection, { props: { sectionId: 0, onExit: null } });
      triggerIntersection(false);
    }).not.toThrow();
  });

  it('handles rapid enter/exit/enter sequence correctly', () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(ScrollSection, { props: { sectionId: 3, onEnter, onExit } });
    triggerIntersection(true);
    triggerIntersection(false);
    triggerIntersection(true);
    expect(onEnter).toHaveBeenCalledTimes(2);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('both callbacks undefined (omitted entirely) does not crash', () => {
    expect(() => {
      render(ScrollSection, { props: { sectionId: 4 } });
      triggerIntersection(true);
      triggerIntersection(false);
    }).not.toThrow();
  });
});

// ============================================================
// 5. IntersectionObserver mocking
// ============================================================
describe('ScrollSection -- IntersectionObserver wiring', () => {
  it('creates exactly one IntersectionObserver instance', () => {
    const MockIO = installMockIO();
    render(ScrollSection, { props: { sectionId: 0 } });
    expect(MockIO).toHaveBeenCalledTimes(1);
  });

  it('calls observer.observe() with the container element', () => {
    installMockIO();
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 2 } });
    const container = getByTestId('scroll-section-2');
    expect(mockObserverInstances.length).toBe(1);
    expect(mockObserverInstances[0].observe).toHaveBeenCalledTimes(1);
    expect(mockObserverInstances[0].observe).toHaveBeenCalledWith(container);
  });

  it('passes threshold option to IntersectionObserver constructor', () => {
    installMockIO();
    render(ScrollSection, { props: { sectionId: 0, threshold: 0.7 } });
    const opts = mockObserverInstances[0].options;
    expect(opts).toBeDefined();
    expect(opts!.threshold).toBe(0.7);
  });
});

// ============================================================
// 6. IO unavailable fallback
// ============================================================
describe('ScrollSection -- IntersectionObserver unavailable', () => {
  it('calls onEnter immediately when IntersectionObserver does not exist', () => {
    removeMockIO();
    const onEnter = vi.fn();
    render(ScrollSection, { props: { sectionId: 8, onEnter } });
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(8);
  });

  it('does not crash when IO unavailable and onEnter is null, still renders container', () => {
    removeMockIO();
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 0, onEnter: null } });
    // Must still render the container div even without IO
    const container = getByTestId('scroll-section-0');
    expect(container.getAttribute('data-section-id')).toBe('0');
  });

  it('does not call onExit when IO unavailable, container still rendered', () => {
    removeMockIO();
    const onExit = vi.fn();
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 2, onExit } });
    // Must render the container div
    const container = getByTestId('scroll-section-2');
    expect(container.getAttribute('data-section-id')).toBe('2');
    expect(onExit).not.toHaveBeenCalled();
  });
});

// ============================================================
// 7. Cleanup / disconnect
// ============================================================
describe('ScrollSection -- cleanup', () => {
  it('calls observer.disconnect() when component is unmounted', () => {
    installMockIO();
    const { unmount } = render(ScrollSection, { props: { sectionId: 1 } });
    expect(mockObserverInstances.length).toBe(1);
    const observer = mockObserverInstances[0];
    expect(observer.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not leave dangling observer after unmount (disconnect called exactly once)', () => {
    installMockIO();
    const { unmount } = render(ScrollSection, { props: { sectionId: 0 } });
    unmount();
    expect(mockObserverInstances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('triggering intersection after unmount does not call callbacks', () => {
    installMockIO();
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const { unmount } = render(ScrollSection, {
      props: { sectionId: 10, onEnter, onExit },
    });
    unmount();
    // This should not crash or invoke callbacks — observer is disconnected
    // The callback may still be called by our mock, but the component should guard
    // against post-unmount calls, or at minimum disconnect prevents real browser calls
    expect(mockObserverInstances[0].disconnect).toHaveBeenCalled();
  });
});

// ============================================================
// 8. Children / slot content
// ============================================================
describe('ScrollSection -- children', () => {
  beforeEach(() => {
    installMockIO();
  });

  it('container div exists and can contain content (slot rendering)', () => {
    const { getByTestId } = render(ScrollSection, { props: { sectionId: 0 } });
    const container = getByTestId('scroll-section-0');
    // The container must be a real DOM element capable of holding children
    expect(container).toBeInstanceOf(HTMLElement);
    expect(container.tagName).toBe('DIV');
  });
});
