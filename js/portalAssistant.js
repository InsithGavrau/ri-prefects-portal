import { createIcons, X, SendHorizontal, RotateCcw, Bell, BellOff, ChevronRight } from "lucide";
import { roleHome } from "./router.js";
import { TECH_ISSUES_MAILTO } from "./ui.js";
import { canRunAssistantAction, getAssistantReply, getPageGuide } from "./assistantKnowledge.js";

const ASSISTANT_ID = "ri-helpbot";
const QUIET_KEY = "ri-helpbot-quiet";
const INTRO_KEY = "ri-helpbot-introduced";
const ICONS = { X, SendHorizontal, RotateCcw, Bell, BellOff, ChevronRight };

const PIXEL_BASE = [
  "....................",
  ".........OO.........",
  "........OHHO........",
  "........OHHO........",
  ".....OOOOOOOOOO.....",
  "....OHHLLLLLLLLO....",
  "...OHHLLLLLLLLLLO...",
  "..OHLLLLLLLLLLLLLO..",
  "..OLLLEELLLLLEELLO..",
  "..OLLLEELLLLLEELLO..",
  "..OLLLLLLLLLLLLLLO..",
  "..OLLLLLLOOLLLLLLO..",
  "MMOLLLLLLLLLLMMMMOMM",
  "MMOLLLLLLLLMMMMMMOMM",
  "..OLLLLLLMMMMMMSSO..",
  "..OLLLLMMMMMMSSSSO..",
  "...OMMMMMMSSSSSSO...",
  "....OMMMMSSSSSSO....",
  ".....OOOOOOOOOO.....",
  ".....OOO....OOO.....",
];

const PALETTE = {
  O: "#2f130f",
  H: "#fefed6",
  L: "#c9a646",
  M: "#6a362a",
  S: "#4a2119",
  E: "#120807",
  B: "#efe1be",
};

const STATES = ["idle", "wave", "think", "cheer", "sleep", "dash"];

let activeRoot = null;
let context = {};
let listenersBound = false;
let lastReactionAt = 0;
let quiet = false;
let timers = {};
let lastField = null;
let focusBeforeOpen = null;

function preference(storage, key, value) {
  try {
    if (value === undefined) return window[storage].getItem(key);
    window[storage].setItem(key, value);
  } catch {
    // Help remains usable when a browser blocks storage.
  }
}

function icon(name) {
  return `<i data-helpbot-icon="${name}" aria-hidden="true"></i>`;
}

function refreshIcons() {
  createIcons({ icons: ICONS, root: activeRoot, nameAttr: "data-helpbot-icon" });
  activeRoot.querySelectorAll("[data-helpbot-icon]").forEach(el => el.removeAttribute("data-lucide"));
}

export function initPortalAssistant({ page, profile = null } = {}) {
  Object.values(timers).forEach(window.clearTimeout);
  timers = {};
  activeRoot?.remove();
  lastField = null;
  focusBeforeOpen = null;
  context = { page, role: profile?.role };
  quiet = preference("localStorage", QUIET_KEY) === "true";
  const guide = getPageGuide(context);
  activeRoot = document.createElement("aside");
  activeRoot.id = ASSISTANT_ID;
  activeRoot.className = "ri-helpbot no-print";
  activeRoot.setAttribute("aria-label", "Portal help assistant");
  activeRoot.dataset.state = quiet ? "sleep" : "idle";
  activeRoot.dataset.open = "false";
  activeRoot.innerHTML = `
    <div class="ri-helpbot-bubble" data-helpbot-bubble role="status" aria-live="polite"></div>
    <button class="ri-helpbot-launch" type="button" data-helpbot-toggle aria-label="Open RI Guide" title="Open RI Guide" aria-expanded="false" aria-controls="ri-helpbot-panel">
      <span class="ri-helpbot-sprite" aria-hidden="true">${spriteMarkup(quiet ? "sleep" : "idle")}</span>
      <span class="ri-helpbot-indicator" aria-hidden="true"></span>
    </button>
    <section class="ri-helpbot-panel" id="ri-helpbot-panel" aria-label="RI Guide" aria-hidden="true" hidden>
      <header>
        <div><strong>RI Guide</strong><span>${escapeHtml(guide.title)}</span></div>
        <div class="ri-helpbot-tools">
          <button type="button" data-helpbot-reset title="Start a new conversation" aria-label="Start a new conversation">${icon("rotate-ccw")}</button>
          <button type="button" data-helpbot-quiet aria-pressed="${quiet}" title="${quiet ? "Enable helpful hints" : "Mute helpful hints"}" aria-label="${quiet ? "Enable helpful hints" : "Mute helpful hints"}">${icon(quiet ? "bell-off" : "bell")}</button>
          <button type="button" data-helpbot-close title="Close RI Guide" aria-label="Close RI Guide">${icon("x")}</button>
        </div>
      </header>
      <div class="ri-helpbot-thread" data-helpbot-thread role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions"></div>
      <div class="ri-helpbot-context" data-helpbot-context hidden></div>
      <div class="ri-helpbot-quick" data-helpbot-actions aria-label="Suggested actions"></div>
      <form class="ri-helpbot-ask" data-helpbot-form>
        <input name="question" type="text" maxlength="500" autocomplete="off" placeholder="Ask RI Guide..." aria-label="Message RI Guide">
        <button type="submit" title="Send message" aria-label="Send message" disabled>${icon("send-horizontal")}</button>
      </form>
    </section>`;
  document.body.appendChild(activeRoot);
  resetConversation();
  bindAssistant();
  refreshIcons();
  scheduleIntroduction();
}

