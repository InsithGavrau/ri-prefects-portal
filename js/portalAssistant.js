import { roleHome, roleNav } from "./router.js";

const ASSISTANT_ID = "ri-helpbot";
const STORAGE_KEY = "ri-helpbot-open";
const HINT_DELAY = 5200;

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

const PAGE_HELP = {
  login: {
    greeting: "Welcome back. I can help you sign in or start a new prefect account.",
    tips: ["Use your Royal Institute email.", "Forgot the password? Use Sign-in support or ask an admin to reset it.", "Tick Remember email on your own device only."],
    actions: [["Focus email", "focus:#email"], ["Password", "focus:#password"], ["Create account", "signup.html"]],
  },
  signup: {
    greeting: "Let's set up the account neatly: name, school email, phone, class, then a password.",
    tips: ["Use your first name as it should appear to teachers.", "Class examples: 10A, 11B, 12 Commerce.", "After signup, a teacher or admin may need to activate the account."],
    actions: [["Start details", "focus:#first_name"], ["School email", "focus:#email"], ["Class", "focus:#current_class"], ["Back to sign in", "login.html"]],
  },
  "prefect-dashboard": {
    greeting: "This is your overview. Check profile details first, then manage duty selections.",
    tips: ["If your account is pending, teachers must approve it.", "Active duties decide which attendance sessions include you.", "Keep phone and class current."],
    actions: [["My profile", "prefect-profile.html"], ["Duty selection", "prefect-duty-selection.html"], ["Attendance", "prefect-attendance-history.html"]],
  },
  "prefect-profile": {
    greeting: "Profile setup lives here. Phone and current class are the details to keep polished.",
    tips: ["Your email and role are managed by the system.", "Update phone/class whenever they change.", "Pending accounts can still prepare details."],
    actions: [["Phone", "focus:[name='phone']"], ["Class", "focus:[name='current_class']"], ["Duties", "prefect-duty-selection.html"]],
  },
  "prefect-duty-selection": {
    greeting: "Pick your duty type first. The location and day rules change depending on the duty.",
    tips: ["Checkpoint has no location.", "Canteen and Checkpoint use an assigned weekday.", "Floor Duty is a permanent assignment."],
    actions: [["Choose duty", "focus:[name='duty_type_id']"], ["Assigned day", "focus:[name='assigned_day']"], ["Dashboard", "prefect-dashboard.html"]],
  },
  "coordinator-mark-attendance": {
    greeting: "Load a duty roster, mark each prefect, then confirm and submit attendance.",
    tips: ["Choose the date yourself.", "Checkpoint and Canteen may ask for the duty day roster.", "Review the confirmation totals before submitting."],
    actions: [["Date", "focus:[name='date']"], ["Duty type", "focus:[name='duty_type_id']"], ["My sessions", "coordinator-sessions.html"]],
  },
  timetable: {
    greeting: "The timetable is the quickest way to see who is posted where.",
    tips: ["Teachers/admins can regenerate or manage versions.", "Prefects can use it as a read-only guide.", "Use print/export controls when available."],
    actions: [["Announcements", "announcements.html"], ["Wall of Honor", "hall-of-fame.html"]],
  },
  announcements: {
    greeting: "Announcements are where staff updates and reminders live.",
    tips: ["Unread items are highlighted.", "Use reactions when available.", "Admins and teachers can manage announcements."],
    actions: [["Timetable", "timetable.html"], ["Dashboard", "home"]],
  },
  "hall-of-fame": {
    greeting: "This is the Wall of Honor. Browse approved leaders and open entries for the full legacy.",
    tips: ["The cards are approved records only.", "Admins can review submissions when permitted.", "Use the honor roll as inspiration, not a leaderboard."],
    actions: [["Honor roll", "anchor:#hof-archive"], ["Dashboard", "home"]],
  },
  "teacher-dashboard": {
    greeting: "Teacher view gives the live picture: attendance, accounts, duty approvals, and reports.",
    tips: ["Correct attendance from the review page.", "Approve new accounts under Prefects.", "Reports can filter and export CSV."],
    actions: [["Correct attendance", "teacher-attendance-review.html"], ["Prefects", "teacher-prefects.html"], ["Reports", "teacher-reports.html"]],
  },
  "admin-dashboard": {
    greeting: "Admin tools are for users, duty configuration, roster review, and staff oversight.",
    tips: ["Use Users for roles and account status.", "Use Duty options for active duty types and locations.", "Roster shows selected duty assignments."],
    actions: [["Users", "admin-users.html"], ["Duty options", "admin-duty-options.html"], ["Roster", "admin-roster.html"]],
  },
};

