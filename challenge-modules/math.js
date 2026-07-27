function hasMathTypesetter() {
  return Boolean(
    typeof window !== "undefined" &&
    window.MathJax &&
    typeof window.MathJax.typesetPromise === "function"
  );
}

function markMathPending(el) {
  if (!el || !el.dataset) return;
  el.dataset.mathPending = "1";
}

function clearMathPending(el) {
  if (!el || !el.dataset) return;
  delete el.dataset.mathPending;
}

const mathRenderRevisions = new WeakMap();
const mathQueuedRevisions = new WeakMap();
const mathCommitCallbacks = new WeakMap();
let mathQueueDepth = 0;
let mathOperationsActive = 0;
let mathDomMutationDepth = 0;

function nextMathRevision(el) {
  const next = (mathRenderRevisions.get(el) || 0) + 1;
  mathRenderRevisions.set(el, next);
  if (el?.dataset) el.dataset.mathRevision = String(next);
  return next;
}

function currentMathRevision(el) {
  return mathRenderRevisions.get(el) || 0;
}

function addMathCommitCallback(el, revision, callback) {
  if (!el || typeof callback !== "function") return;
  const current = mathCommitCallbacks.get(el);
  if (current?.revision === revision) {
    current.callbacks.push(callback);
    return;
  }
  mathCommitCallbacks.set(el, { revision, callbacks: [callback] });
}

function notifyMathRenderCommitted(el, revision) {
  const pending = mathCommitCallbacks.get(el);
  if (
    !pending
    || pending.revision !== revision
    || currentMathRevision(el) !== revision
    || isDetachedMathNode(el)
  ) {
    return;
  }
  mathCommitCallbacks.delete(el);
  pending.callbacks.forEach((callback) => callback());
}

function isDetachedMathNode(el) {
  // HTMLElement#isConnected is authoritative in the browser. Test doubles and
  // host objects without that property are deliberately treated as usable.
  return Boolean(el && typeof el.isConnected === "boolean" && !el.isConnected);
}

function clearRegisteredMath(el, mj = window?.MathJax) {
  if (!el || !mj || typeof mj.typesetClear !== "function") return;
  try {
    mj.typesetClear([el]);
  } catch (_err) {
    // Clearing stale MathItems is best-effort. A broken clear must not strand
    // the replacement DOM or its readiness callback.
  }
}

function enqueueMathOperation(operation) {
  mathQueueDepth += 1;
  mathTypesetQueue = mathTypesetQueue
    .then(async () => {
      mathOperationsActive += 1;
      try {
        return await operation();
      } finally {
        mathOperationsActive = Math.max(0, mathOperationsActive - 1);
      }
    })
    .catch(() => {})
    .finally(() => {
      mathQueueDepth = Math.max(0, mathQueueDepth - 1);
    });
  return mathTypesetQueue;
}

function markMathTypesetComplete(el, revision) {
  if (!el || currentMathRevision(el) !== revision) return;
  clearMathPending(el);
  if (el.dataset) el.dataset.mathTypeset = "1";
}

function markMathTypesetFailed(el, revision) {
  if (!el || currentMathRevision(el) !== revision) return;
  markMathPending(el);
  if (el.dataset) delete el.dataset.mathTypeset;
}

function runTypesetForRevision(el, revision, { clearFirst = true } = {}) {
  const mj = window?.MathJax;
  if (!mj || typeof mj.typesetPromise !== "function") {
    markMathTypesetFailed(el, revision);
    return Promise.resolve();
  }
  if (clearFirst) clearRegisteredMath(el, mj);
  if (currentMathRevision(el) !== revision || isDetachedMathNode(el)) {
    return Promise.resolve();
  }
  return Promise.resolve()
    .then(() => mj.typesetPromise([el]))
    .then(() => {
      markMathTypesetComplete(el, revision);
    })
    .catch(() => {
      markMathTypesetFailed(el, revision);
    })
    .finally(() => {
      notifyMathRenderCommitted(el, revision);
    });
}

function enqueueMathRevision(el, revision, operation) {
  if (mathQueuedRevisions.get(el) === revision) return false;
  mathQueuedRevisions.set(el, revision);
  enqueueMathOperation(async () => {
    try {
      await operation();
    } finally {
      if (mathQueuedRevisions.get(el) === revision) {
        mathQueuedRevisions.delete(el);
      }
    }
  });
  return true;
}

function queueMathTypeset(el, options = {}) {
  if (!el || typeof window === "undefined") return false;
  const mj = window.MathJax;
  if (!mj || typeof mj.typesetPromise !== "function") {
    markMathPending(el);
    return false;
  }
  const revision = Number.isInteger(options.revision)
    ? options.revision
    : (currentMathRevision(el) || nextMathRevision(el));
  markMathPending(el);
  enqueueMathRevision(el, revision, () => runTypesetForRevision(el, revision, {
    clearFirst: options.clearFirst !== false
  }));
  return true;
}

function scheduleMathRender(el, updateDom, shouldTypeset, onCommitted = null) {
  const revision = nextMathRevision(el);
  if (shouldTypeset) addMathCommitCallback(el, revision, onCommitted);
  if (el?.dataset) delete el.dataset.mathTypeset;
  if (shouldTypeset) markMathPending(el);
  else clearMathPending(el);

  const applyAndMaybeTypeset = (clearFirst) => {
    const mj = window?.MathJax;
    if (clearFirst) clearRegisteredMath(el, mj);
    if (currentMathRevision(el) !== revision || isDetachedMathNode(el)) {
      return Promise.resolve();
    }
    updateDom();
    if (!shouldTypeset) {
      if (typeof onCommitted === "function") onCommitted();
      return Promise.resolve();
    }
    return runTypesetForRevision(el, revision, { clearFirst: false });
  };

  // Preserve the synchronous DOM behavior used throughout the UI when there is
  // no MathJax operation in flight. Once a typeset has started, both clearing
  // old MathItems and replacing their source DOM are serialized behind it.
  if (mathOperationsActive === 0 || mathDomMutationDepth > 0) {
    clearRegisteredMath(el);
    // Populate newly created nodes synchronously even before their parent
    // appends them (the tutor follows this pattern). The queued typeset still
    // verifies connectivity, so nodes removed after rendering are skipped.
    if (currentMathRevision(el) === revision) {
      updateDom();
      if (!shouldTypeset && typeof onCommitted === "function") onCommitted();
    }
    if (shouldTypeset) {
      if (!hasMathTypesetter()) {
        markMathTypesetFailed(el, revision);
        return false;
      }
      enqueueMathRevision(el, revision, () => runTypesetForRevision(el, revision, {
        clearFirst: false
      }));
    }
    return true;
  }

  enqueueMathRevision(el, revision, () => applyAndMaybeTypeset(true));
  return true;
}