function resetConversation() {
  const guide = getPageGuide(context);
  activeRoot.querySelector("[data-helpbot-thread]").replaceChildren();
  addMessage(guide.greeting);
  replaceActions(guide.actions);
  const hint = activeRoot.querySelector("[data-helpbot-context]");
  hint.hidden = true;
  hint.textContent = "";
  const input = activeRoot.querySelector("[name='question']");
  input.value = "";
  activeRoot.querySelector("[type='submit']").disabled = true;
}

function bindAssistant() {
  activeRoot.querySelector("[data-helpbot-toggle]").addEventListener("click", () => setOpen(activeRoot.dataset.open !== "true"));
  activeRoot.querySelector("[data-helpbot-close]").addEventListener("click", () => setOpen(false));
  activeRoot.querySelector("[data-helpbot-reset]").addEventListener("click", () => {
    resetConversation();
    setState("wave");
    activeRoot.querySelector("[name='question']").focus();
  });
  activeRoot.querySelector("[data-helpbot-quiet]").addEventListener("click", event => {
    quiet = !quiet;
    preference("localStorage", QUIET_KEY, String(quiet));
    hideBubble();
    window.clearTimeout(timers.intro);
    const button = event.currentTarget;
    button.setAttribute("aria-pressed", String(quiet));
    button.setAttribute("aria-label", quiet ? "Enable helpful hints" : "Mute helpful hints");
    button.title = button.getAttribute("aria-label");
    button.innerHTML = icon(quiet ? "bell-off" : "bell");
    refreshIcons();
    setState(quiet ? "sleep" : "wave");
  });
  activeRoot.querySelector("[data-helpbot-actions]").addEventListener("click", event => {
    const button = event.target.closest("[data-helpbot-action]");
    if (button) runAction(button.dataset.helpbotAction);
  });
  const form = activeRoot.querySelector("[data-helpbot-form]");
  form.elements.question.addEventListener("input", () => {
    form.querySelector("[type='submit']").disabled = !form.elements.question.value.trim();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const question = form.elements.question.value.trim();
    if (!question) return;
    activeRoot.querySelector("[data-helpbot-context]").hidden = true;
    addMessage(question, "user");
    const reply = getAssistantReply(question, context);
    addMessage(reply.text);
    replaceActions(reply.actions);
    setState(reply.state);
    form.reset();
    form.querySelector("[type='submit']").disabled = true;
    form.elements.question.focus({ preventScroll: true });
  });
  if (!listenersBound) {
    document.addEventListener("focusin", handleFocusReaction);
    document.addEventListener("pointerdown", handlePointerReaction);
    document.addEventListener("submit", handleSubmitReaction, true);
    document.addEventListener("keydown", handleShortcut);
    listenersBound = true;
  }
}

function setOpen(open, restoreFocus = true) {
  const panel = activeRoot.querySelector(".ri-helpbot-panel");
  window.clearTimeout(timers.close);
  window.clearTimeout(timers.intro);
  hideBubble();
  preference("sessionStorage", INTRO_KEY, "true");
  if (open) {
    focusBeforeOpen = document.activeElement;
    panel.hidden = false;
  }
  activeRoot.dataset.open = String(open);
  activeRoot.querySelector("[data-helpbot-toggle]").setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));
  panel.inert = !open;
  setState(open ? "wave" : quiet ? "sleep" : "idle");
  if (open) activeRoot.querySelector("[name='question']").focus({ preventScroll: true });
  else {
    timers.close = window.setTimeout(() => { panel.hidden = true; }, 180);
    if (restoreFocus) {
      const target = focusBeforeOpen?.isConnected && focusBeforeOpen !== document.body ? focusBeforeOpen : activeRoot.querySelector("[data-helpbot-toggle]");
      target.focus({ preventScroll: true });
    }
  }
}

