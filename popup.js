/**
 * Popup: ask the active tab's content script to copy the description, and
 * report what happened. The popup itself never touches the page DOM.
 */
(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const copyButton = document.getElementById('copy');
  const headerToggle = document.getElementById('include-header');

  let activeTab = null;

  function setStatus(message, tone) {
    statusEl.textContent = message;
    statusEl.setAttribute('data-tone', tone || 'info');
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: 'not-injected' });
          return;
        }
        resolve(response);
      });
    });
  }

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function copy() {
    if (!activeTab) return;
    copyButton.disabled = true;
    setStatus('Copying…', 'info');
    const response = await sendToTab(activeTab.id, {
      type: 'copy-job-description',
      options: { includeHeader: headerToggle.checked },
    });
    copyButton.disabled = false;

    if (response && response.ok) {
      const size = response.characters
        ? ` · ${response.characters} characters`
        : '';
      setStatus((response.title || 'Description') + ' copied' + size, 'ok');
      window.setTimeout(() => window.close(), 900);
      return;
    }
    setStatus(describeFailure(response && response.reason), 'error');
  }

  function describeFailure(reason) {
    if (reason === 'not-job-page') return "This doesn't look like a LinkedIn job page.";
    if (reason === 'not-injected') return 'Reload the LinkedIn tab, then try again.';
    if (reason === 'clipboard') return 'The browser refused to write to the clipboard.';
    return 'Could not find the job description.';
  }

  async function init() {
    activeTab = await activeTabId();
    if (!activeTab || !activeTab.url) {
      setStatus('No active tab.', 'error');
      return;
    }
    if (!/^https:\/\/([\w-]+\.)*linkedin\.com\/jobs\//.test(activeTab.url)) {
      setStatus("This doesn't look like a LinkedIn job page.", 'error');
      return;
    }

    const probe = await sendToTab(activeTab.id, { type: 'describe-page' });
    if (probe && probe.ok && probe.title) {
      setStatus(probe.title, 'info');
    } else {
      setStatus('Ready to copy.', 'info');
    }
    copyButton.disabled = false;
    copyButton.focus();
  }

  copyButton.addEventListener('click', copy);
  init();
})();
