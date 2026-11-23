/**
 * robots.txt parser (RFC 9309).
 *
 * Rules are matched with the longest-match-wins strategy and Allow wins ties.
 * Wildcards (`*`) and end anchors (`$`) are supported, as are Crawl-delay and
 * Sitemap directives.
 */

export interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; pattern: string; regex: RegExp; length: number }>;
  crawlDelay: number | null;
}

export class RobotsTxt {
  readonly groups: RobotsGroup[];
  readonly sitemaps: string[];

  constructor(groups: RobotsGroup[], sitemaps: string[]) {
    this.groups = groups;
    this.sitemaps = sitemaps;
  }

  static allowAll(): RobotsTxt {
    return new RobotsTxt([], []);
  }

  static parse(text: string): RobotsTxt {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let current: RobotsGroup | null = null;
    let lastWasAgent = false;

    const clean = text.replace(/^\uFEFF/, '');
    for (const rawLine of clean.split(/\r?\n/)) {
      const comment = rawLine.indexOf('#');
      const line = (comment === -1 ? rawLine : rawLine.slice(0, comment)).trim();
      if (!line) continue;
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();

      if (field === 'user-agent') {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [], crawlDelay: null };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!current) continue;

      if (field === 'disallow' || field === 'allow') {
        if (!value) continue;
        current.rules.push({
          allow: field === 'allow',
          pattern: value,
          regex: patternToRegex(value),
          length: value.length,
        });
      } else if (field === 'crawl-delay') {
        const delay = Number.parseFloat(value);
        if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
      } else if (field === 'sitemap') {
        if (value) sitemaps.push(value);
      }
    }
    return new RobotsTxt(groups, sitemaps);
  }

  /** Picks the most specific group for a product token such as "LomeSearchBot". */
  groupFor(userAgent: string): RobotsGroup | null {
    const ua = userAgent.toLowerCase();
    let best: RobotsGroup | null = null;
    let bestLength = -1;
    let wildcard: RobotsGroup | null = null;
    for (const group of this.groups) {
      for (const agent of group.agents) {
        if (agent === '*') {
          wildcard ??= group;
          continue;
        }
        if (ua.includes(agent) && agent.length > bestLength) {
          best = group;
          bestLength = agent.length;
        }
      }
    }
    return best ?? wildcard;
  }

  isAllowed(path: string, userAgent: string): boolean {
    const group = this.groupFor(userAgent);
    if (!group || group.rules.length === 0) return true;
    const target = path.startsWith('/') ? path : `/${path}`;
    let best: { allow: boolean; length: number } | null = null;
    for (const rule of group.rules) {
      if (!rule.regex.test(target)) continue;
      if (
        !best ||
        rule.length > best.length ||
        (rule.length === best.length && rule.allow)
      ) {
        best = { allow: rule.allow, length: rule.length };
      }
    }
    return best ? best.allow : true;
  }

  crawlDelay(userAgent: string): number | null {
    const group = this.groupFor(userAgent);
    return group?.crawlDelay ?? null;
  }
}

function patternToRegex(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') source += '.*';
    else if (char === '$' && i === pattern.length - 1) source += '$';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  if (!source.endsWith('$')) source += '.*';
  try {
    return new RegExp(`^${source}`);
  } catch {
    return /^$/;
  }
}
