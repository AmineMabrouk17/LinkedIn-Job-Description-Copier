/**
 * LinkedIn Job Description Copier — content script.
 *
 * Responsibilities:
 *   - intercept Ctrl/Cmd+C on LinkedIn job pages and put the description on the
 *     clipboard instead of the whole page
 *   - stay out of the way when the user is typing or has a selection
 *   - serve copy requests coming from the popup, the context menu and the
 *     keyboard shortcut
 *   - give a small, unobtrusive toast of what happened
 */
(function () {
  'use strict';

  if (window.__linkedinJobCopierLoaded) return;
  window.__linkedinJobCopierLoaded = true;

  const extractor = window.JobExtractor;
  if (!extractor) return;

  const TOAST_ID = 'linkedin-job-copier-toast';
  const TOAST_DURATION = 2200;

  const MESSAGES = {
    copied: 'Job description copied',
    copiedShort: 'Copied',
    notFound: 'Could not find the job description.',
    notJobPage: "This page doesn't appear to be a LinkedIn job page.",
    failed: 'Could not write to the clipboard.',
    nothingSelected: 'Nothing to copy here.',
  };

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------

  /**
   * Write both flavours of the description. `navigator.clipboard` is the happy
   * path (that is what `clipboardWrite` is for); the execCommand fallback keeps
   * the html/plain pair together when the async API is unavailable.
   */
  async function writeClipboard(text, html) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* fall through to the legacy path */
    }
    return legacyCopy(text, html);
  }

  function legacyCopy(text, html) {
    const holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.position = 'fixed';
    holder.style.top = '-1000px';
    holder.style.left = '-1000px';
    holder.style.whiteSpace = 'pre-wrap';
    holder.textContent = text;
    document.body.appendChild(holder);

    const selection = window.getSelection();
    const previous = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection.removeAllRanges();
    selection.addRange(range);

    const onCopy = (event) => {
      event.stopPropagation();
      event.clipboardData.setData('text/plain', text);
      if (html) event.clipboardData.setData('text/html', html);
      event.preventDefault();
    };
    document.addEventListener('copy', onCopy, true);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }

    document.removeEventListener('copy', onCopy, true);
    holder.remove();
    if (previous) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  function showToast(message, tone) {
    let host = document.getElementById(TOAST_ID);
    if (host) host.remove();

    host = document.createElement('div');
    host.id = TOAST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'z-index: 2147483647',
      'right: 16px',
      'bottom: 16px',
      'pointer-events: none',
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .toast {
        font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 9px 14px;
        border-radius: 8px;
        background: #1f2328;
        color: #ffffff;
        box-shadow: 0 6px 20px rgba(0, 0, 0, .25);
        max-width: 280px;
      }
      .toast[data-tone="error"] { background: #b3261e; }
      @media (prefers-reduced-motion: no-preference) {
        .toast { animation: rise .16s ease-out; }
        @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
      }
    `;
    const box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('data-tone', tone === 'error' ? 'error' : 'ok');
    box.textContent = message;

    shadow.append(style, box);
    document.documentElement.appendChild(host);

    window.setTimeout(() => host && host.remove(), TOAST_DURATION);
  }

  // ---------------------------------------------------------------------------
  // Copying
  // ---------------------------------------------------------------------------

  function buildPayload(result, options) {
    const header = options && options.includeHeader ? extractor.formatHeader(result.meta) : '';
    return {
      text: header ? header + '\n\n' + result.text : result.text,
      html: result.html,
    };
  }

  /** Copy whatever the extractor can find on this page (button, menu, shortcut). */
  async function copyJobDescription(options) {
    const settings = options || {};
    const onJobPage = extractor.isJobPage(window.location);
    let result = extractor.extract(document);

    if (result.found && extractor.expandDescription(result.container)) {
      // A collapsed description was expanded; read it again now that it is open.
      result = extractor.extract(document);
    }

    if (!result.found) {
      if (!onJobPage && !result.heading) return { ok: false, reason: 'not-job-page' };
      showToast(MESSAGES.notFound, 'error');
      return { ok: false, reason: result.reason };
    }

    const payload = buildPayload(result, settings);
    const ok = await writeClipboard(payload.text, payload.html);
    if (!ok) {
      showToast(MESSAGES.failed, 'error');
      return { ok: false, reason: 'clipboard' };
    }

    showToast(
      result.text.length > 90 ? MESSAGES.copied : MESSAGES.copiedShort,
      'ok'
    );
    return {
      ok: true,
      characters: result.text.length,
      title: result.meta.title,
      company: result.meta.company,
    };
  }

  // ---------------------------------------------------------------------------
  // Ctrl+C interception
  // ---------------------------------------------------------------------------

  function hasUserSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    if (selection.isCollapsed) return false;
    return String(selection).trim().length > 0;
  }

  document.addEventListener(
    'copy',
    (event) => {
      // Cheap pre-checks only: the clipboard must be written synchronously, so
      // the real extraction happens right here rather than in a promise.
      const onJobPage =
        extractor.isJobPage(window.location) || !!extractor.findHeading(document);

      const shouldHandle = extractor.shouldInterceptCopy({
        isEditableTarget: extractor.isEditableTarget(event.target),
        hasSelection: hasUserSelection(),
        hasDescription: onJobPage,
      });
      if (!shouldHandle) return;

      const result = extractor.extract(document);
      if (!result.found) {
        if (extractor.isJobPage(window.location)) showToast(MESSAGES.notFound, 'error');
        return;
      }

      const payload = buildPayload(result, { includeHeader: false });
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData.setData('text/plain', payload.text);
      if (payload.html) event.clipboardData.setData('text/html', payload.html);
      showToast(result.text.length > 90 ? MESSAGES.copied : MESSAGES.copiedShort, 'ok');
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Messages from the popup / context menu / shortcut
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return undefined;

    if (message.type === 'describe-page') {
      // Cheap answer for the popup: what job is this page, and is it copyable?
      const result = extractor.extract(document);
      sendResponse({
        ok: true,
        isJobPage: extractor.isJobPage(window.location),
        found: result.found,
        title: (result.meta && result.meta.title) || document.title || '',
        company: (result.meta && result.meta.company) || '',
      });
      return undefined;
    }

    if (message.type === 'copy-job-description') {
      copyJobDescription(message.options).then(sendResponse, () =>
        sendResponse({ ok: false, reason: 'error' })
      );
      return true; // async response
    }

    return undefined;
  });
})();
