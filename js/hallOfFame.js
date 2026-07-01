import { requireClient } from "./supabase.js";
import { $, escapeHtml, toast, setBusy, formatDate, badge } from "./ui.js";

const TABLE = "hall_of_fame_entries";
const REQUEST_ROLES = new Set(["prefect", "coordinator"]);
const STAFF_ROLES = new Set(["teacher", "admin"]);
const ANSWER_MIN = 30;
const ANSWER_MAX = 700;

let context = {};
let approvedEntries = [];
let myRequests = [];
let pendingRequests = [];
let historyEntries = [];

export async function hallOfFameFull(options) {
  context = options;
  const canRequest = REQUEST_ROLES.has(context.profile.role);
  const canReview = STAFF_ROLES.has(context.profile.role);
  const isAdmin = context.profile.role === "admin";

  context.layout(`
    <section class="hof-hero card">
      <div>
        <p class="eyebrow">Royal Institute Prefects Guild</p>
        <h2>Prefects / Headboard Hall of Fame</h2>
        <p>Recognising leadership, service, discipline, and meaningful contributions to the Royal Institute Prefects' Guild.</p>
      </div>
      <div class="hof-hero-mark" aria-hidden="true"><img src="assets/rilogo.png" alt=""></div>
    </section>

    <section class="section-gap">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Celebrated leadership</p>
          <h2>Honoured Prefects</h2>
        </div>
      </div>
      <div id="hof-approved" class="hof-grid"><section class="card empty">Loading Hall of Fame entries...</section></div>
    </section>

    ${canRequest ? requestSectionMarkup() : ""}
    ${guidelinesMarkup()}
    ${isAdmin ? adminSectionMarkup() : ""}
    ${canReview ? reviewSectionMarkup() : ""}
  `);

  const jobs = [refreshApprovedHallOfFame()];
  if (canRequest) {
    bindRequestForm();
    jobs.push(refreshMyHallOfFameRequests());
  }
  if (isAdmin) bindAdminForm();
  if (canReview) {
    bindReviewActions();
    jobs.push(refreshPendingHallOfFameRequests(), refreshHallOfFameHistory());
  }
  await Promise.all(jobs);
}

export async function loadApprovedHallOfFame() {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select("*")
    .eq("status", "approved")
    .limit(100);
  if (error) throw error;
  return sortHallEntries(data || []);
}

