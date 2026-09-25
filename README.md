# LinkedIn Job Description Copier

A lightweight browser extension for **Chrome, Brave, and other Chromium-based browsers** that extracts the job description from a LinkedIn job page and copies it as clean, readable text.

The goal is simple:

> **Open a LinkedIn job → press `Ctrl+C` → paste the clean job description anywhere.**

No manual selection. No copying the entire page. No HTML cleanup afterward.

---

## ✨ Features

- 📋 Copy the LinkedIn job description with `Ctrl+C`
- 🧹 Automatically converts HTML into clean plain text
- 🔎 Finds the job description using semantic DOM elements instead of unstable CSS classes
- 🚫 Avoids relying on LinkedIn's generated class names such as `_496fcd88`
- 🌐 Works with LinkedIn job pages
- 🖱️ Optional extension button for manual copying
- 🖱️ Optional context-menu action: **Copy LinkedIn job description**
- 🔔 Shows a small success/failure notification
- ⚡ Lightweight — no backend or external API required
- 🔒 Runs locally in the browser
- 💻 Compatible with Chrome, Brave, Edge and other Chromium-based browsers

---

# 🎯 Motivation

LinkedIn job pages contain a lot of surrounding content:

- company information
- navigation
- recommendations
- buttons
- application controls
- job metadata
- related jobs
- comments and other UI elements

When manually copying a job description, you often end up with unnecessary content or have to select the text carefully.

This extension automates the process.

Instead of:

```text
Open LinkedIn
    ↓
Find "About the job"
    ↓
Select the description manually
    ↓
Copy
    ↓
Paste
    ↓
Clean the formatting
```

You simply do:

```text
Open LinkedIn job
    ↓
Ctrl+C
    ↓
Paste
```

---

# 🧠 How It Works

The extension runs a content script on LinkedIn job pages.

It searches the page for the **"About the job"** section rather than depending on LinkedIn's generated CSS classes.

For example, a LinkedIn page may contain:

```html
<h2>
    About the job
</h2>
```

followed by a container such as:

```html
<span data-testid="expandable-text-box">
    ...
</span>
```

The extension identifies the relevant section and extracts its textual content.

The HTML is then converted into clean plain text.

---

# ⚠️ Why We Don't Use LinkedIn's CSS Classes

LinkedIn frequently uses generated class names such as:

```text
_496fcd88
bef132b9
dbc981b1
_9e907aaf
cdc21505
```

These classes should **not** be considered stable APIs.

For example:

```html
<div class="_496fcd88 eebe61b8 b59dc2c0">
```

may change after a LinkedIn deployment.

Instead, the extension should prioritize:

```html
<h2>About the job</h2>
```

and stable attributes such as:

```html
data-testid="expandable-text-box"
```

The extraction strategy is therefore based on **semantic content and DOM relationships**, making it more resilient to LinkedIn UI changes.

### The one thing the test-id approach misses

The heading is the anchor, but the `expandable-text-box` test id is **not** a
reliable container. LinkedIn renders the box *inside* a paragraph:

```html
<p><span data-testid="expandable-text-box">Notre équipe<p>…</p><ul>…</ul></span></p>
```

The HTML parser closes the outer `<p>` at the first inner `<p>` and pops the
`<span>` with it. In the live DOM the box holds **only the first line** — every
following paragraph and every list is its *sibling*, so reading the box returns
a single line with all the bullets missing. Two more quirks of the same page:

| Quirk | Handling |
| --- | --- |
| Lists are authored `<ul><p><li>…</li></p></ul>` | Items are collected by list ownership, not by child position |
| The toggle reads `… more` (U+2026), not "Show more" | Matches both ellipsis forms, and prefers `[data-testid="expandable-text-button"]` |

So the unit that gets extracted is the **section around the heading**, stopping
before the next section (a company blurb in its own box, or a heading such as
"About the company"). The heading itself is excluded from the output.

### Title, company, location

The "Include job title, company and location" header resolves in this order:

1. **`schema.org/JobPosting`** from `ld+json`, searched recursively so it is
   still found inside an `@graph` or `mainEntity` wrapper.
