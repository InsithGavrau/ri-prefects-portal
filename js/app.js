import { supabase, requireClient } from "./supabase.js";
import { $, $$, escapeHtml, toast, setBusy, formatDate, badge, initQuote, drawBackground } from "./ui.js";
import { isConfigured } from "./config.js";
import { pageTitles, roleHome, roleNav } from "./router.js";
import { signInWithPassword, signOut, signUpPrefect } from "./auth.js";
import { hallOfFameFull } from "./hallOfFame.js";

const page = document.body.dataset.page;
const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Any"];
const DUTY_NAMES = ["Checkpoint Duty", "Floor Duty", "Canteen Duty"];
const LOCATIONLESS_VALUE = "__no_location__";
const SESSION_STATE_OPTIONS = [
  ["recorded", "Recorded"],
  ["corrected", "Corrected"],
  ["flagged", "Flagged"],
];
const removedDutyName = ["Bag", "Checking", "Duty"].join(" ");
const removedLocationNames = [["Front", "Entrance"].join(" "), ["Back", "Entrance"].join(" ")];
let currentUser = null;
let profile = null;
let attendanceRows = [];

function setupNotice() {
  const el = $("[data-setup]");
  if (el && !isConfigured()) {
    el.innerHTML = '<div class="setup-warning">Setup required: paste the project publishable/anon key into <strong>js/config.js</strong>.</div>';
  }
}
function navMarkup(role) {
  return (roleNav[role] || []).map(([href, label]) => `<a class="nav-link ${location.pathname.endsWith(href) ? "active" : ""}" href="${href}">${label}</a>`).join("");
}
function normalizeText(value) {
  const mojibakeDash = String.fromCharCode(0xe2, 0x20ac, 0x201d);
  const mojibakeDot = String.fromCharCode(0xc2, 0xb7);
  return value.replaceAll(mojibakeDash, " - ").replaceAll(mojibakeDot, " | ");
}
function footerMarkup(auth = false) {
  return `<footer class="portal-footer ${auth ? "auth-footer" : ""}">System developed by Insith Liyana Arachchi | 2026 Headboard <span>|</span> <a href="mailto:insith6969@gmail.com">Technical Issues</a> <span>|</span> <a href="PASTE_INSITH_LINKEDIN_URL_HERE">LinkedIn</a></footer>`;
}
function brandMarkup(compact = false) {
  return `<img class="crest" src="assets/rilogo.png" alt="Royal Institute logo"><div><strong>${compact ? "RI Prefects Portal" : "Royal Institute Prefects Portal"}</strong><span>The light of Learning</span></div>`;
}
function layout(content) {
  const [title, subtitle] = pageTitles[page] || ["Prefects Portal", ""];
  content = normalizeText(content);
  $("#app").innerHTML = `
    <div class="top-strip">Royal Institute Prefects Portal | ${escapeHtml(profile.first_name)} | ${escapeHtml(profile.role)}</div>
    <header class="brandbar">${brandMarkup()}</header>
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">${brandMarkup(true)}</div>
        <p class="nav-title">${escapeHtml(profile.role)} portal</p>
        ${navMarkup(profile.role)}
        <button class="btn ghost logout" data-logout>Sign out</button>
      </aside>
      <main class="main">
        <header class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><span>${new Intl.DateTimeFormat("en-LK", { dateStyle: "full" }).format(new Date())}</span></header>
        ${content}
        ${footerMarkup()}
      </main>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">${navMarkup(profile.role)}</nav>`;
  $$("[data-logout]").forEach(el => el.addEventListener("click", logout));
  initQuote();
  animateCounters();
  const notice = sessionStorage.getItem("portal-notice");
  if (notice) {
    sessionStorage.removeItem("portal-notice");
    toast(notice, "error");
  }
}
function animateCounters() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  $$(".stat strong").forEach(el => {
    const match = el.textContent.trim().match(/^(\d+)(%)?$/);
    if (!match) return;
    const target = Number(match[1]);
    const suffix = match[2] || "";
    if (!target) return;
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 500);
      el.textContent = `${Math.round(target * (1 - Math.pow(1 - progress, 3)))}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function logout() {
  await signOut();
  location.replace("login.html");
}
async function getProfile(id) {
  const { data, error } = await requireClient().from("profiles").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function guard() {
  if (!isConfigured()) {
    location.replace("login.html");
    return false;
  }
  const { data: { session }, error } = await requireClient().auth.getSession();
  if (error || !session) {
    location.replace("login.html");
    return false;
  }
  currentUser = session.user;
  try {
    profile = await getProfile(currentUser.id);
  } catch (err) {
    toast(`Profile unavailable: ${err.message}`, "error");
    return false;
  }
  if (["inactive", "rejected"].includes(profile.account_status)) {
    await requireClient().auth.signOut();
    location.replace("login.html?inactive=1");
    return false;
  }
  if (profile.role !== "prefect" && profile.account_status !== "active") {
    await requireClient().auth.signOut();
    location.replace("login.html?inactive=1");
    return false;
  }
  const required = (document.body.dataset.role || "").split(",").map(value => value.trim()).filter(Boolean);
  const allowed = required.includes(profile.role) || profile.role === "admin";
  if (!allowed) {
    sessionStorage.setItem("portal-notice", `This page is for ${required.join(" or ")} accounts. You are signed in as ${profile.role} (${profile.account_status}). Ask an admin to promote/activate this account, or sign out and use a staff account.`);
    location.replace(roleHome[profile.role] || "login.html");
    return false;
  }
  return true;
}
function errorMessage(err) {
  const message = err?.message || "Something went wrong.";
  if (err?.status === 429 || /rate limit/i.test(message)) return "Supabase's project email quota is temporarily exhausted. Do not keep retrying. For this prototype, disable Confirm email in Supabase Auth settings; for production, configure custom SMTP.";
  if (isMissingAssignmentScopeError(err)) return "Your Supabase database is missing the assignment_scope column. Run sql/update-floor-duty-permanent-assignments.sql in the Supabase SQL Editor, then run sql/make-coordinator-attendance-official.sql.";
  if (err?.code === "PGRST205" || /schema cache|could not find the table/i.test(message)) return "The Supabase portal tables are not installed yet. Run schema.sql, rls-policies.sql, seed-duty-options.sql, then the new migration files in the project's SQL Editor.";
  if (err?.code === "23505" || /duplicate key/i.test(message)) return "That record already exists. Review the existing session or assignment, or choose a different combination.";
  if (err?.code === "23503" || /foreign key/i.test(message)) return "A linked record is missing in Supabase. Re-run the schema and seed SQL, then reload this page.";
  if (err?.code === "42501" || /row-level security|permission denied/i.test(message)) return "Supabase blocked this action with row-level security. Check that your account role is active and that the RLS policies have been installed.";
  return message;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function schoolDateISO() {
  const d = new Date();
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  if (day === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rowsOrEmpty(rows, columns, message = "No records found.") {
  return rows.length ? rows.join("") : `<tr><td class="empty" colspan="${columns}">${message}</td></tr>`;
}
async function count(table, apply = q => q) {
  const { count: total, error } = await apply(requireClient().from(table).select("id", { count: "exact" }).limit(0));
  if (error) throw error;
  return total || 0;
}

function isRemovedDutyType(name = "") {
  return String(name).trim().toLowerCase() === removedDutyName.toLowerCase();
}
function isRemovedLocation(name = "") {
  return removedLocationNames.some(removed => String(name).trim().toLowerCase() === removed.toLowerCase());
}
function isAllowedDutyType(name = "") {
  return DUTY_NAMES.includes(String(name).trim());
}
function isFloorDuty(name = "") {
  return String(name).trim() === "Floor Duty";
}
function isCheckpointDuty(name = "") {
  return String(name).trim() === "Checkpoint Duty";
}
function requiresAssignedDay(dutyTypeName = "") {
  return !isFloorDuty(dutyTypeName);
}
function requiresLocation(dutyTypeName = "") {
  return !isCheckpointDuty(dutyTypeName);
}
function isMissingAssignmentScopeError(err) {
  const message = `${err?.message || ""} ${err?.details || ""} ${err?.hint || ""}`;
  return /assignment_scope/i.test(message) && /(does not exist|schema cache|column|not find)/i.test(message);
}
function assignmentScope(assignment) {
  return assignment?.assignment_scope || (isFloorDuty(assignment?.duty_type?.name) ? "permanent" : "weekday");
}
function orderDutyTypes(types) {
  return [...types].sort((a, b) => DUTY_NAMES.indexOf(a.name) - DUTY_NAMES.indexOf(b.name));
}
function cleanDutyTypes(types, workflowOnly = true) {
  return orderDutyTypes((types || []).filter(type => !isRemovedDutyType(type.name) && (!workflowOnly || isAllowedDutyType(type.name))));
}
function cleanLocations(locations) {
  return (locations || []).filter(location => !isRemovedLocation(location.name || location.location_name || "") && !isRemovedDutyType(location.duty_type?.name || ""));
}
function formatLocationName(location) {
  if (!location) return "No specific location";
  const name = location.name || location.location_name || "";
  if (!name) return "No specific location";
  return location.group_name ? `${location.group_name} - ${name}` : name;
}
function formatAssignmentDay(assignment) {
  return assignmentScope(assignment) === "permanent" ? "Permanent / Until changed" : (assignment?.assigned_day || "Not set");
}
function formatAssignmentType(assignment) {
  return assignmentScope(assignment) === "permanent" ? "Permanent / Until changed" : "Weekday assignment";
}
function sessionStateLabel(state = "recorded") {
  return ({
    pending: "Recorded",
    recorded: "Recorded",
    approved: "Corrected",
    corrected: "Corrected",
    rejected: "Flagged",
    flagged: "Flagged",
  })[state] || state || "Recorded";
}
function sessionStateClass(state = "recorded") {
  return ({
    pending: "recorded",
    approved: "corrected",
    rejected: "flagged",
  })[state] || state || "recorded";
}
function sessionBadge(state) {
  return `<span class="badge ${escapeHtml(sessionStateClass(state))}">${escapeHtml(sessionStateLabel(state))}</span>`;
}
function sessionStateOptionsMarkup() {
  return SESSION_STATE_OPTIONS.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("");
}
function optionRows(items) {
  return items.map(item => `<option value="${item.id}">${escapeHtml(formatLocationName(item))}</option>`).join("");
}
async function getActiveDutyTypes() {
  const { data, error } = await requireClient().from("duty_types").select("*").eq("is_active", true).order("name");
  if (error) throw error;
  return cleanDutyTypes(data, true);
}
async function getDutyTypesForAdmin() {
  const { data, error } = await requireClient().from("duty_types").select("*").order("name");
  if (error) throw error;
  return cleanDutyTypes(data, false);
}
async function getAllActiveLocations() {
  const { data, error } = await requireClient().from("duty_locations").select("*,duty_type:duty_types(id,name)").eq("is_active", true).order("sort_order").order("name");
  if (error) throw error;
  return cleanLocations(data);
}
async function getDutyLocationsByDutyType(dutyTypeId, dutyTypes = null) {
  const type = dutyTypes?.find(item => item.id === dutyTypeId);
  if (type && isCheckpointDuty(type.name)) return [];
  const { data, error } = await requireClient().from("duty_locations").select("*,duty_type:duty_types(id,name)").eq("duty_type_id", dutyTypeId).eq("is_active", true).order("sort_order").order("name");
  if (error) throw error;
  return cleanLocations(data);
}
async function getActiveCoordinators() {
  const { data, error } = await requireClient().from("profiles").select("id,first_name").eq("role", "coordinator").eq("account_status", "active").order("first_name");
  if (error) throw error;
  return data || [];
}
async function getSessionsWithFilters(filters = {}) {
  let query = requireClient().from("attendance_sessions")
    .select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name),coordinator:profiles!coordinator_profile_id(first_name),attendance_records(id,status,note,teacher_note,prefect:profiles!prefect_profile_id(first_name,current_class))")
    .order("attendance_date", { ascending: false })
    .limit(250);
  if (filters.from) query = query.gte("attendance_date", filters.from);
  if (filters.to) query = query.lte("attendance_date", filters.to);
  if (filters.duty_type_id) query = query.eq("duty_type_id", filters.duty_type_id);
  if (filters.coordinator_profile_id) query = query.eq("coordinator_profile_id", filters.coordinator_profile_id);
  if (filters.session_status) {
    const legacyStateMap = {
      recorded: ["recorded", "pending"],
      corrected: ["corrected", "approved"],
      flagged: ["flagged", "rejected"],
    };
    query = query.in("review_status", legacyStateMap[filters.session_status] || [filters.session_status]);
  }
  if (filters.duty_location_id === null) query = query.is("duty_location_id", null);
  else if (filters.duty_location_id) query = query.eq("duty_location_id", filters.duty_location_id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
function locationFilterOptions(type, locations) {
  if (!type) return '<option value="">All locations</option>';
  if (isCheckpointDuty(type.name)) return `<option value="">All locations</option><option value="${LOCATIONLESS_VALUE}">No specific location</option>`;
  return `<option value="">All locations</option>${optionRows(locations)}`;
}

async function initLogin() {
  setupNotice();
  drawBackground();
  const params = new URLSearchParams(location.search);
  if (params.get("inactive")) toast("This account is inactive or rejected. Ask a teacher or administrator for help.", "error");
  if (params.get("confirmed")) toast("Email confirmed. You can sign in now.");
  if (params.get("setup")) toast("Authentication worked, but the database tables are not installed yet.", "error");
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      try {
        const p = await getProfile(session.user.id);
        const notice = $("[data-setup]");
        notice.innerHTML = `<div class="setup-warning success"><strong>Already signed in as ${escapeHtml(p.first_name)} (${escapeHtml(p.role)}).</strong><div class="actions"><a class="btn" href="${roleHome[p.role] || "prefect-dashboard.html"}">Continue to dashboard</a><button class="btn ghost" type="button" data-clear-session>Sign out / switch account</button></div></div>`;
        $("[data-clear-session]")?.addEventListener("click", async () => {
          await signOut();
          location.reload();
        });
      } catch (err) {
        await supabase.auth.signOut();
        toast(errorMessage(err), "error");
      }
    }
  }
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button[type=submit]", e.currentTarget);
    setBusy(btn, true, "Signing in...");
    try {
      const f = new FormData(e.currentTarget);
      const { data, error } = await signInWithPassword(f.get("email"), f.get("password"));
      if (error) throw error;
      const p = await getProfile(data.user.id);
      toast("Signed in.");
      location.replace(roleHome[p.role] || "login.html");
    } catch (err) {
      await signOut();
      toast(errorMessage(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });
}
async function initSignup() {
  setupNotice();
  drawBackground();
  const form = $("#signup-form");
  const status = $("#signup-status");
  const button = $("button[type=submit]", form);
  const cooldownKey = "ri-signup-last-attempt";
  const showStatus = (message, type = "error") => {
    status.innerHTML = `<div class="setup-warning ${type}">${escapeHtml(message)}</div>`;
  };
  const updateCooldown = () => {
    const remaining = Math.ceil((Number(localStorage.getItem(cooldownKey) || 0) + 60000 - Date.now()) / 1000);
    if (remaining > 0) {
      button.disabled = true;
      button.textContent = `Try again in ${remaining}s`;
      setTimeout(updateCooldown, 1000);
    } else if (button.disabled) {
      button.disabled = false;
      button.textContent = "Create account";
    }
  };
  updateCooldown();
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(form);
    const password = String(f.get("password"));
    if (password !== f.get("confirm_password")) {
      toast("Passwords do not match.", "error");
      return;
    }
    localStorage.setItem(cooldownKey, String(Date.now()));
    setBusy(button, true, "Creating account...");
    try {
      const { data, error } = await signUpPrefect({
        email: f.get("email"),
        password,
        firstName: f.get("first_name"),
        phone: f.get("phone"),
        currentClass: f.get("current_class"),
        redirectTo: `${location.origin}/login.html?confirmed=1`,
      });
      if (error) throw error;
      if (data.session) {
        toast("Account created. Your prefect account is pending approval.");
        location.replace("prefect-dashboard.html");
      } else {
        showStatus("Account created. Check your inbox and confirm your email before signing in.", "success");
        form.reset();
        $$("input,button", form).forEach(el => { el.disabled = true; });
      }
    } catch (err) {
      const message = errorMessage(err);
      showStatus(message);
      toast(message, "error");
      setBusy(button, false);
      updateCooldown();
    }
  });
}

async function prefectProfile() {
  const [{ data: assignments, error: assignmentError }, { data: records, error: recordError }] = await Promise.all([
    requireClient().from("prefect_duty_assignments").select("id,assignment_status").eq("prefect_profile_id", profile.id),
    requireClient().from("attendance_records").select("id,status").eq("prefect_profile_id", profile.id),
  ]);
  if (assignmentError || recordError) throw assignmentError || recordError;
  const attendanceRate = records.length ? Math.round(records.filter(row => row.status === "present").length / records.length * 100) : 0;
  layout(`<div class="grid cards"><article class="card stat"><strong>${assignments.length}</strong><span>Duty selections</span></article><article class="card stat"><strong>${assignments.filter(row => row.assignment_status === "active").length}</strong><span>Active duties</span></article><article class="card stat"><strong>${records.length}</strong><span>Attendance records</span></article><article class="card stat"><strong>${attendanceRate}%</strong><span>Present rate</span></article></div><div class="grid two section-gap"><section class="card"><div class="section-heading"><div><p class="eyebrow">Personal record</p><h2>Profile details</h2></div>${badge(profile.account_status)}</div><form id="standalone-profile-form" class="form-grid"><div class="field"><label>First name</label><input value="${escapeHtml(profile.first_name)}" disabled><small>First names are managed with your identity record.</small></div><div class="field"><label>Email</label><input value="${escapeHtml(profile.email || currentUser.email)}" disabled></div><div class="field"><label>Telephone number</label><input name="phone" type="tel" value="${escapeHtml(profile.phone || "")}" required maxlength="30"></div><div class="field"><label>Current class</label><input name="current_class" value="${escapeHtml(profile.current_class || "")}" required maxlength="80"></div><div class="field"><label>Portal role</label><input value="${escapeHtml(profile.role)}" disabled></div><div class="field"><label>Account status</label><input value="${escapeHtml(profile.account_status)}" disabled></div><div class="field full"><button class="btn">Save profile changes</button></div></form>${profile.account_status === "pending" ? '<div class="setup-warning">Your prefect account is pending approval. You can prepare duty selections while a teacher or administrator reviews your account.</div>' : ""}</section><section class="card quote"><p class="eyebrow">Prefect Motivation</p><h2>Lead with purpose</h2><p data-quote></p><button class="btn secondary" data-new-quote>New Quote</button></section></div>`);
  $("#standalone-profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button", form);
    const values = new FormData(form);
    setBusy(button, true, "Saving...");
    try {
      const { error } = await requireClient().from("profiles").update({ phone: String(values.get("phone")).trim(), current_class: String(values.get("current_class")).trim() }).eq("id", profile.id);
      if (error) throw error;
      profile.phone = String(values.get("phone")).trim();
      profile.current_class = String(values.get("current_class")).trim();
      toast("Profile details updated.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  });
}
async function prefectDashboardFull() {
  const [{ data: assignments, error: ae }, { data: records, error: re }] = await Promise.all([
    requireClient().from("prefect_duty_assignments").select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").eq("prefect_profile_id", profile.id).order("created_at", { ascending: false }),
    requireClient().from("attendance_records").select("status,attendance_session:attendance_sessions(attendance_date,duty_type:duty_types(name),duty_location:duty_locations(name,group_name))").eq("prefect_profile_id", profile.id).order("created_at", { ascending: false }).limit(8),
  ]);
  if (ae || re) throw ae || re;
  const activeAssignments = assignments.filter(x => x.assignment_status === "active").length;
  const pendingNotice = profile.account_status !== "active" || !activeAssignments ? `<div class="setup-warning"><strong>Setup needed for full attendance flow.</strong> This prefect account is ${escapeHtml(profile.account_status)} and has ${activeAssignments} approved duty assignment${activeAssignments === 1 ? "" : "s"}. A teacher/admin must activate the account and approve at least one duty before coordinator attendance marking can include it as official roster data.</div>` : "";
  layout(`${pendingNotice}<div class="grid cards"><article class="card stat"><strong>${assignments.length}</strong><span>Selected duties</span></article><article class="card stat"><strong>${activeAssignments}</strong><span>Active duties</span></article><article class="card stat"><strong>${records.filter(x => x.status === "present").length}</strong><span>Recent present</span></article><article class="card stat"><strong>${records.filter(x => x.status === "absent").length}</strong><span>Recent absent</span></article></div><div class="grid two" style="margin-top:18px"><section class="card"><h2>Your profile</h2><form id="profile-form" class="form-grid"><div class="field"><label>First name</label><input value="${escapeHtml(profile.first_name)}" disabled></div><div class="field"><label>Email</label><input value="${escapeHtml(profile.email || currentUser.email)}" disabled></div><div class="field"><label>Phone</label><input name="phone" value="${escapeHtml(profile.phone)}" required></div><div class="field"><label>Current class</label><input name="current_class" value="${escapeHtml(profile.current_class)}" required></div><div class="field full"><button class="btn">Update profile</button></div></form><p>${badge(profile.role)} ${badge(profile.account_status)}</p></section><section class="card quote"><p class="eyebrow">Prefect Motivation</p><h2>Lead with purpose</h2><p data-quote></p><button class="btn secondary" data-new-quote>New Quote</button></section></div><section class="card" style="margin-top:18px"><h2>Selected duties</h2><div class="table-wrap"><table><thead><tr><th>Duty</th><th>Location</th><th>Assignment Type</th><th>Status</th></tr></thead><tbody>${rowsOrEmpty(assignments.map(a => `<tr><td>${escapeHtml(a.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(a.duty_location))}</td><td>${escapeHtml(formatAssignmentDay(a))}</td><td>${badge(a.assignment_status)}</td></tr>`), 4)}</tbody></table></div><div class="actions"><a class="btn" href="prefect-duty-selection.html">Manage duty selections</a><a class="btn ghost" href="prefect-attendance-history.html">View full attendance</a></div></section><section class="card" style="margin-top:18px"><h2>Recent attendance</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Duty</th><th>Location</th><th>Status</th></tr></thead><tbody>${rowsOrEmpty(records.map(r => `<tr><td>${formatDate(r.attendance_session?.attendance_date)}</td><td>${escapeHtml(r.attendance_session?.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(r.attendance_session?.duty_location))}</td><td>${badge(r.status)}</td></tr>`), 4)}</tbody></table></div></section>`);
  $("#profile-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const btn = $("button", e.currentTarget);
    setBusy(btn, true, "Updating...");
    const { error } = await requireClient().from("profiles").update({ phone: String(f.get("phone")).trim(), current_class: String(f.get("current_class")).trim() }).eq("id", profile.id);
    if (error) toast(errorMessage(error), "error");
    else toast("Profile updated.");
    setBusy(btn, false);
  });
}
async function dutySelection() {
  const [{ data: rawAssignments, error: ae }, types, locations] = await Promise.all([
    requireClient().from("prefect_duty_assignments").select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").eq("prefect_profile_id", profile.id).order("created_at", { ascending: false }),
    getActiveDutyTypes(),
    getAllActiveLocations(),
  ]);
  if (ae) throw ae;
  const assignments = rawAssignments || [];
  layout(`<section class="card"><h2>Select a duty</h2><p class="lede">Checkpoint has no location. Floor Duty is continuous until a teacher or admin changes it.</p><form id="duty-form" class="form-grid"><div class="field"><label>Duty type</label><select name="duty_type_id" required><option value="">Choose duty</option>${types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}</select></div><div class="field" data-location-field><label>Duty location</label><select name="duty_location_id" disabled><option value="">Choose duty first</option></select><small data-location-note></small></div><div class="field" data-day-field><label>Assigned day</label><select name="assigned_day" required><option value="">Choose day</option>${WEEKDAY_OPTIONS.map(d => `<option>${d}</option>`).join("")}</select><small>Required for Checkpoint and Canteen duties.</small></div><div class="field"><label>Optional note</label><textarea name="note" maxlength="500"></textarea></div><div class="field full"><div class="info-card" data-duty-helper>Select a duty type to see the matching rule.</div></div><div class="field full"><button class="btn">Save duty selection</button></div></form></section><section class="card" style="margin-top:18px"><h2>My Selected Duties</h2><div class="table-wrap"><table><thead><tr><th>Duty</th><th>Location</th><th>Assignment Type</th><th>Assigned day</th><th>Status</th><th></th></tr></thead><tbody id="assignment-list">${assignmentRows(assignments)}</tbody></table></div></section>`);
  const typeSelect = $("[name=duty_type_id]");
  const locSelect = $("[name=duty_location_id]");
  const dayField = $("[data-day-field]");
  const daySelect = $("[name=assigned_day]");
  const note = $("[data-location-note]");
  const helper = $("[data-duty-helper]");
  const updateFields = () => {
    const selected = types.find(t => t.id === typeSelect.value);
    const matches = locations.filter(l => l.duty_type_id === typeSelect.value);
    locSelect.value = "";
    if (!selected) {
      locSelect.disabled = true;
      locSelect.required = false;
      locSelect.innerHTML = '<option value="">Choose duty first</option>';
      dayField.classList.remove("hidden");
      daySelect.required = true;
      note.textContent = "";
      helper.textContent = "Select a duty type to see the matching rule.";
      return;
    }
    if (isCheckpointDuty(selected.name)) {
      locSelect.disabled = true;
      locSelect.required = false;
      locSelect.innerHTML = '<option value="">No specific location</option>';
      dayField.classList.remove("hidden");
      daySelect.required = true;
      note.textContent = "Checkpoint Duty currently has no specific location option. Your selection will be saved under Checkpoint Duty only.";
      helper.textContent = "Checkpoint Duty uses the selected weekday and stores duty_location_id as null.";
    } else if (isFloorDuty(selected.name)) {
      locSelect.disabled = false;
      locSelect.required = true;
      locSelect.innerHTML = `<option value="">Choose floor/class location</option>${optionRows(matches)}`;
      dayField.classList.add("hidden");
      daySelect.required = false;
      daySelect.value = "";
      note.textContent = "Floor Duty is a continuous assignment. You do not need to choose a day because this duty remains active until changed by a teacher or admin.";
      helper.textContent = "Floor Duty assignments are continuous. You will remain assigned to this floor/class until a teacher or admin changes it.";
    } else {
      locSelect.disabled = false;
      locSelect.required = true;
      locSelect.innerHTML = `<option value="">Choose location</option>${optionRows(matches)}`;
      dayField.classList.remove("hidden");
      daySelect.required = true;
      note.textContent = "";
      helper.textContent = "Canteen Duty uses the selected weekday and Canteen location.";
    }
  };
  typeSelect.addEventListener("change", updateFields);
  $("#duty-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button", e.currentTarget);
    const f = new FormData(e.currentTarget);
    const dutyType = types.find(t => t.id === f.get("duty_type_id"));
    if (!dutyType) {
      toast("Choose a duty type.", "error");
      return;
    }
    const locationId = requiresLocation(dutyType.name) ? String(f.get("duty_location_id") || "") : null;
    const assignedDay = requiresAssignedDay(dutyType.name) ? String(f.get("assigned_day") || "") : null;
    if (requiresLocation(dutyType.name) && !locationId) {
      toast("Choose a duty location.", "error");
      return;
    }
    if (requiresAssignedDay(dutyType.name) && !assignedDay) {
      toast("Choose an assigned day.", "error");
      return;
    }
    setBusy(btn, true, "Saving...");
    try {
      const payload = {
        profile_id: profile.id,
        prefect_profile_id: profile.id,
        duty_type_id: dutyType.id,
        duty_location_id: locationId,
        assigned_day: assignedDay,
        assignment_scope: isFloorDuty(dutyType.name) ? "permanent" : "weekday",
        note: String(f.get("note") || "").trim() || null,
      };
      let { error } = await requireClient().from("prefect_duty_assignments").insert(payload);
      if (isMissingAssignmentScopeError(error)) {
        const legacyPayload = { ...payload };
        delete legacyPayload.assignment_scope;
        ({ error } = await requireClient().from("prefect_duty_assignments").insert(legacyPayload));
      }
      if (error) throw error;
      toast("Duty selection saved. A teacher or admin may review it.");
      await dutySelection();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });
  $("#assignment-list").addEventListener("click", async e => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    btn.disabled = true;
    const { error } = await requireClient().from("prefect_duty_assignments").delete().eq("id", btn.dataset.remove).eq("assignment_status", "pending");
    if (error) toast(errorMessage(error), "error");
    else {
      toast("Pending selection removed.");
      btn.closest("tr").remove();
    }
  });
}
function assignmentRows(rows) {
  return rowsOrEmpty(rows.map(a => `<tr><td>${escapeHtml(a.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(a.duty_location))}</td><td>${escapeHtml(formatAssignmentType(a))}</td><td>${escapeHtml(formatAssignmentDay(a))}</td><td>${badge(a.assignment_status)}</td><td>${a.assignment_status === "pending" ? `<button class="btn danger" data-remove="${a.id}">Remove</button>` : ""}</td></tr>`), 6);
}
async function prefectHistory() {
  const { data, error } = await requireClient().from("attendance_records").select("status,note,attendance_session:attendance_sessions(attendance_date,duty_type:duty_types(name),duty_location:duty_locations(name,group_name))").eq("prefect_profile_id", profile.id).order("created_at", { ascending: false });
  if (error) throw error;
  layout(`<section class="card"><h2>My attendance</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Duty</th><th>Location</th><th>Status</th><th>Note</th></tr></thead><tbody>${rowsOrEmpty(data.map(r => `<tr><td>${formatDate(r.attendance_session?.attendance_date)}</td><td>${escapeHtml(r.attendance_session?.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(r.attendance_session?.duty_location))}</td><td>${badge(r.status)}</td><td>${escapeHtml(r.note || "")}</td></tr>`), 5)}</tbody></table></div></section>`);
}

async function coordinatorDashboardFull() {
  const [{ data: sessions, error: se }, { data: pending, error: pe }] = await Promise.all([
    requireClient().from("attendance_sessions").select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name),attendance_records(status)").eq("coordinator_profile_id", profile.id).order("created_at", { ascending: false }).limit(12),
    requireClient().from("prefect_duty_assignments").select("id,duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").eq("assignment_status", "pending"),
  ]);
  if (se || pe) throw se || pe;
  const today = todayISO();
  const todaySessions = sessions.filter(s => s.attendance_date === today);
  const pendingLocations = new Set(pending.map(a => `${a.duty_type?.name} / ${formatLocationName(a.duty_location)}`));
  layout(`<div class="grid cards"><article class="card stat"><strong>${todaySessions.length}</strong><span>Sessions today</span></article><article class="card stat"><strong>${pendingLocations.size}</strong><span>Pending duty locations</span></article><article class="card stat"><strong>${sessions.length}</strong><span>Official sessions</span></article><article class="card stat"><strong>${todaySessions.flatMap(s => s.attendance_records || []).length}</strong><span>Records today</span></article></div><div class="grid two" style="margin-top:18px"><section class="card quote"><p class="eyebrow">Prefect Motivation</p><h2>Lead with purpose</h2><p data-quote></p><button class="btn secondary" data-new-quote>New Quote</button></section><section class="card"><h2>Today's workflow</h2><p>Load assigned prefects for a weekday duty and submit one final status for each person. Submitted statuses become official immediately.</p><a class="btn" href="coordinator-mark-attendance.html">Mark Attendance</a></section></div><section class="card" style="margin-top:18px"><h2>Recent sessions</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Duty</th><th>Location</th><th>Records</th><th>State</th></tr></thead><tbody>${rowsOrEmpty(sessions.map(s => `<tr><td>${formatDate(s.attendance_date)}</td><td>${escapeHtml(s.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(s.duty_location))}</td><td>${s.attendance_records?.length || 0}</td><td>${sessionBadge(s.review_status)}</td></tr>`), 5)}</tbody></table></div></section>`);
}
async function markAttendance() {
  const [types, locations] = await Promise.all([getActiveDutyTypes(), getAllActiveLocations()]);
  layout(`<section class="card quote"><p class="eyebrow">Prefect Motivation</p><h2>Lead with purpose</h2><p data-quote></p><button class="btn secondary" data-new-quote>New Quote</button></section><section class="card" style="margin-top:18px"><form id="load-form" class="form-grid"><div class="field"><label>Attendance date</label><input name="date" type="date" value="${schoolDateISO()}" required></div><div class="field"><label>Duty type</label><select name="duty_type_id" required><option value="">Choose duty</option>${types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}</select></div><div class="field"><label>Duty location</label><select name="duty_location_id" disabled><option value="">Choose duty first</option></select><small data-location-note></small></div><div class="field" style="justify-content:end"><button class="btn">Load Prefects</button></div></form></section><section id="attendance-area" class="card hidden" style="margin-top:18px"></section>`);
  const typeSelect = $("[name=duty_type_id]");
  const locationSelect = $("[name=duty_location_id]");
  const note = $("[data-location-note]");
  typeSelect.addEventListener("change", () => {
    const selected = types.find(type => type.id === typeSelect.value);
    const items = locations.filter(location => location.duty_type_id === typeSelect.value);
    locationSelect.value = "";
    if (!selected) {
      locationSelect.disabled = true;
      locationSelect.required = false;
      locationSelect.innerHTML = '<option value="">Choose duty first</option>';
      note.textContent = "";
    } else if (isCheckpointDuty(selected.name)) {
      locationSelect.disabled = true;
      locationSelect.required = false;
      locationSelect.innerHTML = '<option value="">No specific location</option>';
      note.textContent = "Checkpoint Duty sessions are saved without a duty location.";
    } else {
      locationSelect.disabled = false;
      locationSelect.required = true;
      locationSelect.innerHTML = `<option value="">Choose location</option>${optionRows(items)}`;
      note.textContent = isFloorDuty(selected.name) ? "Floor Duty prefects load regardless of assigned day." : "";
    }
  });
  $("#load-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const date = String(f.get("date"));
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 0 || day === 6) {
      toast("School duty attendance can only be marked from Monday to Friday.", "error");
      return;
    }
    const dutyType = types.find(type => type.id === f.get("duty_type_id"));
    if (!dutyType) {
      toast("Choose a duty type.", "error");
      return;
    }
    const locationId = requiresLocation(dutyType.name) ? String(f.get("duty_location_id") || "") : null;
    if (requiresLocation(dutyType.name) && !locationId) {
      toast("Choose a duty location.", "error");
      return;
    }
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
    let query = requireClient().from("prefect_duty_assignments")
      .select("id,assigned_day,prefect:profiles!prefect_profile_id(id,first_name,current_class),duty_type:duty_types(name),duty_location:duty_locations(name,group_name)")
      .eq("duty_type_id", dutyType.id)
      .in("assignment_status", ["pending", "active"]);
    if (isFloorDuty(dutyType.name)) {
      query = query.eq("duty_location_id", locationId);
    } else if (isCheckpointDuty(dutyType.name)) {
      query = query.is("duty_location_id", null).in("assigned_day", [dayName, "Any"]);
    } else {
      query = query.eq("duty_location_id", locationId).in("assigned_day", [dayName, "Any"]);
    }
    const { data, error } = await query;
    if (error) {
      toast(errorMessage(error), "error");
      return;
    }
    renderAttendance(data || [], {
      date,
      duty_type_id: dutyType.id,
      duty_location_id: locationId,
      duty_type: dutyType.name,
      duty_location: locationId ? formatLocationName(locations.find(x => x.id === locationId)) : "No specific location",
    });
  });
}
function renderAttendance(assignments, meta) {
  const area = $("#attendance-area");
  area.classList.remove("hidden");
  area.onclick = null;
  if (!assignments.length) {
    area.innerHTML = '<div class="empty">No prefects match this duty selection. Check approvals, account status, duty location, and weekday.</div>';
    return;
  }
  area.dataset.meta = JSON.stringify(meta);
  area.innerHTML = `<h2>Attendance list</h2><div class="actions"><button class="btn secondary" data-all="present">Mark All Present</button><button class="btn ghost" data-all="absent">Mark All Absent</button><button class="btn ghost" data-reset>Reset</button></div><div class="table-wrap"><table><thead><tr><th>Prefect</th><th>Class</th><th>Duty</th><th>Assignment</th><th>Final status</th><th>Note</th></tr></thead><tbody>${assignments.map((a, i) => `<tr data-prefect="${a.prefect.id}"><td>${escapeHtml(a.prefect.first_name)}</td><td>${escapeHtml(a.prefect.current_class)}</td><td>${escapeHtml(a.duty_type.name)} / ${escapeHtml(formatLocationName(a.duty_location))}</td><td>${escapeHtml(isFloorDuty(a.duty_type.name) ? "Permanent floor assignment" : formatAssignmentDay(a))}</td><td><div class="status-pills">${["present", "absent", "late", "excused"].map(s => `<label><input type="radio" name="status-${i}" value="${s}" required><span>${s}</span></label>`).join("")}</div></td><td><input data-note maxlength="500" aria-label="Attendance note"></td></tr>`).join("")}</tbody></table></div><button class="btn" data-submit-attendance style="margin-top:18px">Submit Attendance</button>`;
  area.onclick = attendanceAction;
}
function attendanceAction(e) {
  const area = $("#attendance-area");
  const all = e.target.closest("[data-all]");
  if (all) $$("tr[data-prefect]", area).forEach(row => {
    const radio = $(`input[value=${all.dataset.all}]`, row);
    if (radio) radio.checked = true;
  });
  if (e.target.closest("[data-reset]")) {
    $$("input[type=radio]", area).forEach(input => { input.checked = false; });
    $$("[data-note]", area).forEach(input => { input.value = ""; });
  }
  if (e.target.closest("[data-submit-attendance]")) confirmAttendance();
}
function confirmAttendance() {
  const area = $("#attendance-area");
  const rows = $$("tr[data-prefect]", area);
  const records = rows.map(row => ({ prefect_profile_id: row.dataset.prefect, status: $("input[type=radio]:checked", row)?.value, note: $("[data-note]", row).value.trim() || null }));
  if (records.some(record => !record.status)) {
    toast("Every prefect must have one final status.", "error");
    return;
  }
  const meta = JSON.parse(area.dataset.meta);
  const counts = Object.fromEntries(["present", "absent", "late", "excused"].map(status => [status, records.filter(record => record.status === status).length]));
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  back.innerHTML = `<section class="card modal"><h2>Confirm attendance</h2><p><strong>${escapeHtml(meta.duty_type)}</strong> | ${escapeHtml(meta.duty_location)} | ${formatDate(meta.date)}</p><div class="grid cards">${Object.entries(counts).map(([key, value]) => `<div class="stat"><strong>${value}</strong><span>${key}</span></div>`).join("")}</div><div class="actions"><button class="btn" data-confirm>Confirm and submit</button><button class="btn ghost" data-cancel>Go back</button></div></section>`;
  document.body.append(back);
  $("[data-cancel]", back).onclick = () => back.remove();
  $("[data-confirm]", back).onclick = () => submitAttendance(meta, records, back);
}
async function submitAttendance(meta, records, modal) {
  const btn = $("[data-confirm]", modal);
  setBusy(btn, true, "Submitting...");
  let sessionId = null;
  try {
    const { data, error } = await requireClient().from("attendance_sessions").insert({ attendance_date: meta.date, duty_type_id: meta.duty_type_id, duty_location_id: meta.duty_location_id || null, coordinator_profile_id: profile.id, session_status: "submitted", review_status: "recorded" }).select("id").single();
    if (error) throw error;
    sessionId = data.id;
    const { error: recordError } = await requireClient().from("attendance_records").insert(records.map(record => ({ ...record, attendance_session_id: sessionId, session_id: sessionId, marked_by: profile.id })));
    if (recordError) throw recordError;
    modal.remove();
    $("#attendance-area").innerHTML = '<div class="empty"><div class="success-check" aria-hidden="true">&#10003;</div><h2>Attendance submitted successfully.</h2><p>The statuses are now official in Supabase and visible on teacher/admin dashboards and reports.</p><div class="actions" style="justify-content:center"><a class="btn" href="coordinator-sessions.html">View my sessions</a><a class="btn ghost" href="coordinator-mark-attendance.html">Mark another session</a></div></div>';
    toast("Official attendance saved.");
  } catch (err) {
    if (sessionId) await requireClient().from("attendance_sessions").delete().eq("id", sessionId);
    toast(errorMessage(err), "error");
    setBusy(btn, false);
  }
}
async function coordinatorSessions() {
  const { data: sessions, error } = await requireClient().from("attendance_sessions").select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name),attendance_records(status)").eq("coordinator_profile_id", profile.id).order("attendance_date", { ascending: false }).limit(500);
  if (error) throw error;
  const unique = selector => [...new Set(sessions.map(selector).filter(Boolean))].sort();
  const locationOptions = unique(row => formatLocationName(row.duty_location)).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  layout(`<div class="grid cards"><article class="card stat"><strong>${sessions.length}</strong><span>Total sessions</span></article><article class="card stat"><strong>${sessions.filter(row => sessionStateClass(row.review_status) === "recorded").length}</strong><span>Recorded sessions</span></article><article class="card stat"><strong>${sessions.filter(row => sessionStateClass(row.review_status) === "corrected").length}</strong><span>Corrected sessions</span></article><article class="card stat"><strong>${sessions.reduce((sum, row) => sum + (row.attendance_records?.length || 0), 0)}</strong><span>Attendance records</span></article></div><section class="card section-gap"><div class="section-heading"><div><p class="eyebrow">Session archive</p><h2>Official attendance</h2></div><a class="btn" href="coordinator-mark-attendance.html">Mark attendance</a></div><form id="coordinator-session-filter" class="form-grid compact"><div class="field"><label>Date</label><input type="date" name="date"></div><div class="field"><label>Duty type</label><select name="duty"><option value="">All duty types</option>${unique(row => row.duty_type?.name).map(value => `<option>${escapeHtml(value)}</option>`).join("")}</select></div><div class="field"><label>Duty location</label><select name="location"><option value="">All locations</option>${locationOptions}</select></div><div class="field"><label>Record state</label><select name="status"><option value="">All states</option>${sessionStateOptionsMarkup()}</select></div></form><div class="table-wrap section-gap-small"><table><thead><tr><th>Date</th><th>Duty</th><th>Location</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>State</th></tr></thead><tbody id="coordinator-session-list"></tbody></table></div></section>`);
  const render = () => {
    const values = new FormData($("#coordinator-session-filter"));
    const rows = sessions.filter(row => (!values.get("date") || row.attendance_date === values.get("date")) && (!values.get("duty") || row.duty_type?.name === values.get("duty")) && (!values.get("location") || formatLocationName(row.duty_location) === values.get("location")) && (!values.get("status") || sessionStateClass(row.review_status) === values.get("status")));
    $("#coordinator-session-list").innerHTML = rowsOrEmpty(rows.map(row => {
      const statusCount = status => (row.attendance_records || []).filter(record => record.status === status).length;
      return `<tr><td>${formatDate(row.attendance_date)}</td><td>${escapeHtml(row.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(row.duty_location))}</td><td>${statusCount("present")}</td><td>${statusCount("absent")}</td><td>${statusCount("late")}</td><td>${statusCount("excused")}</td><td>${sessionBadge(row.review_status)}</td></tr>`;
    }), 8);
  };
  render();
  $("#coordinator-session-filter").addEventListener("input", render);
}

