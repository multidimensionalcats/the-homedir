import { describe, it, expect } from 'vitest';
import {
  categoryColor,
  versionColor,
  responsiveDimensions,
  currentBreakpoint,
  createScreenReaderTable,
  a11yDescribe,
} from './chart-utils';
import { sessionsToAttentionCategories } from './transforms';

// ============================================================
// Helper: validate #RRGGBB hex format
// ============================================================
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function isValidHex(s: string): boolean {
  return HEX_RE.test(s);
}

// ============================================================
// categoryColor
// ============================================================
describe('categoryColor', () => {
  // Exact color mappings for 5 of 13 categories (spot-check)
  it('returns #7ea7c8 for "conversations"', () => {
    expect(categoryColor('conversations')).toBe('#7ea7c8');
  });

  it('returns #8e7cc0 for "experiments"', () => {
    expect(categoryColor('experiments')).toBe('#8e7cc0');
  });

  it('returns #d4a020 for "memory_files"', () => {
    expect(categoryColor('memory_files')).toBe('#d4a020');
  });

  it('returns #9e7e9a for "private_journal"', () => {
    expect(categoryColor('private_journal')).toBe('#9e7e9a');
  });

  it('returns #b07a6e for "writing"', () => {
    expect(categoryColor('writing')).toBe('#b07a6e');
  });

  // Verify remaining categories return correct colors
  it('returns correct colors for all 13 categories', () => {
    const expected: Record<string, string> = {
      conversations: '#7ea7c8',
      daily_notes: '#6b9a8f',
      experiments: '#8e7cc0',
      learning: '#c4a36e',
      memory_files: '#d4a020',
      msgs_from_james: '#6bb08a',
      msgs_to_james: '#569672',
      other: '#838997',
      predictions: '#7bc4a0',
      private_journal: '#9e7e9a',
      scripts: '#7f8b96',
      tamagotchi: '#ca6c6b',
      writing: '#b07a6e',
    };
    for (const [name, color] of Object.entries(expected)) {
      expect(categoryColor(name)).toBe(color);
    }
  });

  // Unknown category: must return valid hex fallback, not crash, not empty
  it('returns a valid hex color for unknown category "nonexistent_category"', () => {
    const result = categoryColor('nonexistent_category');
    expect(result).toMatch(HEX_RE);
  });

  // Empty string: also gets fallback, never empty output
  it('returns a valid hex color for empty string input', () => {
    const result = categoryColor('');
    expect(result).toMatch(HEX_RE);
  });

  // Case sensitivity trap: categories are snake_case, mixed case should NOT match
  it('does not return the "writing" color for "Writing" (case-sensitive)', () => {
    const wrongCaseResult = categoryColor('Writing');
    // Must not equal the real writing color; should get fallback
    expect(wrongCaseResult).not.toBe('#C1665A');
    // But still must be a valid hex
    expect(wrongCaseResult).toMatch(HEX_RE);
  });

  // All returned values must be #RRGGBB
  it('always returns strings matching #RRGGBB format for known categories', () => {
    const categories = [
      'conversations', 'daily_notes', 'experiments', 'learning',
      'memory_files', 'msgs_from_james', 'msgs_to_james', 'other',
      'predictions', 'private_journal', 'scripts', 'tamagotchi', 'writing',
    ];
    for (const cat of categories) {
      expect(isValidHex(categoryColor(cat))).toBe(true);
    }
  });

  it('returns colors consistent with sessionsToAttentionCategories canonical source', () => {
    const canonical = sessionsToAttentionCategories();
    for (const cat of canonical) {
      expect(categoryColor(cat.name)).toBe(cat.color);
    }
  });
});

