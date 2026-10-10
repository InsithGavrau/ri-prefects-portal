import { requireClient } from "./supabase.js";
import { $, $$, escapeHtml, toast, setBusy, formatDate, badge } from "./ui.js";
import { Award, Crown, createIcons, Eye, ShieldCheck, Sparkles, X } from "lucide";

const TABLE = "hall_of_fame_entries";
const PHOTO_BUCKET = "hall-of-fame-photos";
const REQUEST_ROLES = new Set(["prefect", "coordinator"]);
const STAFF_ROLES = new Set(["teacher", "admin"]);
const ANSWER_MIN_WORDS = 10;
const ANSWER_MAX_WORDS = 70;
const PHOTO_MAX_SIZE = 2 * 1024 * 1024;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let context = {};
let approvedEntries = [];
let myRequests = [];
let pendingRequests = [];
let historyEntries = [];
let webglCleanup = null;

const HALL_ICONS = { Award, Crown, Eye, ShieldCheck, Sparkles, X };

function renderHallIcons() {
  createIcons({ icons: HALL_ICONS });
}

export async function hallOfFameFull(options) {
  context = options;
  const canRequest = REQUEST_ROLES.has(context.profile.role);
  const canReview = STAFF_ROLES.has(context.profile.role);
  const isAdmin = context.profile.role === "admin";

  context.layout(`
    <section class="hof-hero" data-hof-webgl-root>
      <div class="hof-hero-copy">
        <div class="hof-hero-brand">
          <span class="portal-wordmark"><img src="/assets/ri-prefects-wordmark-20261010.png" alt="RI Prefects Portal" width="2172" height="724" decoding="async"></span>
        </div>
        <p class="eyebrow">Royal Institute Prefects Guild</p>
        <h2>Wall of Honor</h2>
        <p>Celebrating leadership, service, discipline, and lasting contribution.</p>
        <div class="hof-values" aria-label="Wall of Honor values">
          <span><i data-lucide="shield-check" aria-hidden="true"></i>Leadership</span>
          <span><i data-lucide="sparkles" aria-hidden="true"></i>Service</span>
          <span><i data-lucide="award" aria-hidden="true"></i>Discipline</span>
        </div>
        <a class="hof-enter-link" href="#hof-archive"><span>Enter the archive</span><i data-lucide="eye" aria-hidden="true"></i></a>
      </div>
      <div class="hof-hero-visual" aria-hidden="true">
        <div class="hof-crown-fallback"><i data-lucide="crown"></i></div>
        <span>RI / Honor</span>
      </div>
    </section>

    <section class="hof-showcase section-gap" id="hof-archive">
      <div class="hof-carousel-toolbar">
        <div>
          <p class="eyebrow">Celebrated leadership</p>
          <h2>The Honor Roll</h2>
          <p>Approved leaders, lasting stories, and the standard future prefects can look up to.</p>
        </div>
        <div class="hof-archive-count" aria-live="polite"><strong data-hof-count>--</strong><span>honored profiles</span></div>
      </div>
      <div id="hof-approved" class="hof-carousel" aria-label="Wall of Honor entries">
        <div class="hof-inline-loader" role="status"><i data-lucide="crown" aria-hidden="true"></i><span>Curating the honor roll...</span></div>
      </div>
    </section>

    ${canRequest ? requestSectionMarkup() : ""}
    ${guidelinesMarkup()}
    ${isAdmin ? adminSectionMarkup() : ""}
      ${canReview ? reviewSectionMarkup() : ""}
  `);
  renderHallIcons();
  void startHallOfFameExperience();

  const jobs = [refreshApprovedHallOfFame()];
  if (canRequest) {
    bindRequestForm();
    jobs.push(refreshMyHallOfFameRequests());
  }
  if (isAdmin) bindAdminForm();
  if (canReview) {
    bindReviewActions();
    bindApprovedActions();
    jobs.push(refreshPendingHallOfFameRequests(), refreshHallOfFameHistory());
  }
  await Promise.all(jobs);
}

