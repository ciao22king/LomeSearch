import type {
  ChromeApi,
  ChromeState,
  DownloadState,
  Settings,
  Suggestion,
  TabState,
} from '../shared/types.js';

/**
 * Chrome UI renderer: tab strip, toolbar, omnibox suggestions, find bar and the
 * small panels (menu, downloads, privacy). The main process owns all state; this
 * file only renders what it receives and sends commands back.
 */

const api = (window as unknown as { lome: ChromeApi }).lome;

const ICONS = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4.5 12h15M12 4c2.2 2.3 3.3 5 3.3 8S14.2 17.7 12 20c-2.2-2.3-3.3-5-3.3-8S9.8 6.3 12 4z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7L8 10z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7L8 10z"/><path d="M16 10l4 4M20 10l-4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-2.9 8.2-7 9.5C7.9 19.2 5 15.4 5 11V6z"/><path d="M9.5 11.8l1.8 1.8 3.4-3.6"/></svg>',
} as const;

const $ = <T extends HTMLElement>(selector: string): T =>
  document.querySelector(selector) as T;

const tabsEl = $<HTMLDivElement>('#tabs');
const omnibox = $<HTMLInputElement>('#omnibox');
const omniboxForm = $<HTMLFormElement>('#omnibox-form');
const securityEl = $<HTMLSpanElement>('#security');
const starEl = $<HTMLButtonElement>('#star');
const backEl = $<HTMLButtonElement>('#back');
const forwardEl = $<HTMLButtonElement>('#forward');
const reloadEl = $<HTMLButtonElement>('#reload');
const shieldEl = $<HTMLButtonElement>('#shield');
const shieldCountEl = $<HTMLSpanElement>('#shield-count');
const downloadsCountEl = $<HTMLSpanElement>('#downloads-count');
const overlayEl = $<HTMLDivElement>('#overlay');
const suggestionsEl = $<HTMLDivElement>('#suggestions');
const findbarEl = $<HTMLDivElement>('#findbar');
const findInput = $<HTMLInputElement>('#find-input');
const findCountEl = $<HTMLSpanElement>('#find-count');
const menuPanel = $<HTMLDivElement>('#menu-panel');
const downloadsPanel = $<HTMLDivElement>('#downloads-panel');
const shieldPanel = $<HTMLDivElement>('#shield-panel');
const toastEl = $<HTMLDivElement>('#toast');
const privateBadge = $<HTMLSpanElement>('#private-badge');

let state: ChromeState | null = null;
let settings: Settings | null = null;
let suggestions: Suggestion[] = [];
let suggestionIndex = 0;
let activePanel: 'none' | 'suggestions' | 'find' | 'menu' | 'downloads' | 'shield' = 'none';
let tabSignature = '';
let suggestTimer: number | null = null;
let findTimer: number | null = null;
let toastTimer: number | null = null;
let findQuery = '';

// --------------------------------------------------------------------- theme

function applyTheme(theme: Settings['theme']): void {
  document.documentElement.dataset.theme = theme;
}

// --------------------------------------------------------------------- state

function displayUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('lomesearch://')) {
    return url.replace(/\/$/, '').replace('lomesearch://', 'lome:');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${host}${path}${parsed.search}`.slice(0, 200);
  } catch {
    return url;
  }
}

function activeTab(): TabState | null {
  if (!state) return null;
  return state.tabs.find((tab) => tab.id === state?.activeTabId) ?? null;
}

function render(next: ChromeState): void {
  const previousActive = state?.activeTabId ?? null;
  state = next;
  privateBadge.hidden = !next.window.isPrivate;
  document.body.classList.toggle('private', next.window.isPrivate);
  renderTabs();
  renderToolbar();
  renderBadges();
  if (activePanel === 'downloads') renderDownloadsPanel();
  if (activePanel === 'shield') renderShieldPanel();
  if (previousActive !== next.activeTabId) closePanels({ keepFocus: true });
  updateOmnibox();
}

function renderTabs(): void {
  if (!state) return;
  const signature = JSON.stringify(
    state.tabs.map((tab) => [
      tab.id,
      tab.title,
      tab.favicon,
      tab.loading,
      tab.audible,
      tab.id === state?.activeTabId,
    ]),
  );
  if (signature === tabSignature) return;
  tabSignature = signature;
  tabsEl.textContent = '';

  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === state.activeTabId ? ' active' : ''}`;
    el.dataset.id = String(tab.id);
    el.draggable = true;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    el.title = tab.title ? `${tab.title}\n${tab.url}` : tab.url;

    if (tab.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      el.append(spinner);
    } else if (tab.favicon) {
      const image = document.createElement('img');
      image.className = 'tab-favicon';
      image.alt = '';
      image.src = tab.favicon;
      image.addEventListener('error', () => {
        image.replaceWith(fallbackIcon(tab.title));
      });
      el.append(image);
    } else {
      el.append(fallbackIcon(tab.title));
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'Nuova scheda';
    el.append(title);

    if (tab.audible) {
      const audio = document.createElement('span');
      audio.className = 'tab-audio';
      audio.innerHTML = tab.muted ? ICONS.muted : ICONS.speaker;
      el.append(audio);
    }

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = 'Chiudi scheda';
    close.setAttribute('aria-label', 'Chiudi scheda');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void api.closeTab(tab.id);
    });
    el.append(close);

    el.addEventListener('mousedown', (event) => {
      if (event.button === 0) void api.selectTab(tab.id);
      if (event.button === 1) {
        event.preventDefault();
        void api.closeTab(tab.id);
      }
    });
    el.addEventListener('dblclick', () => void api.maximize());
    el.addEventListener('dragstart', (event) => {
      el.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', String(tab.id));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      for (const other of tabsEl.children) other.classList.remove('drop-before', 'drop-after');
    });
    el.addEventListener('dragover', (event) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      for (const other of tabsEl.children) other.classList.remove('drop-before', 'drop-after');
      el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedId = Number(event.dataTransfer?.getData('text/plain'));
      if (!Number.isFinite(draggedId) || !state) return;
      const rect = el.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      const currentIndex = state.tabs.findIndex((item) => item.id === draggedId);
      let target = state.tabs.findIndex((item) => item.id === tab.id) + (after ? 1 : 0);
      if (currentIndex !== -1 && currentIndex < target) target -= 1;
      void api.moveTab(draggedId, Math.max(0, target));
    });

    tabsEl.append(el);
  }
}

function fallbackIcon(title: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'tab-fallback';
  span.textContent = (title || 'L').trim().slice(0, 1).toUpperCase();
  return span;
}

function renderToolbar(): void {
  const tab = activeTab();
  backEl.disabled = !tab?.canGoBack;
  forwardEl.disabled = !tab?.canGoForward;
  reloadEl.title = tab?.loading ? 'Interrompi (Esc)' : 'Ricarica (Ctrl+R)';
  reloadEl.innerHTML = tab?.loading ? ICONS.close : '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';
  starEl.classList.toggle('on', state?.bookmarked === true);
  starEl.title = state?.bookmarked ? 'Rimuovi dai preferiti (Ctrl+D)' : 'Aggiungi ai preferiti (Ctrl+D)';

  const url = tab?.url ?? '';
  if (url.startsWith('https://')) {
    securityEl.innerHTML = ICONS.lock;
    securityEl.classList.remove('insecure');
    securityEl.title = 'Connessione cifrata';
  } else if (url.startsWith('http://')) {
    securityEl.innerHTML = ICONS.info;
    securityEl.classList.add('insecure');
    securityEl.title = 'Connessione non cifrata';
  } else if (url.startsWith('lomesearch://')) {
    securityEl.innerHTML = ICONS.shield;
    securityEl.classList.remove('insecure');
    securityEl.title = 'Pagina interna di LomeSearch';
  } else {
    securityEl.innerHTML = ICONS.info;
    securityEl.classList.remove('insecure');
    securityEl.title = 'Nuova scheda';
  }
}

function renderBadges(): void {
  const tab = activeTab();
  const blocked = tab?.blocked ?? 0;
  shieldCountEl.hidden = blocked === 0;
  shieldCountEl.textContent = blocked > 999 ? '999+' : String(blocked);
  const downloading = state?.downloads.filter((item) => item.state === 'progressing').length ?? 0;
  downloadsCountEl.hidden = downloading === 0;
  downloadsCountEl.textContent = String(downloading);
}

function updateOmnibox(): void {
  if (document.activeElement === omnibox) return;
  const tab = activeTab();
  const url = tab?.url ?? '';
  omnibox.value = url.startsWith('lomesearch://newtab') ? '' : displayUrl(url);
}

// ------------------------------------------------------------------- panels

