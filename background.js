/**
 * Background service worker: right-click menu and keyboard shortcut.
 *
 * Both entry points do the same thing — ask the active tab's content script to
 * copy the description. If the tab was already open when the extension was
 * installed the content script is missing, so it gets injected on demand.
 */
const CONTEXT_MENU_ID = 'linkedin-job-copier-copy';
const CONTENT_SCRIPTS = ['extractor.js', 'content.js'];

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Copy LinkedIn job description',
      contexts: ['page', 'selection'],
      documentUrlPatterns: ['https://*.linkedin.com/jobs/*'],
    });
  });
}

async function copyInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return;

  const response = await sendToTab(tab.id);
  if (response === undefined) {
    // No receiver: the content script was never injected into this tab.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_SCRIPTS,
    });
    const retry = await sendToTab(tab.id);
    if (retry && retry.ok === false) {
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b3261e' });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 3000);
    }
  }
}

function sendToTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs
      .sendMessage(tabId, { type: 'copy-job-description', options: {} }, (response) => {
        if (chrome.runtime.lastError) {
          // Swallow "Could not establish connection" — handled by the caller.
          resolve(undefined);
          return;
        }
        resolve(response);
      });
  });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  copyInActiveTab();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'copy-job-description') return;
  copyInActiveTab();
});
