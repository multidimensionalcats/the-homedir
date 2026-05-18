// chart-utils.ts — Chart utility functions for the Home Directory exhibit

import { sessionsToAttentionCategories } from './transforms';

export interface ChartDimensions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface Breakpoint {
  name: 'mobile' | 'tablet' | 'desktop';
  minWidth: number;
}

const CATEGORY_COLOR_MAP = new Map(
  sessionsToAttentionCategories().map(c => [c.name, c.color])
);

const CATEGORY_FALLBACK = '#3A3F4B';

const VERSION_COLORS: Record<string, string> = {
  '4.5': '#5B8BD4',
  '4.6': '#D4A55B',
  '4.7': '#5BD47B',
};

const VERSION_FALLBACK = '#3A3F4B';

export function categoryColor(categoryName: string): string {
  return CATEGORY_COLOR_MAP.get(categoryName) ?? CATEGORY_FALLBACK;
}

export function versionColor(version: string): string {
  return VERSION_COLORS[version] ?? VERSION_FALLBACK;
}

export function responsiveDimensions(containerWidth: number): ChartDimensions {
  containerWidth = Math.max(0, containerWidth);
  if (containerWidth < 640) {
    return {
      width: containerWidth,
      height: 250,
      margin: { top: 20, right: 10, bottom: 30, left: 40 },
    };
  }
  if (containerWidth < 1024) {
    return {
      width: containerWidth,
      height: 350,
      margin: { top: 20, right: 20, bottom: 40, left: 50 },
    };
  }
  return {
    width: containerWidth,
    height: 450,
    margin: { top: 30, right: 30, bottom: 50, left: 60 },
  };
}

export function currentBreakpoint(containerWidth: number): Breakpoint {
  containerWidth = Math.max(0, containerWidth);
  if (containerWidth < 640) {
    return { name: 'mobile', minWidth: 0 };
  }
  if (containerWidth < 1024) {
    return { name: 'tablet', minWidth: 640 };
  }
  return { name: 'desktop', minWidth: 1024 };
}

function escapeHtml(value: string | number): string {
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createScreenReaderTable(headers: string[], rows: (string | number)[][], caption?: string): string {
  const thCells = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const thead = `<thead><tr>${thCells}</tr></thead>`;

  const bodyRows = rows
    .map((row) => {
      const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const tbody = `<tbody>${bodyRows}</tbody>`;

  const captionHtml = caption ? `<caption>${escapeHtml(caption)}</caption>` : '';
  return `<table class="sr-only">${captionHtml}${thead}${tbody}</table>`;
}

export function a11yDescribe(chartType: string, dataPoints: number, description: string): string {
  const pointWord = dataPoints === 1 ? 'data point' : 'data points';
  return `${chartType}. ${dataPoints} ${pointWord}. ${description}`;
}
