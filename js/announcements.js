import { requireClient } from "./supabase.js";
import { $, escapeHtml, toast, setBusy, badge, renderRoleBadge } from "./ui.js";

const STAFF_ROLES = new Set(["teacher", "admin"]);
const ACTIVE_ROLES = new Set(["prefect", "coordinator", "teacher", "admin"]);
const VISIBLE_STATUSES = ["active", "edited"];
const MESSAGE_LIMIT = 1800;

let context = {};
let announcements = [];

export async function unreadAnnouncementAlertMarkup(profile) {
  if (!profile || profile.account_status !== "active" || !ACTIVE_ROLES.has(profile.role)) return "";
  try {
    const [{ data: rows, error: announcementError }, { data: reads, error: readError }] = await Promise.all([
      requireClient()
        .from("announcements")
        .select("id")
        .in("status", VISIBLE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(40),
      requireClient()
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", profile.id),
    ]);
    if (announcementError || readError) throw announcementError || readError;
    const readIds = new Set((reads || []).map(row => row.announcement_id));
    const unread = (rows || []).filter(row => !readIds.has(row.id));
    if (!unread.length) return "";
    return `
      <section class="announcement-alert card">
        <div>
          <p class="eyebrow">Announcements</p>
          <h2>You have new messages in the Announcements tab.</h2>
        </div>
        <a class="btn" href="announcements.html">View Announcements</a>
      </section>
    `;
  } catch (err) {
    console.warn("Announcement unread check skipped", err);
    return "";
  }
}

export async function announcementsFull(options) {
  context = options;
  context.layout(`
    <section class="announcements-page">
      ${canManage() ? composerMarkup() : ""}
      <section class="card announcement-toolbar">
        <div class="field">
          <label for="announcement-search">Search announcements</label>
          <input id="announcement-search" type="search" placeholder="Search by message or author">
        </div>
        <div class="field compact-filter">
          <label for="announcement-filter">Filter</label>
          <select id="announcement-filter">
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="reacted">Reacted</option>
          </select>
        </div>
      </section>
      <section id="announcement-feed" class="announcement-feed">
        <section class="card empty">Loading announcements...</section>
      </section>
    </section>
  `);
  bindAnnouncementActions();
  await refreshAnnouncements();
}

function canManage() {
  return STAFF_ROLES.has(context.profile?.role);
}

function composerMarkup() {
  return `
    <section class="card announcement-composer">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Staff message</p>
          <h2>Post announcement</h2>
        </div>
        ${renderRoleBadge(context.profile.role)}
      </div>
      <form id="announcement-form">
        <div class="field">
          <label for="announcement-message">Message</label>
          <textarea id="announcement-message" name="message" maxlength="${MESSAGE_LIMIT}" required placeholder="Write a clear announcement..."></textarea>
          <small>Use announcements for official notices, reminders, and prefect updates.</small>
        </div>
        <div class="announcement-composer-meta">
          <span id="announcement-counter">0 / ${MESSAGE_LIMIT}</span>
        </div>
        <div class="actions">
          <button type="submit" class="btn">Post Announcement</button>
          <button type="button" class="btn ghost" data-clear-announcement>Clear</button>
        </div>
      </form>
    </section>
  `;
}

function bindAnnouncementActions() {
  const form = $("#announcement-form");
  form?.addEventListener("submit", submitAnnouncement);
  $("#announcement-message")?.addEventListener("input", updateCharacterCounter);
  $("[data-clear-announcement]")?.addEventListener("click", () => {
    form?.reset();
    updateCharacterCounter();
    $("#announcement-message")?.focus();
  });
  $("#announcement-search")?.addEventListener("input", renderAnnouncements);
  $("#announcement-filter")?.addEventListener("change", renderAnnouncements);
  $("#announcement-feed")?.addEventListener("click", async event => {
    const reaction = event.target.closest("[data-reaction]");
    const edit = event.target.closest("[data-edit-announcement]");
    const remove = event.target.closest("[data-delete-announcement]");
    if (reaction) {
      await toggleReaction(reaction.dataset.announcementId, reaction.dataset.reaction);
      return;
    }
    if (edit) {
      const item = announcements.find(row => row.id === edit.dataset.editAnnouncement);
      if (item) openEditAnnouncementModal(item);
      return;
    }
    if (remove) {
      await deleteAnnouncement(remove.dataset.deleteAnnouncement, remove);
    }
  });
}

async function submitAnnouncement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type=submit]", form);
  const message = String(new FormData(form).get("message") || "").trim();
  if (!message) {
    toast("Announcement message is required.", "error");
    return;
  }
  setBusy(button, true, "Posting...");
  try {
    const { error } = await requireClient().from("announcements").insert({
      author_id: context.profile.id,
      message,
      status: "active",
    });
    if (error) throw error;
    form.reset();
    updateCharacterCounter();
    toast("Announcement posted.");
    await refreshAnnouncements();
  } catch (err) {
    toast(cleanError(err), "error");
  } finally {
    setBusy(button, false);
  }
}