async function teacherDashboardFull() {
  const today = todayISO();
  const [total, active, pending, { data: todaySessions, error: te }, { data: absent, error: ae }, { data: recent, error: re }, { data: pendingAssignments, error: pe }] = await Promise.all([
    count("profiles", q => q.eq("role", "prefect")),
    count("profiles", q => q.eq("role", "prefect").eq("account_status", "active")),
    count("profiles", q => q.eq("role", "prefect").eq("account_status", "pending")),
    requireClient().from("attendance_sessions").select("id,review_status,attendance_records(status)").eq("attendance_date", today),
    requireClient().from("attendance_records").select("prefect_profile_id,status,attendance_session:attendance_sessions(attendance_date,duty_type:duty_types(name),duty_location:duty_locations(name,group_name)),prefect:profiles!prefect_profile_id(first_name,current_class)").eq("status", "absent").order("created_at", { ascending: false }),
    requireClient().from("attendance_sessions").select("*,duty_type:duty_types(name),duty_location:duty_locations(name,group_name),coordinator:profiles!coordinator_profile_id(first_name)").order("created_at", { ascending: false }).limit(6),
    requireClient().from("prefect_duty_assignments").select("id,assigned_day,prefect:profiles!prefect_profile_id(first_name),duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").eq("assignment_status", "pending").order("created_at", { ascending: false }).limit(6),
  ]);
  if (te || ae || re || pe) throw te || ae || re || pe;
  const statuses = todaySessions.flatMap(s => s.attendance_records || []);
  const statusCount = status => statuses.filter(x => x.status === status).length;
  const groups = new Map();
  absent.forEach(record => {
    const grouped = groups.get(record.prefect_profile_id) || { ...record, count: 0, duties: {} };
    grouped.count += 1;
    const label = `${record.attendance_session?.duty_type?.name || "Duty"} / ${formatLocationName(record.attendance_session?.duty_location)}`;
    grouped.duties[label] = (grouped.duties[label] || 0) + 1;
    if ((record.attendance_session?.attendance_date || "") > (grouped.attendance_session?.attendance_date || "")) grouped.attendance_session = record.attendance_session;
    groups.set(record.prefect_profile_id, grouped);
  });
  const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  layout(`<div class="grid cards">${[[total, "Registered prefects"], [active, "Active prefects"], [pending, "Pending accounts"], [statusCount("present"), "Present today"], [statusCount("absent"), "Absent today"], [statusCount("late"), "Late today"], [statusCount("excused"), "Excused today"], [todaySessions.length, "Official sessions today"], [todaySessions.filter(s => sessionStateClass(s.review_status) === "corrected").length, "Corrected today"]].map(([value, label]) => `<article class="card stat"><strong>${value}</strong><span>${label}</span></article>`).join("")}</div><section class="card" style="margin-top:18px"><h2>Top 4 Prefects Missing Duties</h2><div class="table-wrap"><table><thead><tr><th>Rank</th><th>First name</th><th>Class</th><th>Absences</th><th>Last missed</th><th>Main missed duty</th></tr></thead><tbody>${rowsOrEmpty(top.map((record, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(record.prefect?.first_name)}</td><td>${escapeHtml(record.prefect?.current_class)}</td><td>${record.count}</td><td>${formatDate(record.attendance_session?.attendance_date)}</td><td>${escapeHtml(Object.entries(record.duties).sort((a, b) => b[1] - a[1])[0]?.[0] || "-")}</td></tr>`), 6)}</tbody></table></div></section><div class="grid two" style="margin-top:18px"><section class="card"><h2>Recent sessions</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Duty</th><th>State</th></tr></thead><tbody>${rowsOrEmpty(recent.map(session => `<tr><td>${formatDate(session.attendance_date)}</td><td>${escapeHtml(session.duty_type?.name)} / ${escapeHtml(formatLocationName(session.duty_location))}</td><td>${sessionBadge(session.review_status)}</td></tr>`), 3)}</tbody></table></div></section><section class="card"><h2>Pending duty approvals</h2><div class="table-wrap"><table><thead><tr><th>Prefect</th><th>Duty</th><th>Assignment</th></tr></thead><tbody>${rowsOrEmpty(pendingAssignments.map(assignment => `<tr><td>${escapeHtml(assignment.prefect?.first_name)}</td><td>${escapeHtml(assignment.duty_type?.name)} / ${escapeHtml(formatLocationName(assignment.duty_location))}</td><td>${escapeHtml(formatAssignmentDay(assignment))}</td></tr>`), 3)}</tbody></table></div></section></div><section class="card" style="margin-top:18px"><h2>Recent absences</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Prefect</th><th>Class</th><th>Duty</th></tr></thead><tbody>${rowsOrEmpty(absent.slice(0, 8).map(record => `<tr><td>${formatDate(record.attendance_session?.attendance_date)}</td><td>${escapeHtml(record.prefect?.first_name)}</td><td>${escapeHtml(record.prefect?.current_class)}</td><td>${escapeHtml(record.attendance_session?.duty_type?.name)} / ${escapeHtml(formatLocationName(record.attendance_session?.duty_location))}</td></tr>`), 4)}</tbody></table></div><div class="actions"><a class="btn" href="teacher-attendance-review.html">Correct attendance</a><a class="btn ghost" href="teacher-prefects.html">Manage prefects</a><a class="btn secondary" href="teacher-reports.html">Open reports</a></div></section>`);
}
function sessionCardsFull(rows) {
  return rows.length ? rows.map(session => `<article class="card" style="margin-bottom:18px" data-session="${session.id}"><h2>${escapeHtml(session.duty_type?.name)} - ${escapeHtml(formatLocationName(session.duty_location))}</h2><p>${formatDate(session.attendance_date)} | ${escapeHtml(session.coordinator?.first_name || "Unknown coordinator")} | ${sessionBadge(session.review_status)}</p><div class="info-card">Coordinator-marked attendance is already official. Use this page only to correct a status or add teacher notes.</div><div class="table-wrap section-gap-small"><table><thead><tr><th>Prefect</th><th>Class</th><th>Status</th><th>Teacher note</th><th></th></tr></thead><tbody>${(session.attendance_records || []).map(record => `<tr data-record="${record.id}"><td>${escapeHtml(record.prefect?.first_name)}</td><td>${escapeHtml(record.prefect?.current_class)}</td><td><select data-record-status>${["present", "absent", "late", "excused"].map(value => `<option ${value === record.status ? "selected" : ""}>${value}</option>`).join("")}</select></td><td><input data-teacher-note value="${escapeHtml(record.teacher_note || "")}" maxlength="500"></td><td><button class="btn ghost" data-save-record>Save correction</button></td></tr>`).join("")}</tbody></table></div><div class="field" style="margin-top:12px"><label>Session teacher note</label><textarea data-session-note maxlength="1000">${escapeHtml(session.teacher_note || "")}</textarea></div><div class="actions"><button class="btn secondary" data-save-session-note>Save session note</button></div></article>`).join("") : '<section class="card empty">No sessions match the filters.</section>';
}
async function attendanceReviewFull() {
  const [types, coordinators] = await Promise.all([getActiveDutyTypes(), getActiveCoordinators()]);
  layout(`<section class="card"><form id="review-filter" class="form-grid"><div class="field"><label>From</label><input type="date" name="from"></div><div class="field"><label>To</label><input type="date" name="to"></div><div class="field"><label>Duty type</label><select name="duty_type_id"><option value="">All duty types</option>${types.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}</select></div><div class="field"><label>Duty location</label><select name="duty_location_id"><option value="">All locations</option></select></div><div class="field"><label>Coordinator</label><select name="coordinator_profile_id"><option value="">All coordinators</option>${coordinators.length ? coordinators.map(coordinator => `<option value="${coordinator.id}">${escapeHtml(coordinator.first_name)}</option>`).join("") : '<option disabled>No coordinators registered yet</option>'}</select></div><div class="field"><label>Record state</label><select name="status"><option value="">All states</option>${sessionStateOptionsMarkup()}</select></div></form></section><section id="session-list" style="margin-top:18px"><section class="card empty">Loading sessions...</section></section>`);
  const form = $("#review-filter");
  const dutySelect = $("[name=duty_type_id]", form);
  const locationSelect = $("[name=duty_location_id]", form);
  const updateLocations = async () => {
    const type = types.find(item => item.id === dutySelect.value);
    const locations = type ? await getDutyLocationsByDutyType(type.id, types) : [];
    locationSelect.innerHTML = locationFilterOptions(type, locations);
  };
  const render = async () => {
    const values = new FormData(form);
    const locationValue = values.get("duty_location_id");
    const filters = {
      from: values.get("from"),
      to: values.get("to"),
      duty_type_id: values.get("duty_type_id"),
      duty_location_id: locationValue === LOCATIONLESS_VALUE ? null : locationValue,
      coordinator_profile_id: values.get("coordinator_profile_id"),
      session_status: values.get("status"),
    };
    $("#session-list").innerHTML = sessionCardsFull(await getSessionsWithFilters(filters));
  };
  dutySelect.addEventListener("change", async () => {
    await updateLocations();
    await render();
  });
  form.addEventListener("input", render);
  await updateLocations();
  await render();
  $("#session-list").addEventListener("click", reviewAction);
}
async function reviewAction(e) {
  const recordBtn = e.target.closest("[data-save-record]");
  if (recordBtn) {
    const row = recordBtn.closest("[data-record]");
    const card = recordBtn.closest("[data-session]");
    const { error } = await requireClient().from("attendance_records").update({ status: $("[data-record-status]", row).value, teacher_note: $("[data-teacher-note]", row).value.trim() || null }).eq("id", row.dataset.record);
    if (error) toast(errorMessage(error), "error");
    else {
      const sessionError = await saveSessionCorrection(card);
      if (sessionError) toast(errorMessage(sessionError), "error");
      else toast("Attendance correction saved.");
    }
    return;
  }
  const noteBtn = e.target.closest("[data-save-session-note]");
  if (noteBtn) {
    const error = await saveSessionCorrection(noteBtn.closest("[data-session]"));
    if (error) toast(errorMessage(error), "error");
    else toast("Session note saved.");
  }
}
async function saveSessionCorrection(card) {
  const { error } = await requireClient().from("attendance_sessions").update({
    review_status: "corrected",
    teacher_note: $("[data-session-note]", card).value.trim() || null,
    reviewed_by: profile.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", card.dataset.session);
  return error;
}
function dutyApprovalRows(rows) {
  return rowsOrEmpty(rows.map(assignment => `<tr data-id="${assignment.id}"><td>${escapeHtml(assignment.prefect?.first_name)}</td><td>${escapeHtml(assignment.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(assignment.duty_location))}</td><td>${escapeHtml(formatAssignmentDay(assignment))}</td><td>${badge(assignment.assignment_status)}</td><td><button class="btn" data-assignment="active">Approve</button> <button class="btn danger" data-assignment="rejected">Reject</button> <button class="btn ghost" data-assignment="inactive">Deactivate</button></td></tr>`), 6);
}
async function prefectManagementFull() {
  const [{ data: people, error: pe }, { data: assignments, error: ae }] = await Promise.all([
    requireClient().from("profiles").select("*").eq("role", "prefect").order("first_name"),
    requireClient().from("prefect_duty_assignments").select("*,prefect:profiles!prefect_profile_id(first_name),duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").order("created_at", { ascending: false }),
  ]);
  if (pe || ae) throw pe || ae;
  const classes = [...new Set(people.map(p => p.current_class).filter(Boolean))].sort();
  layout(`<section class="card"><form id="prefect-filter" class="form-grid"><div class="field"><label>Search first name</label><input name="search"></div><div class="field"><label>Current class</label><select name="class"><option value="">All classes</option>${classes.map(value => `<option>${escapeHtml(value)}</option>`).join("")}</select></div><div class="field"><label>Account status</label><select name="status"><option value="">All statuses</option>${["pending", "active", "rejected", "inactive"].map(value => `<option>${value}</option>`).join("")}</select></div></form><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Name</th><th>Class</th><th>Phone</th><th>Status</th><th>Selected duties</th><th>Actions</th></tr></thead><tbody id="prefect-list"></tbody></table></div></section><section class="card" style="margin-top:18px"><h2>Duty assignment approvals</h2><div class="table-wrap"><table><thead><tr><th>Prefect</th><th>Duty</th><th>Location</th><th>Assignment</th><th>Status</th><th>Actions</th></tr></thead><tbody id="duty-approvals">${dutyApprovalRows(assignments)}</tbody></table></div></section>`);
  const render = () => {
    const values = new FormData($("#prefect-filter"));
    const search = String(values.get("search")).toLowerCase();
    $("#prefect-list").innerHTML = rowsOrEmpty(people.filter(p => p.first_name.toLowerCase().includes(search) && (!values.get("class") || p.current_class === values.get("class")) && (!values.get("status") || p.account_status === values.get("status"))).map(p => `<tr data-id="${p.id}"><td>${escapeHtml(p.first_name)}</td><td>${escapeHtml(p.current_class)}</td><td>${escapeHtml(p.phone)}</td><td>${badge(p.account_status)}</td><td>${assignments.filter(a => a.prefect_profile_id === p.id).map(a => `${escapeHtml(a.duty_type?.name)} / ${escapeHtml(formatLocationName(a.duty_location))} (${escapeHtml(formatAssignmentDay(a))})`).join("<br>") || "None"}</td><td class="actions"><button class="btn" data-account="active">Activate</button><button class="btn danger" data-account="rejected">Reject</button><button class="btn ghost" data-account="inactive">Deactivate</button></td></tr>`), 6);
  };
  render();
  $("#prefect-filter").addEventListener("input", render);
  $("#prefect-list").addEventListener("click", managePrefect);
  $("#duty-approvals").addEventListener("click", manageAssignment);
}
async function managePrefect(e) {
  const btn = e.target.closest("[data-account]");
  if (!btn) return;
  const { error } = await requireClient().from("profiles").update({ account_status: btn.dataset.account }).eq("id", btn.closest("tr").dataset.id);
  if (error) toast(errorMessage(error), "error");
  else {
    toast("Prefect account updated.");
    location.reload();
  }
}
async function manageAssignment(e) {
  const btn = e.target.closest("[data-assignment]");
  if (!btn) return;
  const { error } = await requireClient().from("prefect_duty_assignments").update({ assignment_status: btn.dataset.assignment, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), approved_by: profile.id, approved_at: new Date().toISOString() }).eq("id", btn.closest("tr").dataset.id);
  if (error) toast(errorMessage(error), "error");
  else {
    toast("Duty assignment updated.");
    location.reload();
  }
}
async function reportsFull() {
  const [{ data: records, error }, types, coordinators] = await Promise.all([
    requireClient().from("attendance_records").select("status,note,teacher_note,prefect:profiles!prefect_profile_id(first_name,current_class),attendance_session:attendance_sessions(attendance_date,duty_type_id,duty_location_id,duty_type:duty_types(name),duty_location:duty_locations(name,group_name),coordinator_profile_id,coordinator:profiles!coordinator_profile_id(first_name))").order("created_at", { ascending: false }).limit(5000),
    getActiveDutyTypes(),
    getActiveCoordinators(),
  ]);
  if (error) throw error;
  attendanceRows = records || [];
  const unique = fn => [...new Set(attendanceRows.map(fn).filter(Boolean))].sort();
  layout(`<section class="card"><form id="report-filter" class="form-grid"><div class="field"><label>From</label><input name="from" type="date"></div><div class="field"><label>To</label><input name="to" type="date"></div><div class="field"><label>Prefect first name</label><input name="name"></div><div class="field"><label>Current class</label><select name="class"><option value="">All</option>${unique(row => row.prefect?.current_class).map(value => `<option>${escapeHtml(value)}</option>`).join("")}</select></div><div class="field"><label>Duty type</label><select name="duty_type_id"><option value="">All duty types</option>${types.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}</select></div><div class="field"><label>Duty location</label><select name="duty_location_id"><option value="">All locations</option></select></div><div class="field"><label>Status</label><select name="status"><option value="">All</option>${["present", "absent", "late", "excused"].map(value => `<option>${value}</option>`).join("")}</select></div><div class="field"><label>Coordinator</label><select name="coordinator_profile_id"><option value="">All coordinators</option>${coordinators.map(coordinator => `<option value="${coordinator.id}">${escapeHtml(coordinator.first_name)}</option>`).join("")}</select></div><div class="field full"><button type="button" class="btn secondary" data-csv>Export filtered CSV</button></div></form></section><div id="report-output"></div>`);
  const form = $("#report-filter");
  const dutySelect = $("[name=duty_type_id]", form);
  const locationSelect = $("[name=duty_location_id]", form);
  const updateLocations = async () => {
    const type = types.find(item => item.id === dutySelect.value);
    const locations = type ? await getDutyLocationsByDutyType(type.id, types) : [];
    locationSelect.innerHTML = locationFilterOptions(type, locations);
  };
  const filtered = () => {
    const values = new FormData(form);
    const name = String(values.get("name")).toLowerCase();
    const locationValue = values.get("duty_location_id");
    return attendanceRows.filter(record => {
      const session = record.attendance_session || {};
      const locationMatches = !locationValue || (locationValue === LOCATIONLESS_VALUE ? !session.duty_location_id : session.duty_location_id === locationValue);
      return (!values.get("from") || session.attendance_date >= values.get("from")) &&
        (!values.get("to") || session.attendance_date <= values.get("to")) &&
        (!name || record.prefect?.first_name.toLowerCase().includes(name)) &&
        (!values.get("class") || record.prefect?.current_class === values.get("class")) &&
        (!values.get("duty_type_id") || session.duty_type_id === values.get("duty_type_id")) &&
        locationMatches &&
        (!values.get("status") || record.status === values.get("status")) &&
        (!values.get("coordinator_profile_id") || session.coordinator_profile_id === values.get("coordinator_profile_id"));
    });
  };
  const render = () => {
    const rows = filtered();
    const statusTotal = status => rows.filter(record => record.status === status).length;
    $("#report-output").innerHTML = `<div class="grid cards" style="margin-top:18px"><article class="card stat"><strong>${rows.length}</strong><span>Total records</span></article><article class="card stat"><strong>${rows.length ? Math.round(statusTotal("present") / rows.length * 100) : 0}%</strong><span>Present</span></article><article class="card stat"><strong>${rows.length ? Math.round(statusTotal("absent") / rows.length * 100) : 0}%</strong><span>Absent</span></article><article class="card stat"><strong>${statusTotal("late")}</strong><span>Late</span></article><article class="card stat"><strong>${statusTotal("excused")}</strong><span>Excused</span></article></div><section class="card" style="margin-top:18px"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Prefect</th><th>Class</th><th>Duty</th><th>Location</th><th>Status</th><th>Coordinator</th></tr></thead><tbody>${rowsOrEmpty(rows.map(record => `<tr><td>${formatDate(record.attendance_session?.attendance_date)}</td><td>${escapeHtml(record.prefect?.first_name)}</td><td>${escapeHtml(record.prefect?.current_class)}</td><td>${escapeHtml(record.attendance_session?.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(record.attendance_session?.duty_location))}</td><td>${badge(record.status)}</td><td>${escapeHtml(record.attendance_session?.coordinator?.first_name)}</td></tr>`), 7)}</tbody></table></div></section>`;
  };
  dutySelect.addEventListener("change", async () => {
    await updateLocations();
    render();
  });
  form.addEventListener("input", render);
  $("[data-csv]").addEventListener("click", () => {
    const rows = filtered();
    const values = rows.map(record => [record.attendance_session?.attendance_date, record.prefect?.first_name, record.prefect?.current_class, record.attendance_session?.duty_type?.name, formatLocationName(record.attendance_session?.duty_location), record.status, record.attendance_session?.coordinator?.first_name]);
    const csv = [["Date", "Prefect", "Class", "Duty", "Location", "Status", "Coordinator"], ...values].map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `attendance-report-${todayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  await updateLocations();
  render();
}

