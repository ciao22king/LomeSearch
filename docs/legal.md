# Legal

LomeSearch is a personal, non-commercial project. It is not a product of a
company, an employer, a client or an office, and it is not offered, supported or
deployed as a service to any organisation. There is no support contract, no
service level and no data processing agreement. If you install it at work, you
do so on your own initiative and you are responsible for checking that it fits
your organisation rules.

The same text is available in the browser at `lome:legal`.

## Licence

Source code and binaries are distributed under the Apache License, Version 2.0.
A copy is in the `LICENSE` file. Third-party components keep their own licences.

## Warranty and liability

The software is provided "as is", without warranties or conditions of any kind,
express or implied, including merchantability, fitness for a particular purpose
and non-infringement. To the maximum extent permitted by law, the author is not
liable for any claim, damage or other liability arising from the software or its
use.

## Third-party components

- Electron and Chromium: rendering engine and browser platform (BSD-style
  licences, see the Electron and Chromium projects).
- Node.js: JavaScript runtime (MIT).
- TypeScript and esbuild: build tooling (Apache-2.0 and MIT).
- The search engine, crawler, index, IndexNow client and browser interface in
  this repository are original code, Apache-2.0.

The built-in blocklists and cosmetic filter rules are written for this project.
They are not copies of EasyList or another third-party filter list, and no
third-party filter list is redistributed.

## Acceptable use

LomeSearch is a privacy tool, not a way to hide abuse. Do not use it to break the
law or the terms of a site, to attack or scan systems you do not own, to evade a
ban, a paywall or an access control, to crawl against `robots.txt` or copyright,
or to submit URLs to IndexNow that you do not control.

You are responsible for the sites you crawl and for the content of the index you
build. The crawler runs on your computer and sends requests from your address.

## Fake IP headers

The "Fake IP headers" option adds decoy `X-Forwarded-For`, `X-Real-IP`,
`Client-IP` and `Forwarded` headers carrying a reserved documentation address
(RFC 5737 ranges such as 203.0.113.0/24).

It does not change your IP address. The TCP connection still comes from your real
address, and every server, proxy and network in between can see it. Only software
that trusts those headers records the decoy. Sending extra HTTP headers is
generally lawful, but it can break sites, trigger fraud checks or violate a
site's terms. The option is off by default and you enable it at your own risk.

## Privacy statement

LomeSearch has no telemetry, no account, no sync service and no analytics.
History, bookmarks, settings, downloads and the search index are files in your
local data folder, and clearing them deletes them.

Network traffic still happens where a feature requires it: DNS over HTTPS goes to
Cloudflare when enabled, remote blocklist downloads go to the URL you enter, and
IndexNow submissions go to the search engines you choose when you run that
command. The local engine listens on loopback only.

## Content and index

The index contains pages you chose to crawl. Caching and indexing third-party
pages may be restricted by copyright, database rights or the site terms. Keep the
index small, personal and lawful; do not republish crawled content as your own.

## No legal advice, no specific jurisdiction

This document explains the author's intent in plain terms. It is not legal advice
and it does not choose a jurisdiction. Local consumer, privacy, copyright and
computer-misuse law still applies where you are.

Questions, corrections and licence requests: open an issue on
github.com/ciao22king/LomeSearch.