function openPanel(name: Exclude<typeof activePanel, 'none'>): void {
  if (activePanel === name) return;
  hidePanels();
  activePanel = name;
  overlayEl.hidden = false;
  if (name === 'suggestions') suggestionsEl.hidden = false;
  if (name === 'find') {
    findbarEl.hidden = false;
    findInput.focus();
    findInput.select();
  }
  if (name === 'menu') {
    renderMenu();
    menuPanel.hidden = false;
  }
  if (name === 'downloads') {
    renderDownloadsPanel();
    downloadsPanel.hidden = false;
  }
  if (name === 'shield') {
    renderShieldPanel();
    shieldPanel.hidden = false;
  }
  void api.setOverlay(true);
}

function hidePanels(): void {
  suggestionsEl.hidden = true;
  findbarEl.hidden = true;
  menuPanel.hidden = true;
  downloadsPanel.hidden = true;
  shieldPanel.hidden = true;
  overlayEl.hidden = true;
}

function closePanels(options: { keepFocus?: boolean } = {}): void {
  const wasFind = activePanel === 'find';
  hidePanels();
  activePanel = 'none';
  if (wasFind) {
    void api.stopFind();
    findQuery = '';
    findCountEl.textContent = '0/0';
  }
  void api.setOverlay(false);
  if (!options.keepFocus) {
    omnibox.blur();
  }
}

// ---------------------------------------------------------------- omnibox

function scheduleSuggestions(): void {
  if (suggestTimer !== null) window.clearTimeout(suggestTimer);
  const value = omnibox.value.trim();
  if (!value) {
    if (activePanel === 'suggestions') closePanels({ keepFocus: true });
    return;
  }
  suggestTimer = window.setTimeout(async () => {
    suggestTimer = null;
    try {
      suggestions = await api.suggest(value);
    } catch {
      suggestions = [];
    }
    if (suggestions.length === 0) {
      if (activePanel === 'suggestions') closePanels({ keepFocus: true });
      return;
    }
    suggestionIndex = 0;
    renderSuggestions();
    if (activePanel !== 'suggestions') openPanel('suggestions');
  }, 110);
}