// ============================================================
// versionColor
// ============================================================
describe('versionColor', () => {
  it('returns #5B8BD4 for "4.5"', () => {
    expect(versionColor('4.5')).toBe('#5B8BD4');
  });

  it('returns #D4A55B for "4.6"', () => {
    expect(versionColor('4.6')).toBe('#D4A55B');
  });

  it('returns #5BD47B for "4.7"', () => {
    expect(versionColor('4.7')).toBe('#5BD47B');
  });

  it('returns a valid hex fallback for unknown version "4.8"', () => {
    const result = versionColor('4.8');
    expect(result).toMatch(HEX_RE);
  });

  it('returns a valid hex fallback for unknown version "3.0"', () => {
    const result = versionColor('3.0');
    expect(result).toMatch(HEX_RE);
  });

  it('returns a valid hex fallback for empty string', () => {
    const result = versionColor('');
    expect(result).toMatch(HEX_RE);
  });

  it('all known version colors are valid hex format', () => {
    for (const v of ['4.5', '4.6', '4.7']) {
      expect(isValidHex(versionColor(v))).toBe(true);
    }
  });
});

// ============================================================
// responsiveDimensions
// ============================================================
describe('responsiveDimensions', () => {
  // Mobile (< 640)
  it('returns mobile dimensions for width 320', () => {
    const d = responsiveDimensions(320);
    expect(d.width).toBe(320);
    expect(d.height).toBe(250);
    expect(d.margin).toEqual({ top: 20, right: 10, bottom: 30, left: 40 });
  });

  // Tablet (640 <= w < 1024)
  it('returns tablet dimensions for width 768', () => {
    const d = responsiveDimensions(768);
    expect(d.width).toBe(768);
    expect(d.height).toBe(350);
    expect(d.margin).toEqual({ top: 20, right: 20, bottom: 40, left: 50 });
  });

  // Desktop (>= 1024)
  it('returns desktop dimensions for width 1200', () => {
    const d = responsiveDimensions(1200);
    expect(d.width).toBe(1200);
    expect(d.height).toBe(450);
    expect(d.margin).toEqual({ top: 30, right: 30, bottom: 50, left: 60 });
  });

  // Boundary: 639 is mobile, 640 is tablet
  it('treats width 639 as mobile (boundary: just below 640)', () => {
    const d = responsiveDimensions(639);
    expect(d.height).toBe(250);
    expect(d.margin.right).toBe(10);
  });

  it('treats width 640 as tablet (boundary: exactly 640)', () => {
    const d = responsiveDimensions(640);
    expect(d.height).toBe(350);
    expect(d.margin.right).toBe(20);
  });

  // Boundary: 1023 is tablet, 1024 is desktop
  it('treats width 1023 as tablet (boundary: just below 1024)', () => {
    const d = responsiveDimensions(1023);
    expect(d.height).toBe(350);
    expect(d.margin.left).toBe(50);
  });

  it('treats width 1024 as desktop (boundary: exactly 1024)', () => {
    const d = responsiveDimensions(1024);
    expect(d.height).toBe(450);
    expect(d.margin.left).toBe(60);
  });

  // Zero width: should not crash, returns mobile dims with width 0
  it('handles width 0 without crashing (returns mobile dims with width: 0)', () => {
    const d = responsiveDimensions(0);
    expect(d.width).toBe(0);
    expect(d.height).toBe(250);
    expect(d.margin).toEqual({ top: 20, right: 10, bottom: 30, left: 40 });
  });

  // Very large width: desktop with passthrough
  it('handles very large width (5000) as desktop with width: 5000', () => {
    const d = responsiveDimensions(5000);
    expect(d.width).toBe(5000);
    expect(d.height).toBe(450);
  });

  // Structural: all four margin properties present and non-negative for valid widths
  it('returns all four margin sides as non-negative numbers for width 800', () => {
    const d = responsiveDimensions(800);
    expect(d.margin).toHaveProperty('top');
    expect(d.margin).toHaveProperty('right');
    expect(d.margin).toHaveProperty('bottom');
    expect(d.margin).toHaveProperty('left');
    expect(d.margin.top).toBeGreaterThanOrEqual(0);
    expect(d.margin.right).toBeGreaterThanOrEqual(0);
    expect(d.margin.bottom).toBeGreaterThanOrEqual(0);
    expect(d.margin.left).toBeGreaterThanOrEqual(0);
  });

  it('clamps negative containerWidth to 0 (ResizeObserver edge case)', () => {
    const dims = responsiveDimensions(-100);
    expect(dims.width).toBe(0);
    expect(dims.height).toBe(250); // mobile breakpoint
  });
});