function hideBubble() {
  const bubble = activeRoot?.querySelector("[data-helpbot-bubble]");
  if (bubble) {
    bubble.dataset.show = "false";
    bubble.textContent = "";
  }
  window.clearTimeout(timers.bubble);
}

function showBubble(message) {
  if (!activeRoot || activeRoot.dataset.open === "true" || quiet) return;
  const bubble = activeRoot.querySelector("[data-helpbot-bubble]");
  bubble.textContent = message;
  bubble.dataset.show = "true";
  window.clearTimeout(timers.bubble);
  timers.bubble = window.setTimeout(hideBubble, 4500);
}

function addMessage(message, author = "bot") {
  const thread = activeRoot.querySelector("[data-helpbot-thread]");
  const node = document.createElement("div");
  node.className = `ri-helpbot-message ${author}`;
  node.textContent = message;
  thread.appendChild(node);
  while (thread.children.length > 40) thread.firstElementChild.remove();
  thread.scrollTop = thread.scrollHeight;
}

function replaceActions(actions) {
  const box = activeRoot.querySelector("[data-helpbot-actions]");
  const visible = actions.filter(([, target]) => {
    if (!canRunAssistantAction(target, context)) return false;
    if (!target.startsWith("focus:")) return true;
    const field = document.querySelector(target.slice(6));
    return field && !field.disabled && !field.readOnly && field.getClientRects().length;
  });
  if (!visible.length) visible.push(["Help with this page", "help"]);
  box.innerHTML = visible.map(([label, target]) => `<button type="button" data-helpbot-action="${escapeHtml(target)}"><span>${escapeHtml(label)}</span>${icon("chevron-right")}</button>`).join("");
  refreshIcons();
}

function runAction(target) {
  if (!canRunAssistantAction(target, context)) {
    addMessage("That page is not available for this account. Choose one of your portal pages instead.");
    replaceActions(getPageGuide(context).actions);
    return;
  }
  if (target === "close") return setOpen(false);
  if (target === "help") {
    const guide = getPageGuide(context);
    addMessage(guide.detail);
    replaceActions(guide.actions);
    return setState("think");
  }
  if (target === "setup") {
    const fields = ["first_name", "email", "phone", "current_class", "password", "confirm_password"];
    const current = fields.indexOf(lastField?.name);
    const next = fields.slice(current + 1).find(name => document.querySelector(`[name='${name}']`));
    if (next) return runAction(`focus:[name='${next}']`);
    addMessage("Review your details and use Create account when you are ready. I cannot submit the form for you.");
    return;
  }
  if (target.startsWith("focus:")) {
    const field = document.querySelector(target.slice(6));
    if (!field || field.disabled || field.readOnly || !field.getClientRects().length) {
      addMessage("That field is not available yet. Choose the duty type first, or use the page's current form.");
      return;
    }
    lastField = field;
    setOpen(false, false);
    field.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    field.focus({ preventScroll: true });
    setState("think");
    return;
  }
  if (target.startsWith("anchor:")) {
    const anchor = document.querySelector(target.slice(7));
    if (!anchor) return addMessage("The honor roll is not available on this page yet.");
    setOpen(false, false);
    anchor.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    return;
  }
  if (target === "support") {
    location.href = TECH_ISSUES_MAILTO;
    return;
  }
  location.href = target === "home" ? roleHome[context.role] || "login.html" : target;
}

function handleFocusReaction(event) {
  if (!activeRoot || activeRoot.contains(event.target)) return;
  const field = event.target.closest("input,select,textarea");
  if (!field || field.disabled || field.readOnly) return;
  lastField = field;
  if (quiet) return;
  const hint = activeRoot.querySelector("[data-helpbot-context]");
  hint.textContent = fieldHint(field);
  hint.hidden = false;
  if (Date.now() - lastReactionAt > 2500) {
    lastReactionAt = Date.now();
    setState("think");
  }
}

function handlePointerReaction(event) {
  if (!activeRoot || quiet || activeRoot.contains(event.target)) return;
  if (Date.now() - lastReactionAt < 3500) return;
  const target = event.target.closest(".nav-link,.btn,[data-hof-card]");
  if (!target) return;
  lastReactionAt = Date.now();
  hideBubble();
  setState(target.matches(".nav-link") ? "dash" : "wave");
}

function handleSubmitReaction(event) {
  if (!activeRoot || quiet || activeRoot.contains(event.target)) return;
  if (!(event.target instanceof HTMLFormElement)) return;
  hideBubble();
  setState("think");
}

function handleShortcut(event) {
  if (!activeRoot) return;
  if (event.key === "Escape" && activeRoot.dataset.open === "true") {
    event.preventDefault();
    setOpen(false);
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setOpen(activeRoot.dataset.open !== "true");
  }
}

