/**
 * Content-script tests: the behaviours the spec actually promises.
 *
 *   Ctrl+C on a job page      → clipboard gets the description
 *   Ctrl+C in a text field    → browser keeps its normal behaviour
 *   Ctrl+C with a selection   → browser keeps its normal behaviour
 *   popup / context menu      → the message API answers
 *
 * The content script is loaded into a jsdom window with a stubbed `chrome`
 * global, exactly as the browser would run it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { jobPage, collapsedJobPage, nonJobPage } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extractor = require(join(root, 'extractor.js'));
const contentScript = readFileSync(join(root, 'content.js'), 'utf8');

/** Boot a page with the content script installed. */
function boot(html, url) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.JobExtractor = extractor;
  window.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => window.__listeners.push(fn) },
    },
  };
  window.__listeners = [];
  window.__clipboardWrites = [];

  Object.defineProperty(window, 'isSecureContext', { value: true });
  window.navigator.clipboard = {
    writeText: async (text) => {
      window.__clipboardWrites.push(text);
    },
  };

  window.eval(contentScript);
  return dom;
}

/** Fire a copy event the way the browser does, with a working clipboardData. */
function pressCopy(window, target) {
  const event = new window.Event('copy', { bubbles: true, cancelable: true });
  const written = new Map();
  event.clipboardData = {
    setData: (type, value) => written.set(type, value),
    getData: (type) => written.get(type) || '',
  };
  (target || window.document).dispatchEvent(event);
  return { event, written };
}

const JOB_URL = 'https://www.linkedin.com/jobs/view/4123456/';

test('Ctrl+C on a job page copies the description', () => {
  const { window } = boot(jobPage, JOB_URL);
  const { event, written } = pressCopy(window);

  assert.equal(event.defaultPrevented, true, 'the native copy must be cancelled');
  const text = written.get('text/plain');
  assert.match(text, /Notre équipe/);
  assert.match(text, /• Développer des fonctionnalités/);
  assert.doesNotMatch(text, /Galadrim is a software company/);
  assert.doesNotMatch(text, /Comments/);
  assert.match(written.get('text/html'), /<ul>/);
});

test('Ctrl+C shows a toast', () => {
  const { window } = boot(jobPage, JOB_URL);
  pressCopy(window);
  const host = window.document.getElementById('linkedin-job-copier-toast');
  assert.ok(host, 'a toast should be inserted');
});

test('Ctrl+C in a text field is left alone', () => {
  const { window } = boot(jobPage + '<input id="search" />', JOB_URL);
  const input = window.document.getElementById('search');
  const { event, written } = pressCopy(window, input);

  assert.equal(event.defaultPrevented, false);
  assert.equal(written.size, 0);
});

test('Ctrl+C with a manual selection is left alone', () => {
  const { window } = boot(jobPage, JOB_URL);
  const paragraph = window.document.querySelector('main p');
  const range = window.document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const { event, written } = pressCopy(window);
  assert.equal(event.defaultPrevented, false);
  assert.equal(written.size, 0);
});

test('Ctrl+C on a page without a job description is left alone', () => {
  const { window } = boot(nonJobPage, 'https://www.linkedin.com/feed/');
  const { event, written } = pressCopy(window);

  assert.equal(event.defaultPrevented, false);
  assert.equal(written.size, 0);
});

test('the message API copies without a user gesture', async () => {
  const { window } = boot(jobPage, JOB_URL);
  const [listener] = window.__listeners;
  assert.equal(typeof listener, 'function');

  const response = await new Promise((resolve) => {
    const returned = listener(
      { type: 'copy-job-description', options: { includeHeader: true } },
      {},
      resolve
    );
    assert.equal(returned, true, 'the listener must keep the channel open');
  });

  assert.equal(response.ok, true);
  assert.ok(response.characters > 100);
  const [written] = window.__clipboardWrites;
  assert.match(written, /^Job: Full Stack Developer\nCompany: Galadrim\nLocation: Paris/);
  assert.match(written, /Notre équipe/);
});

test('the popup probe describes the page', () => {
  const { window } = boot(jobPage, JOB_URL);
  const [listener] = window.__listeners;
  let response;
  listener({ type: 'describe-page' }, {}, (value) => {
    response = value;
  });
  assert.equal(response.ok, true);
  assert.equal(response.isJobPage, true);
  assert.equal(response.found, true);
  assert.equal(response.title, 'Full Stack Developer');
});

test('the copy request reports a helpful reason on a non-job page', async () => {
  const { window } = boot(nonJobPage, 'https://www.linkedin.com/feed/');
  const [listener] = window.__listeners;
  const response = await new Promise((resolve) => {
    listener({ type: 'copy-job-description', options: {} }, {}, resolve);
  });
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'not-job-page');
});

test('the button path expands a collapsed description before copying', async () => {
  const { window } = boot(collapsedJobPage, JOB_URL);
  const { document } = window;
  const hidden = document.querySelector('p[style]');
  document.getElementById('toggle').addEventListener('click', () => {
    hidden.removeAttribute('style');
  });

  const [listener] = window.__listeners;
  const response = await new Promise((resolve) => {
    listener({ type: 'copy-job-description', options: {} }, {}, resolve);
  });

  assert.equal(response.ok, true);
  // The toggle was clicked, so the previously hidden paragraph is now part of
  // the description that lands on the clipboard.
  assert.match(window.__clipboardWrites[0], /Visible part/);
  assert.match(window.__clipboardWrites[0], /Hidden until expanded/);
});
