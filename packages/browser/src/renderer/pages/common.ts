import type { LomeApi, Settings } from '../../shared/types.js';

/**
 * Shared helpers for the internal pages. No framework: a handful of DOM
 * builders keep the pages small and predictable, and all strings are inserted
 * with textContent, never with innerHTML.
 */

export const lome = (window as unknown as { lome: LomeApi }).lome;

export function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element as T;
}

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value as Record<string, string>);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in node) {
      (node as unknown as Record<string, unknown>)[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.textContent = '';
}

const NAV: Array<{ page: string; label: string; href: string }> = [
  { page: 'history', label: 'History', href: 'lomesearch://history' },
  { page: 'bookmarks', label: 'Bookmarks', href: 'lomesearch://bookmarks' },
  { page: 'downloads', label: 'Downloads', href: 'lomesearch://downloads' },
  { page: 'extensions', label: 'Extensions', href: 'lomesearch://extensions' },
  { page: 'privacy', label: 'Privacy', href: 'lomesearch://privacy' },
  { page: 'settings', label: 'Settings', href: 'lomesearch://settings' },
  { page: 'legal', label: 'Legal', href: 'lomesearch://legal' },
  { page: 'about', label: 'About', href: 'lomesearch://about' },
];

export interface PageHandle {
  main: HTMLElement;
  settings: Settings;
}

export async function initPage(active: string, title: string): Promise<PageHandle> {
  const settings = await lome.settings.get();
  document.documentElement.dataset.theme = settings.theme;
  document.title = `${title} · LomeSearch`;

  const nav = el(
    'nav',
    { class: 'nav', 'aria-label': 'Sezioni' },
    ...NAV.map((entry) =>
      el(
        'a',
        {
          href: entry.href,
          ...(entry.page === active ? { 'aria-current': 'page' } : {}),
        },
        entry.label,
      ),
    ),
  );

  const shell = el(
    'div',
    { class: 'shell' },
    el(
      'header',
      { class: 'topbar' },
      el('a', { class: 'brand', href: 'lomesearch://newtab' }, 'Lome', el('span', {}, 'Search')),
      nav,
    ),
    el('main', { id: 'main' }),
  );
  document.body.append(shell);

  lome.onSettingsChanged((next) => {
    document.documentElement.dataset.theme = next.theme;
  });

  return { main: $<HTMLElement>('#main'), settings };
}

export function heading(title: string, lede?: string): HTMLElement {
  return el(
    'div',
    {},
    el('h1', {}, title),
    lede ? el('p', { class: 'lede' }, lede) : null,
  );
}

export function card(title: string | null, hint: string | null, ...content: Child[]): HTMLElement {
  return el(
    'section',
    { class: 'card' },
    title ? el('h2', {}, title) : null,
    hint ? el('p', { class: 'hint' }, hint) : null,
    ...content,
  );
}

export function toggleRow(
  label: string,
  description: string,
  checked: boolean,
  onChange: (value: boolean) => void | Promise<void>,
): HTMLElement {
  const button = el('button', {
    class: 'switch',
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
    onclick: async () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      await onChange(next);
    },
  });
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'label' }, el('strong', {}, label), el('small', {}, description)),
    button,
  );
}

export function button(
  label: string,
  onClick: () => void | Promise<void>,
  variant: 'primary' | 'danger' | 'small' | '' = '',
): HTMLButtonElement {
  return el(
    'button',
    {
      class: `btn ${variant}`.trim(),
      onclick: () => {
        void onClick();
      },
    },
    label,
  );
}

export function selectRow(
  label: string,
  description: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void | Promise<void>,
): HTMLElement {
  const select = el(
    'select',
    {
      onchange: () => {
        void onChange(select.value);
      },
    },
    ...options.map((option) =>
      el('option', { value: option.value, ...(option.value === value ? { selected: true } : {}) }, option.label),
    ),
  );
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'label' }, el('strong', {}, label), el('small', {}, description)),
    select,
  );
}

export function inputRow(
  label: string,
  description: string,
  value: string,
  placeholder: string,
  onCommit: (value: string) => void | Promise<void>,
  type = 'text',
): HTMLElement {
  const input = el('input', {
    type,
    value,
    placeholder,
    onchange: () => {
      void onCommit(input.value.trim());
    },
  });
  input.style.minWidth = '220px';
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'label' }, el('strong', {}, label), el('small', {}, description)),
    input,
  );
}

export function toast(message: string): void {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2_200);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function shorten(url: string, max = 90): string {
  const value = url.replace(/^https?:\/\/(www\.)?/, '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