async function refreshAnnouncements() {
  const target = $("#announcement-feed");
  if (target) target.innerHTML = '<section class="card empty">Loading announcements...</section>';
  try {
    const { data, error } = await requireClient()
      .from("announcements")
      .select("id,author_id,message,status,created_at,updated_at,author:profiles(first_name,role),announcement_reactions(id,user_id,reaction_type),announcement_reads(user_id)")
      .in("status", VISIBLE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    announcements = data || [];
    renderAnnouncements();
    markAnnouncementsRead(announcements).catch(err => console.warn("Announcement read mark skipped", err));
  } catch (err) {
    if (!target) return;
    target.innerHTML = `<section class="card empty"><h2>Announcements could not load</h2><p>${escapeHtml(cleanError(err))}</p></section>`;
  }
}

function visibleAnnouncements() {
  const search = String($("#announcement-search")?.value || "").trim().toLowerCase();
  const filter = $("#announcement-filter")?.value || "all";
  return announcements.filter(item => {
    const author = item.author?.first_name || "";
    const haystack = `${item.message || ""} ${author}`.toLowerCase();
    const unread = !hasRead(item);
    const reacted = ownReaction(item);
    return (!search || haystack.includes(search)) &&
      (filter === "all" || (filter === "unread" && unread) || (filter === "reacted" && reacted));
  });
}

function renderAnnouncements() {
  const target = $("#announcement-feed");
  if (!target) return;
  const rows = visibleAnnouncements();
  if (!rows.length) {
    target.innerHTML = `<section class="card empty">${escapeHtml(emptyAnnouncementMessage())}</section>`;
    return;
  }
  target.innerHTML = rows.map((item, index) => announcementCardMarkup(item, index)).join("");
}

function announcementCardMarkup(item, index) {
  const authorName = item.author?.first_name || "RI Staff";
  const authorRole = item.author?.role || "teacher";
  const unread = !hasRead(item);
  const own = ownReaction(item);
  const reactions = item.announcement_reactions || [];
  const canEdit = canManage();
  return `
    <article class="announcement-card" style="--delay:${Math.min(index * 45, 360)}ms">
      <div class="announcement-avatar" aria-hidden="true">${escapeHtml(initials(authorName))}</div>
      <div class="announcement-bubble">
        <div class="announcement-meta">
          <div class="announcement-author">
            <strong>${escapeHtml(authorName)}</strong>
            ${renderRoleBadge(authorRole)}
            ${unread ? '<span class="badge new">New</span>' : ""}
            ${item.status === "edited" ? badge("edited") : ""}
          </div>
          <time datetime="${escapeHtml(item.created_at)}">${formatTimestamp(item.created_at)}</time>
        </div>
        <div class="announcement-text">${messageHtml(item.message)}</div>
        <div class="announcement-actions">
          ${reactionButton(item.id, "thumbs_up", "Thumbs up", reactionCount(reactions, "thumbs_up"), own === "thumbs_up")}
          ${reactionButton(item.id, "heart", "Heart", reactionCount(reactions, "heart"), own === "heart")}
          ${canEdit ? `<button type="button" class="btn ghost small" data-edit-announcement="${item.id}">Edit</button><button type="button" class="btn danger small" data-delete-announcement="${item.id}">Delete</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

function reactionButton(id, type, label, count, active) {
  const symbol = type === "heart" ? "&#9829;" : "&#128077;";
  return `<button type="button" class="reaction-btn ${active ? "active" : ""}" data-announcement-id="${id}" data-reaction="${type}" aria-label="${label}">${symbol}<span>${count}</span></button>`;
}

async function toggleReaction(announcementId, reactionType) {
  const item = announcements.find(row => row.id === announcementId);
  if (!item) return;
  const own = (item.announcement_reactions || []).find(row => row.user_id === context.profile.id);
  try {
    if (own?.reaction_type === reactionType) {
      const { error } = await requireClient()
        .from("announcement_reactions")
        .delete()
        .eq("announcement_id", announcementId)
        .eq("user_id", context.profile.id);
      if (error) throw error;
    } else {
      const { error } = await requireClient()
        .from("announcement_reactions")
        .upsert({
          announcement_id: announcementId,
          user_id: context.profile.id,
          reaction_type: reactionType,
          updated_at: new Date().toISOString(),
        }, { onConflict: "announcement_id,user_id" });
      if (error) throw error;
    }
    await refreshAnnouncements();
  } catch (err) {
    toast(cleanError(err), "error");
  }
}

function openEditAnnouncementModal(item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="card modal">
      <p class="eyebrow">Edit announcement</p>
      <h2>Update message</h2>
      <form id="announcement-edit-form">
        <div class="field">
          <label>Message</label>
          <textarea name="message" maxlength="1800" required>${escapeHtml(item.message || "")}</textarea>
        </div>
        <div class="form-message" data-edit-announcement-message></div>
        <div class="actions">
          <button type="submit" class="btn">Save Changes</button>
          <button type="button" class="btn ghost" data-cancel-edit>Cancel</button>
        </div>
      </form>
    </section>
  `;
  document.body.append(modal);
  $("[data-cancel-edit]", modal).addEventListener("click", () => modal.remove());
  $("#announcement-edit-form", modal).addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("button[type=submit]", event.currentTarget);
    const message = String(new FormData(event.currentTarget).get("message") || "").trim();
    if (!message) return;
    setBusy(button, true, "Saving...");
    try {
      const { error } = await requireClient()
        .from("announcements")
        .update({ message, status: "edited", updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
      modal.remove();
      toast("Announcement updated.");
      await refreshAnnouncements();
    } catch (err) {
      const messageEl = $("[data-edit-announcement-message]", modal);
      messageEl.textContent = cleanError(err);
      messageEl.className = "form-message error";
      setBusy(button, false);
    }
  });
}

async function deleteAnnouncement(id, button) {
  if (!confirm("Delete this announcement from the feed?")) return;
  setBusy(button, true, "Deleting...");
  try {
    const { error: deleteError } = await requireClient()
      .from("announcements")
      .delete()
      .eq("id", id);

    if (deleteError && !isPermissionError(deleteError)) throw deleteError;

    if (deleteError) {
      const { error: archiveError } = await requireClient()
        .from("announcements")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (archiveError) throw archiveError;
    }

    announcements = announcements.filter(item => item.id !== id);
    renderAnnouncements();
    toast("Announcement deleted.");
    await refreshAnnouncements();
  } catch (err) {
    toast(cleanError(err), "error");
  } finally {
    setBusy(button, false);
  }
}

async function markAnnouncementsRead(rows) {
  const unread = rows.filter(item => !hasRead(item));
  if (!unread.length) return;
  const now = new Date().toISOString();
  const payload = unread.map(item => ({
    announcement_id: item.id,
    user_id: context.profile.id,
    read_at: now,
  }));
  const { error } = await requireClient()
    .from("announcement_reads")
    .upsert(payload, { onConflict: "announcement_id,user_id" });
  if (error) throw error;
  unread.forEach(item => {
    item.announcement_reads = [...(item.announcement_reads || []), { user_id: context.profile.id }];
  });
}

function hasRead(item) {
  return (item.announcement_reads || []).some(row => row.user_id === context.profile.id);
}

function ownReaction(item) {
  return (item.announcement_reactions || []).find(row => row.user_id === context.profile.id)?.reaction_type || "";
}

function reactionCount(rows, type) {
  return (rows || []).filter(row => row.reaction_type === type).length;
}

function initials(name = "RI") {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "RI";
}

function messageHtml(message = "") {
  return escapeHtml(message).replace(/\r?\n/g, "<br>");
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat("en-LK", { timeStyle: "short" }).format(date);
  if (date.toDateString() === now.toDateString()) return `Today at ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function emptyAnnouncementMessage() {
  const search = String($("#announcement-search")?.value || "").trim();
  const filter = $("#announcement-filter")?.value || "all";
  if (filter === "unread" && !search) return "You are all caught up.";
  if (filter === "reacted" && !search) return "No reacted announcements yet.";
  return "No announcements yet.";
}

function updateCharacterCounter() {
  const field = $("#announcement-message");
  const counter = $("#announcement-counter");
  if (!field || !counter) return;
  const used = field.value.length;
  counter.textContent = `${used} / ${MESSAGE_LIMIT}`;
  counter.classList.toggle("near-limit", used > MESSAGE_LIMIT * 0.86);
}

function cleanError(err) {
  const message = err?.message || "";
  if (isPermissionError(err)) {
    return "Supabase blocked this announcement action with grants/RLS. Run sql/fix-announcements-rls.sql in the Supabase SQL Editor, reload, and use an active teacher/admin account for posting, editing, or deleting.";
  }
  return context.errorMessage ? context.errorMessage(err) : err?.message || "Something went wrong.";
}

function isPermissionError(err) {
  const message = err?.message || "";
  return err?.code === "42501" || /row-level security|permission denied/i.test(message);
}