export async function loadMyHallOfFameRequests() {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select("*")
    .eq("submitted_by", context.profile.id)
    .order("submitted_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}

export async function loadPendingHallOfFameRequests() {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return hydrateSubmitters(data || []);
}

async function loadHallOfFameHistory() {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return hydrateSubmitters(data || []);
}

export async function submitHallOfFameRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("[data-hof-submit]", form);
  const message = $("[data-hof-form-message]", form);
  const values = new FormData(form);
  const displayName = String(values.get("display_name") || "").trim();
  const displayClass = String(values.get("display_class") || "").trim();
  const contribution = String(values.get("contribution_summary") || "").trim();
  const impact = String(values.get("leadership_impact") || "").trim();
  const validation = validateRequest(displayName, displayClass, contribution, impact);

  if (validation) {
    setMessage(message, validation, "error");
    return;
  }

  setBusy(button, true, "Submitting...");
  setMessage(message, "", "");
  try {
    const payload = {
      submitted_by: context.profile.id,
      display_name: displayName,
      display_class: displayClass,
      title: "Prefect Nominee",
      contribution_years: extractYears(contribution),
      contribution_summary: contribution,
      leadership_impact: impact,
      status: "pending",
      is_seeded: false,
    };
    const { data, error } = await requireClient().from(TABLE).insert(payload).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your request was not saved. Please reload and try again.");
    form.reset();
    myRequests = [data, ...myRequests].slice(0, 10);
    renderMyHallOfFameRequests(myRequests);
    toast("Your Hall of Fame request has been submitted and is now being reviewed by teachers/admins.");
    setMessage(message, "Request submitted successfully.", "success");
  } catch (err) {
    setMessage(message, cleanError(err), "error");
    toast(cleanError(err), "error");
  } finally {
    setBusy(button, false);
  }
}

export async function approveHallOfFameRequest(entryId, reviewNote = "") {
  return reviewHallOfFameRequest(entryId, "approved", reviewNote);
}

export async function declineHallOfFameRequest(entryId, reviewNote = "") {
  return reviewHallOfFameRequest(entryId, "declined", reviewNote);
}

export function renderHallOfFameCards(entries) {
  const target = $("#hof-approved");
  if (!target) return;
  if (!entries.length) {
    target.innerHTML = '<section class="card empty">No approved Hall of Fame entries are available yet.</section>';
    return;
  }
  target.innerHTML = entries.map(entry => `
    <article class="hof-card ${entry.is_seeded ? "seeded" : ""}">
      <div class="hof-medal" aria-hidden="true"><img src="assets/rilogo.png" alt=""></div>
      <p class="eyebrow">${entry.is_seeded ? "Seeded record" : "Approved record"}</p>
      <h3>${escapeHtml(entry.display_name)}</h3>
      <p class="hof-title">${escapeHtml(entry.title || "Prefect")}</p>
      <p class="hof-years">${escapeHtml(entry.contribution_years || (entry.is_seeded ? "Honoured Leadership Record" : ""))}</p>
      <p>${escapeHtml(entry.contribution_summary || (entry.is_seeded ? "Honoured Leadership Record" : "Recognised for meaningful service to the Prefects Guild."))}</p>
      ${entry.leadership_impact ? `<div class="hof-impact">${escapeHtml(entry.leadership_impact)}</div>` : ""}
      <span class="badge approved">approved</span>
    </article>
  `).join("");
}

export function renderPendingRequests(entries) {
  const target = $("#hof-pending-list");
  if (!target) return;
  if (!entries.length) {
    target.innerHTML = '<section class="card empty">No Hall of Fame requests are pending review.</section>';
    return;
  }
  target.innerHTML = entries.map(entry => `
    <article class="hof-review-card card" data-entry="${entry.id}">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Pending request</p>
          <h3>${escapeHtml(entry.display_name)}</h3>
          <p>${escapeHtml(entry.display_class || "No class")} | Submitted ${formatDate(entry.submitted_at?.slice(0, 10))}</p>
          <p class="hof-submitter">Submitted by: ${escapeHtml(submitterLabel(entry))}</p>
        </div>
        ${badge(entry.status)}
      </div>
      <div class="hof-answer"><strong>Contribution and years</strong><p>${escapeHtml(entry.contribution_summary || "")}</p></div>
      <div class="hof-answer"><strong>Leadership impact</strong><p>${escapeHtml(entry.leadership_impact || "")}</p></div>
      <div class="field">
        <label>Review note</label>
        <textarea data-review-note maxlength="500" placeholder="Optional note for the record"></textarea>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-hof-approve>Approve</button>
        <button type="button" class="btn danger" data-hof-decline>Decline</button>
      </div>
    </article>
  `).join("");
}

function renderHistory(entries) {
  const target = $("#hof-history-list");
  const filter = $("#hof-history-filter")?.value || "";
  if (!target) return;
  const rows = entries.filter(entry => !filter || entry.status === filter);
  if (!rows.length) {
    target.innerHTML = '<section class="card empty">No Hall of Fame records match this filter.</section>';
    return;
  }
  target.innerHTML = rows.map(entry => `
    <article class="hof-history-card card" data-entry="${entry.id}">
      <div class="section-heading">
        <div>
          <p class="eyebrow">${entry.is_seeded ? "Seeded default" : "Hall of Fame record"}</p>
          <h3>${escapeHtml(entry.display_name)}</h3>
          <p>${escapeHtml(entry.title)} | ${escapeHtml(entry.display_class || "No class")}</p>
        </div>
        ${badge(entry.status)}
      </div>
      <p>${escapeHtml(entry.contribution_summary || "No contribution summary recorded.")}</p>
      ${entry.review_note ? `<div class="hof-answer"><strong>Review note</strong><p>${escapeHtml(entry.review_note)}</p></div>` : ""}
      ${context.profile.role === "admin" ? `<div class="actions"><button type="button" class="btn secondary" data-hof-history-status="approved">Approve</button><button type="button" class="btn ghost" data-hof-history-status="declined">Decline</button><button type="button" class="btn ghost" data-hof-history-status="archived">Archive</button></div>` : ""}
    </article>
  `).join("");
}

function requestSectionMarkup() {
  return `
    <section class="card section-gap" id="hof-request-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Nomination request</p>
          <h2>Want your name here?</h2>
          <p>Fill the form below and explain your contributions to the Prefects' Guild.</p>
        </div>
      </div>
      <form id="hof-request-form" class="form-grid" novalidate>
        <div class="field">
          <label>Name</label>
          <input name="display_name" required maxlength="120" value="${escapeHtml(context.profile.first_name || "")}">
        </div>
        <div class="field">
          <label>Class</label>
          <input name="display_class" required maxlength="80" value="${escapeHtml(context.profile.current_class || "")}">
        </div>
        <div class="field full">
          <label>What have you contributed to the Prefects' Guild, and from which year to which year?</label>
          <textarea name="contribution_summary" required minlength="${ANSWER_MIN}" maxlength="${ANSWER_MAX}"></textarea>
          <small>Minimum ${ANSWER_MIN} characters, maximum ${ANSWER_MAX} characters.</small>
        </div>
        <div class="field full">
          <label>Why do you believe you have made a meaningful change to the school, whether through the school environment, discipline, leadership, or in general?</label>
          <textarea name="leadership_impact" required minlength="${ANSWER_MIN}" maxlength="${ANSWER_MAX}"></textarea>
          <small>Minimum ${ANSWER_MIN} characters, maximum ${ANSWER_MAX} characters.</small>
        </div>
        <div class="field full">
          <div class="form-message" data-hof-form-message></div>
          <div class="actions">
            <button type="submit" class="btn" data-hof-submit>Submit Request</button>
            <button type="button" class="btn secondary" data-hof-cancel>Cancel</button>
          </div>
        </div>
      </form>
      <div id="hof-my-requests" class="section-gap-small"></div>
    </section>
  `;
}

function guidelinesMarkup() {
  return `
    <section class="hof-guidelines card section-gap">
      <p class="eyebrow">Selection guidance</p>
      <h2>Criteria for Hall of Fame Consideration</h2>
      <ol>
        <li>Meaningful contribution to improving the school ecosystem, discipline, responsibility, or student environment.</li>
        <li>Evidence of leadership through service, consistency, teamwork, and positive influence within the Prefects' Guild.</li>
        <li>A clear belief in growing as a leader while helping others improve, supporting the values expected from a Royal Institute prefect.</li>
      </ol>
    </section>
  `;
}

function adminSectionMarkup() {
  return `
    <section class="card section-gap">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Admin management</p>
          <h2>Add Hall of Fame Entry</h2>
          <p>Create an approved record directly without marking it as a seeded default.</p>
        </div>
      </div>
      <form id="hof-admin-form" class="form-grid" novalidate>
        <div class="field"><label>Name</label><input name="display_name" required maxlength="120"></div>
        <div class="field"><label>Class</label><input name="display_class" maxlength="80"></div>
        <div class="field"><label>Title</label><input name="title" required maxlength="100" value="Head Prefect"></div>
        <div class="field"><label>Status</label><select name="status"><option>approved</option><option>pending</option><option>declined</option><option>archived</option></select></div>
        <div class="field full"><label>Contribution years</label><input name="contribution_years" maxlength="160" placeholder="Example: 2024 to 2026"></div>
        <div class="field full"><label>Contribution summary</label><textarea name="contribution_summary" maxlength="${ANSWER_MAX}"></textarea></div>
        <div class="field full"><label>Leadership impact</label><textarea name="leadership_impact" maxlength="${ANSWER_MAX}"></textarea></div>
        <div class="field full"><div class="form-message" data-hof-admin-message></div><button type="submit" class="btn" data-hof-admin-submit>Add Entry</button></div>
      </form>
    </section>
  `;
}

function reviewSectionMarkup() {
  return `
    <section class="section-gap" id="hof-review-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Teacher/Admin review</p>
          <h2>Pending Hall of Fame Requests</h2>
        </div>
      </div>
      <div id="hof-pending-list" class="hof-review-list"><section class="card empty">Loading pending requests...</section></div>
    </section>
    <section class="section-gap" id="hof-history-section">
      <section class="card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Request history</p>
            <h2>Reviewed Hall of Fame Requests</h2>
          </div>
          <div class="field compact-filter">
            <label>Filter</label>
            <select id="hof-history-filter">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
        <div id="hof-history-list" class="hof-review-list"><section class="empty">Loading review history...</section></div>
      </section>
    </section>
  `;
}

function bindRequestForm() {
  $("#hof-request-form")?.addEventListener("submit", submitHallOfFameRequest);
  $("[data-hof-cancel]")?.addEventListener("click", () => {
    $("#hof-request-form")?.reset();
    setMessage($("[data-hof-form-message]"), "", "");
  });
}

function bindAdminForm() {
  $("#hof-admin-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("[data-hof-admin-submit]", form);
    const message = $("[data-hof-admin-message]", form);
    const values = new FormData(form);
    const displayName = String(values.get("display_name") || "").trim();
    const title = String(values.get("title") || "").trim();
    if (!displayName || !title) {
      setMessage(message, "Name and title are required.", "error");
      return;
    }
    setBusy(button, true, "Adding...");
    try {
      const status = String(values.get("status") || "approved");
      const payload = {
        submitted_by: context.profile.id,
        display_name: displayName,
        display_class: String(values.get("display_class") || "").trim() || null,
        title,
        contribution_years: String(values.get("contribution_years") || "").trim() || null,
        contribution_summary: String(values.get("contribution_summary") || "").trim() || "Honoured Leadership Record",
        leadership_impact: String(values.get("leadership_impact") || "").trim() || null,
        status,
        is_seeded: false,
        reviewed_by: status === "pending" ? null : context.profile.id,
        reviewed_at: status === "pending" ? null : new Date().toISOString(),
      };
      const { data, error } = await requireClient().from(TABLE).insert(payload).select("*").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Entry was not created. Please reload and try again.");
      form.reset();
      setMessage(message, "Hall of Fame entry added.", "success");
      toast("Hall of Fame entry added.");
      await Promise.all([refreshApprovedHallOfFame(), refreshHallOfFameHistory()]);
    } catch (err) {
      setMessage(message, cleanError(err), "error");
      toast(cleanError(err), "error");
    } finally {
      setBusy(button, false);
    }
  });
}