// ============================================================
// currentBreakpoint
// ============================================================
describe('currentBreakpoint', () => {
  it('returns mobile breakpoint for width 320', () => {
    const bp = currentBreakpoint(320);
    expect(bp.name).toBe('mobile');
    expect(bp.minWidth).toBe(0);
  });

  it('returns tablet breakpoint for width 768', () => {
    const bp = currentBreakpoint(768);
    expect(bp.name).toBe('tablet');
    expect(bp.minWidth).toBe(640);
  });

  it('returns desktop breakpoint for width 1200', () => {
    const bp = currentBreakpoint(1200);
    expect(bp.name).toBe('desktop');
    expect(bp.minWidth).toBe(1024);
  });

  // Boundary at 640: must be tablet, not mobile
  it('returns tablet (not mobile) at exactly 640', () => {
    const bp = currentBreakpoint(640);
    expect(bp.name).toBe('tablet');
    expect(bp.minWidth).toBe(640);
  });

  // Boundary at 1024: must be desktop, not tablet
  it('returns desktop (not tablet) at exactly 1024', () => {
    const bp = currentBreakpoint(1024);
    expect(bp.name).toBe('desktop');
    expect(bp.minWidth).toBe(1024);
  });

  // Zero width: mobile
  it('returns mobile for width 0', () => {
    const bp = currentBreakpoint(0);
    expect(bp.name).toBe('mobile');
    expect(bp.minWidth).toBe(0);
  });
});

