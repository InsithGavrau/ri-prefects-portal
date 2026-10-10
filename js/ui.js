import { getMotivationalQuote } from "./quotes.js";
export { drawBackground } from "./webglBackground.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

export function toast(message, type = "success") {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.append(stack);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 4500);
}

export function setBusy(element, busy, label = "Working...") {
  if (!element) return;
  if (busy) {
    element.dataset.label = element.textContent;
    element.dataset.originalHtml = element.innerHTML;
    element.textContent = label;
    element.disabled = true;
  } else {
    if (element.dataset.originalHtml) element.innerHTML = element.dataset.originalHtml;
    else element.textContent = element.dataset.label || element.textContent;
    element.disabled = false;
  }
}

export function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-LK", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

export function badge(value) {
  return `<span class="badge ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

export const PORTAL_CREDIT_TEXT = "System developed by Insith Liyana Arachchi and Diyon Liyana Arachchi | 2026 Headboard";
export const TECH_ISSUES_MAILTO = "mailto:insith6969@gmail.com";
export const LINKEDIN_URL = "https://www.linkedin.com/in/insith101";

export function renderRoleBadge(role) {
  const key = String(role || "unknown").toLowerCase();
  const label = ({
    prefect: "Prefect",
    coordinator: "Coordinator",
    teacher: "Teacher",
    admin: "Admin",
  })[key] || key.replace(/\b\w/g, char => char.toUpperCase());
  const icons = {
    prefect: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6l7-3z"/><path d="M9 12l2 2 4-5"/></svg>',
    coordinator: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l1 2h3v15H5V6h3l1-2z"/><path d="M9 12l2 2 4-4"/><path d="M9 17h6"/></svg>',
    teacher: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h10a4 4 0 0 1 4 4v10H8a3 3 0 0 1-3-3V5z"/><path d="M8 5v11a3 3 0 0 0 3 3"/><path d="M9 9h6"/></svg>',
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l4 4 4-7 4 7 4-4-2 11H6L4 8z"/><path d="M7 19h10"/></svg>',
  };
  return `<span class="role-badge role-${escapeHtml(key)}"><span class="role-badge-icon">${icons[key] || icons.prefect}</span>${escapeHtml(label)}</span>`;
}

export function initQuote() {
  const target = $("[data-quote]");
  if (!target) return;
  const refresh = () => {
    target.textContent = getMotivationalQuote();
  };
  refresh();
  $("[data-new-quote]")?.addEventListener("click", refresh);
}
