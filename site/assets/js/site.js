// Progressive enhancement for the LomeSearch site: no trackers, no network.
(() => {
  const root = document.documentElement;
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode */
      }
    },
  };

  /* ---------- theme ---------- */

  const saved = store.get('lomesearch-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const themeButton = document.querySelector('[data-theme-toggle]');
  themeButton?.addEventListener('click', () => {
    const current =
      root.dataset.theme ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('lomesearch-theme', next);
    themeButton.setAttribute('aria-pressed', String(next === 'dark'));
  });

  /* ---------- mobile navigation ---------- */

  const header = document.querySelector('.site-header');
  const navButton = document.querySelector('[data-nav-toggle]');
  navButton?.addEventListener('click', () => {
    const open = header?.dataset.open !== 'true';
    if (header) header.dataset.open = String(open);
    navButton.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav a').forEach((link) => {
    link.addEventListener('click', () => {
      if (header) header.dataset.open = 'false';
      navButton?.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- copy buttons ---------- */

  document.querySelectorAll('.code__copy').forEach((button) => {
    button.addEventListener('click', async () => {
      const block = button.closest('.code');
      const text = block?.querySelector('pre')?.innerText.trim();
      if (!text) return;
      const label = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copiato';
      } catch {
        button.textContent = 'Seleziona';
        block?.querySelector('pre')?.focus();
      }
      setTimeout(() => {
        button.textContent = label;
      }, 1600);
    });
  });

  /* ---------- screenshot lightbox ---------- */

  const dialog = document.querySelector('dialog.lightbox');
  const dialogImage = dialog?.querySelector('img');
  document.querySelectorAll('[data-lightbox]').forEach((button) => {
    button.addEventListener('click', () => {
      const source = button.getAttribute('data-lightbox');
      if (!dialog || !dialogImage || !source) return;
      dialogImage.src = source;
      dialogImage.alt = button.getAttribute('aria-label') ?? '';
      dialog.showModal();
    });
  });
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  /* ---------- reveal on scroll ---------- */

  const reveals = document.querySelectorAll('.reveal');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    reveals.forEach((element) => observer.observe(element));
  } else {
    reveals.forEach((element) => element.classList.add('is-visible'));
  }

  /* ---------- active section in the nav ---------- */

  const links = new Map(
    [...document.querySelectorAll('.nav a[href^="#"]')].map((link) => [
      link.getAttribute('href').slice(1),
      link,
    ]),
  );
  if (links.size > 0 && 'IntersectionObserver' in window) {
    const sections = [...links.keys()]
      .map((id) => document.getElementById(id))
      .filter((section) => section !== null);
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const link = links.get(entry.target.id);
          if (!link) continue;
          if (entry.isIntersecting) {
            links.forEach((item) => item.removeAttribute('aria-current'));
            link.setAttribute('aria-current', 'true');
          }
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((section) => spy.observe(section));
  }
})();