async function startHallOfFameExperience() {
  const root = $("[data-hof-webgl-root]");
  if (!root) return;
  try {
    const { mountHallOfFameWebGL } = await import("./hallOfFameWebGL.js");
    webglCleanup?.();
    webglCleanup = mountHallOfFameWebGL(root);
  } catch (error) {
    root.classList.add("hof-webgl-unavailable");
    console.warn("Hall of Fame scene could not start", error);
  }
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
  const photo = values.get("profile_image");
  const validation = validateRequest(displayName, displayClass, contribution, impact);

  if (validation) {
    setMessage(message, validation, "error");
    return;
  }
  const photoValidation = validatePhoto(photo);
  if (photoValidation) {
    setMessage(message, photoValidation, "error");
    return;
  }

  setBusy(button, true, "Submitting...");
  setMessage(message, "", "");
  try {
    const uploadedPhoto = await uploadHallOfFamePhoto(photo);
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
      profile_image_path: uploadedPhoto?.path || null,
      profile_image_url: uploadedPhoto?.url || null,
    };
    const { data, error } = await requireClient().from(TABLE).insert(payload).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your request was not saved. Please reload and try again.");
    form.reset();
    $$("[data-word-counter]", form).forEach(field => updateWordCounter({ currentTarget: field }));
    resetPhotoPreview();
    myRequests = [data, ...myRequests].slice(0, 10);
    renderMyHallOfFameRequests(myRequests);
    toast("Your Wall of Honor request has been submitted and is now being reviewed by teachers/admins.");
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
  const count = $("[data-hof-count]");
  if (count) count.textContent = String(entries.length).padStart(2, "0");
  if (!entries.length) {
    target.innerHTML = '<section class="hof-empty-state empty"><i data-lucide="crown" aria-hidden="true"></i><span>No approved Wall of Honor entries are available yet.</span></section>';
    renderHallIcons();
    return;
  }
  target.innerHTML = entries.map((entry, index) => {
    const summary = summarySnippet(entry.contribution_summary, "Recognised for meaningful service to the Prefects Guild.");
    const delay = Math.min(index * 70, 420);
    return `
      <article class="hof-card ${entry.is_seeded ? "seeded" : ""}" data-hof-card="${entry.id}" data-hof-tilt style="--hof-delay:${delay}ms" tabindex="0" role="button" aria-label="Open ${escapeHtml(entry.display_name)} details">
        <span class="hof-card-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <span class="hof-card-laurel" aria-hidden="true"></span>
        <div class="hof-card-photo">${profileImageMarkup(entry, "card")}</div>
        <div class="hof-card-body">
          <div class="hof-card-kicker">
            <span class="hof-pill">${entry.is_seeded ? "Head Prefect Legacy" : "Approved Leader"}</span>
            ${badge("approved")}
          </div>
          <h3>${escapeHtml(entry.display_name)}</h3>
          <p class="hof-title">${escapeHtml(entry.title || "Prefect")}</p>
          <p class="hof-summary">${escapeHtml(summary)}</p>
          <div class="hof-card-meta">
            ${entry.display_class ? `<span>Class ${escapeHtml(entry.display_class)}</span>` : ""}
            <span>${escapeHtml(entry.contribution_years || (entry.is_seeded ? "Honored Leadership Record" : "Leadership record"))}</span>
          </div>
          <div class="hof-card-footer">
            <span>Read legacy <i data-lucide="eye" aria-hidden="true"></i></span>
            ${STAFF_ROLES.has(context.profile?.role) ? `<button type="button" class="btn ghost small" data-hof-remove="${entry.id}">Remove</button>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
  bindApprovedCards(target);
  renderHallIcons();
}

function bindApprovedCards(target) {
  if (target.dataset.hofBound === "true") return;
  target.addEventListener("click", event => {
    if (event.target.closest("[data-hof-remove]")) return;
    const card = event.target.closest("[data-hof-card]");
    if (!card) return;
    const entry = approvedEntries.find(item => item.id === card.dataset.hofCard);
    if (entry) openHallOfFameDetailModal(entry);
  });
  target.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key)) return;
    const card = event.target.closest("[data-hof-card]");
    if (!card) return;
    event.preventDefault();
    const entry = approvedEntries.find(item => item.id === card.dataset.hofCard);
    if (entry) openHallOfFameDetailModal(entry);
  });
  if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
    target.addEventListener("pointermove", event => {
      const card = event.target.closest("[data-hof-tilt]");
      if (!card) return;
      const bounds = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      card.style.setProperty("--hof-rotate-x", `${(0.5 - y) * 5.5}deg`);
      card.style.setProperty("--hof-rotate-y", `${(x - 0.5) * 7}deg`);
      card.style.setProperty("--hof-glow-x", `${x * 100}%`);
      card.style.setProperty("--hof-glow-y", `${y * 100}%`);
    });
    target.addEventListener("pointerout", event => {
      const card = event.target.closest("[data-hof-tilt]");
      if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) return;
      card.style.removeProperty("--hof-rotate-x");
      card.style.removeProperty("--hof-rotate-y");
      card.style.removeProperty("--hof-glow-x");
      card.style.removeProperty("--hof-glow-y");
    });
  }
  target.dataset.hofBound = "true";
}