2. **Open Graph** (`og:title`, `og:description`).
3. **The top card** — `.top-card-layout__title`, `.topcard__org-name-link`,
   `.topcard__flavor--bullet`. LinkedIn serves these before the cookie banner is
   accepted, which is exactly when there is no `ld+json` and no OG tag.
4. The **document title**, e.g. `Werkstudent (m/f/d) … bei SC Media House |
   LinkedIn`, split on the last `bei` / `at`.

The description heading is never used as a title. On a page with no structured
data it is the only heading present, so a "first heading wins" fallback reports
`Job: About the job` on *every* posting. Section labels are rejected explicitly,
and when nothing is known the header is omitted rather than filled with a wrong
answer.

LinkedIn packs several facts into the location bullet
(`Hamburg, Deutschland · Vor Ort · Softwareentwicklung`); only the first segment
is reported as the location.

---

# 🏗️ Architecture

```text
┌───────────────────────────────┐
│       LinkedIn Job Page       │
└───────────────┬───────────────┘
                │
                ▼
       ┌─────────────────┐
       │ Content Script  │
       └────────┬────────┘
                │
                ▼
      Find "About the job"
                │
                ▼
       Locate description
                │
                ▼
        Extract innerText
                │
                ▼
       Clean / normalize text
                │
                ▼
       Clipboard API
                │
                ▼
        📋 Clean text
```

---

# 📁 Project Structure

Actual structure of this repository:

```text
linkedin-job-copier/
│
├── manifest.json
├── extractor.js          ← DOM extraction, cleanup, metadata (no chrome.* APIs)
├── content.js            ← Ctrl+C interception, clipboard, toast, message API
├── background.js         ← context menu, keyboard shortcut, on-demand injection
├── popup.html
├── popup.js
├── popup.css
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── tools/
│   └── generate-icons.mjs
│
├── tests/
│   ├── fixtures.mjs
│   ├── extractor.test.mjs
│   └── content.test.mjs
│
├── package.json
├── LICENSE
└── README.md
```

