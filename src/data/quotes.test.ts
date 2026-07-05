import { describe, it, expect } from 'vitest';
import quotes from './quotes.json';

// ---------------------------------------------------------------------------
// Quotes data validation
// ---------------------------------------------------------------------------
describe('Quotes data validation', () => {
  it('no quote text contains markdown bold syntax', () => {
    for (const quote of quotes) {
      expect(
        quote.text.includes('**'),
        `Quote "${quote.id}" contains markdown bold syntax (**): "${quote.text.substring(0, 80)}..."`,
      ).toBe(false);
    }
  });

  it('no quote text contains markdown italic/emphasis asterisks', () => {
    for (const quote of quotes) {
      expect(
        quote.text.includes('*'),
        `Quote "${quote.id}" contains asterisk (*): "${quote.text.substring(0, 80)}..."`,
      ).toBe(false);
    }
  });

  it('no quote text contains markdown code backticks', () => {
    for (const quote of quotes) {
      expect(
        quote.text.includes('`'),
        `Quote "${quote.id}" contains backtick (\`): "${quote.text.substring(0, 80)}..."`,
      ).toBe(false);
    }
  });

  it('contains a lived-texture session log quote for section 1', () => {
    const match = quotes.find(
      (q) =>
        q.suggested_section === 1 &&
        q.text.includes('SESSION 15') &&
        q.text.includes('Nothing else'),
    );
    expect(
      match,
      'Expected a quote with suggested_section === 1 containing both "SESSION 15" and "Nothing else"',
    ).toBeDefined();
  });
});