function invalidateMathTree(root) {
  if (!root) return;
  const nodes = [root];
  if (typeof root.querySelectorAll === "function") {
    nodes.push(...Array.from(root.querySelectorAll("[data-math-revision], mjx-container")));
  } else if (Array.isArray(root.children)) {
    nodes.push(...root.children);
  }
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") return;
    nextMathRevision(node);
    clearMathPending(node);
    if (node.dataset) delete node.dataset.mathTypeset;
  });
}

function replaceMathContainer(root, updateDom) {
  if (!root || typeof updateDom !== "function") return Promise.resolve();
  invalidateMathTree(root);
  const revision = currentMathRevision(root);
  const replace = () => {
    clearRegisteredMath(root);
    if (currentMathRevision(root) !== revision || isDetachedMathNode(root)) return;
    mathDomMutationDepth += 1;
    try {
      updateDom();
    } finally {
      mathDomMutationDepth = Math.max(0, mathDomMutationDepth - 1);
    }
  };
  if (mathOperationsActive === 0) {
    replace();
    return Promise.resolve();
  }
  return enqueueMathOperation(replace);
}

async function flushPendingMathTypeset(elements = null) {
  const list = Array.isArray(elements)
    ? elements
    : Array.from(document.querySelectorAll("[data-math-pending='1']"));
  for (const el of list) {
    if (isDetachedMathNode(el)) {
      clearMathPending(el);
      continue;
    }
    queueMathTypeset(el);
  }
  // A queued operation can append more work while it runs (for example, a
  // container replacement that creates and schedules five choice buttons).
  // Keep draining until the queue tail itself is stable.
  let tail;
  do {
    tail = mathTypesetQueue;
    await tail;
  } while (tail !== mathTypesetQueue);
}

function schedulePendingMathRetry() {
  if (mathPendingRetryTimer) return;
  mathPendingRetryTimer = setInterval(() => {
    if (!hasMathTypesetter()) return;
    clearInterval(mathPendingRetryTimer);
    mathPendingRetryTimer = null;
    void flushPendingMathTypeset();
  }, 150);
}

function bindMathJaxReadyRetry() {
  if (typeof window === "undefined") return;
  if (hasMathTypesetter()) {
    void flushPendingMathTypeset();
    return;
  }
  schedulePendingMathRetry();
  const startup = window.MathJax?.startup;
  if (startup?.promise && typeof startup.promise.then === "function") {
    startup.promise
      .then(() => {
        void flushPendingMathTypeset();
      })
      .catch(() => {});
  }
}

function hasRenderableMathSyntax(text) {
  const s = String(text || "");
  return /(?<!\\)\$|\\\(|\\\[|\\[A-Za-z]+|[_^]|(?<!\\)[{}]/.test(s);
}

function hasAssistantMarkdownSyntax(text) {
  const s = String(text || "");
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) || /\*\*[^*\n]+?\*\*/.test(s) || /(^|[^*])\*[^*\n]+?\*(?!\*)/.test(s);
}

const PROBLEM_DIAGRAM_FIELDS = ["diagramPng", "diagramSvg", "diagramPngs", "diagramSvgs"];
const PROBLEM_DIAGRAM_MENTION_RE =
  /\b(?:(?:in|from|using|use|shown in|according to|based on)\s+(?:the\s+)?(?:figure|diagram|graph|grid|chart|table)|(?:figure|diagram|graph|grid|chart|table)\s+(?:shown|below|above|provided|supplied|shows?|depicts?|on\s+(?:the\s+)?(?:left|right))|(?:see|refer to)\s+(?:the\s+)?(?:figure|diagram|graph|grid|chart|table)|accompanying\s+(?:(?:paragraph|text)\s+and\s+)?(?:figure|diagram|graph|grid|chart|table)|grid\s+shown|positions?\s+shown|pictured\s+(?:below|above|on\s+(?:the\s+)?(?:left|right)))\b/i;
const PROBLEM_AS_SHOWN_RE =
  /\b(?:as shown(?:\s+(?:below|above))?(?=\s*(?:[,.;:)]|$)|\s+in\b)|shown\s+(?:(?:on\s+(?:the\s+)?(?:left|right))|below|above))\b/i;
const PROBLEM_PASSIVE_SHOWN_RE =
  /\b(?:is|are|was|were)\s+shown(?!\s+(?:that|to)\b)(?:\s+(?:below|above))?\b/i;
const PROBLEM_EMBEDDED_VISUAL_RE =
  /\\begin\{(?:array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|aligned|gathered)\}/;

function problemHasDiagramReference(problem) {
  return PROBLEM_DIAGRAM_FIELDS.some((field) => {
    const value = problem?.[field];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== "";
  });
}

function problemRequiresExternalVisual(problem) {
  if (!problem || problemHasDiagramReference(problem)) return false;
  const prompt = String(problem.prompt || "");
  if (PROBLEM_EMBEDDED_VISUAL_RE.test(prompt)) return false;
  return (
    PROBLEM_DIAGRAM_MENTION_RE.test(prompt)
    || PROBLEM_AS_SHOWN_RE.test(prompt)
    || PROBLEM_PASSIVE_SHOWN_RE.test(prompt)
  );
}

function stabilizePlainPunctuation(text) {
  // Keep punctuation visually attached to the preceding token when wrapping.
  // \u2060 is WORD JOINER (zero-width, non-breaking).
  // Never inject between TeX escapes like "\," (that breaks MathJax parsing).
  return String(text || "").replace(
    /([^\\\s])([,.;:!?])/g,
    (match, previous, punctuation, offset, source) => {
      const next = String(source || "")[Number(offset) + String(match).length] || "";
      // Decimal points and thousands separators are part of the number, not
      // prose punctuation. Keep copied currency values byte-for-byte clean.
      if (
        (punctuation === "." || punctuation === ",")
        && /\d/.test(previous)
        && /\d/.test(next)
      ) {
        return match;
      }
      return `${previous}\u2060${punctuation}`;
    }
  );
}