const FALLBACK_HELP = {
  greeting: "I can guide you around the portal and point out what to do next.",
  tips: ["Use the sidebar for the main pages.", "Forms usually save with the primary brown button.", "Profile and duty setup are the best first stops."],
  actions: [["Dashboard", "home"], ["Profile", "prefect-profile.html"], ["Timetable", "timetable.html"]],
};

let activeRoot = null;
let autoHintTimer = null;
let lastReactionAt = 0;
let lastFieldName = "";
let listenersBound = false;

export function initPortalAssistant({ page, profile = null, currentUser = null, isAuthPage = false } = {}) {
  activeRoot?.remove();
  activeRoot = document.createElement("aside");
  activeRoot.id = ASSISTANT_ID;
  activeRoot.className = "ri-helpbot no-print";
  activeRoot.setAttribute("aria-label", "Portal help assistant");
  activeRoot.dataset.state = "idle";
  activeRoot.dataset.open = localStorage.getItem(STORAGE_KEY) === "true" ? "true" : "false";
  activeRoot.innerHTML = renderAssistantShell(page, profile, currentUser, isAuthPage);
  document.body.appendChild(activeRoot);
  bindAssistant(activeRoot, page, profile, currentUser);
  say(getHelp(page).greeting, "wave", false);
  scheduleAutoHint(page, profile, isAuthPage);
}