function summarySnippet(value, fallback) {
  const words = String(value || fallback || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 24) return words.join(" ");
  return `${words.slice(0, 24).join(" ")}...`;
}

function profileImageMarkup(entry, variant = "card") {
  const src = hallPhotoUrl(entry);
  const alt = `${entry.display_name || "Wall of Honor"} portrait`;
  if (src) return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
  return `<div class="hof-initials hof-initials-${escapeHtml(variant)}" aria-hidden="true">${escapeHtml(initials(entry.display_name))}</div>`;
}

function hallPhotoUrl(entry) {
  if (entry.profile_image_url) return entry.profile_image_url;
  if (!entry.profile_image_path) return "";
  const { data } = requireClient().storage.from(PHOTO_BUCKET).getPublicUrl(entry.profile_image_path);
  return data?.publicUrl || "";
}

function openHallOfFameDetailModal(entry) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop hof-detail-backdrop";
  modal.innerHTML = `
    <section class="modal hof-detail-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(entry.display_name)} details">
      <button type="button" class="modal-close" data-close-hof-detail aria-label="Close"><i data-lucide="x" aria-hidden="true"></i></button>
      <div class="hof-detail-media">${profileImageMarkup(entry, "detail")}</div>
      <div class="hof-detail-copy">
        <div class="hof-detail-seal"><i data-lucide="crown" aria-hidden="true"></i><span>${entry.is_seeded ? "Head Prefect Legacy" : "Approved Honor"}</span></div>
        <h2>${escapeHtml(entry.display_name)}</h2>
        <p class="hof-title">${escapeHtml(entry.title || "Prefect")}</p>
        <div class="hof-detail-facts">
          ${entry.display_class ? `<span>Class: ${escapeHtml(entry.display_class)}</span>` : ""}
          ${entry.contribution_years ? `<span>Years: ${escapeHtml(entry.contribution_years)}</span>` : ""}
        </div>
        <div class="hof-detail-section">
          <strong>Contribution</strong>
          <p>${escapeHtml(entry.contribution_summary || "Recognised for meaningful service to the Prefects Guild.")}</p>
        </div>
        <div class="hof-detail-section">
          <strong>Leadership impact</strong>
          <p>${escapeHtml(entry.leadership_impact || "Celebrated for leadership, discipline, and lasting contribution.")}</p>
        </div>
      </div>
    </section>
  `;
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    modal.remove();
  };
  const onKeydown = event => {
    if (event.key === "Escape") close();
  };
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest("[data-close-hof-detail]")) close();
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(modal);
  renderHallIcons();
  $("[data-close-hof-detail]", modal)?.focus();
}

export function startHallOfFameGoldParticles(durationMs = 10000) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelector("[data-hof-particles]")?.remove();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let animationId = 0;
  let particles = [];
  const startedAt = performance.now();

  canvas.className = "hof-particles";
  canvas.dataset.hofParticles = "true";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle(y = -20) {
    return {
      x: Math.random() * window.innerWidth,
      y: y - Math.random() * window.innerHeight * 0.25,
      size: 3 + Math.random() * 5,
      speed: 0.55 + Math.random() * 1.35,
      drift: -0.35 + Math.random() * 0.7,
      alpha: 0.42 + Math.random() * 0.46,
      spin: Math.random() * Math.PI,
    };
  }

  function cleanup() {
    cancelAnimationFrame(animationId);
    window.removeEventListener("resize", resize);
    canvas.remove();
  }

  function tick(now) {
    const elapsed = now - startedAt;
    const fade = Math.max(0, 1 - Math.max(0, elapsed - durationMs + 1200) / 1200);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    particles.forEach(particle => {
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.spin += 0.02;
      if (particle.y > window.innerHeight + 20) Object.assign(particle, makeParticle(-20), { y: -20 });

      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.spin);
      ctx.globalAlpha = particle.alpha * fade;
      ctx.shadowColor = "rgba(254, 254, 214, 0.55)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = particle.size > 5 ? "#FEFED6" : "#C9A646";
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
      ctx.restore();
    });

    if (elapsed < durationMs) animationId = requestAnimationFrame(tick);
    else cleanup();
  }

  resize();
  particles = Array.from(
    { length: Math.min(120, Math.max(46, Math.floor(window.innerWidth / 12))) },
    () => makeParticle(0),
  );
  window.addEventListener("resize", resize);
  animationId = requestAnimationFrame(tick);
  window.setTimeout(cleanup, durationMs + 1500);
}