function bindReviewActions() {
  $("#hof-pending-list")?.addEventListener("click", async event => {
    const card = event.target.closest("[data-entry]");
    if (!card) return;
    const approve = event.target.closest("[data-hof-approve]");
    const decline = event.target.closest("[data-hof-decline]");
    if (!approve && !decline) return;
    const note = String($("[data-review-note]", card)?.value || "").trim();
    const button = approve || decline;
    setBusy(button, true, approve ? "Approving..." : "Declining...");
    try {
      if (approve) await approveHallOfFameRequest(card.dataset.entry, note);
      else await declineHallOfFameRequest(card.dataset.entry, note);
    } finally {
      setBusy(button, false);
    }
  });

  $("#hof-history-section")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-hof-history-status]");
    if (!button || context.profile.role !== "admin") return;
    const card = button.closest("[data-entry]");
    setBusy(button, true, "Saving...");
    try {
      await reviewHallOfFameRequest(card.dataset.entry, button.dataset.hofHistoryStatus, "");
    } finally {
      setBusy(button, false);
    }
  });

  $("#hof-history-filter")?.addEventListener("change", () => renderHistory(historyEntries));
}

async function reviewHallOfFameRequest(entryId, status, reviewNote = "") {
  const payload = {
    status,
    reviewed_by: context.profile.id,
    reviewed_at: new Date().toISOString(),
    review_note: reviewNote.trim() || null,
  };
  const { data, error } = await requireClient()
    .from(TABLE)
    .update(payload)
    .eq("id", entryId)
    .select("*")
    .maybeSingle();
  if (error) {
    toast(cleanError(error), "error");
    throw error;
  }
  if (!data) {
    const err = new Error("Supabase did not update this Hall of Fame request. Check the RLS migration, then reload.");
    toast(err.message, "error");
    throw err;
  }
  toast(status === "approved" ? "Hall of Fame request approved." : status === "declined" ? "Hall of Fame request declined." : "Hall of Fame record updated.");
  await Promise.all([refreshApprovedHallOfFame(), refreshPendingHallOfFameRequests(), refreshHallOfFameHistory()]);
  return data;
}