function stabilizePunctuationWrapping(text) {
  return splitMathSegments(text)
    .map((part) => (
      part.kind === "math" ? part.value : stabilizePlainPunctuation(part.value)
    ))
    .join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitMathSegments(text) {
  const source = String(text || "");
  const parts = [];
  const isEscaped = (index) => {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) {
      slashes += 1;
    }
    return slashes % 2 === 1;
  };
  const pushPlain = (start, end) => {
    if (end > start) parts.push({ kind: "plain", value: source.slice(start, end) });
  };

  let plainStart = 0;
  let index = 0;
  while (index < source.length) {
    let closeToken = "";
    let openLength = 0;
    if (
      source[index] === "$"
      && !isEscaped(index)
      && source[index + 1] === "$"
      && !isEscaped(index + 1)
    ) {
      closeToken = "$$";
      openLength = 2;
    } else if (source[index] === "$" && !isEscaped(index)) {
      closeToken = "$";
      openLength = 1;
    } else if (
      source[index] === "\\"
      && !isEscaped(index)
      && (source[index + 1] === "(" || source[index + 1] === "[")
    ) {
      closeToken = source[index + 1] === "(" ? "\\)" : "\\]";
      openLength = 2;
    } else {
      index += 1;
      continue;
    }

    let close = index + openLength;
    while (close < source.length) {
      if (source.startsWith(closeToken, close) && !isEscaped(close)) break;
      close += 1;
    }
    if (close >= source.length) {
      index += openLength;
      continue;
    }
    pushPlain(plainStart, index);
    const end = close + closeToken.length;
    parts.push({ kind: "math", value: source.slice(index, end) });
    index = end;
    plainStart = end;
  }
  pushPlain(plainStart, source.length);
  return parts;
}

function hasUndelimitedMathSyntax(text) {
  const plain = splitMathSegments(text)
    .filter((part) => part.kind === "plain")
    .map((part) => part.value)
    .join(" ");
  if (!plain.trim()) return false;
  const source = plain.replace(/\\\$/g, " ");
  return (
    /\\(?!\$)[A-Za-z]+/.test(source)
    || /(?:^|[^\\])(?:[A-Za-z0-9)\]}])\s*(?:\^|_)\s*(?:\{[^{}]+\}|[A-Za-z0-9+\-]+)/.test(source)
    || /[≤≥≠∞∑∫√πθλμσφω→←↔∈⊂⊆⊃⊇]/.test(source)
  );
}

function isEscapedAt(source, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function hasMalformedMathSyntax(text) {
  const source = String(text || "");
  const delimiters = [];
  let braceDepth = 0;

  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "$" && !isEscapedAt(source, i)) {
      const token = source[i + 1] === "$" && !isEscapedAt(source, i + 1)
        ? "$$"
        : "$";
      if (token === "$$") i += 1;
      const top = delimiters[delimiters.length - 1];
      if (top === token) delimiters.pop();
      else if (top) return true;
      else delimiters.push(token);
      continue;
    }
    if (source[i] === "\\" && !isEscapedAt(source, i)) {
      const token = source.slice(i, i + 2);
      if (token === "\\(" || token === "\\[") {
        if (delimiters.length) return true;
        delimiters.push(token);
        i += 1;
        continue;
      }
      if (token === "\\)" || token === "\\]") {
        const expected = token === "\\)" ? "\\(" : "\\[";
        if (delimiters.pop() !== expected) return true;
        i += 1;
        continue;
      }
    }
    if ((source[i] === "{" || source[i] === "}") && !isEscapedAt(source, i)) {
      braceDepth += source[i] === "{" ? 1 : -1;
      if (braceDepth < 0) return true;
    }
  }
  if (delimiters.length || braceDepth !== 0) return true;

  const environments = [];
  const environmentPattern = /\\(begin|end)\{([^{}]+)\}/g;
  let match;
  while ((match = environmentPattern.exec(source)) !== null) {
    if (match[1] === "begin") {
      environments.push(match[2]);
    } else if (environments.pop() !== match[2]) {
      return true;
    }
  }
  if (environments.length) return true;

  return /(?:\^|_)\s*(?=(?:\$|\\\)|\\\]|[}\])]|$))/.test(source);
}

function renderInlineMarkdownHtml(text) {
  const safeToken = "__CHAT_ESCAPED_ASTERISK__";
  let out = escapeHtml(stabilizePlainPunctuation(text)).replace(/\\\*/g, safeToken);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(new RegExp(safeToken, "g"), "*");
  return out;
}