function renderAssistantShell(page, profile, currentUser, isAuthPage) {
  const help = getHelp(page);
  const title = isAuthPage ? "Account Guide" : `${profile?.first_name || "Portal"} Guide`;
  const status = isAuthPage ? "setup helper" : `${profile?.role || "portal"} helper`;
  const isOpen = localStorage.getItem(STORAGE_KEY) === "true";
  return `
    <div class="ri-helpbot-bubble" data-helpbot-bubble role="status" aria-live="polite"></div>
    <button class="ri-helpbot-launch" type="button" data-helpbot-toggle aria-expanded="${isOpen ? "true" : "false"}" aria-controls="ri-helpbot-panel">
      <span class="ri-helpbot-sprite" aria-hidden="true">${spriteMarkup("idle")}</span>
      <span class="sr-only">Open portal help</span>
    </button>
    <section class="ri-helpbot-panel" id="ri-helpbot-panel" aria-label="Portal helper chat" aria-hidden="${isOpen ? "false" : "true"}" ${isOpen ? "" : "hidden"}>
      <header>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(status)}</span>
        </div>
        <button type="button" data-helpbot-close aria-label="Close portal helper">x</button>
      </header>
      <div class="ri-helpbot-thread" data-helpbot-thread>
        <div class="ri-helpbot-message bot">${escapeHtml(help.greeting)}</div>
      </div>
      <div class="ri-helpbot-quick" data-helpbot-actions>
        ${help.actions.map(([label, action]) => `<button type="button" data-helpbot-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join("")}
      </div>
      <form class="ri-helpbot-ask" data-helpbot-form>
        <input name="question" autocomplete="off" placeholder="Ask where to go..." aria-label="Ask the portal helper">
        <button type="submit">Ask</button>
      </form>
    </section>
  `;
}

function bindAssistant(root, page, profile, currentUser) {
  const toggle = root.querySelector("[data-helpbot-toggle]");
  const close = root.querySelector("[data-helpbot-close]");
  toggle?.addEventListener("click", () => setOpen(root.dataset.open !== "true"));
  close?.addEventListener("click", () => setOpen(false));
  root.querySelector("[data-helpbot-actions]")?.addEventListener("click", event => {
    const button = event.target.closest("[data-helpbot-action]");
    if (!button) return;
    runAction(button.dataset.helpbotAction, page, profile);
  });
  root.querySelector("[data-helpbot-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = event.currentTarget.elements.question;
    const question = String(input.value || "").trim();
    if (!question) return;
    addMessage(question, "user");
    respondToQuestion(question, page, profile);
    input.value = "";
  });
  if (!listenersBound) {
    document.addEventListener("focusin", handleFocusReaction, true);
    document.addEventListener("pointerover", handlePointerReaction, true);
    document.addEventListener("submit", handleSubmitReaction, true);
    document.addEventListener("keydown", handleShortcut);
    listenersBound = true;
  }
}

function setOpen(open) {
  if (!activeRoot) return;
  const panel = activeRoot.querySelector(".ri-helpbot-panel");
  if (open && panel) panel.hidden = false;
  activeRoot.dataset.open = open ? "true" : "false";
  activeRoot.querySelector("[data-helpbot-toggle]")?.setAttribute("aria-expanded", String(open));
  panel?.setAttribute("aria-hidden", String(!open));
  localStorage.setItem(STORAGE_KEY, String(open));
  if (open) {
    setState("think");
    activeRoot.querySelector(".ri-helpbot-ask input")?.focus({ preventScroll: true });
  } else {
    setState("idle");
    window.setTimeout(() => {
      if (activeRoot?.dataset.open !== "true" && panel) panel.hidden = true;
    }, 220);
  }
}

function say(message, state = "idle", openPanel = false) {
  if (!activeRoot) return;
  setState(state);
  const bubble = activeRoot.querySelector("[data-helpbot-bubble]");
  bubble.textContent = message;
  bubble.dataset.show = "true";
  if (openPanel) addMessage(message, "bot");
  window.clearTimeout(autoHintTimer);
  autoHintTimer = window.setTimeout(() => {
    if (activeRoot?.dataset.open !== "true") bubble.dataset.show = "false";
  }, HINT_DELAY);
}

function addMessage(message, author = "bot") {
  const thread = activeRoot?.querySelector("[data-helpbot-thread]");
  if (!thread) return;
  const node = document.createElement("div");
  node.className = `ri-helpbot-message ${author}`;
  node.textContent = message;
  thread.appendChild(node);
  thread.scrollTop = thread.scrollHeight;
}

function respondToQuestion(question, page, profile) {
  const q = question.toLowerCase();
  const route = findRoute(q, profile?.role);
  if (route) {
    const label = route[1];
    const href = route[0];
    addMessage(`Go to ${label}. I can take you there now.`, "bot");
    replaceActions([[`Open ${label}`, href], ["Stay here", "close"]]);
    setState("dash");
    return;
  }
  if (/password|forgot|reset/.test(q)) {
    addMessage("Passwords cannot be viewed. Use Sign-in support or ask an admin to send a password recovery/reset from Supabase Auth.", "bot");
    setState("think");
    return;
  }
  if (/class|phone|email|account|setup|sign ?up|register/.test(q)) {
    const authTarget = page === "signup" ? "focus:#first_name" : page === "login" ? "signup.html" : "prefect-profile.html";
    addMessage("For account setup, keep email, phone, and current class correct. I can jump you to the right spot.", "bot");
    replaceActions([["Set up details", authTarget], ["Profile page", "prefect-profile.html"]]);
    setState("wave");
    return;
  }
  addMessage(getHelp(page).tips[0] || FALLBACK_HELP.tips[0], "bot");
  setState("idle");
}

function replaceActions(actions) {
  const box = activeRoot?.querySelector("[data-helpbot-actions]");
  if (!box) return;
  box.innerHTML = actions.map(([label, action]) => `<button type="button" data-helpbot-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join("");
}

function runAction(action, page, profile) {
  if (!action || action === "close") return setOpen(false);
  if (action === "home") {
    location.href = roleHome[profile?.role] || "login.html";
    return;
  }
  if (action.startsWith("focus:")) {
    const selector = action.slice(6);
    const target = document.querySelector(selector);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => target.focus({ preventScroll: true }), 300);
      say(fieldHint(target), "think", true);
    } else {
      say("That field is not on this page. I can still guide you from the menu.", "think", true);
    }
    return;
  }
  if (action.startsWith("anchor:")) {
    document.querySelector(action.slice(7))?.scrollIntoView({ behavior: "smooth", block: "start" });
    say("Here you go.", "dash", false);
    return;
  }
  location.href = action;
}

function handleFocusReaction(event) {
  if (!activeRoot || activeRoot.contains(event.target)) return;
  const target = event.target.closest("input, select, textarea");
  if (!target || target.disabled || target.readOnly) return;
  const name = target.name || target.id || target.getAttribute("aria-label") || "";
  if (name === lastFieldName && Date.now() - lastReactionAt < 9000) return;
  lastFieldName = name;
  react(fieldHint(target), "think");
}