async function adminDashboard() {
  const [users, types, locations, assignments, { data: logs, error }] = await Promise.all([
    count("profiles"),
    count("duty_types", q => q.neq("name", removedDutyName)),
    count("duty_locations"),
    count("prefect_duty_assignments", q => q.eq("assignment_status", "pending")),
    requireClient().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(15),
  ]);
  if (error) throw error;
  layout(`<div class="grid cards">${[[users, "Users"], [types, "Duty types"], [locations, "Duty locations"], [assignments, "Pending assignments"]].map(([value, label]) => `<article class="card stat"><strong>${value}</strong><span>${label}</span></article>`).join("")}</div><div class="grid two" style="margin-top:18px"><a class="card" href="admin-users.html"><h2>Manage users</h2><p>Change roles and account states with self-promotion protection.</p></a><a class="card" href="admin-duty-options.html"><h2>Duty configuration</h2><p>Add or deactivate duty types and locations.</p></a></div><section class="card" style="margin-top:18px"><h2>Recent audit log</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Table</th><th>Record</th></tr></thead><tbody>${rowsOrEmpty((logs || []).map(log => `<tr><td>${new Date(log.created_at).toLocaleString("en-LK")}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.table_name)}</td><td>${escapeHtml(log.record_id)}</td></tr>`), 4)}</tbody></table></div></section>`);
}
async function adminUsersFull() {
  let { data, error } = await requireClient().from("profiles").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  data = data || [];
  const roleOptions = ["prefect", "coordinator", "teacher", "admin"];
  const statusOptions = ["pending", "active", "rejected", "inactive"];
  const staffRoles = new Set(["coordinator", "teacher", "admin"]);
  const optionMarkup = (items, selected) => items.map(value => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
  layout(`<section class="card"><form id="user-filter" class="form-grid"><div class="field"><label>Search name or email</label><input name="search"></div><div class="field"><label>Role</label><select name="role"><option value="">All roles</option>${["prefect", "coordinator", "teacher", "admin"].map(value => `<option>${value}</option>`).join("")}</select></div><div class="field"><label>Status</label><select name="status"><option value="">All statuses</option>${["pending", "active", "rejected", "inactive"].map(value => `<option>${value}</option>`).join("")}</select></div></form><p>Teacher and coordinator accounts are created by signing up normally, then promoting and activating them here. No service key is exposed in the browser.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Class</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody id="user-list"></tbody></table></div></section>`);
  const form = $("#user-filter");
  const list = $("#user-list");
  const render = () => {
    const values = new FormData(form);
    const search = String(values.get("search")).toLowerCase();
    list.innerHTML = rowsOrEmpty(data.filter(person => {
      const name = String(person.first_name || "").toLowerCase();
      const email = String(person.email || "").toLowerCase();
      return (!search || name.includes(search) || email.includes(search)) &&
        (!values.get("role") || person.role === values.get("role")) &&
        (!values.get("status") || person.account_status === values.get("status"));
    }).map(person => `<tr data-id="${person.id}"><td>${escapeHtml(person.first_name)}</td><td>${escapeHtml(person.email)}</td><td>${escapeHtml(person.current_class || "no class")}</td><td><select data-role-select ${person.id === profile.id ? "disabled" : ""}>${optionMarkup(roleOptions, person.role)}</select></td><td><select data-status-select>${optionMarkup(statusOptions, person.account_status)}</select></td><td><button type="button" class="btn" data-save-user>Save</button></td></tr>`), 6);
  };
  render();
  form.addEventListener("input", render);
  list.addEventListener("change", e => {
    const roleSelect = e.target.closest("[data-role-select]");
    if (!roleSelect) return;
    const row = roleSelect.closest("tr");
    const statusSelect = $("[data-status-select]", row);
    if (staffRoles.has(roleSelect.value) && statusSelect.value === "pending") {
      statusSelect.value = "active";
      toast("Staff accounts must be active to open staff dashboards, so status was set to active.");
    }
  });
  list.addEventListener("click", async e => {
    const btn = e.target.closest("[data-save-user]");
    if (!btn) return;
    const row = btn.closest("tr");
    const targetId = row.dataset.id;
    const roleSelect = $("[data-role-select]", row);
    const statusSelect = $("[data-status-select]", row);
    const payload = { account_status: statusSelect.value };
    if (targetId !== profile.id) {
      payload.role = roleSelect.value;
      if (staffRoles.has(payload.role) && payload.account_status === "pending") {
        payload.account_status = "active";
        statusSelect.value = "active";
      }
    }
    setBusy(btn, true, "Saving...");
    try {
      const { data: updated, error: updateError } = await requireClient().from("profiles").update(payload).eq("id", targetId).select("*").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) throw new Error("Supabase did not update this user. Re-run sql/fix-admin-user-management-role-updates.sql, then reload the admin page.");
      const index = data.findIndex(person => person.id === updated.id);
      if (index >= 0) data[index] = updated;
      else data.unshift(updated);
      if (updated.id === profile.id) profile = updated;
      render();
      toast(`${updated.first_name} is now ${updated.role} (${updated.account_status}).`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(btn, false);
    }
  });
}
async function dutyOptionsFull() {
  const [{ data: rawLocations, error: le }, types] = await Promise.all([
    requireClient().from("duty_locations").select("*,duty_type:duty_types(name)").order("sort_order").order("name"),
    getDutyTypesForAdmin(),
  ]);
  if (le) throw le;
  const locations = cleanLocations(rawLocations).filter(location => !isRemovedDutyType(location.duty_type?.name));
  layout(`<div class="grid two"><section class="card"><h2>Add duty type</h2><form id="type-form"><div class="field"><label>Name</label><input name="name" required maxlength="100"></div><button class="btn">Add type</button></form></section><section class="card"><h2>Add duty location</h2><form id="location-form" class="form-grid"><div class="field"><label>Duty type</label><select name="duty_type_id" required>${types.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}</select></div><div class="field"><label>Name</label><input name="name" required maxlength="160"></div><div class="field"><label>Group/building</label><input name="group_name" maxlength="160"></div><div class="field"><label>Sort order</label><input name="sort_order" type="number" value="100"></div><div class="field full"><button class="btn">Add location</button></div></form></section></div><section class="card" style="margin-top:18px"><h2>Duty types</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th></th></tr></thead><tbody id="type-list">${types.map(type => `<tr data-id="${type.id}"><td>${escapeHtml(type.name)}</td><td>${badge(type.is_active ? "active" : "inactive")}</td><td><button class="btn ghost" data-toggle-type="${!type.is_active}">${type.is_active ? "Deactivate" : "Activate"}</button></td></tr>`).join("")}</tbody></table></div></section><section class="card" style="margin-top:18px"><h2>Configured locations</h2><div class="table-wrap"><table><thead><tr><th>Duty type</th><th>Location</th><th>Group</th><th>Order</th><th>State</th><th></th></tr></thead><tbody id="option-list">${rowsOrEmpty(locations.map(location => `<tr data-id="${location.id}"><td>${escapeHtml(location.duty_type?.name)}</td><td><input data-name value="${escapeHtml(location.name)}"></td><td><input data-group value="${escapeHtml(location.group_name || "")}"></td><td><input data-order type="number" value="${location.sort_order}"></td><td>${badge(location.is_active ? "active" : "inactive")}</td><td class="actions"><button class="btn" data-save-location>Save</button><button class="btn ghost" data-toggle-location="${!location.is_active}">${location.is_active ? "Deactivate" : "Activate"}</button></td></tr>`), 6)}</tbody></table></div></section>`);
  $("#type-form").addEventListener("submit", e => insertForm(e, "duty_types", ["name"]));
  $("#location-form").addEventListener("submit", e => insertForm(e, "duty_locations", ["duty_type_id", "name", "group_name", "sort_order"]));
  $("#type-list").addEventListener("click", async e => {
    const btn = e.target.closest("[data-toggle-type]");
    if (!btn) return;
    const { error } = await requireClient().from("duty_types").update({ is_active: btn.dataset.toggleType === "true", active: btn.dataset.toggleType === "true" }).eq("id", btn.closest("tr").dataset.id);
    if (error) toast(errorMessage(error), "error");
    else location.reload();
  });
  $("#option-list").addEventListener("click", async e => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    let payload;
    if (e.target.closest("[data-save-location]")) {
      payload = { name: $("[data-name]", row).value.trim(), location_name: $("[data-name]", row).value.trim(), group_name: $("[data-group]", row).value.trim() || null, sort_order: Number($("[data-order]", row).value) };
    } else {
      const btn = e.target.closest("[data-toggle-location]");
      if (!btn) return;
      payload = { is_active: btn.dataset.toggleLocation === "true", active: btn.dataset.toggleLocation === "true" };
    }
    const { error } = await requireClient().from("duty_locations").update(payload).eq("id", row.dataset.id);
    if (error) toast(errorMessage(error), "error");
    else {
      toast("Duty location updated.");
      location.reload();
    }
  });
}
async function insertForm(e, table, fields) {
  e.preventDefault();
  const values = new FormData(e.currentTarget);
  const payload = {};
  fields.forEach(key => {
    payload[key] = key === "sort_order" ? Number(values.get(key)) : String(values.get(key) || "").trim() || null;
  });
  if (table === "duty_locations") {
    if (!payload.group_name) delete payload.group_name;
    payload.location_name = payload.name;
  }
  const { error } = await requireClient().from(table).insert(payload);
  if (error) toast(errorMessage(error), "error");
  else {
    toast("Option added.");
    location.reload();
  }
}
async function adminRosterFull() {
  const { data, error } = await requireClient().from("prefect_duty_assignments").select("*,prefect:profiles!prefect_profile_id(first_name,current_class),duty_type:duty_types(name),duty_location:duty_locations(name,group_name)").order("created_at", { ascending: false });
  if (error) throw error;
  layout(`<section class="card"><form id="roster-filter" class="form-grid"><div class="field"><label>Search prefect</label><input name="search"></div><div class="field"><label>Status</label><select name="status"><option value="">All</option>${["pending", "active", "rejected", "inactive"].map(value => `<option>${value}</option>`).join("")}</select></div></form><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Prefect</th><th>Class</th><th>Duty</th><th>Location</th><th>Assignment</th><th>Status</th><th>Actions</th></tr></thead><tbody id="roster-list"></tbody></table></div></section>`);
  const render = () => {
    const values = new FormData($("#roster-filter"));
    const search = String(values.get("search")).toLowerCase();
    $("#roster-list").innerHTML = rowsOrEmpty(data.filter(assignment => (!search || assignment.prefect?.first_name.toLowerCase().includes(search)) && (!values.get("status") || assignment.assignment_status === values.get("status"))).map(assignment => `<tr data-id="${assignment.id}"><td>${escapeHtml(assignment.prefect?.first_name)}</td><td>${escapeHtml(assignment.prefect?.current_class)}</td><td>${escapeHtml(assignment.duty_type?.name)}</td><td>${escapeHtml(formatLocationName(assignment.duty_location))}</td><td>${escapeHtml(formatAssignmentDay(assignment))}</td><td>${badge(assignment.assignment_status)}</td><td class="actions"><button class="btn" data-roster-status="active">Approve</button><button class="btn ghost" data-roster-status="rejected">Reject</button><button class="btn ghost" data-roster-status="inactive">Deactivate</button><button class="btn danger" data-delete-assignment>Delete</button></td></tr>`), 7);
  };
  render();
  $("#roster-filter").addEventListener("input", render);
  $("#roster-list").addEventListener("click", async e => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const remove = e.target.closest("[data-delete-assignment]");
    const status = e.target.closest("[data-roster-status]");
    const query = remove ? requireClient().from("prefect_duty_assignments").delete().eq("id", row.dataset.id) : status ? requireClient().from("prefect_duty_assignments").update({ assignment_status: status.dataset.rosterStatus, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), approved_by: profile.id, approved_at: new Date().toISOString() }).eq("id", row.dataset.id) : null;
    if (!query) return;
    const { error: updateError } = await query;
    if (updateError) toast(errorMessage(updateError), "error");
    else {
      toast(remove ? "Assignment deleted." : "Assignment updated.");
      location.reload();
    }
  });
}

