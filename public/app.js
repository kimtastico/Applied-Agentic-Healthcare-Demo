// All model output is inserted with textContent, never innerHTML.

const form = document.getElementById("explain-form");
const input = document.getElementById("phrase");
const submit = document.getElementById("submit");
const resultEl = document.getElementById("result");
const glossaryList = document.getElementById("glossary-list");
const glossaryStatus = document.getElementById("glossary-status");
const glossaryFilter = document.getElementById("glossary-filter");

let glossaryTerms = [];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

function showMessage(kind, text) {
  resultEl.hidden = false;
  resultEl.className = `result ${kind}`;
  resultEl.replaceChildren(el("div", { class: "card", role: kind === "error" ? "alert" : "status" }, el("p", {}, text)));
}

const SOURCE_LABELS = {
  ai: "Written by AI",
  glossary: "From the glossary",
  demo: "Demo example",
};

// What the reviewer model did with the writer's draft.
const REVIEW_LABELS = {
  passed: "Checked by reviewer AI",
  revised: "Corrected by reviewer AI",
  unresolved: "Issues flagged: not saved",
  skipped: "Not yet reviewed",
};

function showResult(data) {
  if (!data.understood) {
    showMessage("unclear", data.explanation || "We couldn't tell what that phrase means. Try copying just the medical words.");
    return;
  }

  const card = el("div", { class: "card" },
    el("h2", { class: "term" }, data.term),
    el("p", { class: "explanation" }, data.explanation),
  );

  if (data.word_parts?.length) {
    card.append(
      el("h3", {}, "Word by word"),
      el("ul", { class: "parts" },
        ...data.word_parts.map((p) => el("li", {}, el("span", { class: "word" }, p.word), el("span", {}, p.meaning))),
      ),
    );
  }

  if (data.questions?.length) {
    card.append(
      el("h3", {}, "Questions you could ask your care team"),
      el("ul", { class: "questions" }, ...data.questions.map((q) => el("li", {}, q))),
    );
  }

  const meta = el("div", { class: "meta" }, el("span", { class: "badge" }, SOURCE_LABELS[data.source] ?? data.source));
  if (data.reading_grade != null) {
    const grade = Math.round(data.reading_grade);
    const label = grade < 1 ? "Reading level: below grade 1" : `Reading level ≈ grade ${grade}`;
    meta.append(el("span", { class: "badge", title: "Flesch-Kincaid estimate" }, label));
  }
  const reviewLabel = REVIEW_LABELS[data.review?.status];
  if (reviewLabel) {
    // Hovering "Not yet reviewed" shows why (e.g. the reviewer model was unavailable).
    const attrs = data.review.reason ? { class: "badge", title: `Why: ${data.review.reason}` } : { class: "badge" };
    meta.append(el("span", attrs, reviewLabel));
  }
  if (data.logged) meta.append(el("span", { class: "badge" }, "Counted in public glossary"));
  card.append(meta);

  // Show what the reviewer caught, so readers can see the check at work.
  if (data.review?.problems?.length) {
    const heading = data.review.status === "revised" ? "What the reviewer fixed" : "What the reviewer flagged";
    card.append(
      el("details", { class: "review" },
        el("summary", {}, heading),
        el("ul", {}, ...data.review.problems.map((p) => el("li", {}, p.issue))),
      ),
    );
  }

  resultEl.hidden = false;
  resultEl.className = "result";
  resultEl.replaceChildren(card);
}

async function explain(phrase) {
  submit.disabled = true;
  submit.textContent = "Explaining…";
  showMessage("loading", "Looking that up… A writer AI drafts the answer and a reviewer AI checks it. The first time someone asks, this can take up to a minute.");
  try {
    const res = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage("error", data.message || "Something went wrong. Please try again.");
      return;
    }
    showResult(data);
    if (data.logged) loadGlossary();
  } catch {
    showMessage("error", "We couldn't reach the server. Check your connection and try again.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Explain";
  }
}

function renderGlossary() {
  const q = glossaryFilter.value.trim().toLowerCase();
  const shown = q ? glossaryTerms.filter((t) => t.term.includes(q)) : glossaryTerms;
  glossaryList.replaceChildren(
    ...shown.map((t) => {
      const btn = el("button", { type: "button" },
        el("span", { class: "g-term" }, t.term),
        el("span", { class: "g-count" }, `${t.count.toLocaleString()} ${t.count === 1 ? "search" : "searches"}`),
        t.summary ? el("span", { class: "g-summary" }, t.summary) : null,
      );
      btn.addEventListener("click", () => {
        input.value = t.term;
        updateCount();
        explain(t.term);
        form.scrollIntoView({ behavior: "smooth" });
      });
      return el("li", {}, btn);
    }),
  );
  glossaryStatus.textContent = shown.length || !glossaryTerms.length ? "" : "No terms match that filter.";
}

async function loadGlossary() {
  try {
    const res = await fetch("/api/glossary");
    const data = await res.json();
    if (!data.configured) {
      glossaryStatus.textContent = "The glossary will appear here once the database is connected.";
      return;
    }
    glossaryTerms = data.terms ?? [];
    glossaryFilter.hidden = glossaryTerms.length < 10;
    if (!glossaryTerms.length) glossaryStatus.textContent = "No searches yet. Be the first!";
    renderGlossary();
  } catch {
    glossaryStatus.textContent = "The glossary couldn't be loaded right now.";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const phrase = input.value.trim();
  if (phrase) explain(phrase);
});

// Enter submits; Shift+Enter adds a new line.
// Character counter: "120 / 300", red from 90% of the limit. The box itself stops at the
// limit, so a long paste is cut off; say so instead of dropping text silently.
const MAX_CHARS = Number(input.getAttribute("maxlength")) || 300;
const NEAR_LIMIT = Math.floor(MAX_CHARS * 0.9);
const charCount = document.getElementById("char-count");
const pasteNote = document.getElementById("paste-note");

function updateCount() {
  const n = input.value.length;
  charCount.textContent = `${n} / ${MAX_CHARS}`;
  charCount.classList.toggle("near-limit", n >= NEAR_LIMIT);
  if (n < MAX_CHARS) pasteNote.textContent = "";
}

input.addEventListener("input", updateCount);
input.addEventListener("paste", (e) => {
  const pasted = e.clipboardData?.getData("text") ?? "";
  const replaced = input.selectionEnd - input.selectionStart;
  if (input.value.length - replaced + pasted.length > MAX_CHARS) {
    // Set after the paste lands, so updateCount doesn't clear it straight away.
    setTimeout(() => {
      pasteNote.textContent = `Only the first ${MAX_CHARS} characters were kept. Try pasting just the medical phrase.`;
    }, 0);
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.phrase;
    updateCount();
    explain(chip.dataset.phrase);
  });
}

glossaryFilter.addEventListener("input", renderGlossary);

// Support shareable links like /?q=cardiomegaly
const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  input.value = initial.slice(0, MAX_CHARS);
  updateCount();
  explain(input.value);
}

loadGlossary();