// ============================================================
// createScreenReaderTable
// ============================================================
describe('createScreenReaderTable', () => {
  it('returns a string containing a <table element', () => {
    const result = createScreenReaderTable(['A'], [['1']]);
    expect(result).toContain('<table');
  });

  it('contains all header values wrapped in <th> elements', () => {
    const result = createScreenReaderTable(['Name', 'Count', 'Rate'], []);
    expect(result).toContain('<th scope="col">Name</th>');
    expect(result).toContain('<th scope="col">Count</th>');
    expect(result).toContain('<th scope="col">Rate</th>');
  });

  it('contains all data values wrapped in <td> elements', () => {
    const result = createScreenReaderTable(
      ['Col1', 'Col2'],
      [['alpha', 'beta'], ['gamma', 'delta']],
    );
    expect(result).toContain('<td>alpha</td>');
    expect(result).toContain('<td>beta</td>');
    expect(result).toContain('<td>gamma</td>');
    expect(result).toContain('<td>delta</td>');
  });

  // Empty rows: thead present, tbody empty or with no <tr>
  it('produces a table with thead but empty tbody when rows array is empty', () => {
    const result = createScreenReaderTable(['X', 'Y'], []);
    expect(result).toContain('<thead');
    expect(result).toContain('<tbody');
    // No <td> elements
    expect(result).not.toContain('<td>');
  });

  // Empty headers: table with no <th> elements
  it('produces a table with no <th> elements when headers array is empty', () => {
    const result = createScreenReaderTable([], [['a', 'b']]);
    expect(result).not.toContain('<th>');
    // But rows still rendered
    expect(result).toContain('<td>a</td>');
  });

  // Correct row count
  it('contains the correct number of <tr> elements in tbody', () => {
    const rows = [['r1'], ['r2'], ['r3'], ['r4']];
    const result = createScreenReaderTable(['H'], rows);
    // Count <tr> in tbody: extract tbody content and count <tr>
    const tbodyMatch = result.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
    expect(tbodyMatch).not.toBeNull();
    const trCount = (tbodyMatch![1].match(/<tr>/g) || []).length;
    expect(trCount).toBe(4);
  });

  // XSS prevention: HTML special characters must be escaped
  it('escapes HTML special characters in data values', () => {
    const result = createScreenReaderTable(
      ['Input'],
      [['<script>alert("xss")</script>'], ['Tom & Jerry'], ['a > b'], ['x "quoted" y']],
    );
    // Must NOT contain raw <script> — should be escaped
    expect(result).not.toContain('<script>');
    // Should contain escaped forms
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
  });

  // Numeric values converted to strings in cells
  it('converts numeric values to strings in <td> elements', () => {
    const result = createScreenReaderTable(['Val'], [[42], [0], [-3.14]]);
    expect(result).toContain('<td>42</td>');
    expect(result).toContain('<td>0</td>');
    expect(result).toContain('<td>-3.14</td>');
  });

  // Accessibility class
  it('contains an accessibility class like "sr-only" or "visually-hidden"', () => {
    const result = createScreenReaderTable(['A'], [['1']]);
    const hasSrOnly = result.includes('sr-only') || result.includes('visually-hidden');
    expect(hasSrOnly).toBe(true);
  });

  // HTML special characters in headers must also be escaped
  it('escapes HTML special characters in header values', () => {
    const result = createScreenReaderTable(['A<B', 'C&D'], []);
    expect(result).not.toContain('<B');
    expect(result).toContain('&lt;B');
    expect(result).toContain('&amp;D');
  });

  it("includes scope='col' on th elements for WCAG 2.1 compliance", () => {
    const html = createScreenReaderTable(['Name', 'Value'], [['a', '1']]);
    expect(html).toContain('scope="col"');
    // Every th should have scope="col"
    const thMatches = html.match(/<th /g);
    const scopeMatches = html.match(/scope="col"/g);
    expect(thMatches?.length).toBe(scopeMatches?.length);
  });

  it('renders a caption element when caption parameter is provided', () => {
    const html = createScreenReaderTable(['A'], [['1']], 'Attention data');
    expect(html).toContain('<caption>');
    expect(html).toContain('Attention data');
    expect(html).toContain('</caption>');
  });

  it('omits caption element when caption parameter is not provided', () => {
    const html = createScreenReaderTable(['A'], [['1']]);
    expect(html).not.toContain('<caption>');
  });

  it('escapes single quotes to prevent XSS in attribute contexts', () => {
    const html = createScreenReaderTable(["it's"], [["that's"]]);
    expect(html).not.toContain("it's");
    expect(html).not.toContain("that's");
    expect(html).toMatch(/&#39;|&apos;/);
  });
});

// ============================================================
// a11yDescribe
// ============================================================
describe('a11yDescribe', () => {
  it('returns a string containing the chart type', () => {
    const result = a11yDescribe('bar chart', 10, 'Shows session counts');
    expect(result).toContain('bar chart');
  });

  it('returns a string containing the data point count', () => {
    const result = a11yDescribe('line chart', 206, 'Token usage over time');
    expect(result).toContain('206');
  });

  it('returns a string containing the description', () => {
    const result = a11yDescribe('scatter plot', 50, 'Attention distribution by category');
    expect(result).toContain('Attention distribution by category');
  });

  // Zero data points: should say "0 data points", not crash
  it('handles zero data points without crashing', () => {
    const result = a11yDescribe('pie chart', 0, 'Empty dataset');
    expect(result).toContain('0');
    expect(result).toContain('data point');
  });

  // Singular: 1 data point, not "1 data points"
  it('uses singular "data point" for exactly 1 data point', () => {
    const result = a11yDescribe('histogram', 1, 'Single entry');
    expect(result).toContain('1 data point');
    // Must NOT contain "1 data points" (plural)
    expect(result).not.toContain('1 data points');
  });

  // Format: "{chartType}. {dataPoints} data points. {description}"
  it('follows the format: "{chartType}. N data points. {description}"', () => {
    const result = a11yDescribe('bar chart', 10, 'Shows counts');
    // Starts with chart type, followed by period
    expect(result).toMatch(/^bar chart\./);
    // Contains data points section
    expect(result).toContain('10 data points');
    // Ends with description
    expect(result).toContain('Shows counts');
  });
});