function scheduleIntroduction() {
  if (quiet || preference("sessionStorage", INTRO_KEY) === "true") return;
  timers.intro = window.setTimeout(() => {
    if (!activeRoot || activeRoot.dataset.open === "true" || matchMedia("(max-width: 640px)").matches) return;
    if (document.hidden || document.body.classList.contains("mobile-menu-open") || document.querySelector(".modal-backdrop") || document.activeElement?.matches("input,textarea,select")) return;
    preference("sessionStorage", INTRO_KEY, "true");
    showBubble("Need a hand? RI Guide is here.");
    setState("wave");
  }, 8000);
}

function fieldHint(field) {
  const name = String(field.name || field.id).toLowerCase();
  if (name.includes("confirm_password")) return "Confirm password: repeat your new password exactly.";
  if (name.includes("password")) return context.page === "login" ? "Use your existing password. Sign-in support can help with a reset." : "Use at least 6 characters and keep your password private.";
  if (name.includes("email")) return "Use the Royal Institute email for your account.";
  if (name.includes("class")) return "Current class: for example, 11A or 12 Commerce.";
  if (name.includes("phone")) return "Use a reachable telephone number.";
  if (name.includes("duty_type")) return "Choose the duty type before its location and day.";
  if (name.includes("duty_location")) return "Choose a location belonging to this duty. Checkpoint does not need one.";
  if (name.includes("day")) return "Choose the weekday roster you need, not necessarily today's weekday.";
  if (name.includes("date")) return "Choose the date for the duty or records you want.";
  return "Check the field label, then continue when you are ready.";
}

function setState(state) {
  if (!activeRoot) return;
  const next = STATES.includes(state) ? state : "idle";
  if (activeRoot.dataset.state !== next) {
    activeRoot.dataset.state = next;
    activeRoot.querySelector(".ri-helpbot-sprite").innerHTML = spriteMarkup(next);
  }
  window.clearTimeout(timers.state);
  if (next !== "idle" && next !== "sleep") timers.state = window.setTimeout(() => setState(quiet ? "sleep" : "idle"), 2000);
}

function spriteMarkup(state) {
  const grid = buildFrame(state);
  const cells = [];
  grid.forEach((row, y) => row.forEach((key, x) => {
    if (key === ".") return;
    cells.push(`<i style="--x:${x};--y:${y};--c:${PALETTE[key] || PALETTE.M}"></i>`);
  }));
  return cells.join("");
}

function buildFrame(state) {
  const grid = PIXEL_BASE.map(row => row.split(""));
  if (state === "wave") {
    fill(grid, 12, 13, 18, 19, ".");
    fill(grid, 7, 13, 18, 19, "M");
    put(grid, 7, 18, "HH");
    smile(grid);
  }
  if (state === "think") {
    clearEyes(grid);
    put(grid, 7, 6, "EE");
    put(grid, 7, 13, "EE");
    fill(grid, 12, 13, 18, 19, ".");
    fill(grid, 10, 13, 18, 19, "M");
    put(grid, 10, 18, "HH");
  }
  if (state === "cheer") {
    smile(grid);
    fill(grid, 6, 13, 0, 1, "M");
    fill(grid, 6, 13, 18, 19, "M");
    put(grid, 6, 0, "HH");
    put(grid, 6, 18, "HH");
  }
  if (state === "sleep") {
    clearEyes(grid);
    put(grid, 9, 5, "OOO");
    put(grid, 9, 13, "OOO");
    put(grid, 11, 9, "OO");
    fill(grid, 12, 13, 0, 1, ".");
    fill(grid, 12, 13, 18, 19, ".");
  }
  if (state === "dash") {
    fill(grid, 12, 13, 0, 1, ".");
    fill(grid, 14, 15, 0, 1, "M");
    fill(grid, 14, 15, 18, 19, "M");
    put(grid, 19, 4, "OOO");
    put(grid, 19, 13, "OOO");
  }
  return grid;
}

function smile(grid) {
  fill(grid, 11, 13, 7, 12, "L");
  put(grid, 11, 8, "OLLO");
  put(grid, 12, 9, "OO");
}

function clearEyes(grid) {
  fill(grid, 7, 9, 5, 8, "L");
  fill(grid, 7, 9, 12, 15, "L");
}

function put(grid, y, x, value) {
  [...value].forEach((char, index) => {
    if (grid[y] && x + index >= 0 && x + index < 20) grid[y][x + index] = char;
  });
}

function fill(grid, y0, y1, x0, x1, value) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (grid[y] && x >= 0 && x < 20) grid[y][x] = value;
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
