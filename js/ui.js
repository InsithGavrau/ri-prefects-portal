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
    element.textContent = label;
    element.disabled = true;
  } else {
    element.textContent = element.dataset.label || element.textContent;
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

export function initQuote() {
  const target = $("[data-quote]");
  if (!target) return;
  const refresh = () => {
    target.textContent = getMotivationalQuote();
  };
  refresh();
  $("[data-new-quote]")?.addEventListener("click", refresh);
}
