import { card, el, heading, initPage } from './common.js';

const { main } = await initPage('legal', 'Legal');

function paragraph(...children: (string | HTMLElement)[]): HTMLElement {
  return el('p', { class: 'hint' }, ...children);
}

function bullet(...children: (string | HTMLElement)[]): HTMLElement {
  return el('li', {}, ...children);
}

main.append(
  heading(
    'Legal',
    'LomeSearch is a personal project. Read this page before you rely on it for anything that matters.',
  ),

  card(
    'Personal project, not a company product',
    null,
    paragraph(
      'LomeSearch is written and maintained by one person as a personal, non-commercial project. It is not a product of a company, an employer, a client or an office, and it is not offered, supported or deployed as a service to any organisation.',
    ),
    paragraph(
      'There is no company behind it, no support contract, no service level and no data processing agreement. If you install it at work, you do so on your own initiative and you are responsible for checking that it fits your organisation rules.',
    ),
    paragraph(
      'The project is published under the Apache License 2.0. The licence grants broad rights; the paragraphs below describe how the author intends the software to be used and what is not promised.',
    ),
  ),

  card(
    'Licence and warranty',
    null,
    paragraph(
      'Source code and binaries are distributed under the Apache License, Version 2.0. A copy is in the LICENSE file of the repository. Third-party components keep their own licences.',
    ),
    paragraph(
      'The software is provided “as is”, without warranties or conditions of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. To the maximum extent permitted by law, the author is not liable for any claim, damage or other liability arising from the software or its use.',
    ),
  ),

  card(
    'Third-party components',
    null,
    el(
      'ul',
      { class: 'list' },
      bullet('Electron and Chromium: rendering engine and browser platform (BSD-style licences, see the Electron and Chromium projects).'),
      bullet('Node.js: JavaScript runtime (MIT).'),
      bullet('TypeScript and esbuild: build tooling (Apache-2.0 and MIT).'),
      bullet('The search engine, crawler, index, IndexNow client and browser interface in this repository are original code, Apache-2.0.'),
    ),
    paragraph(
      'The built-in blocklists and cosmetic filter rules are written for this project and are not copies of EasyList or other third-party lists. No third-party filter list is redistributed.',
    ),
  ),

  card(
    'Acceptable use',
    null,
    paragraph('LomeSearch is a privacy tool, not a way to hide abuse. Do not use it to:'),
    el(
      'ul',
      { class: 'list' },
      bullet('break the law or the terms of a site you visit;'),
      bullet('attack, overload or scan systems you do not own;'),
      bullet('evade a ban, a paywall or an access control;'),
      bullet('crawl sites against their robots.txt or copyright, or submit URLs to IndexNow that you do not control.'),
    ),
    paragraph(
      'You are responsible for the sites you crawl and for the content of the index you build. The crawler is a local tool: it sends requests from your computer and your address.',
    ),
  ),

  card(
    'Fake IP headers: what they do and what they do not',
    null,
    paragraph(
      'The “Fake IP headers” option adds decoy X-Forwarded-For, X-Real-IP, Client-IP and Forwarded headers carrying a reserved documentation address (RFC 5737 ranges such as 203.0.113.0/24).',
    ),
    paragraph(
      'It does not change your IP address. The TCP connection still comes from your real address, and every server, proxy and network in between can see it. Only software that trusts those headers will record the decoy.',
    ),
    paragraph(
      'Sending extra HTTP headers is generally lawful, but it can break sites, trigger fraud checks or violate a site’s terms. Some servers log or block requests with inconsistent forwarding headers. The option is off by default and you enable it at your own risk.',
    ),
  ),

  card(
    'Privacy statement',
    null,
    paragraph(
      'LomeSearch has no telemetry, no account, no sync service and no analytics. History, bookmarks, settings, downloads and the search index are files in your local data folder, and clearing them deletes them.',
    ),
    paragraph(
      'Network traffic still happens where the feature requires it: DNS over HTTPS goes to Cloudflare when enabled, remote blocklist downloads go to the URL you enter, and IndexNow submissions go to the search engines you choose when you run that command. The local engine listens on loopback only.',
    ),
  ),

  card(
    'Content and index',
    null,
    paragraph(
      'The index contains pages you chose to crawl. Caching and indexing third-party pages may be restricted by copyright, database rights or the site terms. Keep the index small, personal and lawful; do not republish crawled content as your own.',
    ),
  ),

  card(
    'No legal advice, no specific jurisdiction',
    null,
    paragraph(
      'This page explains the author’s intent in plain terms. It is not legal advice and it does not choose a jurisdiction. Local consumer, privacy, copyright and computer-misuse law still applies where you are.',
    ),
    paragraph(
      'Questions, corrections and licence requests: open an issue on the project repository, github.com/ciao22king/LomeSearch.',
    ),
  ),
);