function renderSuggestions(): void {
  suggestionsEl.textContent = '';
  suggestions.forEach((suggestion, index) => {
    const row = document.createElement('div');
    row.className = `suggestion${index === suggestionIndex ? ' active' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === suggestionIndex));

    const icon = document.createElement('span');
    icon.className = 's-icon';
    icon.innerHTML =
      suggestion.type === 'history'
        ? ICONS.history
        : suggestion.type === 'bookmark'
          ? ICONS.bookmark
          : suggestion.type === 'url'
            ? ICONS.globe
            : ICONS.search;
    row.append(icon);

    const text = document.createElement('span');
    text.className = 's-text';
    const title = document.createElement('span');
    title.className = 's-title';
    title.textContent = suggestion.title;
    const subtitle = document.createElement('span');
    subtitle.className = 's-sub';
    subtitle.textContent = suggestion.subtitle;
    text.append(title, subtitle);
    row.append(text);

    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      chooseSuggestion(index);
    });
    row.addEventListener('mouseenter', () => {
      suggestionIndex = index;
      for (const child of suggestionsEl.children) child.classList.remove('active');
      row.classList.add('active');
    });
    suggestionsEl.append(row);
  });
  omnibox.setAttribute('aria-expanded', 'true');
}

function chooseSuggestion(index: number): void {
  const suggestion = suggestions[index];
  if (!suggestion) return;
  const value = omnibox.value;
  suggestions = [];
  omnibox.value = suggestion.type === 'url' ? displayUrl(suggestion.url) : suggestion.title;
  closePanels();
  void api.navigate(value, suggestion.url);
}

function submitOmnibox(): void {
  const value = omnibox.value.trim();
  if (!value) return;
  const suggestion = suggestions[suggestionIndex];
  if (suggestion) {
    chooseSuggestion(suggestionIndex);
    return;
  }
  closePanels();
  void api.navigate(value);
  omnibox.blur();
}

// --------------------------------------------------------------------- find

function startFind(): void {
  openPanel('find');
  if (findQuery) void api.find(findQuery, true, false);
}

function updateFind(): void {
  findQuery = findInput.value;
  if (findTimer !== null) window.clearTimeout(findTimer);
  findTimer = window.setTimeout(() => {
    findTimer = null;
    void api.find(findQuery, true, false);
  }, 120);
}

// --------------------------------------------------------------------- menu

interface MenuEntry {
  label: string;
  shortcut?: string;
  action?: string;
  page?: string;
  separator?: boolean;
}

const MENU: MenuEntry[] = [
  { label: 'Nuova scheda', shortcut: 'Ctrl+T', action: 'new-tab' },
  { label: 'Nuova finestra', shortcut: 'Ctrl+N', action: 'new-window' },
  { label: 'Finestra privata', shortcut: 'Ctrl+Shift+N', action: 'private-window' },
  { label: '', separator: true },
  { label: 'Cronologia', shortcut: 'Ctrl+H', page: 'history' },
  { label: 'Preferiti', shortcut: 'Ctrl+Shift+O', page: 'bookmarks' },
  { label: 'Download', shortcut: 'Ctrl+J', page: 'downloads' },
  { label: 'Estensioni', page: 'extensions' },
  { label: '', separator: true },
  { label: 'Trova nella pagina', shortcut: 'Ctrl+F', action: 'find' },
  { label: 'Stampa', shortcut: 'Ctrl+P', action: 'print' },
  { label: 'Strumenti per sviluppatori', shortcut: 'Ctrl+Shift+I', action: 'devtools' },
  { label: 'Zoom 100%', shortcut: 'Ctrl+0', action: 'zoom-reset' },
  { label: '', separator: true },
  { label: 'Privacy e dati locali', page: 'privacy' },
  { label: 'Impostazioni', shortcut: 'Ctrl+,', page: 'settings' },
  { label: 'Informazioni su LomeSearch', page: 'about' },
];

function renderMenu(): void {
  menuPanel.textContent = '';
  const status = document.createElement('div');
  status.className = 'menu-status';
  const dot = document.createElement('span');
  dot.className = `dot ${state?.engine.running ? 'on' : 'off'}`;
  const text = document.createElement('span');
  text.textContent = state?.engine.running
    ? `Motore attivo · ${state.engine.documents.toLocaleString('it-IT')} documenti`
    : state?.engine.error ?? 'Motore non attivo';
  status.append(dot, text);
  menuPanel.append(status);

  for (const entry of MENU) {
    if (entry.separator) {
      const separator = document.createElement('div');
      separator.className = 'menu-sep';
      menuPanel.append(separator);
      continue;
    }
    const button = document.createElement('button');
    button.className = 'menu-item';
    button.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = entry.label;
    button.append(label);
    if (entry.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.textContent = entry.shortcut;
      button.append(kbd);
    }
    button.addEventListener('click', () => {
      closePanels();
      if (entry.page) void api.openPage(entry.page);
      else if (entry.action) void api.command(entry.action);
    });
    menuPanel.append(button);
  }
}

// ---------------------------------------------------------------- downloads

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function renderDownloadsPanel(): void {
  downloadsPanel.textContent = '';
  const items = state?.downloads.slice(0, 6) ?? [];
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = 'Nessun download recente.';
    downloadsPanel.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'download-row';
    row.title = item.savePath || item.url;
    const name = document.createElement('span');
    name.className = 'download-name';
    name.textContent = item.filename;
    const meta = document.createElement('span');
    meta.className = 'download-meta';
    const left = document.createElement('span');
    left.textContent = downloadLabel(item);
    const right = document.createElement('span');
    right.textContent =
      item.state === 'progressing' && item.total > 0
        ? `${formatBytes(item.received)} / ${formatBytes(item.total)}`
        : formatBytes(item.received || item.total);
    meta.append(left, right);
    const progress = document.createElement('div');
    progress.className = 'progress';
    const bar = document.createElement('span');
    const ratio = item.total > 0 ? Math.min(1, item.received / item.total) : item.state === 'completed' ? 1 : 0.15;
    bar.style.width = `${Math.round(ratio * 100)}%`;
    progress.append(bar);
    row.append(name, meta, progress);
    row.addEventListener('click', () => {
      closePanels();
      void api.openPage('downloads');
    });
    downloadsPanel.append(row);
  }
  const footer = document.createElement('div');
  footer.className = 'panel-footer';
  const button = document.createElement('button');
  button.textContent = 'Tutti i download';
  button.addEventListener('click', () => {
    closePanels();
    void api.openPage('downloads');
  });
  footer.append(button);
  downloadsPanel.append(footer);
}

function downloadLabel(item: DownloadState): string {
  if (item.state === 'progressing') return 'In corso';
  if (item.state === 'completed') return 'Completato';
  if (item.state === 'cancelled') return 'Annullato';
  return 'Interrotto';
}

// ------------------------------------------------------------------- shield

function renderShieldPanel(): void {
  shieldPanel.textContent = '';
  const title = document.createElement('h3');
  title.textContent = 'Privacy di questa pagina';
  const row = document.createElement('div');
  row.className = 'row';
  const big = document.createElement('span');
  big.className = 'big';
  big.textContent = String(activeTab()?.blocked ?? 0);
  const small = document.createElement('small');
  small.textContent = 'richieste bloccate in questa scheda';
  row.append(big, small);
  const total = document.createElement('p');
  total.textContent = `Da quando LomeSearch è in esecuzione: ${state?.privacy.blockedSession ?? 0} bloccate. Totale storico: ${state?.privacy.blockedTotal ?? 0}.`;
  const rules = document.createElement('p');
  rules.textContent = `Lista integrata: ${state?.privacy.blocklistSize ?? 0} regole, cookie di terze parti e HTTPS-first attivi.`;
  const button = document.createElement('button');
  button.textContent = 'Apri il report privacy';
  button.addEventListener('click', () => {
    closePanels();
    void api.openPage('privacy');
  });
  shieldPanel.append(title, row, total, rules, button);
}

// -------------------------------------------------------------------- toast

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastTimer = null;
  }, 1_800);
}

// ------------------------------------------------------------------- wiring

omniboxForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitOmnibox();
});

omnibox.addEventListener('input', () => {
  omnibox.setAttribute('aria-expanded', 'true');
  scheduleSuggestions();
});
omnibox.addEventListener('focus', () => {
  omnibox.select();
  if (omnibox.value.trim()) scheduleSuggestions();
});
omnibox.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (suggestions.length === 0) {
      scheduleSuggestions();
      return;
    }
    suggestionIndex = Math.min(suggestions.length - 1, suggestionIndex + 1);
    renderSuggestions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    suggestionIndex = Math.max(0, suggestionIndex - 1);
    renderSuggestions();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (activePanel === 'suggestions') closePanels();
    omnibox.blur();
  }
});
omnibox.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (activePanel === 'suggestions' && !suggestionsEl.matches(':hover')) {
      closePanels({ keepFocus: true });
    }
  }, 140);
});

backEl.addEventListener('click', () => void api.back());
forwardEl.addEventListener('click', () => void api.forward());
reloadEl.addEventListener('click', () => {
  if (activeTab()?.loading) void api.stop();
  else void api.reload(false);
});
$('#home').addEventListener('click', () => void api.home());
$('#new-tab').addEventListener('click', () => void api.createTab());
$('#win-min').addEventListener('click', () => void api.minimize());
$('#win-max').addEventListener('click', () => void api.maximize());
$('#win-close').addEventListener('click', () => void api.close());

starEl.addEventListener('click', async () => {
  const added = await api.toggleBookmark();
  toast(added ? 'Aggiunto ai preferiti' : 'Rimosso dai preferiti');
});

shieldEl.addEventListener('click', () => {
  if (activePanel === 'shield') closePanels();
  else openPanel('shield');
});
$('#downloads').addEventListener('click', () => {
  if (activePanel === 'downloads') closePanels();
  else openPanel('downloads');
});
$('#extensions').addEventListener('click', () => void api.openPage('extensions'));
$('#menu').addEventListener('click', () => {
  if (activePanel === 'menu') closePanels();
  else openPanel('menu');
});

overlayEl.addEventListener('mousedown', () => closePanels());

findInput.addEventListener('input', updateFind);
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void api.find(findInput.value, !event.shiftKey, true);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePanels();
  }
});
$('#find-next').addEventListener('click', () => void api.find(findInput.value, true, true));
$('#find-prev').addEventListener('click', () => void api.find(findInput.value, false, true));
$('#find-close').addEventListener('click', () => closePanels());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (activePanel !== 'none') {
      event.preventDefault();
      closePanels();
    }
  }
});

api.onState((next) => render(next));
api.onFindResult((result) => {
  findCountEl.textContent = `${result.activeMatch}/${result.matches}`;
});
api.onFocusOmnibox(() => {
  omnibox.focus();
  omnibox.select();
});
api.onFocusFind(() => startFind());
api.onSettingsChanged((next) => {
  settings = next;
  applyTheme(next.theme);
});
api.onDownloads(() => renderBadges());

void (async () => {
  settings = await api.getSettings();
  applyTheme(settings.theme);
  render(await api.getState());
})();
