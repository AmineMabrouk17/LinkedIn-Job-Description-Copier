/**
 * LinkedIn Job Description Copier — extraction core.
 *
 * Everything in this file is pure with respect to the page: it receives a
 * `Document` (or any element) and returns data. It never touches `chrome.*`,
 * never writes to the clipboard and never mutates the page (except
 * `expandDescription`, which clicks a "show more" toggle on purpose).
 *
 * Design rules, straight from the project spec:
 *   - never select on LinkedIn's generated class names (`_496fcd88`, ...)
 *   - locate the section through its heading text and stable `data-testid`s
 *   - always degrade gracefully: a missing/renamed node returns null
 */
(function (global) {
  'use strict';

  /** Node.DOCUMENT_POSITION_FOLLOWING — `reference` comes before `target`. */
  const POSITION_FOLLOWING = 4;
  const PARAGRAPH_BREAK = '\u0000';

  /** Section headings LinkedIn uses, normalised (lowercase, unaccented). */
  const HEADING_LABELS = [
    'about the job',
    'about this job',
    'job description',
    'about the position',
    'about the role',
    'a propos du poste',
    'a propos de l emploi',
    'a propos de l offre',
    'description du poste',
    'description de l emploi',
    'acerca del puesto',
    'acerca del empleo',
    'sobre el puesto',
    'sobre o cargo',
    'uber den job',
    'uber die stelle',
    'uber den einstieg',
    'over de functie',
    'over de baan',
    'vacature',
    'sobre a vaga',
    'descricao da vaga',
    'inchiodo sulla posizione',
    'om rollen',
    'het profiel',
    'fora om jobbet',
    'pregled mesta',
    'o miejscu pracy',
    'ismerteto',
  ];

  /** Toggle labels LinkedIn puts on a truncated description. */
  const EXPAND_LABELS =
    /^(?:(?:\.\.\.|\u2026)\s*)?(?:more|show more|see more|read more|show all|view all|view more|afficher plus|voir plus|mehr anzeigen|ver mas|mostrar mas|leggimi di piu|meer weergeven)\b/i;

  /** Nodes that never belong to a job description. */
  const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  /**
   * Headings that end a section. Not job-description labels, so they never get
   * matched as the anchor, but they must stop the read before the next
   * section's text is picked up.
   */
  const SECTION_BREAK_LABELS = [
    'about the company',
    'about us',
    'who we are',
    'a propos de l entreprise',
    'a propos de nous',
    'qui sommes nous',
    'sur l entreprise',
    'uber das unternehmen',
    'uber uns',
    'acerca de la empresa',
    'acerca de nosotros',
    'chi siamo',
    'sobre nos',
    'over ons',
    'about the organisation',
    'about the organization',
  ];

  const SKIP_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'canvas',
    'iframe',
    'object',
    'embed',
    'button',
    'input',
    'select',
    'textarea',
    'form',
    '[hidden]',
    '[aria-hidden="true"]',
    '.visually-hidden',
    '.sr-only',
    '.screen-reader-only',
    '.screenreader-only',
    '.a11y-text',
    '.visuallyhidden',
  ].join(', ');

  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
  ]);

  const LIST_TAGS = new Set(['ul', 'ol']);
  const SKIPPED_TEXT_BOXES = /^(?:see |view |read )?(?:job )?description$/i;

  /** Shortest text we are willing to call a job description. */
  const MIN_LENGTH = 60;

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------

  /** Lowercase, strip accents, collapse whitespace. */
  function normalizeLabel(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s]+/g, ' ')
      .replace(/[\s:]+$/, '')
      .trim();
  }

  /** Collapse a raw HTML source run into a single readable line. */
  function collapseInline(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\f\r ]+/g, ' ')
      .replace(/ ?\n ?/g, ' ')
      .trim();
  }

  /**
   * The cleanup described in the spec, applied to a finished block of text.
   * Keeps paragraph structure, drops runs of blank lines and trailing spaces.
   * Leading whitespace on a line is left alone: that is list indentation.
   */
  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim();
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  function isElement(node) {
    return !!node && node.nodeType === 1;
  }

  function tagOf(node) {
    return isElement(node) ? node.tagName.toLowerCase() : '';
  }

  function shouldSkip(element) {
    if (!isElement(element)) return false;
    if (element.matches && element.matches(SKIP_SELECTOR)) return true;
    if (isVisuallyHidden(element)) return true;
    return false;
  }

  function isVisuallyHidden(element) {
    if (element.hidden) return true;
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    if (!view || !view.getComputedStyle) return false;
    let style;
    try {
      style = view.getComputedStyle(element);
    } catch (error) {
      return false;
    }
    if (!style) return false;
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function ancestors(element, limit) {
    const out = [];
    let node = element && element.parentElement;
    while (node && out.length < (limit || 10)) {
      out.push(node);
      node = node.parentElement;
    }
    return out;
  }

  /** Does `target` come after `reference` in document order? */
  function follows(reference, target) {
    if (!reference || !target || typeof reference.compareDocumentPosition !== 'function') {
      return false;
    }
    return !!(reference.compareDocumentPosition(target) & POSITION_FOLLOWING);
  }

  function isDescriptionBox(element) {
    if (!isElement(element)) return false;
    const testId = element.getAttribute && element.getAttribute('data-testid');
    if (testId && /expandable-text-box|job-description|job-description-container/i.test(testId)) {
      return true;
    }
    const className = typeof element.className === 'string' ? element.className : '';
    // BEM class (`description__text`, `jobs-description__text`), not a hashed
    // build class — only used when no stable test id is present.
    return /(?:^|[\s_-])description__text(?:[\s_-]|$)/.test(className);
  }

  function textLength(element) {
    return collapseInline(element && element.textContent).length;
  }

  // ---------------------------------------------------------------------------
  // Locating the description
  // ---------------------------------------------------------------------------

  /** Find the "About the job" heading, whatever the locale. */
  function findHeading(root) {
    if (!root || !root.querySelectorAll) return null;
    const headings = Array.prototype.slice.call(
      root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], legend')
    );
    let loose = null;
    for (const heading of headings) {
      const label = normalizeLabel(heading.textContent);
      if (!label) continue;
      if (HEADING_LABELS.indexOf(label) !== -1) return heading;
      if (!loose && label.length <= 80) {
        const isPrefix = HEADING_LABELS.some((known) => label.indexOf(known) === 0);
        if (isPrefix && !isInsideDescription(heading, root)) loose = heading;
      }
    }
    return loose;
  }

  function isInsideDescription(heading, root) {
    for (const ancestor of ancestors(heading, 12)) {
      if (ancestor === root) return true;
      if (isDescriptionBox(ancestor)) return true;
    }
    return false;
  }

  function childNodes(element) {
    return Array.prototype.slice.call((element && element.childNodes) || []);
  }

  /**
   * Items of `list`, including ones LinkedIn wrapped in a `<p>`.
   *
   * The markup is `<ul><p><li>…</li></p>…</ul>`. Parsing that leaves empty
   * `<p>` elements interleaved with the items, so children alone are not
   * enough, and an item may sit one wrapper deeper. Only items whose nearest
   * list ancestor is this list count, so nested lists stay with their own
   * parent item.
   */
  function listItems(list) {
    if (!list || !list.querySelectorAll) return [];
    return Array.prototype.slice
      .call(list.querySelectorAll('li'))
      .filter((item) => {
        const owner = item.parentElement && item.parentElement.closest
          ? item.parentElement.closest('ul,ol')
          : null;
        return owner === list;
      });
  }

  /** Direct child of `section` that contains `node`, or `node` itself. */
  function blockOf(section, node) {
    let current = node;
    while (current && current.parentElement && current.parentElement !== section) {
      current = current.parentElement;
    }
    return current || node;
  }

  /**
   * The nodes that make up the job description, in document order.
   *
   * The description box alone is not enough. LinkedIn renders it *inside* a
   * `<p>`:
   *
   *   <p><span data-testid="expandable-text-box">Notre équipe<p>…</p><ul>…</ul></span></p>
   *
   * and the HTML parser closes that outer `<p>` at the first inner `<p>`, which
   * pops the `<span>` as well. In the real DOM the box therefore holds only the
   * first line, and every following paragraph and list is its *sibling*. The
   * unit that is actually complete is the whole section around the heading.
   *
   * That section is returned from the block that holds the heading onwards, with
   * the heading itself marked to be ignored: cutting *after* the block would
   * throw away the description in the layouts where the heading and the text
   * share one parent.
   */
  function findDescriptionNodes(heading) {
    if (!heading) return null;

    for (const section of ancestors(heading, 8)) {
      if (!section.querySelectorAll) continue;
      const box = Array.prototype.slice
        .call(section.querySelectorAll('*'))
        .filter(isDescriptionBox)
        .find((candidate) => follows(heading, candidate));
      if (!box) continue;

      const children = childNodes(section);
      const start = Math.max(children.indexOf(blockOf(section, heading)), 0);
      const nodes = trimAtNextSection(children.slice(start), heading, box);
      return {
        nodes: nodes,
        ignore: heading,
        container: box,
        section: section,
      };
    }

    // No usable section: fall back to the box on its own.
    const box = findForwardDescription(heading);
    return box ? { nodes: [box], ignore: null, container: box, section: box } : null;
  }

  /**
   * Cut the node list short if the *next* section starts.
   *
   * A section label lives on the heading element, not on the block that wraps it,
   * so the block has to be searched for one. Without this, a section that climbs
   * as high as <body> drags "About the company" in with it.
   */
  function trimAtNextSection(nodes, heading, box) {
    const stop = nodes.findIndex((node) => {
      if (!isElement(node)) return false;

      const next = firstSectionHeading(node);
      if (next && follows(heading, next)) return true;

      // Structurally the same signal, independent of any wording: a *different*
      // text box after ours belongs to the next section.
      if (box && !node.contains(box)) {
        const other = Array.prototype.slice
          .call(node.querySelectorAll ? node.querySelectorAll('*') : [])
          .filter(isDescriptionBox)
          .find((candidate) => follows(box, candidate));
        if (other) return true;
      }
      return false;
    });
    return stop === -1 ? nodes : nodes.slice(0, stop);
  }

  /** First heading in `node` (itself included) naming a known section. */
  function firstSectionHeading(node) {
    const headings = [];
    if (HEADING_TAGS.indexOf(tagOf(node)) !== -1) headings.push(node);
    if (node.querySelectorAll) {
      for (const found of Array.prototype.slice.call(
        node.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], legend')
      )) {
        if (headings.indexOf(found) === -1) headings.push(found);
      }
    }
    return headings.find((candidate) => {
      const label = normalizeLabel(candidate.textContent);
      if (!label) return false;
      return (
        HEADING_LABELS.indexOf(label) !== -1 ||
        SECTION_BREAK_LABELS.indexOf(label) !== -1
      );
    }) || null;
  }

  /** Description container that follows `heading`, closest ancestor first. */
  function findDescriptionAfterHeading(heading) {
    const found = findDescriptionNodes(heading);
    return found && found.container;
  }

  function findForwardDescription(element) {
    let node = element;
    for (let depth = 0; node && depth < 4; depth += 1) {
      let sibling = node.nextElementSibling;
      while (sibling) {
        if (isDescriptionBox(sibling)) return sibling;
        const nested = sibling.querySelectorAll
          ? Array.prototype.slice.call(sibling.querySelectorAll('*')).find(isDescriptionBox)
          : null;
        if (nested) return nested;
        sibling = sibling.nextElementSibling;
      }
      node = node.parentElement;
    }
    return null;
  }

  /** Last resort: the longest description-looking box on a job page. */
  function findLargestDescriptionBox(root, minLength) {
    if (!root || !root.querySelectorAll) return null;
    const threshold = minLength == null ? MIN_LENGTH : minLength;
    const boxes = Array.prototype.slice
      .call(root.querySelectorAll('*'))
      .filter(isDescriptionBox)
      .filter((box) => !shouldSkip(box))
      .filter((box) => !SKIPPED_TEXT_BOXES.test(cleanText(box.textContent)));
    let best = null;
    let bestLength = 0;
    for (const box of boxes) {
      const length = textLength(box);
      if (length > bestLength) {
        best = box;
        bestLength = length;
      }
    }
    return bestLength >= threshold ? best : null;
  }

  /** Heuristic: is this text plausibly a job description and not a teaser? */
  function isPlausibleDescription(text, minLength) {
    const clean = cleanText(text);
    if (clean.length < (minLength == null ? MIN_LENGTH : minLength)) return false;
    if (SKIPPED_TEXT_BOXES.test(clean)) return false;
    return clean.split(/\s+/).length >= 8;
  }

  // ---------------------------------------------------------------------------
  // Serialising the description
  // ---------------------------------------------------------------------------

  /** Depth-first walk of a container (or node list) into "para"/"item" chunks. */
  function collectChunks(element, options) {
    const skipLists = !!(options && options.skipLists);
    const ignore = (options && options.ignore) || null;
    const chunks = [];
    let buffer = '';

    const flush = () => {
      const text = collapseInline(buffer);
      buffer = '';
      if (text) chunks.push({ type: 'para', depth: 0, text: text });
    };

    const visit = (node) => {
      for (const child of Array.isArray(node) ? node : childNodes(node)) {
        if (ignore && child === ignore) continue;
        if (child.nodeType === 3) {
          buffer += child.nodeValue;
          continue;
        }
        if (!isElement(child) || shouldSkip(child)) continue;
        const tag = tagOf(child);

        if (tag === 'br') {
          buffer += PARAGRAPH_BREAK;
          continue;
        }
        if (LIST_TAGS.has(tag)) {
          if (!skipLists) {
            flush();
            pushList(child, tag === 'ol', 0);
          }
          continue;
        }
        if (tag === 'li') {
          if (!skipLists) {
            flush();
            pushListItem(child, 0, '•');
          }
          continue;
        }
        if (tag === 'td' || tag === 'th') {
          buffer = buffer.replace(/[ |]+$/, '');
          visit(child);
          buffer += ' | ';
          continue;
        }
        if (tag === 'hr') {
          flush();
          chunks.push({ type: 'para', depth: 0, text: '---' });
          continue;
        }
        if (BLOCK_TAGS.has(tag)) flush();
        visit(child);
        if (BLOCK_TAGS.has(tag)) flush();
      }
    };

    const pushList = (list, ordered, depth) => {
      let ordinal = 0;
      for (const item of listItems(list)) {
        ordinal += 1;
        pushListItem(item, depth + 1, ordered ? ordinal + '.' : '\u2022');
      }
    };

    // An item's own text excludes any nested list; nested lists become their
    // own chunks so the marker and indent of each level stay intact.
    const pushListItem = (item, depth, marker) => {
      const own = collectChunks(item, { skipLists: true, ignore: ignore });
      const text = own
        .map((chunk) => chunk.text)
        .join(' ')
        .replace(/[ |]+$/, '')
        .replace(/^(\u0000)+|(\u0000)+$/g, '')
        .replace(/\u0000{3,}/g, '\u0000\u0000')
        .trim();
      if (text) chunks.push({ type: 'item', depth: depth, marker: marker, text: text });

      for (const list of Array.prototype.slice.call(item.children || [])) {
        if (LIST_TAGS.has(tagOf(list))) pushList(list, tagOf(list) === 'ol', depth);
      }
    };

    if (isElement(element) && LIST_TAGS.has(tagOf(element))) {
      // Called on a list itself: its items belong to the outer level.
      pushList(element, tagOf(element) === 'ol', 0);
      return chunks;
    }

    visit(element);
    flush();
    return chunks;
  }

  function chunksToText(chunks) {
    let out = '';
    let previous = null;
    for (const chunk of chunks) {
      const isItem = chunk.type === 'item';
      const indent = chunk.depth > 0 ? new Array(chunk.depth).join('  ') : '';
      const body = isItem ? chunk.marker + ' ' + chunk.text : chunk.text;
      // A <br> splits a chunk; continuation lines line up under the text, not
      // under the bullet.
      const hang = isItem ? indent + new Array(String(chunk.marker).length + 2).join(' ') : indent;
      const rendered = body
        .split(PARAGRAPH_BREAK)
        .map((line, index) => (index === 0 ? indent + line : hang + line.trim()))
        .join('\n');
      if (previous) {
        const tight = previous.type === 'item' && isItem;
        out += tight ? '\n' : '\n\n';
      }
      out += rendered;
      previous = chunk;
    }
    return cleanText(out);
  }

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const HTML_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  const HTML_LIST_TAGS = new Set(['ul', 'ol']);
  const HTML_VOID_TAGS = new Set(['br', 'hr', 'img']);

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"]/g,
      (char) => HTML_ESCAPES[char]
    );
  }

  /**
   * Rich-text version of the description, for pasting into Docs/Notion/Word.
   * Keeps emphasis, links, headings and lists; drops everything else.
   */
  function serializeHtml(element, options) {
    const ignore = (options && options.ignore) || null;
    const visit = (node) => {
      let out = '';
      const children = Array.isArray(node) ? node : childNodes(node);
      for (const child of children) {
        if (ignore && child === ignore) continue;
        if (child.nodeType === 3) {
          out += escapeHtml(String(child.nodeValue).replace(/\s+/g, ' '));
          continue;
        }
        if (!isElement(child) || shouldSkip(child)) continue;
        const tag = tagOf(child);

        if (HTML_VOID_TAGS.has(tag)) {
          out += tag === 'hr' ? '\n<hr />\n' : '<br />';
          continue;
        }
        if (HTML_LIST_TAGS.has(tag)) {
          // One newline between items, not a blank one.
          const items = visit(child)
            .replace(/\s*\n\s*/g, '\n')
            .trim();
          out += '\n<' + tag + '>\n' + items + '\n</' + tag + '>\n';
          continue;
        }
        if (tag === 'li' || HTML_BLOCK_TAGS.has(tag)) {
          const body = visit(child).trim();
          if (body) out += '\n<' + tag + '>' + body + '</' + tag + '>\n';
          continue;
        }
        if (tag === 'a') {
          const body = visit(child).trim();
          const href = child.getAttribute('href');
          out += href ? '<a href="' + escapeHtml(href) + '">' + body + '</a>' : body;
          continue;
        }
        out += visit(child);
      }
      return out;
    };

    return visit(element)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Click a "…more" / "Show more" toggle so a truncated description can be read.
   * Returns true when something was clicked.
   *
   * The scope cannot be the text box or a <section>: LinkedIn renders the box
   * inside a <p>, so the parser hoists the toggle out and it ends up as a
   * sibling of the box, several wrappers up. Search the box, then walk out
   * through its ancestors, and only then give up on the document.
   */
  function expandDescription(root) {
    if (!root || !root.querySelectorAll) return false;

    const scopes = [root];
    for (let ancestor = root.parentElement, depth = 0; ancestor && depth < 4; ancestor = ancestor.parentElement) {
      depth += 1;
      scopes.push(ancestor);
    }
    const document = root.ownerDocument;
    if (document && document !== root) scopes.push(document);

    for (const scope of scopes) {
      if (!scope || !scope.querySelectorAll) continue;
      const controls = Array.prototype.slice.call(
        scope.querySelectorAll('button, a, [role="button"]')
      );
      const control = controls.find(isExpandControl) || controls.find(hasExpandLabel);
      if (!control || typeof control.click !== 'function') continue;
      control.click();
      return true;
    }
    return false;
  }

  /** The stable handle on LinkedIn's own toggle. */
  function isExpandControl(element) {
    const testid = element.getAttribute && element.getAttribute('data-testid');
    return testid === 'expandable-text-button';
  }

  function hasExpandLabel(element) {
    const text = normalizeLabel(element.textContent);
    const label = normalizeLabel(element.getAttribute('aria-label'));
    return EXPAND_LABELS.test(text) || EXPAND_LABELS.test(label);
  }

  /**
   * Extract the job description from a LinkedIn job page.
   * Never throws: returns `{ found: false, reason }` when nothing matches.
   */
  function extract(doc, options) {
    const settings = options || {};
    const minLength = settings.minLength == null ? MIN_LENGTH : settings.minLength;
    const root = settings.root || (doc && doc.body) || doc;
    if (!root) return { found: false, reason: 'no-document' };

    try {
      const heading = findHeading(root);
      const located = heading ? findDescriptionNodes(heading) : null;
      const ignore = located ? located.ignore : null;

      let nodes = (located && located.nodes) || [];
      let container = located && located.container;
      if (!nodes.length) {
        // No heading to anchor a section to: take the biggest box on the page.
        const box = findLargestDescriptionBox(root, minLength);
        if (box) {
          nodes = [box];
          container = box;
        }
      }
      if (!nodes.length) {
        return { found: false, reason: 'no-container', heading: !!heading };
      }

      const chunks = collectChunks(nodes, { ignore: ignore });
      const text = chunksToText(chunks);
      if (!isPlausibleDescription(text, minLength)) {
        return { found: false, reason: 'too-short', heading: !!heading };
      }

      return {
        found: true,
        text: text,
        html: serializeHtml(nodes, { ignore: ignore }),
        container: container,
        heading: heading,
        meta: extractMeta(doc, heading),
      };
    } catch (error) {
      // Graceful, but not silent: a broken page should be diagnosable.
      if (global.console && global.console.warn) {
        global.console.warn('[job-copier] extraction failed', error);
      }
      return { found: false, reason: 'error', error: String((error && error.message) || error) };
    }
  }

  function formatLocation(location) {
    if (!location) return '';
    if (typeof location === 'string') return location;
    if (Array.isArray(location)) return location.map(formatLocation).filter(Boolean).join(' / ');
    const address = location.address || location;
    if (typeof address === 'string') return address;
    if (!address || typeof address !== 'object') return '';
    return [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean)
      .join(', ');
  }

  /**
   * The card at the top of a job page. BEM names, not hashed ones, so they
   * survive a LinkedIn deployment even when the utility classes churn.
   */
  const TOP_CARD = {
    title: [
      'h1.top-card-layout__title',
      'h2.top-card-layout__title',
      '.top-card-layout__title',
      'h1.jobs-top-card__title',
      'h2.jobs-top-card__title',
      '[data-testid="job-title"]',
    ],
    company: [
      'a.topcard__org-name-link',
      '.top-card-layout__second-subline a',
      'h4.top-card-layout__second-subline',
      '[data-testid="company-name"]',
    ],
    location: [
      '.topcard__flavor--bullet',
      '.top-card-layout__first-subline',
      '[data-testid="job-location"]',
    ],
  };

  function firstMatch(root, selectors) {
    if (!root || !root.querySelector) return null;
    for (const selector of selectors) {
      let found = null;
      try {
        found = root.querySelector(selector);
      } catch (error) {
        continue; // an invalid selector must not sink the whole extraction
      }
      if (found) return found;
    }
    return null;
  }

  /** Text of a DOM node or a JSON value (string, number, array, named object). */
  function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return collapseInline(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object' && typeof value.textContent === 'string') {
      return collapseInline(value.textContent);
    }
    if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' / ');
    if (typeof value === 'object') {
      return textOf(value.name || value.legalName || value.value || '');
    }
    return '';
  }

  /** LinkedIn packs several facts into one bullet: "City · Remote · Full-time". */
  function firstSegment(value) {
    return textOf(value).split(/\s*[\u00b7\u2022|]\s*/)[0].trim();
  }

  /** Depth-limited search for a schema.org JobPosting inside any ld+json shape. */
  function findJobPosting(doc) {
    for (const script of Array.prototype.slice.call(
      doc.querySelectorAll('script[type="application/ld+json"]')
    )) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (error) {
        continue;
      }
      const found = searchJobPosting(data, 0);
      if (found) return found;
    }
    return null;
  }

  function searchJobPosting(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = searchJobPosting(child, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    const isPosting = types.some(
      (value) => typeof value === 'string' && /jobposting/i.test(value)
    );
    const looksLikeOne = node.hiringOrganization || node.jobLocation;
    if (isPosting || looksLikeOne) return node;
    // @graph, mainEntity, itemListElement, …
    for (const key of ['@graph', 'mainEntity', 'itemListElement', 'about']) {
      const found = searchJobPosting(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function formatLocation(location) {
    if (!location) return '';
    if (Array.isArray(location)) {
      return location.map(formatLocation).filter(Boolean).join(' / ');
    }
    if (typeof location === 'string') return collapseInline(location);
    if (typeof location !== 'object') return '';

    const address = location.address || location;
    if (typeof address === 'string') return collapseInline(address);
    if (!address || typeof address !== 'object') return '';

    const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean)
      .map((part) => (typeof part === 'string' ? part : textOf(part)))
      .filter(Boolean);
    if (parts.length) return collapseInline(parts.join(', '));
    return textOf(location.name) || textOf(location);
  }

  /** A section label is never a job title, whatever the fallback found. */
  function isSectionLabel(value) {
    const label = normalizeLabel(value);
    if (!label) return true;
    return (
      HEADING_LABELS.indexOf(label) !== -1 ||
      SECTION_BREAK_LABELS.indexOf(label) !== -1
    );
  }

  /**
   * Job title / company / location.
   *
   * Order: the schema.org JobPosting LinkedIn publishes (independent of the UI
   * *and* of hashed classes), then Open Graph, then the top card of the page.
   *
   * The description heading is never used. On a page that carries no structured
   * data it is the only heading around, so the obvious "first heading" fallback
   * confidently reports the title as "About the job" — a string that is
   * guaranteed to be wrong on every posting.
   */
  function extractMeta(doc, heading) {
    const meta = { title: '', company: '', location: '', source: '' };
    if (!doc || !doc.querySelectorAll) return meta;

    const posting = findJobPosting(doc);
    if (posting) {
      meta.title = textOf(posting.title || posting.name || posting.headline);
      const organization =
        posting.hiringOrganization || posting.organization || posting.employer;
      meta.company = textOf(organization);
      meta.location = formatLocation(posting.jobLocation || posting.applicantLocationRequirements);
      if (meta.title || meta.company) meta.source = 'ld+json';
    }

    if (!meta.title) {
      // og:title looks like "Full Stack Developer at Galadrim | LinkedIn".
      const og = doc.querySelector('meta[property="og:title"]');
      if (og) {
        meta.title = (og.getAttribute('content') || '')
          .split('|')[0]
          .replace(/\s+(?:at|@)\s+.*$/, '')
          .trim();
        if (meta.title) meta.source = meta.source || 'og';
      }
    }
    if (!meta.company) {
      const og = doc.querySelector('meta[property="og:description"]');
      if (og) {
        const match = /(?:at|@)\s+([^\u00b7|]+)/i.exec(og.getAttribute('content') || '');
        if (match) meta.company = match[1].trim();
      }
    }
    if (!meta.title) {
      const card = firstMatch(doc, TOP_CARD.title);
      if (card) {
        meta.title = textOf(card);
        meta.source = meta.source || 'top-card';
      }
    }
    if (!meta.company) {
      const card = firstMatch(doc, TOP_CARD.company);
      if (card) {
        const value = firstSegment(card.textContent);
        if (value) {
          meta.company = value;
          meta.source = meta.source || 'top-card';
        }
      }
    }
    if (!meta.location) {
      const card = firstMatch(doc, TOP_CARD.location);
      if (card) {
        const value = firstSegment(card.textContent);
        if (value) {
          meta.location = value;
          meta.source = meta.source || 'top-card';
        }
      }
    }
    if (!meta.title) {
      // Last resort: the document title, e.g.
      // "Werkstudent (m/f/d) Softwareentwicklung bei SC Media House | LinkedIn".
      const raw = (doc.title || '').split('|')[0].replace(/\s+-\s+LinkedIn.*$/i, '');
      if (raw) {
        const split = raw.match(/^(.*?)\s+(?:bei|at)\s+([^,|]{2,60})$/i);
        if (split) {
          meta.title = split[1].trim();
          if (!meta.company) meta.company = split[2].trim();
        } else {
          meta.title = raw.trim();
        }
        meta.source = meta.source || 'document-title';
      }
    }

    meta.title = cleanText(meta.title || '');
    meta.company = cleanText(meta.company || '');
    meta.location = cleanText(meta.location || '');

    if (isSectionLabel(meta.title)) meta.title = '';
    if (isSectionLabel(meta.company)) meta.company = '';
    return meta;
  }

  /** Render the optional structured header shown above the description. */
  function formatHeader(meta) {
    if (!meta) return '';
    const lines = [];
    if (meta.title) lines.push('Job: ' + meta.title);
    if (meta.company) lines.push('Company: ' + meta.company);
    if (meta.location) lines.push('Location: ' + meta.location);
    return lines.join('\n');
  }

  /** LinkedIn job page? Works for /jobs/view/… , /jobs/guest/… and collections. */
  function isJobPage(url) {
    const href = String((url && url.href) || url || '');
    if (!href) return false;
    const path = (/(?:\/\/[^/]+)?(\/[^?#]*)/.exec(href) || [, ''])[1] || '';
    return /^\/jobs\/(view|guest|collections|search)\b/.test(path) || /^\/jobs\/[^/]+\/?$/.test(path);
  }

  /** Is the copy event coming from a field the user is typing in? */
  function isEditableTarget(target) {
    if (!target || !target.closest) return false;
    if (target.isContentEditable) return true;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
      return true;
    }
    return false;
  }

  /**
   * The spec's decision tree, in one pure function so it can be unit tested.
   * `override` forces a copy (button, context menu, keyboard shortcut).
   */
  function shouldInterceptCopy(state) {
    const s = state || {};
    if (s.override) return true;
    if (s.isEditableTarget) return false;
    if (s.hasSelection) return false;
    return !!s.hasDescription;
  }

  const JobExtractor = {
    MIN_LENGTH: MIN_LENGTH,
    HEADING_LABELS: HEADING_LABELS,
    cleanText: cleanText,
    collapseInline: collapseInline,
    normalizeLabel: normalizeLabel,
    findHeading: findHeading,
    findDescriptionAfterHeading: findDescriptionAfterHeading,
    findLargestDescriptionBox: findLargestDescriptionBox,
    isPlausibleDescription: isPlausibleDescription,
    collectChunks: collectChunks,
    chunksToText: chunksToText,
    serializeHtml: serializeHtml,
    expandDescription: expandDescription,
    extract: extract,
    extractMeta: extractMeta,
    formatHeader: formatHeader,
    isJobPage: isJobPage,
    isEditableTarget: isEditableTarget,
    shouldInterceptCopy: shouldInterceptCopy,
  };

  global.JobExtractor = JobExtractor;
  if (typeof module !== 'undefined' && module.exports) module.exports = JobExtractor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