function handlePointerReaction(event) {
  if (!activeRoot || activeRoot.contains(event.target)) return;
  if (Date.now() - lastReactionAt < 10000) return;
  const target = event.target.closest(".nav-link, .btn, [data-mobile-menu-toggle], [data-announcement-card], [data-hof-card]");
  if (!target) return;
  const text = cleanText(target);
  if (!text) return;
  react(target.matches(".nav-link") ? `Need ${text}? I can explain this page too.` : `That ${text} action is ready when you are.`, "wave");
}

function handleSubmitReaction(event) {
  if (!activeRoot || activeRoot.contains(event.target)) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  react("Checking the form now. I will stay out of the way.", "cheer");
}

function handleShortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && event.shiftKey) {
    event.preventDefault();
    setOpen(activeRoot?.dataset.open !== "true");
  }
}

function react(message, state) {
  if (Date.now() - lastReactionAt < 2600) return;
  lastReactionAt = Date.now();
  say(message, state, false);
}

function scheduleAutoHint(page, profile, isAuthPage) {
  window.clearTimeout(autoHintTimer);
  autoHintTimer = window.setTimeout(() => {
    if (!activeRoot || activeRoot.dataset.open === "true") return;
    if (isAuthPage) {
      say(page === "signup" ? "I can walk through each signup field with you." : "Need a route in? I can focus email or send you to account creation.", "wave");
      return;
    }
    if (profile && (!profile.phone || !profile.current_class)) {
      say("Your profile details look incomplete. I can take you to the setup fields.", "think");
      replaceActions([["Complete profile", "prefect-profile.html"], ["Later", "close"]]);
      return;
    }
    say(getHelp(page).tips[0] || "I can help you find the right page.", "idle");
  }, 1800);
}

function getHelp(page) {
  return PAGE_HELP[page] || FALLBACK_HELP;
}

function findRoute(query, role) {
  const nav = roleNav[role] || Object.values(roleNav).flat();
  const matches = [
    ["attendance", "mark", "present", "absent"].some(word => query.includes(word)) && nav.find(([, label]) => /attendance|mark/i.test(label)),
    ["duty", "selection", "roster"].some(word => query.includes(word)) && nav.find(([, label]) => /duty|roster/i.test(label)),
    ["profile", "class", "phone"].some(word => query.includes(word)) && nav.find(([, label]) => /profile/i.test(label)),
    ["announcement", "notice"].some(word => query.includes(word)) && nav.find(([, label]) => /announcement/i.test(label)),
    ["timetable", "schedule"].some(word => query.includes(word)) && nav.find(([, label]) => /timetable/i.test(label)),
    ["honor", "fame", "wall"].some(word => query.includes(word)) && nav.find(([, label]) => /honor/i.test(label)),
    ["report", "csv"].some(word => query.includes(word)) && nav.find(([, label]) => /report/i.test(label)),
    ["user", "account", "role"].some(word => query.includes(word)) && nav.find(([, label]) => /user|prefect/i.test(label)),
  ];
  return matches.find(Boolean) || null;
}

function fieldHint(target) {
  const escapedId = target.id && window.CSS?.escape ? CSS.escape(target.id) : "";
  const labelFromFor = escapedId ? document.querySelector(`label[for="${escapedId}"]`)?.textContent?.trim() : "";
  const label = labelFromFor
    || target.closest(".field")?.querySelector("label")?.textContent?.trim()
    || target.name
    || "this field";
  const name = String(target.name || target.id || label).toLowerCase();
  if (name.includes("email")) return "Use the correct Royal Institute email for this account.";
  if (name.includes("password") && name.includes("confirm")) return "Repeat the same password exactly.";
  if (name.includes("password")) return "Use at least 6 characters. A longer password is better.";
  if (name.includes("class")) return "Enter the current class clearly, like 10A or 12 Commerce.";
  if (name.includes("phone")) return "Use a reachable phone number so staff can contact you.";
  if (name.includes("duty_type")) return "Choose the duty type first; the portal will adjust the next fields.";
  if (name.includes("duty_location")) return "Only locations that belong to the selected duty type should appear here.";
  if (name.includes("date")) return "Pick the duty date you want to work with.";
  return `Fill ${label} carefully, then continue.`;
}

function setState(state) {
  if (!activeRoot) return;
  activeRoot.dataset.state = STATES.includes(state) ? state : "idle";
  const sprite = activeRoot.querySelector(".ri-helpbot-sprite");
  if (sprite) sprite.innerHTML = spriteMarkup(activeRoot.dataset.state);
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

function cleanText(target) {
  return String(target.getAttribute("aria-label") || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 46);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