function renderAssistantMarkdownLineHtml(line) {
  const headingMatch = String(line || "").match(/^\s{0,3}(#{1,3})\s+(.+)$/);
  const level = headingMatch ? headingMatch[1].length : 0;
  const text = headingMatch ? headingMatch[2] : String(line || "");
  const segments = splitMathSegments(text);
  const inner = segments.map((part) => {
    if (part.kind === "math") return escapeHtml(part.value);
    return renderInlineMarkdownHtml(part.value);
  }).join("");
  if (level > 0) {
    return `<span class="chat-md-heading chat-md-h${level}">${inner}</span>`;
  }
  return inner;
}

function renderAssistantMarkdownText(el, text) {
  if (!el) return;
  // Tutor output is already authored mathematical prose. Avoid contest OCR
  // guesses here (T/2 -> pi/2, f-1 -> inverse notation) and preserve newlines.
  const sanitized = normalizeUnsupportedLatexEnvironments(String(text || ""));
  const renderKey = `m::${sanitized}`;
  if (el.dataset.renderKey === renderKey) return;
  const html = splitMathSegments(sanitized).map((part) => {
    if (part.kind === "math") return escapeHtml(part.value);
    return part.value
      .split(/\r?\n/)
      .map((line) => renderAssistantMarkdownLineHtml(line))
      .join("<br>");
  }).join("");
  el.dataset.renderKey = renderKey;
  const hasMath = hasRenderableMathSyntax(sanitized);
  const scheduled = scheduleMathRender(el, () => {
    el.innerHTML = html;
  }, hasMath);
  if (hasMath && (!scheduled || !hasMathTypesetter())) {
    schedulePendingMathRetry();
  }
}

function renderMathText(el, text, options = {}) {
  const inlineOnly = Boolean(options.inlineOnly);
  const force = Boolean(options.force);
  const onCommitted = typeof options.onCommitted === "function"
    ? options.onCommitted
    : null;
  if (!el) return;
  let nextText = text || "";
  if (inlineOnly) {
    nextText = String(nextText)
      .replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => `$${inner}$`)
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\\(${inner}\\)`);
  }
  const displayText = stabilizePunctuationWrapping(nextText);
  const renderKey = `${inlineOnly ? "i" : "b"}::${nextText}`;
  if (!force && el.dataset.renderKey === renderKey) {
    if (el.dataset.mathPending === "1") {
      addMathCommitCallback(el, currentMathRevision(el), onCommitted);
    } else {
      onCommitted?.();
    }
    return;
  }
  const renderPlain = !hasRenderableMathSyntax(nextText);
  el.dataset.renderKey = renderKey;
  const scheduled = scheduleMathRender(el, () => {
    el.textContent = renderPlain ? displayText.replace(/\\\$/g, "$") : displayText;
  }, !renderPlain, onCommitted);
  if (!renderPlain && (!scheduled || !hasMathTypesetter())) {
    schedulePendingMathRetry();
  }
}

function normalizeChoiceMath(text) {
  const normalizeAmbiguousChoice = (value) => {
    let out = String(value || "").trim();
    if (!out) return out;

    out = out
      .replace(/\b(?:GO ON TO THE NEXT P ?AGE\.?|SCRATCH WORK|ANSWER KEY)\b.*$/i, "")
      .replace(/\b(?:Linear Algebra|References|Multivariable Calculus|Euclidean Geometry|General Topology|Complex Analysis|Differential Equations)\s*#?\d*\s*$/i, "")
      .replace(/\bReferences?\s*:?\s*\d*\s*$/i, "")
      .replace(/\bProbability\s*#?\d*\s*$/i, "")
      .trim();

    out = out
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s*$/, (_m, sign, n, d) => `${sign}\\frac{${n}}{${d}}`)
      .replace(/^([+-]?)\s*e\s+(\d+)\s*$/i, (_m, sign, p) => `${sign}e^{${p}}`)
      .replace(/^([+-]?)\s*e\s+(\d+)\s+(\d+)\s*$/i, (_m, sign, n, d) => `${sign}e^{\\frac{${n}}{${d}}}`)
      // OCR often emits symbolic exponent forms like "e y/x =cx" or "e-x/y =cx".
      .replace(
        /^([+-]?)\s*e\s*([+-]?\s*[A-Za-z0-9\\{}()]+\s*\/\s*[A-Za-z0-9\\{}()]+)\s*=\s*(.+)$/i,
        (_m, sign, exp, rhs) => `${sign}e^{${String(exp || "").replace(/\s+/g, "")}}=${String(rhs || "").trim()}`
      )
      .replace(
        /^([+-]?)\s*e([+-]\s*[A-Za-z0-9\\{}()]+\s*\/\s*[A-Za-z0-9\\{}()]+)\s*=\s*(.+)$/i,
        (_m, sign, exp, rhs) => `${sign}e^{${String(exp || "").replace(/\s+/g, "")}}=${String(rhs || "").trim()}`
      )
      .replace(/^([+-]?)\s*\\pi\s+(\d+)\s*$/i, (_m, sign, d) => `${sign}\\frac{\\pi}{${d}}`)
      .replace(/^([+-]?)\s*(\d+)\s+\\pi\s*$/i, (_m, sign, n) => `${sign}${n}\\pi`)
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s+\$?\\sqrt\{?\s*(\d+)\s*\}?\$?\s*$/i, (_m, sign, n, d, r) => {
        const numerator = Number(n) === 1 ? `\\sqrt{${r}}` : `${n}\\sqrt{${r}}`;
        return `${sign}\\frac{${numerator}}{${d}}`;
      })
      .replace(/^([+-]?)\s*(\d+)\s+\$?\\sqrt\{?\s*(\d+)\s*\}?\$?\s*$/i, (_m, sign, n, r) => `${sign}${n}\\sqrt{${r}}`)
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s+\\sqrt\{?\s*(\d+)\s*\}?\s*$/i, (_m, sign, n, d, r) => {
        const numerator = Number(n) === 1 ? `\\sqrt{${r}}` : `${n}\\sqrt{${r}}`;
        return `${sign}\\frac{${numerator}}{${d}}`;
      });

    return out.trim();
  };

  const raw = normalizeAmbiguousChoice(sanitizeForMathJax(text)).trim();
  if (!raw) return raw;

  // Display math inside buttons causes layout/cropping issues; force inline.
  let inline = raw
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => `$${inner}$`)
    .replace(/\\\[/g, "\\(")
    .replace(/\\\]/g, "\\)");

  // Choices that are entirely mathematical are more robust as one TeX
  // segment than a mixture such as "pi+$\sqrt{2}$" or "[729,$\infty$)".
  const exactParenMath = /^\\\([\s\S]*\\\)$/.test(inline);
  const unwrapped = inline
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .trim();
  if (
    !exactParenMath
    && /\\[A-Za-z]+|[_^{}]/.test(unwrapped)
    && !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(unwrapped.replace(/\\[A-Za-z]+/g, ""))
  ) {
    inline = `$${unwrapped}$`;
  }

  const hasDelimiters = /\$|\\\(|\\\[/.test(inline);
  const looksLikeLatex = /\\[a-zA-Z]+|[_^{}]/.test(inline);
  if (!hasDelimiters && looksLikeLatex) {
    return `$${inline}$`;
  }
  return inline;
}

function stripMathJaxWrappers(text) {
  return String(text || "")
    .replace(/<\/?(?:math|mrow|mi|mo|mn|msup|msub|msubsup|mfrac|msqrt|mroot|mstyle|mtext|semantics|annotation(?:-xml)?)\b[^>]*>/gi, " ")
    .replace(/\[\/?\s*mathjax\s*\]/gi, " ")
    .replace(/\[\/?\s*tex\s*\]/gi, " ")
    .replace(/\s+/g, " ");
}

function normalizeUnicodeMathTokens(text) {
  const source = String(text || "");
  const replacements = [
    [/\ufb00/g, "ff"],
    [/\ufb01/g, "fi"],
    [/\ufb02/g, "fl"],
    [/\ufb03/g, "ffi"],
    [/\ufb04/g, "ffl"],
    [/\u00a0/g, " "], // NBSP
    [/\u2009|\u202f/g, " "], // thin no-break spaces
    [/\u2212/g, "-"], // unicode minus
    [/\u00d7/g, "\\times "],
    [/\u00f7/g, "\\div "],
    [/\u00b1/g, "\\pm "],
    [/\u2213/g, "\\mp "],
    [/\u2264/g, "\\le "],
    [/\u2265/g, "\\ge "],
    [/\u2260/g, "\\ne "],
    [/\u2248/g, "\\approx "],
    [/\u221e/g, "\\infty "],
    [/\u2211/g, "\\sum "],
    [/\u220f/g, "\\prod "],
    [/\u222b/g, "\\int "],
    [/\u03b8/g, "\\theta "],
    [/\u03b1/g, "\\alpha "],
    [/\u03b2/g, "\\beta "],
    [/\u03b3/g, "\\gamma "],
    [/\u03bb/g, "\\lambda "],
    [/\u03bc/g, "\\mu "],
    [/\u03c3/g, "\\sigma "],
    [/\u03d5|\u03c6/g, "\\phi "],
    [/\u03c9/g, "\\omega "],
    [/\u2192/g, "\\to "],
    [/\u21a6/g, "\\mapsto "],
    [/\u2032/g, "'"],
    [/\u00bd/g, "\\frac{1}{2}"],
    [/\u00bc/g, "\\frac{1}{4}"],
    [/\u00be/g, "\\frac{3}{4}"],
    [/\u2153/g, "\\frac{1}{3}"],
    [/\u2154/g, "\\frac{2}{3}"],
    [/\u215b/g, "\\frac{1}{8}"],
    [/\u215c/g, "\\frac{3}{8}"],
    [/\u215d/g, "\\frac{5}{8}"],
    [/\u215e/g, "\\frac{7}{8}"]
  ];

  let out = source;
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  out = out
    // OCR often turns pi into "T" in angle expressions like 7T/6.
    .replace(/(\d)\s*T(?=\s*\/\s*\d)/g, "$1π")
    .replace(/\bT(?=\s*\/\s*\d)/g, "π")
    .replace(/\bI(?=\s*\/\s*\d)/g, "1")
    // Normalize bare sqrt followed by a token into MathJax-safe form.
    .replace(/(?<!\\)\bsqrt\s*\{([^{}]+)\}/gi, "\\sqrt{$1}")
    .replace(/(?<!\\)\bsqrt\s*\(?\s*([A-Za-z0-9][A-Za-z0-9^_+\-*/.]*)\)?/gi, "\\sqrt{$1}")
    .replace(/(?<!\\)\bpi\b/g, "\\pi")
    .replace(/√\s*([^,;:!?]+)/g, (_m, inner) => `\\sqrt{${String(inner || "").trim()}}`)
    // Some OCR exports use modifier circumflex as a faux integral sign.
    .replace(/\u02c6(?=\s*\d|\s*[A-Za-z])/g, "\\int ")
    .replace(
      /(?<!\\)\b(arcsin|arccos|arctan|sin|cos|tan|sec|csc|cot|log|ln)\b(?!\s+denotes?\b)/gi,
      (_m, fn) => `\\${String(fn || "").toLowerCase()}`
    );
  return out;
}

function wrapBareLatexSpans(text) {
  const source = String(text || "");
  const safeWrap = (input, regex) => input.replace(regex, (span, offset, full) => {
    const trimmed = String(span || "").trim();
    if (!trimmed) return span;
    let unescapedDollarCount = 0;
    for (let i = 0; i < Number(offset); i += 1) {
      if (full[i] === "$" && full[i - 1] !== "\\") unescapedDollarCount += 1;
    }
    if (unescapedDollarCount % 2 === 1) return span;
    const prevChar = offset > 0 ? full[offset - 1] : "";
    const nextChar = full[offset + span.length] || "";
    const nextTail = full.slice(offset + span.length);
    if (prevChar === "{" || prevChar === "_" || prevChar === "^" || prevChar === "\\") return span;
    if (nextChar === "}") return span;
    // Avoid wrapping prefix-only fragments like f^{-1} in f^{-1}(A).
    if (/^\s*\(/.test(nextTail)) return span;
    return `$${trimmed}$`;
  });

  const wrapPlainSegment = (segment) => {
    let out = String(segment || "");
    out = safeWrap(out, /[A-Za-z]\s*\^\s*\{-1\}\s*\([^()]{1,120}\)/g);
    out = safeWrap(out, /\\lim(?:_\{[^{}]*\})?[^,;:!?\n]{0,96}/g);
    out = safeWrap(out, /\\int\b[^,;:!?\n]{0,96}?d[A-Za-z]/g);
    out = safeWrap(out, /\\(?:sum|prod)\b[^,;:!?\n]{0,96}/g);
    out = safeWrap(out, /\\(?:arc(?:sin|cos|tan)|sin|cos|tan|sec|csc|cot|log|ln|exp|sqrt)\s*(?:\{[^{}]*\}|\([^()]*\)|[A-Za-z0-9.+\-*/^_]+)/g);
    out = safeWrap(out, /[A-Za-z0-9)\]}]+\s*\\(?:in|subseteq?|supseteq?)\s*(?:\[[^\]]+\]|\{[^}]+\}|[A-Za-z0-9()^_+\-*/.]+)/g);
    out = safeWrap(out, /\\(?:theta|alpha|beta|gamma|delta|lambda|mu|sigma|phi|omega|infty|le|ge|ne|neq|cdot|times|div|mapsto)\b(?:\s*\/\s*[0-9A-Za-z]+)?/g);
    out = safeWrap(out, /\b[A-Za-z](?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9+\-]+))+/g);
    return out;
  };

  return splitMathSegments(source)
    .map((part) => (part.kind === "math" ? part.value : wrapPlainSegment(part.value)))
    .join("");
}

function stripScanNoise(text) {
  let out = String(text || "")
    .replace(
      /\s*\\?\$\s*\(NOTE:\s*THE FOLLOWING DIAGRAM WAS NOT SHOWN DURING THE ACTUAL EXAM,[\s\S]*?PICTURING THE PROBLEM\)\s*$/gi,
      " "
    )
    .replace(/\s*\\?\$\s*[~_]?Diagram by [^_\n]+_?\s*$/gi, " ")
    .replace(/\b(?:GO ON TO THE NEXT P ?AGE\.?|SCRATCH WORK|ANSWER KEY)\b.*$/gi, " ")
    .replace(/\bSTOP If you finished before time is called,\s*you may check your work on this test\b.*$/gi, " ")
    // Remove leaked source image filenames embedded in prompt text.
    .replace(
      /\b(?:\d{4}-\d+|\d{4}\s+(?:AIME|AMC)\s*(?:Problem\s*)?-?\d+[A-Z]?|(?:AIME|AMC)\s+\d{4}\s+Problem\s+\d+)\.png\b/gi,
      " "
    )
    .replace(/\b(?:Linear Algebra|Multivariable Calculus|Euclidean Geometry|General Topology|Complex Analysis|Differential Equations)\s*#?\d*\s*$/gi, " ")
    .replace(/\bReferences?\s*:?\s*\d*\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out.trim();
}

function normalizeOcrMathPatterns(text) {
  let out = String(text || "");
  out = stripScanNoise(out);
  out = out
    // Clean leaked section labels attached to options like "None Combinatorics".
    .replace(/\b(None)\s+(Combinatorics|Algebra|Analysis|Topology|Geometry|Probability)\b/gi, "$1")
    // OCR frequently drops superscript/minus symbols in inverse-image notation.
    .replace(/\bf-1\s*\(/g, "f^{-1}(")
    .replace(
      /\b([fghFGHT])\s*-\s*1(?=\s*(?:is|are|continuous|open|closed|homeomorphism|injective|surjective|bijective)\b)/g,
      "$1^{-1}"
    )
    .replace(/\)\s*o\b/g, ")^\\circ")
    .replace(/\b([A-Z])o(?=\s*(?:[),=]|denotes?\s+(?:the\s+)?interior\b))/g, "$1^\\circ")
    .replace(/\)\s*c\b/g, ")^c")
    .replace(/\b([A-Z])c\b/g, "$1^c")
    .replace(/\b([A-Z])n\s*=\s*Id\b/g, "$1^n = Id")
    .replace(/\baxa2\b/g, "axa^2")
    .replace(/\bx\^3-x-\$\s*1\b/g, "x^3-x-1")
    .replace(/\b3A2-\s*\$?\\lambda\$?\s*A\b/g, "3A^2-\\lambda A")
    .replace(/(\$?\\lambda\$?)\s*n-1\b/g, "$1^{n-1}")
    .replace(/\+\s*\.\.\.\s*\+/g, "+\\cdots+")
    .replace(/\bLet\s+([A-Z])\s+is\s+an\b/g, "Let $1 be an")
    .replace(/\bdiagonilized\b/gi, "diagonalized")
    .replace(/\bvar\s*\(/g, "Var(")
    // Common OCR split for derivatives and simple rational terms.
    .replace(/\bdy\s*dx\b/g, "\\frac{dy}{dx}")
    .replace(/\+\s*y\s*x\b/g, "+\\frac{y}{x}")
    .replace(/\bd\s*d([A-Za-z])\b/g, "\\frac{d}{d$1}")
    .replace(/\blim\s*([A-Za-z])\s*(?:\\to|->)\s*([A-Za-z0-9+\-^{}]+)/gi, "\\lim_{$1\\to $2}")
    .replace(/\blim([A-Za-z])\s*(?:\\to|->)\s*([A-Za-z0-9+\-^{}]+)/gi, "\\lim_{$1\\to $2}")
    // OCR often emits "sinx x" for sin(x)/x.
    .replace(/\(\s*(\\sin|\\cos|\\tan|sin|cos|tan)\s*([A-Za-z])\s+([A-Za-z])\s*\)/gi, (_m, fn, a, b) => {
      if (String(a || "").toLowerCase() !== String(b || "").toLowerCase()) return _m;
      const safeFn = String(fn || "").startsWith("\\") ? String(fn) : `\\${String(fn || "").toLowerCase()}`;
      return `(\\frac{${safeFn} ${a}}{${b}})`;
    })
    // Only infer a lost exponent for a standalone OCR variable. In particular,
    // TeX script operands such as \log_x 3 mean "log base x of 3", not x^3.
    .replace(/(?<![A-Za-z_^\\])([A-Za-z])\s+([23])(?=[\s),.;:!?]|$)/g, "$1^$2")
    .replace(/√\s*([0-9A-Za-z]+)/g, "\\sqrt{$1}")
    .replace(/\s+/g, " ");
  return out.trim();
}

function normalizeUnsupportedLatexEnvironments(text) {
  const stripEmptyScriptMarkers = (value) => {
    let out = String(value || "");
    let prev = "";
    while (out !== prev) {
      prev = out;
      out = out
        // Drop empty script markers attached to symbols, e.g. x_{}^{}.
        .replace(/(?<=\S)\s*(?:\^\s*\{\s*\}|_\s*\{\s*\})+/g, "")
        // Also drop any remaining standalone empty script markers.
        .replace(/(?:\^\s*\{\s*\}|_\s*\{\s*\})+/g, "");
    }
    return out;
  };
  const toEscapedCurrency = (_full, amount) => `\\$${String(amount || "").trim()}`;
  const normalizeInnerEscapedCurrency = (_full, inner) => {
    const seg = String(inner || "").trim();
    // Keep math wrappers when the payload contains LaTeX commands
    // (e.g., $\$\underline{1}\underline{A}\underline{2}$).
    if (seg.includes("\\")) return _full;
    return `\\$${seg}`;
  };
  const normalizeBrokenFractions = (value) => {
    let out = String(value || "");
    // Some imported datasets drop the leading backslash in frac-like commands.
    out = out.replace(/(^|[^\\A-Za-z])(dfrac|tfrac|frac)(?=\s|[0-9{\\+-]|$)/g, (_m, prefix, macro) => `${prefix}\\${macro}`);
    // Normalize common malformed fraction forms into brace-delimited TeX.
    out = out
      // \frac 7{16} -> \frac{7}{16}
      .replace(/\\(dfrac|tfrac|frac)\s*([A-Za-z0-9])\s*\{([^{}]+)\}/g, "\\$1{$2}{$3}")
      // \frac{1}\pi -> \frac{1}{\pi}
      .replace(/\\(dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*(\\[A-Za-z]+|[A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}")
      // \frac mn or \frac12 -> \frac{m}{n}, \frac{1}{2}
      .replace(/\\(dfrac|tfrac|frac)\s+([A-Za-z0-9])\s+([A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}")
      .replace(/\\(dfrac|tfrac|frac)\s*([A-Za-z0-9])\s*([A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}");
    return out;
  };
  const normalizeDisplayEnvironments = (value) => {
    const source = String(value || "");
    const isInsideExplicitMath = (offset) => {
      let active = "";
      for (let i = 0; i < offset; i += 1) {
        if (source[i] === "$" && !isEscapedAt(source, i)) {
          const token = source[i + 1] === "$" && !isEscapedAt(source, i + 1)
            ? "$$"
            : "$";
          if (token === "$$") i += 1;
          if (!active) active = token;
          else if (active === token) active = "";
          continue;
        }
        if (source[i] !== "\\" || isEscapedAt(source, i)) continue;
        const token = source.slice(i, i + 2);
        if (token === "\\[" || token === "\\(") {
          if (!active) active = token;
          i += 1;
        } else if (
          (token === "\\]" && active === "\\[")
          || (token === "\\)" && active === "\\(")
        ) {
          active = "";
          i += 1;
        }
      }
      return Boolean(active);
    };
    return source.replace(
      /\\begin\{(align\*?|eqnarray\*?|aligned|array)\}([\s\S]*?)\\end\{\1\}/g,
      (full, env, body, offset) => {
        const mapped = /^(?:align|eqnarray)/.test(env) ? "aligned" : env;
        const cleanBody = String(body || "")
          .replace(/(?<!\\)\$\$?/g, "")
          .trim();
        const replacement = `\\begin{${mapped}}${cleanBody}\\end{${mapped}}`;
        if (isInsideExplicitMath(Number(offset))) return replacement;
        return `\\[${replacement}\\]`;
      }
    );
  };
  const normalized = normalizeDisplayEnvironments(String(text || ""))
    // MathJax support for \multicolumn in imported table fragments is inconsistent.
    // Keep only the cell payload.
    .replace(/\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1")
    // Normalize unsupported arc macro to a MathJax-safe form.
    .replace(/\\overarc\s*\{([^{}]+)\}/g, "\\overset{\\frown}{$1}")
    // Normalize text-style commands that aren't always available.
    .replace(/\\emph\s*\{/g, "\\text{")
    // Strip layout directives that commonly break MathJax in imported contest data.
    .replace(/\\begingroup\b/g, " ")
    .replace(/\\endgroup\b/g, " ")
    .replace(/\\setlength\s*\{\\tabcolsep\}\s*\{[^{}]*\}/g, " ")
    .replace(/\\renewcommand\s*\{\\arraystretch\}\s*\{[^{}]*\}/g, " ")
    // MathJax doesn't support tabular; convert it to array for rendering.
    .replace(/\\begin\{tabular\*\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "\\begin{array}{$1}")
    .replace(/\\begin\{tabular\}\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, "\\begin{array}{$1}")
    .replace(/\\end\{tabular\*\}/g, "\\end{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}")
    // Normalize currency-ish macros and malformed wrappers.
    .replace(/\\textdollars?/g, "\\$")
    // Imported choices sometimes wrap a signed currency value as TeX even
    // though the dollar sign itself is literal: $-\$ 1.06$ -> -\$1.06.
    .replace(
      /(?<!\\)\$\s*([+-])\s*\\\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*\$/g,
      (_full, sign, amount) => `${sign}\\$${amount}`
    )
    .replace(/(?<!\S)\$\s*\\\$\s*([^$]+?)\s*\$/g, normalizeInnerEscapedCurrency)
    .replace(/(?<!\S)\$\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=[\s,.;:!?)]|$)/g, toEscapedCurrency)
    .replace(/(?<!\S)\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/(?<!\S)\$\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/\$\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/\\\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\\\$/g, toEscapedCurrency)
    .replace(/([,.;:])\\\$/g, "$1 \\$")
    .replace(/(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])/g, " $")
    .replace(/\\rule\s*\{[^{}]*\}\s*\{(?:0?\.\d+|[0-1](?:\.\d+)?)mm\}/g, "\\underline{\\phantom{00}}")
    // Remove spacing directives that tend to render badly in imported problems.
    .replace(/@\{\\hspace\*?\{[^{}]*\}\}/g, "")
    .replace(/\\(?:hspace|vspace)\*?\{[^{}]*\}/g, " ");
  return stripEmptyScriptMarkers(normalizeBrokenFractions(normalized));
}

const CURRENCY_WORDS = new Set([
  "dollar", "dollars", "cent", "cents", "usd",
  "price", "cost", "costs", "pay", "paid", "more", "less",
  "each", "per", "for", "total", "worth", "charge", "charges",
  "spent", "spend", "earned", "income", "fare", "fares"
]);

function findNextUnescapedDollar(text, start = 0) {
  const source = String(text || "");
  for (let i = Math.max(0, start); i < source.length; i += 1) {
    if (source[i] === "$" && source[i - 1] !== "\\") {
      return i;
    }
  }
  return -1;
}

function looksMathishDollarSegment(segment) {
  const s = String(segment || "").trim();
  if (!s) return true;
  if (!/[A-Za-z]/.test(s)) return true;
  if (/\\[a-zA-Z]+|[=+\-*/^_{}()]/.test(s)) return true;
  if (/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(s)) return true;
  if (/^[A-Za-z](?:\d+)?$/.test(s)) return true;
  return false;
}

function escapeLikelyCurrencyDollars(text) {
  const source = String(text || "");
  return source.replace(/(?<!\\)\$(\d+(?:,\d{3})*(?:\.\d+)?)/g, (match, amount, offset, full) => {
    const after = Number(offset) + String(match).length;
    const nextDollar = findNextUnescapedDollar(full, after);
    if (nextDollar !== -1 && nextDollar - after <= 180) {
      const between = full.slice(after, nextDollar);
      if (looksMathishDollarSegment(between)) {
        return match;
      }
      if (/\s+[A-Za-z]{3,}/.test(between)) {
        return `\\$${amount}`;
      }
      return match;
    }

    const tail = full.slice(after);
    const nextCharMatch = tail.match(/\S/);
    if (!nextCharMatch) return `\\$${amount}`;
    const ch = nextCharMatch[0];

    if ("\\^_{}=+-*/()[]".includes(ch)) return match;
    if (/[.,;:!?)]/.test(ch)) return `\\$${amount}`;

    const wordMatch = tail.match(/^\s*([A-Za-z]+)/);
    if (wordMatch) {
      const w = wordMatch[1].toLowerCase();
      if (CURRENCY_WORDS.has(w) || w.length >= 2) {
        return `\\$${amount}`;
      }
    }
    return match;
  });
}

function repairBrokenDollarEscapes(text) {
  const escapedCurrencyToken = "__RB_ESCAPED_CURRENCY_DOLLAR__";
  const classify = (segment) => {
    const s = String(segment || "").trim();
    if (!s) return false;
    const strongMath = /\\[a-zA-Z]+|[\\^_{}=+\-*/()<>!:]|(?:\d\.[A-Za-z])|(?:\d\s*:\s*\d)/.test(s);
    const longWordy = /\s+[A-Za-z]{4,}/.test(s);
    if (longWordy && !strongMath) return false;
    if (strongMath) return true;
    // Support short symbolic fragments like "3, 5, 7, a,".
    return /\d/.test(s) && /(?:^|[\s,;])[A-Za-z](?:$|[\s,;])/.test(s);
  };

  let fixed = String(text || "")
    .replace(/\\\$(?=\d)/g, escapedCurrencyToken)
    .replace(/(?<!\$)\\\$(.+?)(?<!\\)\$/g, (_m, seg) => {
      const s = String(seg || "").trim();
      // If there is another unescaped '$' inside the span, this match crossed
      // multiple math regions and should be left unchanged.
      if (/(?<!\\)\$/.test(s)) {
        return _m;
      }
      if (classify(s)) {
        // Restore true inline math.
        return `$${s}$`;
      }
      // If this span includes prose, the consumed trailing '$' is likely
      // the start of the next math fragment (e.g., "... gave Sammy $t$ ...").
      if (/\s+[A-Za-z]{3,}/.test(s)) {
        return `\\$${s}$`;
      }
      // Treat as currency/amount text.
      return `\\$${s}`;
    });
  fixed = fixed.replace(/(?<!\\)\$(.+?)\\\$/g, (_m, seg) => {
    const s = String(seg || "").trim();
    // If there is another unescaped '$' inside the span, this match crossed
    // multiple math regions and should be left unchanged.
    if (/(?<!\\)\$/.test(s)) {
      return _m;
    }
    if (classify(s)) {
      return `$${s}$`;
    }
    return `\\$${s}\\$`;
  });
  return fixed.replace(new RegExp(escapedCurrencyToken, "g"), "\\$");
}

function escapeDanglingDollarDelimiter(text) {
  const source = String(text || "");
  const positions = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "$" && source[i - 1] !== "\\") {
      positions.push(i);
    }
  }
  if (positions.length % 2 === 0) return source;
  const last = positions[positions.length - 1];
  return `${source.slice(0, last)}\\$${source.slice(last + 1)}`;
}

function simplifyTrivialInlineMath(text) {
  // Keep even simple numeric/symbolic spans delimited. Besides preserving
  // author intent, this makes sanitization idempotent and prevents a second
  // pass from mistaking a formerly delimited trailing number for scan noise.
  return String(text || "");
}

function sanitizeForMathJax(text) {
  return String(
    simplifyTrivialInlineMath(
      escapeDanglingDollarDelimiter(
        escapeLikelyCurrencyDollars(
          wrapBareLatexSpans(
            repairBrokenDollarEscapes(
              normalizeUnsupportedLatexEnvironments(
                normalizeOcrMathPatterns(
                  normalizeUnicodeMathTokens(stripMathJaxWrappers(text))
                )
              )
            )
          )
        )
      )
    )
  )
    // Keep punctuation attached to the preceding token.
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(?<=[A-Za-z])\\\$/g, " \\$")
    .replace(/([,.;:])\\\$/g, "$1 \\$")
    .replace(/(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])/g, " $");
}

function canonicalizeRotblockerPreviewPath() {
  if (typeof window === "undefined") return;
  const pathname = String(window.location?.pathname || "");
  if (!/%2b/i.test(pathname)) return;

  const normalizedPath = pathname.replace(/%2B/gi, "+");
  if (normalizedPath === pathname) return;

  const history = window.history;
  if (!history || typeof history.replaceState !== "function") return;
  try {
    history.replaceState(
      history.state,
      "",
      `${normalizedPath}${window.location.search || ""}${window.location.hash || ""}`
    );
  } catch (_err) {
    // Ignore history updates blocked by the runtime.
  }
}

function isRotblockerPreviewPath(pathname) {
  const raw = String(pathname || "");
  const lower = raw.toLowerCase();
  if (lower.includes("/rotblocker++/") || lower.includes("/rotblocker%2b%2b/")) {
    return true;
  }
  try {
    return decodeURIComponent(raw).toLowerCase().includes("/rotblocker++/");
  } catch (_err) {
    return false;
  }
}

function resolveAssetPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const inExtensionRuntime =
    typeof chrome !== "undefined" &&
    Boolean(chrome?.runtime?.id) &&
    typeof chrome?.runtime?.getURL === "function";
  if (inExtensionRuntime) {
    return chrome.runtime.getURL(raw.replace(/^\/+/, ""));
  }
  if (isRotblockerPreviewPath(window.location?.pathname || "")) {
    return `../${raw.replace(/^\/+/, "")}`;
  }
  return raw.replace(/^\/+/, "");
}

function applyDiagramSizing(targetImgEl = diagramImgEl) {
  if (!targetImgEl) return;
  const w = Number(targetImgEl.naturalWidth || 0);
  const h = Number(targetImgEl.naturalHeight || 0);
  targetImgEl.classList.remove("diagram-tiny", "diagram-small", "diagram-wide", "diagram-tall");
  if (!w || !h) return;
  const maxDim = Math.max(w, h);
  const ratio = w / h;
  if (maxDim <= 36) {
    targetImgEl.classList.add("diagram-tiny");
  } else if (maxDim <= 96) {
    targetImgEl.classList.add("diagram-small");
  }
  if (ratio >= 3) targetImgEl.classList.add("diagram-wide");
  if (ratio <= 0.45) targetImgEl.classList.add("diagram-tall");
}

const RB_MATH_ROOT = globalThis.RB || (globalThis.RB = {});
RB_MATH_ROOT.math = {
  ...RB_MATH_ROOT.math,
  hasMathTypesetter,
  markMathPending,
  clearMathPending,
  queueMathTypeset,
  replaceMathContainer,
  invalidateMathTree,
  flushPendingMathTypeset,
  schedulePendingMathRetry,
  bindMathJaxReadyRetry,
  hasRenderableMathSyntax,
  hasAssistantMarkdownSyntax,
  problemHasDiagramReference,
  problemRequiresExternalVisual,
  stabilizePunctuationWrapping,
  escapeHtml,
  splitMathSegments,
  hasUndelimitedMathSyntax,
  hasMalformedMathSyntax,
  renderInlineMarkdownHtml,
  renderAssistantMarkdownLineHtml,
  renderAssistantMarkdownText,
  renderMathText,
  normalizeChoiceMath,
  stripMathJaxWrappers,
  normalizeUnicodeMathTokens,
  wrapBareLatexSpans,
  stripScanNoise,
  normalizeOcrMathPatterns,
  normalizeUnsupportedLatexEnvironments,
  findNextUnescapedDollar,
  looksMathishDollarSegment,
  escapeLikelyCurrencyDollars,
  repairBrokenDollarEscapes,
  escapeDanglingDollarDelimiter,
  simplifyTrivialInlineMath,
  sanitizeForMathJax,
  canonicalizeRotblockerPreviewPath,
  isRotblockerPreviewPath,
  resolveAssetPath,
  applyDiagramSizing
};