The split matters: `extractor.js` knows nothing about the clipboard, so it can
be unit tested against a real DOM (see [Development](#-development)).

---

# 🔧 Manifest V3

The extension uses **Manifest V3**. The shipped [`manifest.json`](manifest.json):

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Job Description Copier",
  "version": "1.0.0",
  "description": "Copy LinkedIn job descriptions as clean, readable text.",
  "permissions": ["clipboardWrite", "contextMenus", "scripting", "activeTab"],
  "host_permissions": ["https://*.linkedin.com/jobs/*"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://*.linkedin.com/jobs/*"],
      "js": ["extractor.js", "content.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "copy-job-description": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Copy the current job description"
    }
  }
}
```

Why each permission is there:

| Permission        | Why it is needed                                             |
| ----------------- | ------------------------------------------------------------ |
| `clipboardWrite`  | writing to the clipboard outside a native `copy` event        |
| `contextMenus`    | the right-click "Copy LinkedIn job description" entry        |
| `scripting`       | injecting the content script into tabs that were already open |
| `activeTab`       | letting the menu/shortcut talk to the current tab only       |

Nothing else is requested: no `cookies`, no `history`, no host access outside
`linkedin.com/jobs/*` (any subdomain, so country domains work too).

---

# ⌨️ Keyboard Shortcut

The main interaction is:

```text
Ctrl+C
```

on Windows/Linux.

On macOS:

```text
Cmd+C
```

The extension should detect the copy event.

Conceptually:

```javascript
document.addEventListener("copy", handleCopy);
```

When the user presses `Ctrl+C`, the extension checks whether:

1. The current page is a LinkedIn job page.
2. The user is not copying text from an input or textarea.
3. A job description can be found.

If all conditions are satisfied, the extension copies the job description.

---

# 🛡️ Don't Break Normal Copy/Paste

The extension should **not hijack every `Ctrl+C` operation**.

For example, if the user is typing in:

```html
<input>
```

or:

```html
<textarea>
```

the extension should allow the browser to perform its normal copy behavior.

Likewise, if the user manually selects some text elsewhere on LinkedIn, the extension should avoid unexpectedly replacing that selection unless the user is intentionally using the job-description action.

Recommended logic:

```text
Ctrl+C
   │
   ├── Input / textarea / contenteditable?
   │       └── Yes → Normal browser copy
   │
   └── No
       │
       ├── LinkedIn job page?
       │       └── No → Normal browser copy
       │
       └── Yes
           │
           └── Copy job description
```

---

# 🔎 Job Description Detection

The extraction logic should prioritize stable signals.

## Strategy 1 — Find the heading

Search for an element whose visible text is:

```text
About the job
```

Example:

```javascript
const headings = [...document.querySelectorAll("h1, h2, h3")];

const heading = headings.find(
  element => element.textContent.trim().toLowerCase() === "about the job"
);
```

---

## Strategy 2 — Find the associated description

Once the heading is found, inspect nearby DOM elements.

LinkedIn may structure the section differently over time, so the extractor should support several strategies.

For example:

```text
<h2>About the job</h2>
        ↓
parent container
        ↓
description container
```

or:

```text
<h2>About the job</h2>
        ↓
next sibling
        ↓
[data-testid="expandable-text-box"]
```

---

# 🧹 Text Cleanup

Raw `innerText` may contain unnecessary whitespace.

The extension should normalize it.

Example raw content:

```text
Notre équipe


Plus de 90 ingénieurs...




Ton rôle


Il ne s'agit pas...
```

should become:

```text
Notre équipe

Plus de 90 ingénieurs...

Ton rôle

Il ne s'agit pas...
```

Recommended cleanup:

```javascript
text
  .replace(/\r/g, "")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
```

The goal is readable text without destroying paragraph structure.

---

# 📋 Example

Given this HTML:

```html
<h2>About the job</h2>

<span data-testid="expandable-text-box">

  <p>Notre équipe</p>

  <p>
    Plus de 90 ingénieurs issus des meilleures écoles composent notre équipe technique.
  </p>

  <p>Ton rôle</p>

  <p>
    Il ne s'agit pas d'une mission unique.
  </p>

  <ul>
    <li>Développer des fonctionnalités</li>
    <li>Participer aux choix techniques</li>
    <li>Collaborer avec les équipes</li>
  </ul>

</span>
```

The copied result should be:

```text
Notre équipe

Plus de 90 ingénieurs issus des meilleures écoles composent notre équipe technique.

Ton rôle

Il ne s'agit pas d'une mission unique.

• Développer des fonctionnalités
• Participer aux choix techniques
• Collaborer avec les équipes
```

---

# ✨ Optional Formatting

The extension can preserve useful structure.

For example:

### Headings

```text
Notre équipe
```

### Paragraphs

```text
Plus de 90 ingénieurs issus des meilleures écoles composent notre équipe technique.
```

### Lists

```text
• Développer des fonctionnalités
• Participer aux choix techniques
• Collaborer avec les équipes
```

This makes the copied text much more useful when pasting into:

- ChatGPT
- Claude
- Cursor
- Notion
- Obsidian
- Google Docs
- Microsoft Word
- Notes
- Email
- Job application tools

---

# 🖱️ Manual Copy Button

The extension also ships a popup button.

Button label:

```text
Copy description
```

When clicked:

```text
Find job description
        ↓
Extract text
        ↓
Clean text
        ↓
Copy to clipboard
        ↓
Show "Copied!"
```

This is useful if `Ctrl+C` conflicts with another browser action.

---

# 🖱️ Context Menu

The right-click menu provides:

```text
Copy LinkedIn job description
```

Example:

```text
Right click
     ↓
Copy LinkedIn Job Description
```

Implemented in [`background.js`](background.js) with Chrome's `contextMenus` API,
and restricted to `linkedin.com/jobs/*` pages.

---

# 🔔 User Feedback

After successfully copying:

```text
✓ Job description copied
```

If the description cannot be found:

```text
Could not find the job description.
```

If the page is not a LinkedIn job page:

```text
This page doesn't appear to be a LinkedIn job page.
```

Notifications should be small and unobtrusive.

---

# 🌐 Supported Browsers

The extension targets Chromium-based browsers.

Expected compatibility:

- ✅ Google Chrome
- ✅ Brave
- ✅ Microsoft Edge
- ✅ Chromium
- ✅ Arc
- ✅ Opera
- ⚠️ Other Chromium-based browsers may also work

Firefox would require a separate compatibility pass because extension APIs and manifest behavior can differ.

---

# 🔐 Privacy

The extension should not need a backend.

The job description is processed locally:

```text
LinkedIn
   ↓
Browser DOM
   ↓
Extension
   ↓
Clipboard
```

No job description needs to be sent to a server.

The extension should **not**:

- collect LinkedIn credentials
- collect cookies
- track browsing history
- send job descriptions to an external server
- store job descriptions remotely
- require an account

---

# 🚀 Installation — Chrome

Since the extension is locally developed, use Chrome's Developer Mode.

### 1. Clone or download the repository

```bash
git clone <repository-url>
```

Then open the project directory.

### 2. Open Chrome extensions

Go to:

```text
chrome://extensions/
```

### 3. Enable Developer Mode

Turn on:

```text
Developer mode
```

### 4. Load the extension

Click:

```text
Load unpacked
```

Select:

```text
linkedin-job-copier/
```

The extension should now appear in your installed extensions.

---

# 🦁 Installation — Brave

Open:

```text
brave://extensions/
```

Then:

1. Enable **Developer mode**
2. Click **Load unpacked**
3. Select the extension directory
4. Open a LinkedIn job page

The extension should now be active.

---

# 🧪 Testing

Open a LinkedIn job page such as:

```text
https://www.linkedin.com/jobs/view/...
```

Then:

1. Wait for the page to fully load.
2. Press `Ctrl+C`.
3. Open Notepad or another text editor.
4. Press `Ctrl+V`.

Expected result:

```text
Notre équipe

Plus de 90 ingénieurs...

Ton rôle

...

Les conditions

...
```

There should be no:

```html
<div>
<span>
<p>
```

and no LinkedIn CSS classes.

---

# 🧪 Test Cases

The extension should be tested against multiple page states.

## Test 1 — Normal job page

```text
LinkedIn job page
        ↓
Ctrl+C
        ↓
Job description copied
```

---

## Test 2 — Description is collapsed

If LinkedIn displays:

```text
... more
```

the extension expands the description before extracting it (see
`expandDescription` in [`extractor.js`](extractor.js), covered by a test).

Expected behavior:

```text
Find "About the job"
        ↓
Find "... more"
        ↓
Expand
        ↓
Extract full description
```

---

## Test 3 — User is typing

If the user is inside:

```html
<input>
```

and presses:

```text
Ctrl+C
```

the extension should not interfere with normal browser behavior.

---

## Test 4 — Text is manually selected

If the user selects arbitrary LinkedIn text, the extension should avoid unexpectedly replacing the clipboard unless the user explicitly invokes the job-description action.

---

## Test 5 — LinkedIn changes CSS classes

Example:

```text
_old_class_1
_old_class_2
```

becomes:

```text
_new_class_1
_new_class_2
```

The extractor should continue working because it relies primarily on semantic structure rather than hashed classes.

---

# 🧩 Robust Extraction Strategy

The extractor should use a fallback chain.

Recommended priority:

```text
1. Find "About the job" heading
        ↓
2. Find associated expandable text container
        ↓
3. Use data-testid when available
        ↓
4. Inspect nearby DOM relationships
        ↓
5. Validate extracted text
        ↓
6. Return clean text
```

Avoid:

```javascript
document.querySelector("._496fcd88.eebe61b8...");
```

because this is fragile.

Prefer:

```javascript
document.querySelector('[data-testid="expandable-text-box"]');
```

combined with the `"About the job"` heading.

---

On a job page, the description is put on the clipboard as **plain text** and, at
the same time, as **rich text** (`text/html`), so pasting into Google Docs,
Notion or Word keeps the paragraphs and bullet lists instead of flattening
everything.

Three other ways to trigger the same copy:

| Trigger                          | Notes                                             |
| -------------------------------- | ------------------------------------------------- |
| Extension icon → **Copy description** | also offers a header checkbox (see below)     |
| Right-click → **Copy LinkedIn job description** | works on any LinkedIn job page         |
| `Ctrl+Shift+Y` / `Cmd+Shift+Y`   | remappable at `chrome://extensions/shortcuts`     |

The popup checkbox *Include job title, company and location* prepends:

```text
Job: Full Stack Developer
Company: Galadrim
Location: Paris

<description>
```

Title, company and location come from the page's `JobPosting` JSON-LD first
(LinkedIn publishes it independently of the UI), with `og:` meta tags and the
visible heading as fallbacks.

---

# 🛠️ Development

```bash
npm install     # jsdom, used only by the tests
npm test        # 43 tests: extraction + content-script behaviour
npm run icons   # regenerate icons/*.png (no dependencies)
```

The tests run the real files against a real DOM:

- `tests/extractor.test.mjs` — heading detection, container choice, list and
  paragraph formatting, cleanup, metadata, and the copy decision tree. Fixtures
  use hashed class names (`_496fcd88`) on purpose, so any selector that reaches
  for a generated class fails the suite.
- `tests/content.test.mjs` — boots `content.js` in a page and asserts the four
  spec behaviours: `Ctrl+C` copies on a job page, and does nothing while typing,
  while text is selected, or on a page with no description.

Nothing in the test suite touches the network or a real browser.

---

# 📦 Future Improvements

Possible future features:

### 1. Copy as Markdown

Instead of:

```text
Notre équipe
```

produce:

```markdown
## Notre équipe
```

---

### 2. Employment type and salary in the header

The JSON-LD block already carries `employmentType` and, on some listings, a
salary range. Add them next to the title/company/location header.

---

### 3. Per-language heading coverage

The heading list covers English, French, German, Spanish, Portuguese, Italian
and Dutch. Adding a language means adding its translation of "About the job"
to `HEADING_LABELS` in [`extractor.js`](extractor.js).

---

### 4. AI Integration

A future version could send the extracted description to an AI provider for:

- CV matching
- skill-gap analysis
- job summary
- interview preparation
- technology extraction
- requirements extraction

However, the base extension should remain completely local and independent of AI services.

---

### 5. Export

Add:

```text
Copy
Save as TXT
Save as Markdown
```

---

# 🛠️ Development Principles

The project should follow these principles:

### 1. Don't depend on generated CSS classes

Avoid selectors such as:

```text
._496fcd88
._9e907aaf
._34ec36b2
```

These are implementation details of LinkedIn's frontend.

---

### 2. Prefer semantic selectors

Prefer:

```text
h2
[data-testid="expandable-text-box"]
```

and DOM relationships.

---

### 3. Graceful fallback

LinkedIn can change its DOM.

The extension should fail gracefully rather than throwing errors.

---

### 4. No unnecessary permissions

Only request permissions that are actually required.

---

### 5. Local-first

No backend should be necessary for the basic functionality.

---

### 6. Preserve readability

The extracted text should be immediately usable by an AI assistant or human without additional cleanup.

---

# 📜 License

Released under the [MIT License](LICENSE).

---

# ⚠️ Disclaimer

This project is an independent browser extension and is not affiliated with or endorsed by LinkedIn.

LinkedIn may change its website structure at any time. Because of this, extraction logic may require updates if the job-page DOM changes.

Users should use the extension in accordance with LinkedIn's applicable terms and policies.

---

# 🎯 Project Goal

The core objective is intentionally simple:

```text
             LinkedIn
                │
                ▼
         Open Job Page
                │
                ▼
             Ctrl+C
                │
                ▼
      Extract "About the job"
                │
                ▼
        Clean / Normalize
                │
                ▼
          📋 Clipboard
                │
                ▼
       Paste Anywhere
```

**One shortcut. One clean job description. No manual selection.**