export function renderPendingRequests(entries) {
  const target = $("#hof-pending-list");
  if (!target) return;
  if (!entries.length) {
    target.innerHTML = '<section class="card empty">No Wall of Honor requests are pending review.</section>';
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
    target.innerHTML = '<section class="card empty">No Wall of Honor records match this filter.</section>';
    return;
  }
  target.innerHTML = rows.map(entry => `
    <article class="hof-history-card card" data-entry="${entry.id}">
      <div class="section-heading">
        <div>
          <p class="eyebrow">${entry.is_seeded ? "Seeded default" : "Wall of Honor record"}</p>
          <h3>${escapeHtml(entry.display_name)}</h3>
          <p>${escapeHtml(entry.title)} | ${escapeHtml(entry.display_class || "No class")}</p>
        </div>
        ${badge(entry.status)}
      </div>
      <p>${escapeHtml(entry.contribution_summary || "No contribution summary recorded.")}</p>
      ${entry.review_note ? `<div class="hof-answer"><strong>Review note</strong><p>${escapeHtml(entry.review_note)}</p></div>` : ""}
      ${context.profile.role === "admin" ? `<div class="actions"><button type="button" class="btn secondary" data-hof-history-status="approved">Approve</button><button type="button" class="btn ghost" data-hof-history-status="declined">Decline</button><button type="button" class="btn ghost" data-hof-history-status="archived">Archive</button><button type="button" class="btn danger" data-hof-remove="${entry.id}">Remove</button></div>` : STAFF_ROLES.has(context.profile.role) ? `<div class="actions"><button type="button" class="btn danger" data-hof-remove="${entry.id}">Remove</button></div>` : ""}
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
          <textarea name="contribution_summary" required data-word-counter="contribution"></textarea>
          <small><span data-word-count-for="contribution">0 / ${ANSWER_MAX_WORDS} words</span> - minimum ${ANSWER_MIN_WORDS} words.</small>
        </div>
        <div class="field full">
          <label>Why do you believe you have made a meaningful change to the school, whether through the school environment, discipline, leadership, or in general?</label>
          <textarea name="leadership_impact" required data-word-counter="impact"></textarea>
          <small><span data-word-count-for="impact">0 / ${ANSWER_MAX_WORDS} words</span> - minimum ${ANSWER_MIN_WORDS} words.</small>
        </div>
        <div class="field full hof-photo-field">
          <label>Profile picture</label>
          <input type="file" name="profile_image" accept="image/jpeg,image/png,image/webp" data-hof-photo-input>
          <small>Optional JPG, PNG, or WebP image. Maximum 2MB.</small>
          <div class="hof-photo-preview" data-hof-photo-preview>
            <span>No image selected</span>
          </div>
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
    <section class="hof-guidelines section-gap">
      <p class="eyebrow">Selection guidance</p>
      <h2>Criteria for Wall of Honor Consideration</h2>
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
    <section class="card section-gap" id="hof-admin-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Admin management</p>
          <h2>Add Wall of Honor Entry</h2>
          <p>Create an approved record directly without marking it as a seeded default.</p>
        </div>
      </div>
      <form id="hof-admin-form" class="form-grid" novalidate>
        <div class="field"><label>Name</label><input name="display_name" required maxlength="120"></div>
        <div class="field"><label>Class</label><input name="display_class" maxlength="80"></div>
        <div class="field"><label>Title</label><input name="title" required maxlength="100" value="Head Prefect"></div>
        <div class="field"><label>Status</label><select name="status"><option>approved</option><option>pending</option><option>declined</option><option>archived</option></select></div>
        <div class="field full"><label>Contribution years</label><input name="contribution_years" maxlength="160" placeholder="Example: 2024 to 2026"></div>
        <div class="field full"><label>Contribution summary</label><textarea name="contribution_summary" maxlength="900"></textarea></div>
        <div class="field full"><label>Leadership impact</label><textarea name="leadership_impact" maxlength="900"></textarea></div>
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
          <h2>Pending Wall of Honor Requests</h2>
        </div>
      </div>
      <div id="hof-pending-list" class="hof-review-list"><section class="card empty">Loading Wall of Honor requests...</section></div>
    </section>
    <section class="section-gap" id="hof-history-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Request history</p>
          <h2>Reviewed Wall of Honor Requests</h2>
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
      <div id="hof-history-list" class="hof-review-list"><section class="empty">Loading reviewed Wall of Honor requests...</section></div>
    </section>
  `;
}

function bindRequestForm() {
  const form = $("#hof-request-form");
  form?.addEventListener("submit", submitHallOfFameRequest);
  $$("[data-word-counter]", form).forEach(field => {
    field.addEventListener("input", updateWordCounter);
    updateWordCounter({ currentTarget: field });
  });
  $("[data-hof-photo-input]", form)?.addEventListener("change", updatePhotoPreview);
  $("[data-hof-cancel]")?.addEventListener("click", () => {
    form?.reset();
    $$("[data-word-counter]", form).forEach(field => updateWordCounter({ currentTarget: field }));
    resetPhotoPreview();
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
      setMessage(message, "Wall of Honor entry added.", "success");
      toast("Wall of Honor entry added.");
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

function bindApprovedActions() {
  $("#hof-approved")?.addEventListener("click", event => {
    const button = event.target.closest("[data-hof-remove]");
    if (!button) return;
    const entry = approvedEntries.find(item => item.id === button.dataset.hofRemove);
    openRemoveHallOfFameModal(button.dataset.hofRemove, entry?.display_name || "this Wall of Honor entry");
  });
  $("#hof-history-section")?.addEventListener("click", event => {
    const button = event.target.closest("[data-hof-remove]");
    if (!button) return;
    const entry = historyEntries.find(item => item.id === button.dataset.hofRemove);
    openRemoveHallOfFameModal(button.dataset.hofRemove, entry?.display_name || "this Wall of Honor entry");
  });
}

function openRemoveHallOfFameModal(entryId, displayName) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="card modal">
      <p class="eyebrow">Confirm removal</p>
      <h2>Remove Wall of Honor entry?</h2>
      <p>Are you sure you want to remove this Wall of Honor entry from the public Wall of Honor? This will archive it from the visible Wall of Honor list, but keep the record for audit history.</p>
      <p><strong>${escapeHtml(displayName)}</strong></p>
      <div class="form-message" data-hof-remove-message></div>
      <div class="actions">
        <button type="button" class="btn danger" data-confirm-hof-remove>Yes, remove entry</button>
        <button type="button" class="btn ghost" data-cancel-hof-remove>Cancel</button>
      </div>
    </section>
  `;
  document.body.append(modal);
  $("[data-cancel-hof-remove]", modal).addEventListener("click", () => modal.remove());
  $("[data-confirm-hof-remove]", modal).addEventListener("click", async event => {
    const button = event.currentTarget;
    const message = $("[data-hof-remove-message]", modal);
    setBusy(button, true, "Removing...");
    try {
      await removeHallOfFameEntry(entryId, displayName);
      modal.remove();
    } catch (err) {
      setMessage(message, cleanError(err), "error");
      setBusy(button, false);
    }
  });
}

async function removeHallOfFameEntry(entryId, displayName) {
  const { data, error } = await requireClient()
    .from(TABLE)
    .update({
      status: "archived",
      reviewed_by: context.profile.id,
      reviewed_at: new Date().toISOString(),
      review_note: `Removed from public Wall of Honor by ${context.profile.first_name || context.profile.role}.`,
    })
    .eq("id", entryId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Supabase did not archive this Wall of Honor entry. Check the Wall of Honor RLS migration, then reload.");
  await writeHallOfFameAudit(entryId, displayName);
  toast("Wall of Honor entry removed from the public list.");
  await Promise.all([refreshApprovedHallOfFame(), refreshPendingHallOfFameRequests(), refreshHallOfFameHistory()]);
}

async function writeHallOfFameAudit(entryId, displayName) {
  const { error } = await requireClient().from("audit_logs").insert({
    user_id: context.profile.id,
    actor_profile_id: context.profile.id,
    action: "HALL_OF_FAME_ARCHIVED",
    table_name: TABLE,
    record_id: entryId,
    details: { display_name: displayName },
  });
  if (error && error.code !== "42501" && !/permission denied|row-level security/i.test(error.message || "")) {
    console.warn("Wall of Honor audit insert failed", error);
  }
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
    const err = new Error("Supabase did not update this Wall of Honor request. Check the RLS migration, then reload.");
    toast(err.message, "error");
    throw err;
  }
  toast(status === "approved" ? "Wall of Honor request approved." : status === "declined" ? "Wall of Honor request declined." : "Wall of Honor record updated.");
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
    target.innerHTML = '<div class="info-card">You have not submitted a Wall of Honor request yet.</div>';
    return;
  }
  target.innerHTML = `
    <div class="info-card">
      <strong>Your Wall of Honor request status</strong>
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
  const contributionWords = countWords(contribution);
  const impactWords = countWords(impact);
  if (contributionWords < ANSWER_MIN_WORDS) return `Question 1 must be at least ${ANSWER_MIN_WORDS} words.`;
  if (impactWords < ANSWER_MIN_WORDS) return `Question 2 must be at least ${ANSWER_MIN_WORDS} words.`;
  if (contributionWords > ANSWER_MAX_WORDS) return `Question 1 must be ${ANSWER_MAX_WORDS} words or fewer.`;
  if (impactWords > ANSWER_MAX_WORDS) return `Question 2 must be ${ANSWER_MAX_WORDS} words or fewer.`;
  return "";
}

function validatePhoto(file) {
  if (!file || typeof file === "string" || file.size === 0) return "";
  if (!PHOTO_MIME_TYPES.has(file.type)) return "Profile picture must be a JPG, PNG, or WebP image.";
  if (file.size > PHOTO_MAX_SIZE) return "Profile picture must be 2MB or smaller.";
  return "";
}

async function uploadHallOfFamePhoto(file) {
  if (!file || typeof file === "string" || file.size === 0) return null;
  const extension = photoExtension(file);
  const random = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${context.profile.id}/${random}.${extension}`;
  const { error } = await requireClient().storage
    .from(PHOTO_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (error) throw error;
  const { data } = requireClient().storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { path, url: data?.publicUrl || null };
}

function photoExtension(file) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function countWords(value = "") {
  return String(value).trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCounter(event) {
  const field = event.currentTarget;
  const key = field.dataset.wordCounter;
  const target = $(`[data-word-count-for="${key}"]`);
  if (!target) return;
  const total = countWords(field.value);
  target.textContent = `${total} / ${ANSWER_MAX_WORDS} words`;
  target.classList.toggle("over-limit", total > ANSWER_MAX_WORDS);
  target.classList.toggle("under-limit", total > 0 && total < ANSWER_MIN_WORDS);
}

function updatePhotoPreview(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  const target = $("[data-hof-photo-preview]");
  if (!target) return;
  const error = validatePhoto(file);
  if (error) {
    input.value = "";
    target.innerHTML = `<span>${escapeHtml(error)}</span>`;
    target.classList.add("error");
    return;
  }
  target.classList.remove("error");
  if (!file) {
    resetPhotoPreview();
    return;
  }
  if (target.dataset.previewUrl) URL.revokeObjectURL(target.dataset.previewUrl);
  const url = URL.createObjectURL(file);
  target.innerHTML = `<img src="${url}" alt="Selected profile preview"><span>${escapeHtml(file.name)}</span>`;
  target.dataset.previewUrl = url;
}

function resetPhotoPreview() {
  const target = $("[data-hof-photo-preview]");
  if (!target) return;
  if (target.dataset.previewUrl) URL.revokeObjectURL(target.dataset.previewUrl);
  target.dataset.previewUrl = "";
  target.classList.remove("error");
  target.innerHTML = "<span>No image selected</span>";
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

function initials(name = "RI") {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "RI";
}

function setMessage(target, message, type) {
  if (!target) return;
  target.textContent = message || "";
  target.className = `form-message ${type || ""}`.trim();
}

function cleanError(err) {
  return context.errorMessage ? context.errorMessage(err) : err?.message || "Something went wrong.";
}
