/**
 * Extractor tests.
 *
 * The extractor is the only piece with real logic, so it is the only piece
 * tested here: it runs against real DOM (jsdom) built from fixtures that look
 * like LinkedIn's markup, hashed class names included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

import {
  jobPage,
  collapsedJobPage,
  frenchJobPage,
  deeplyNestedJobPage,
  noTestIdJobPage,
  hoistedBoxJobPage,
  headingSharesParentJobPage,
  guestJobPage,
  bareDescriptionJobPage,
  nonJobPage,
} from './fixtures.mjs';

const require = createRequire(import.meta.url);
const extractor = require('../extractor.js');

const load = (html, url = 'https://www.linkedin.com/jobs/view/4123456/') => {
  const dom = new JSDOM(html, { url });
  // Content scripts get `window.JobExtractor`; give the module the same globals.
  return dom;
};

// ---------------------------------------------------------------------------
// Text cleanup
// ---------------------------------------------------------------------------

test('cleanText collapses blank-line runs but keeps paragraphs', () => {
  const raw = 'Notre équipe\n\n\n\n\nPlus de 90 ingénieurs.\n\n\n\nTon rôle  \n';
  assert.equal(extractor.cleanText(raw), 'Notre équipe\n\nPlus de 90 ingénieurs.\n\nTon rôle');
});

test('cleanText drops carriage returns, nbsp and zero-width spaces', () => {
  assert.equal(extractor.cleanText('a\r\nb\u00a0cd'), 'a\nb cd');
  assert.equal(extractor.cleanText('split\u200bword'), 'splitword');
});

test('normalizeLabel unaccents and lowercases headings', () => {
  assert.equal(extractor.normalizeLabel('  À PROPOS DU POSTE  '), 'a propos du poste');
  assert.equal(extractor.normalizeLabel('About the job:'), 'about the job');
});

// ---------------------------------------------------------------------------
// Finding the section
// ---------------------------------------------------------------------------

test('finds the "About the job" heading and ignores hashed classes', () => {
  const dom = load(jobPage);
  const heading = extractor.findHeading(dom.window.document);
  assert.ok(heading, 'heading should be found');
  assert.equal(extractor.normalizeLabel(heading.textContent), 'about the job');
});

test('finds a translated heading', () => {
  const dom = load(frenchJobPage);
  const heading = extractor.findHeading(dom.window.document);
  assert.ok(heading);
  assert.equal(extractor.normalizeLabel(heading.textContent), 'a propos du poste');
});

test('picks the description box that follows the heading, not the company blurb', () => {
  const dom = load(jobPage);
  const result = extractor.extract(dom.window.document, { minLength: 40 });
  assert.equal(result.found, true);
  assert.match(result.text, /Notre équipe/);
  assert.doesNotMatch(result.text, /Galadrim is a software company/);
  assert.doesNotMatch(result.text, /Comments/);
});

test('renders lists as bullets and indents nested lists', () => {
  const dom = load(jobPage);
  const { text } = extractor.extract(dom.window.document, { minLength: 40 });
  assert.match(text, /• Développer des fonctionnalités/);
  assert.match(text, /• Participer aux choix techniques/);
  assert.match(text, /\n {2}• Architecture/);
  assert.doesNotMatch(text, /<[a-z]/i, 'no HTML tags in the plain-text output');
});

test('finds the box through a shared ancestor when siblings are too far away', () => {
  const dom = load(deeplyNestedJobPage);
  const { document } = dom.window;
  const heading = extractor.findHeading(document);
  const box = extractor.findDescriptionAfterHeading(heading);
  assert.ok(box, 'the shared-ancestor search should find the box');
  assert.match(box.textContent, /backend engineer/);

  const result = extractor.extract(document, { minLength: 40 });
  assert.equal(result.found, true);
  assert.match(result.text, /autonomy/);
});

test('falls back to the BEM class when no data-testid is present', () => {
  const dom = load(noTestIdJobPage);
  const result = extractor.extract(dom.window.document, { minLength: 40 });
  assert.equal(result.found, true);
  assert.match(result.text, /full stack developer/);
  assert.match(result.text, /TypeScript, React and Node/);
});

test('drops a11y-only text, buttons and scripts', () => {
  const dom = load(jobPage);
  const { text } = extractor.extract(dom.window.document, { minLength: 40 });
  assert.doesNotMatch(text, /handicapees/);
  assert.doesNotMatch(text, /Postuler/);
  assert.doesNotMatch(text, /tracker/);
});

test('keeps emphasis text and turns <br> into a line break', () => {
  const dom = load(jobPage);
  const { text } = extractor.extract(dom.window.document, { minLength: 40 });
  assert.match(text, /Les conditions/);
  assert.match(text, /Salaire : 60k–70k\nRemote friendly/);
});

test('produces an html flavour with the same structure', () => {
  const dom = load(jobPage);
  const { html } = extractor.extract(dom.window.document, { minLength: 40 });
  assert.match(html, /<ul>/);
  assert.match(html, /<li>Développer des fonctionnalités<\/li>/);
  assert.match(html, /<br \/>/);
  assert.doesNotMatch(html, /<button/);
});

test('expands a collapsed description before reading it', () => {
  const dom = load(collapsedJobPage);
  const document = dom.window.document;
  const result = extractor.extract(document, { minLength: 20 });
  assert.equal(result.found, true);

  let clicked = false;
  const button = document.getElementById('toggle');
  button.addEventListener('click', () => {
    clicked = true;
    document.querySelector('p[style]').removeAttribute('style');
  });

  assert.equal(extractor.expandDescription(result.container), true);
  assert.equal(clicked, true);
  assert.match(extractor.extract(document, { minLength: 20 }).text, /Visible part/);
});

// The real posting parses such that the description box holds a single line and
// every list is its sibling. All three tests below failed before the fix.
test('keeps every list item when the box has been hoisted out of its paragraph', () => {
  const dom = load(hoistedBoxJobPage);
  const result = extractor.extract(dom.window.document, { minLength: 40 });
  assert.equal(result.found, true);

  const bullets = (result.text.match(/\u2022 /g) || []).length;
  assert.equal(bullets, 11);
  for (const item of [
    'Développer des fonctionnalités en construisant un code de qualité',
    'Participer aux choix techniques pour concevoir des produits évolutifs',
    'Un entretien technique de 45 minutes avec le CTO',
  ]) {
    assert.ok(result.text.includes(item), `missing list item: ${item}`);
  }

  // Bare text nodes between lists ("Nos technos") are content, not noise.
  assert.match(result.text, /Nos technos/);
  assert.match(result.text, /Les conditions/);
});

test('reads the list items in posting order and stops before the next section', () => {
  const dom = load(hoistedBoxJobPage);
  const { text } = extractor.extract(dom.window.document, { minLength: 40 });

  const order = [
    'Concrètement',
    'Développer des fonctionnalités',
    'Exemples de projets',
    'Nous avons travaillé avec le CEA',
    'Nos technos',
    'Outils d\'IA',
    'Les conditions',
    'Le recrutement se découpe',
  ].map((needle) => text.indexOf(needle));
  assert.ok(order.every((index) => index !== -1), 'every section must be present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sections out of order');

  // The company blurb lives in the next section and must not be mixed in.
  assert.doesNotMatch(text, /Galadrim is the tech and AI partner/);
  assert.doesNotMatch(text, /more/);
});

test('serialises wrapped list items as valid markup', () => {
  const dom = load(hoistedBoxJobPage);
  const { html } = extractor.extract(dom.window.document, { minLength: 40 });

  assert.equal((html.match(/<li>/g) || []).length, 11);
  assert.doesNotMatch(html, /<p>\s*<li/i, 'a list item must not sit inside a <p>');
  assert.doesNotMatch(html, /<button|expandable-text-button/);
  assert.match(html, /<li>Frontend : JavaScript \/ TypeScript, React, React Native/);
});

test('reads a description that shares a parent with its heading', () => {
  const dom = load(headingSharesParentJobPage);
  const { text, html } = extractor.extract(dom.window.document, { minLength: 40 });
  assert.equal(text.includes('You will build and ship internal tooling'), true);
  assert.equal(text.includes('Own a project end to end'), true);
  assert.equal(text.includes('small team with a large backlog'), false);
  // The heading is the anchor, not part of the description.
  assert.doesNotMatch(text, /About the job/);
  assert.doesNotMatch(html, /About the job/);
});

test('expands a description whose toggle reads "… more"', () => {
  const dom = load(hoistedBoxJobPage);
  const document = dom.window.document;
  const result = extractor.extract(document, { minLength: 40 });

  const button = document.querySelector('#JobDetails_AboutTheJob_4453965703 button');
  let clicked = false;
  button.addEventListener('click', () => {
    clicked = true;
  });

  assert.equal(extractor.expandDescription(result.container), true);
  assert.equal(clicked, true);
});

test('returns a reason instead of throwing when there is no description', () => {
  const dom = load(nonJobPage);
  const result = extractor.extract(dom.window.document);
  assert.equal(result.found, false);
  assert.equal(result.reason, 'no-container');
});

test('rejects a teaser box that only says "See job description"', () => {
  const dom = load(nonJobPage);
  assert.equal(extractor.isPlausibleDescription('See job description'), false);
  assert.equal(extractor.isPlausibleDescription('Short.'), false);
  assert.equal(
    extractor.isPlausibleDescription(
      'We are looking for a senior engineer to join our distributed team in Paris.',
      40
    ),
    true
  );
  assert.equal(
    extractor.isPlausibleDescription('We are looking for a senior engineer to join our team.'),
    false,
    'shorter than the default minimum'
  );
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('reads title, company and location from JSON-LD', () => {
  const dom = load(jobPage);
  const meta = extractor.extractMeta(dom.window.document);
  assert.equal(meta.title, 'Full Stack Developer');
  assert.equal(meta.company, 'Galadrim');
  assert.equal(meta.location, 'Paris, Île-de-France, FR');
});

// Regression: the old "first heading near the description" fallback reported
// the section label as the title, i.e. "Job: About the job" on every posting
// that carries no structured data.
test('reads the top card when the page has no structured data', () => {
  const dom = load(guestJobPage);
  const meta = extractor.extractMeta(dom.window.document);
  assert.equal(meta.title, 'Werkstudent (m/f/d) Softwareentwicklung');
  assert.equal(meta.company, 'SC Media House');
  // The bullet packs three facts; only the place belongs in "Location".
  assert.equal(meta.location, 'Hamburg, Deutschland');
  assert.equal(meta.source, 'top-card');
});

test('never reports a section label as the job title', () => {
  const dom = load(bareDescriptionJobPage);
  const result = extractor.extract(dom.window.document, { minLength: 40 });
  assert.equal(result.found, true);
  assert.equal(result.meta.title, '');
  assert.equal(result.meta.company, '');
  assert.equal(extractor.formatHeader(result.meta), '');
});

test('finds a JobPosting nested inside an @graph', () => {
  const dom = load(jobPage.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage' },
        {
          '@type': 'JobPosting',
          title: 'Werkstudent Softwareentwicklung',
          hiringOrganization: { '@type': 'Organization', name: 'SC Media House' },
          jobLocation: {
            '@type': 'Place',
            address: { '@type': 'PostalAddress', addressLocality: 'Hamburg', addressCountry: 'DE' },
          },
        },
      ],
    })}</script>`
  ));
  const meta = extractor.extractMeta(dom.window.document);
  assert.equal(meta.title, 'Werkstudent Softwareentwicklung');
  assert.equal(meta.company, 'SC Media House');
  assert.equal(meta.location, 'Hamburg, DE');
  assert.equal(meta.source, 'ld+json');
});

test('falls back to the document title when the page carries nothing else', () => {
  const dom = load(guestJobPage.replace(/<section class="top-card-layout">[\s\S]*?<\/section>/, ''));
  const meta = extractor.extractMeta(dom.window.document);
  assert.equal(meta.title, 'Werkstudent (m/f/d) Softwareentwicklung');
  assert.equal(meta.company, 'SC Media House');
  assert.equal(meta.source, 'document-title');
});

test('formats the optional header', () => {
  const header = extractor.formatHeader({
    title: 'Full Stack Developer',
    company: 'Galadrim',
    location: 'Paris',
  });
  assert.equal(
    header,
    'Job: Full Stack Developer\nCompany: Galadrim\nLocation: Paris'
  );
  assert.equal(extractor.formatHeader({}), '');
});

test('survives broken JSON-LD', () => {
  const dom = load('<script type="application/ld+json">{oops</script><h1>Dev</h1>');
  assert.doesNotThrow(() => extractor.extractMeta(dom.window.document));
});

// ---------------------------------------------------------------------------
// Copy decision tree
// ---------------------------------------------------------------------------

test('intercepts Ctrl+C on a job page with no selection', () => {
  assert.equal(
    extractor.shouldInterceptCopy({
      isEditableTarget: false,
      hasSelection: false,
      hasDescription: true,
    }),
    true
  );
});

test('leaves copy alone while the user is typing', () => {
  assert.equal(
    extractor.shouldInterceptCopy({
      isEditableTarget: true,
      hasSelection: false,
      hasDescription: true,
    }),
    false
  );
});

test('leaves copy alone when the user has selected text', () => {
  assert.equal(
    extractor.shouldInterceptCopy({
      isEditableTarget: false,
      hasSelection: true,
      hasDescription: true,
    }),
    false
  );
});

test('leaves copy alone on a page with no description', () => {
  assert.equal(
    extractor.shouldInterceptCopy({
      isEditableTarget: false,
      hasSelection: false,
      hasDescription: false,
    }),
    false
  );
});

test('an explicit action always copies, even with a selection', () => {
  assert.equal(
    extractor.shouldInterceptCopy({
      isEditableTarget: false,
      hasSelection: true,
      hasDescription: true,
      override: true,
    }),
    true
  );
});

test('detects editable targets', () => {
  const dom = load('<input id="a"><div id="b" contenteditable="true"></div><p id="c"></p>');
  const { document } = dom.window;
  assert.equal(extractor.isEditableTarget(document.getElementById('a')), true);
  assert.equal(extractor.isEditableTarget(document.getElementById('b')), true);
  assert.equal(extractor.isEditableTarget(document.getElementById('c')), false);
  assert.equal(extractor.isEditableTarget(null), false);
});

test('recognises job page urls', () => {
  assert.equal(extractor.isJobPage('https://www.linkedin.com/jobs/view/4123456/'), true);
  assert.equal(extractor.isJobPage('https://www.linkedin.com/jobs/guest/4123456/'), true);
  assert.equal(extractor.isJobPage('https://www.linkedin.com/feed/'), false);
  assert.equal(extractor.isJobPage(''), false);
});