const controllers = {
  "prefect-dashboard": prefectDashboardFull,
  "prefect-profile": prefectProfile,
  "prefect-duty-selection": dutySelection,
  "prefect-attendance-history": prefectHistory,
  "coordinator-dashboard": coordinatorDashboardFull,
  "coordinator-mark-attendance": markAttendance,
  "coordinator-sessions": coordinatorSessions,
  "teacher-dashboard": teacherDashboardFull,
  "teacher-attendance-review": attendanceReviewFull,
  "teacher-prefects": prefectManagementFull,
  "teacher-reports": reportsFull,
  "admin-dashboard": adminDashboard,
  "admin-users": adminUsersFull,
  "admin-duty-options": dutyOptionsFull,
  "admin-roster": adminRosterFull,
  "hall-of-fame": () => hallOfFameFull({ profile, currentUser, layout, errorMessage }),
};
async function boot() {
  if (page === "login") return initLogin();
  if (page === "signup") return initSignup();
  drawBackground();
  if ($("#app")) $("#app").innerHTML = '<div class="page-loader" role="status"><span></span><strong>Loading your portal...</strong></div>';
  if (!await guard()) return;
  try {
    await controllers[page]();
  } catch (err) {
    console.error(err);
    layout(`<section class="card"><h2>Page could not load</h2><p>${escapeHtml(errorMessage(err))}</p><button class="btn" onclick="location.reload()">Try again</button></section>`);
    toast(errorMessage(err), "error");
  }
}
boot();