async function refreshApprovedHallOfFame() {
  approvedEntries = await loadApprovedHallOfFame();
  renderHallOfFameCards(approvedEntries);
}

async function refreshMyHallOfFameRequests() {
  myRequests = await loadMyHallOfFameRequests();
  renderMyHallOfFameRequests(myRequests);
}

async function refreshPendingHallOfFameRequests() {
  pendingRequests = await loadPendingHallOfFameRequests();
  renderPendingRequests(pendingRequests);
}

async function refreshHallOfFameHistory() {
  historyEntries = await loadHallOfFameHistory();
  renderHistory(historyEntries);
}

function renderMyHallOfFameRequests(entries) {
  const target = $("#hof-my-requests");
  if (!target) return;
  if (!entries.length) {
    target.innerHTML = '<div class="info-card">You have not submitted a Hall of Fame request yet.</div>';
    return;
  }
  target.innerHTML = `
    <div class="info-card">
      <strong>Your Hall of Fame request status</strong>
      <div class="hof-mini-list">
        ${entries.map(entry => `<span>${escapeHtml(entry.display_name)} ${badge(entry.status)}</span>`).join("")}
      </div>
    </div>
  `;
}

async function hydrateSubmitters(entries) {
  const ids = [...new Set(entries.map(entry => entry.submitted_by).filter(Boolean))];
  if (!ids.length) return entries;
  const { data, error } = await requireClient()
    .from("profiles")
    .select("id,first_name,email,current_class")
    .in("id", ids);
  if (error) return entries;
  const people = new Map((data || []).map(person => [person.id, person]));
  return entries.map(entry => ({ ...entry, submitter: people.get(entry.submitted_by) || null }));
}

function sortHallEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.is_seeded !== b.is_seeded) return a.is_seeded ? -1 : 1;
    const dateA = Date.parse(a.reviewed_at || a.submitted_at || a.created_at || 0);
    const dateB = Date.parse(b.reviewed_at || b.submitted_at || b.created_at || 0);
    if (dateA !== dateB) return dateB - dateA;
    return String(a.display_name).localeCompare(String(b.display_name));
  });
}

function validateRequest(displayName, displayClass, contribution, impact) {
  if (!displayName) return "Name is required.";
  if (!displayClass) return "Class is required.";
  if (!contribution) return "Question 1 is required.";
  if (!impact) return "Question 2 is required.";
  if (contribution.length < ANSWER_MIN) return `Question 1 must be at least ${ANSWER_MIN} characters.`;
  if (impact.length < ANSWER_MIN) return `Question 2 must be at least ${ANSWER_MIN} characters.`;
  if (contribution.length > ANSWER_MAX) return `Question 1 must be ${ANSWER_MAX} characters or fewer.`;
  if (impact.length > ANSWER_MAX) return `Question 2 must be ${ANSWER_MAX} characters or fewer.`;
  return "";
}

function extractYears(value) {
  const match = value.match(/\b(?:19|20)\d{2}\s*(?:-|to)\s*(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b/i);
  return match ? match[0].replace(/\s+/g, " ") : null;
}

function submitterLabel(entry) {
  if (!entry.submitter) return entry.submitted_by || "Unknown account";
  const person = entry.submitter;
  return `${person.first_name || "Unknown"} (${person.email || person.current_class || "profile"})`;
}

function setMessage(target, message, type) {
  if (!target) return;
  target.textContent = message || "";
  target.className = `form-message ${type || ""}`.trim();
}

function cleanError(err) {
  return context.errorMessage ? context.errorMessage(err) : err?.message || "Something went wrong.";
}
