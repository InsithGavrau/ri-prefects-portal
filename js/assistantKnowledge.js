import { pageTitles, roleHome, roleNav } from "./router.js";

const action = (label, target) => [label, target];
const pageAction = (target, label) => action(label || pageTitles[target.replace(".html", "")]?.[0] || "Open page", target);
const focusAction = (label, name) => action(label, `focus:[name='${name}']`);

const PAGE_GUIDES = {
  login: {
    greeting: "Welcome back. What can I help you with?",
    detail: "Sign in with your account email and password. Remember email is best used only on your own device.",
    actions: [focusAction("Email address", "email"), pageAction("signup.html", "Create account"), action("Sign-in support", "support")],
  },
  signup: {
    greeting: "Let's get your account ready. Which detail would you like help with?",
    detail: "Enter your first name, school email, reachable phone number and current class. Create a password of at least 6 characters, then repeat it. A teacher or administrator reviews new accounts.",
    actions: [focusAction("Start with your name", "first_name"), focusAction("Current class", "current_class"), focusAction("Password", "password")],
  },
  "prefect-profile": {
    detail: "Update your telephone number and current class, then save your profile. Your name, email and role are managed by staff.",
    actions: [focusAction("Phone number", "phone"), focusAction("Current class", "current_class")],
  },
  "prefect-duty-selection": {
    detail: "Choose a duty type first. Checkpoint has no location; choose an assigned weekday. Canteen needs its matching location and weekday. Floor Duty is a permanent assignment. Save the selection for staff review.",
    actions: [focusAction("Choose duty", "duty_type_id"), focusAction("Assigned weekday", "assigned_day"), pageAction("timetable.html", "View timetable")],
  },
  "coordinator-mark-attendance": {
    detail: "Choose the attendance date and duty type. For Checkpoint or Canteen, select the weekday roster yourself; select a location only when required. Load Prefects, mark each status, then Submit Attendance. Check the totals before Confirm and submit.",
    actions: [focusAction("Attendance date", "date"), focusAction("Choose duty", "duty_type_id"), pageAction("coordinator-sessions.html", "Submitted sessions")],
  },
  "coordinator-sessions": {
    detail: "Filter your submitted sessions by date, duty, location or record state. This is where you can check that a submission was recorded.",
    actions: [focusAction("Filter by date", "date"), pageAction("coordinator-mark-attendance.html", "Mark attendance")],
  },
  "prefect-attendance-history": {
    detail: "Your recorded duty attendance appears here. If a record is incorrect, ask a teacher to review it; prefects cannot change official attendance.",
    actions: [pageAction("prefect-duty-selection.html", "My duties"), pageAction("timetable.html", "Timetable")],
  },
  "teacher-attendance-review": {
    detail: "Filter submitted sessions, open the relevant session and review the prefect's attendance. Save corrections with a clear reason so the official record remains traceable.",
    actions: [focusAction("From date", "from"), pageAction("teacher-reports.html", "Attendance reports")],
  },
  "teacher-prefects": {
    detail: "Search or filter prefect accounts to review their status. Duty assignment approvals are below the account list. Review the account and selected duty before approving.",
    actions: [focusAction("Find a prefect", "search"), pageAction("teacher-dashboard.html", "Teacher overview")],
  },
  "teacher-reports": {
    detail: "Set your dates and filters, check the matching attendance, then use Export filtered CSV. The export follows the filters you have selected.",
    actions: [focusAction("From date", "from"), focusAction("Duty filter", "duty_type_id")],
  },
  "admin-users": {
    detail: "Search for a user, review the role and account status, then apply the intended change. Only administrators manage staff roles.",
    actions: [focusAction("Find a user", "search"), focusAction("Role filter", "role")],
  },
  "admin-duty-options": {
    detail: "Manage active duty types and their locations here. When adding a location, choose its correct duty type. Deactivation changes what can be selected for new duties.",
    actions: [pageAction("admin-roster.html", "Review roster"), pageAction("timetable.html", "Timetable")],
  },
  "admin-roster": {
    detail: "Review selected assignments by prefect and status. Check the duty type, location and assignment day before changing an assignment's status.",
    actions: [focusAction("Find a prefect", "search"), pageAction("admin-duty-options.html", "Duty options")],
  },
  announcements: {
    detail: "Read staff updates here and use the available reactions. Teachers and administrators can create, edit and delete announcements. Prefects and coordinators can read and react.",
    actions: [pageAction("timetable.html", "Timetable"), action("My overview", "home")],
  },
  timetable: {
    detail: "Browse the duty timetable and its available versions. Use the page's print controls for a printable timetable. Teachers and administrators manage timetable generation and editing.",
    actions: [pageAction("prefect-duty-selection.html", "My duties"), pageAction("announcements.html", "Announcements")],
  },
  "hall-of-fame": {
    detail: "Browse the approved Wall of Honor entries and open a card to read its full story. Submissions are reviewed before appearing publicly.",
    actions: [action("Browse honor roll", "anchor:#hof-archive"), action("My overview", "home")],
  },
};

export function allowedAssistantRoutes(role) {
  if (!roleHome[role]) return ["login.html", "signup.html"];
  const nav = role === "admin" ? [...roleNav.admin, ...roleNav.teacher] : roleNav[role];
  return [...new Set(nav.map(([href]) => href))];
}

export function canRunAssistantAction(target, { role, page } = {}) {
  if (["home", "close", "support", "help", "setup"].includes(target)) return true;
  if (target?.startsWith("focus:")) return true;
  if (target === "anchor:#hof-archive") return page === "hall-of-fame";
  return allowedAssistantRoutes(role).includes(target);
}

function filterActions(actions, context) {
  return actions.filter(([, target]) => canRunAssistantAction(target, context));
}

export function getPageGuide({ page, role } = {}) {
  let guide = PAGE_GUIDES[page];
  if (!guide) {
    const defaults = role === "admin" ? ["admin-users.html", "admin-duty-options.html", "admin-roster.html"]
      : role === "teacher" ? ["teacher-attendance-review.html", "teacher-prefects.html", "teacher-reports.html"]
        : role === "coordinator" ? ["coordinator-mark-attendance.html", "prefect-duty-selection.html", "coordinator-sessions.html"]
          : ["prefect-profile.html", "prefect-duty-selection.html", "prefect-attendance-history.html"];
    guide = { detail: "Choose a page below, or ask about a duty, your account, attendance or announcements.", actions: defaults.map(href => pageAction(href)) };
  }
  return {
    title: pageTitles[page]?.[0] || (page === "signup" ? "Account setup" : "Sign in"),
    greeting: guide.greeting || "Hello. Where would you like to go next?",
    detail: guide.detail,
    actions: filterActions(guide.actions, { page, role }),
  };
}

export function getAssistantReply(question, context = {}) {
  const aliases = { attendence: "attendance", attedence: "attendance", attedance: "attendance", annoucement: "announcement", annoucements: "announcements", announcment: "announcement", singup: "signup", singin: "signin", corrdinator: "coordinator" };
  const q = String(question || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b\w+\b/g, word => aliases[word] || word).replace(/\s+/g, " ").trim();
  const { role, page } = context;
  const guide = getPageGuide(context);
  const signedIn = Boolean(roleHome[role]);
  const staff = ["teacher", "admin"].includes(role);
  const reply = (text, actions = [], state = "think") => ({ text, actions: filterActions(actions, context), state });
  const route = (href, text, label) => reply(text, [pageAction(href, label)], "dash");

  if (/\b(password|passcode|forgot|reset password)\b/.test(q)) {
    if (page === "signup" && !/forgot|reset/.test(q)) return reply("Use at least 6 characters. A longer, unique password is better. Repeat it exactly in Confirm password. Keep passwords out of this chat.", [focusAction("Create password", "password"), focusAction("Confirm password", "confirm_password")]);
    return reply("Passwords cannot be viewed. For a forgotten password, contact Sign-in support or ask an administrator to arrange a reset. Never share your password in chat.", [action("Sign-in support", "support")]);
  }
  if (/\b(error|failed|blocked|schema|rls|not working|doesn t work|cannot submit|can t submit)\b/.test(q)) {
    return reply("Keep your form details in place and check the exact error shown on the page. I cannot repair account permissions or the database. Contact Technical Issues with the page name and error, but no passwords. If attendance may have saved, check My sessions before submitting again.", [action("Technical Issues", "support"), ...(role === "coordinator" ? [pageAction("coordinator-sessions.html", "Check my sessions")] : [])]);
  }
  if (/\b(pending|activate|activation|approve|approval|rejected|inactive)\b/.test(q)) {
    return reply(staff ? "Review the account and its status in the account management page. Duty assignments have their own approval status; activating an account is not the same as approving a duty." : "New prefect accounts and duty selections may need staff approval. A teacher or administrator reviews them. Ask staff to check your account and duty status; I cannot approve them for you.", staff ? [pageAction(role === "admin" ? "admin-users.html" : "teacher-prefects.html", "Review accounts")] : [action("Contact support", "support")]);
  }
  if (!signedIn && /\b(sign in|signin|log in|login)\b/.test(q)) return reply(PAGE_GUIDES.login.detail, [pageAction("login.html", "Sign in"), action("Sign-in support", "support")]);
  if (/\b(class|phone|email|name|profile|set up|setup|sign up|signup|register|registration)\b/.test(q)) {
    const field = /\bclass\b/.test(q) ? "current_class" : /\bphone\b/.test(q) ? "phone" : /\bemail\b/.test(q) ? "email" : "first_name";
    const hints = {
      current_class: "Use your current class, such as 11A or 12 Commerce.",
      phone: "Use a reachable phone number so staff can contact you.",
      email: "Use the correct Royal Institute email for your account. Staff manage email changes after signup.",
      first_name: "Enter your first name as it should appear on your school record.",
    };
    if (page === "signup") return reply(hints[field], [focusAction(`Go to ${field.replaceAll("_", " ")}`, field), action("Next setup step", "setup")], "wave");
    if (page === "login") return /\bemail\b/.test(q) ? reply(hints.email, [focusAction("Email address", "email")]) : route("signup.html", "Create a prefect account with your name, school email, phone and class. Staff will review it before full access is available.", "Create account");
    if (["prefect", "coordinator"].includes(role)) {
      const text = /\b(email|name)\b/.test(q) ? "Your name, email and role are managed by staff. You can update your phone number and current class in My Profile." : "You can update your phone number and current class in My Profile, then save the changes.";
      return page === "prefect-profile" ? reply(text, [focusAction("Phone number", "phone"), focusAction("Current class", "current_class")]) : route("prefect-profile.html", text, "My profile");
    }
    return reply("Ask an administrator to update your staff account details. Staff account roles and status are managed under Users.", role === "admin" ? [pageAction("admin-users.html", "Manage users")] : [action("Contact support", "support")]);
  }
  if (!signedIn && /\b(announcement|announcements|attendance|duty|duties|report|reports|timetable|schedule|honor|honour|fame|roster|admin)\b/.test(q)) return reply("Sign in to access portal pages. Your account role determines which tools are available.", [pageAction("login.html", "Sign in"), pageAction("signup.html", "Create account")]);
  if (/\b(announcement|announcements|notice|notices|reaction|reactions)\b/.test(q)) {
    return route("announcements.html", staff ? "Open Announcements to publish staff updates, edit or delete a message, and review reactions." : "Read announcements and react to updates. Creating, editing and deleting announcements is reserved for teachers and administrators.", "Announcements");
  }
  if (/\b(correct|correction|corrections|wrong attendance|change attendance|edit attendance)\b/.test(q)) {
    return staff ? route("teacher-attendance-review.html", "Open Attendance Corrections, find the submitted session and save the correction with a reason.", "Correct attendance") : reply("Teachers and administrators correct official attendance. Share the duty, date and the incorrect status with staff.", role === "coordinator" ? [pageAction("coordinator-sessions.html", "Find the session")] : [pageAction("prefect-attendance-history.html", "My attendance")]);
  }
  if (/\b(report|reports|csv|export)\b/.test(q) && !/timetable|schedule/.test(q)) {
    return staff ? route("teacher-reports.html", "Filter the attendance report first. Export filtered CSV downloads the records matching those filters.", "Attendance reports") : reply("Attendance reports and CSV exports are staff tools. You can review your own attendance history.", [pageAction("prefect-attendance-history.html", "My attendance")]);
  }
  if (/\b(timetable|schedule|print)\b/.test(q)) return route("timetable.html", guide.title === "Prefects Duty Timetable" ? guide.detail : "Open the timetable to check duty postings and use its print controls. Teachers and administrators manage timetable versions.", "Timetable");
  if (/\b(honor|honour|fame|wall|crown)\b/.test(q)) return route("hall-of-fame.html", "Explore the Wall of Honor and open a card to read the full entry.", "Wall of Honor");
  if (/\b(session|sessions|submitted|submission)\b/.test(q) && !/how|mark|submit attendance/.test(q)) return role === "coordinator" ? route("coordinator-sessions.html", "My Sessions lists your recorded submissions. Filter by duty and date to find the right session.", "My sessions") : reply(guide.detail, guide.actions);
  if (/\b(attendance|present|absent|late|excused|mark|submit)\b/.test(q)) {
    if (role === "coordinator" && !/\b(my attendance|my history|own attendance)\b/.test(q)) return page === "coordinator-mark-attendance" ? reply(PAGE_GUIDES[page].detail, PAGE_GUIDES[page].actions) : route("coordinator-mark-attendance.html", PAGE_GUIDES["coordinator-mark-attendance"].detail, "Mark attendance");
    if (staff) return route("teacher-attendance-review.html", "Review and correct submitted attendance in Attendance Corrections. Coordinators record duty sessions.", "Review attendance");
    return route("prefect-attendance-history.html", "Open your attendance history to see recorded duty sessions. Coordinators mark attendance and staff handle corrections.", "My attendance");
  }
  if (/\b(duty|duties|checkpoint|canteen|floor|location|weekday|roster)\b/.test(q)) {
    if (role === "admin" && /options|location|configure|type/.test(q)) return route("admin-duty-options.html", PAGE_GUIDES["admin-duty-options"].detail, "Duty options");
    if (staff) return route(role === "admin" ? "admin-roster.html" : "teacher-prefects.html", "Review the selected duty assignments and their approval status here.", "Review assignments");
    const dutyGuide = PAGE_GUIDES["prefect-duty-selection"];
    const detail = /\b(day|weekday|date)\b/.test(q) && page === "coordinator-mark-attendance" ? PAGE_GUIDES[page].detail : dutyGuide.detail;
    if (page === "coordinator-mark-attendance") return reply(detail, PAGE_GUIDES[page].actions);
    return page === "prefect-duty-selection" ? reply(detail, dutyGuide.actions) : route("prefect-duty-selection.html", detail, "Duty selection");
  }
  if (/\b(user|users|role|roles|account|accounts|promote)\b/.test(q) && staff) return route(role === "admin" ? "admin-users.html" : "teacher-prefects.html", role === "admin" ? PAGE_GUIDES["admin-users"].detail : PAGE_GUIDES["teacher-prefects"].detail, "Manage accounts");
  if (/\b(home|dashboard|overview)\b/.test(q)) return reply(signedIn ? "Your overview brings together the tools for your portal role." : "Sign in to open your portal overview.", [action(signedIn ? "My overview" : "Sign in", "home")], "dash");
  if (!signedIn && !/\b(help|hello|hi|hey|thanks|thank you)\b/.test(q)) return reply("Sign in to access portal pages. I can help with signing in or setting up a new prefect account.", [pageAction("login.html", "Sign in"), pageAction("signup.html", "Create account")]);
  return reply(/\b(thanks|thank you)\b/.test(q) ? "You're welcome. I'm here whenever you need a hand." : /\b(help|this page|how|what|hello|hi|hey)\b/.test(q) ? guide.detail : "I can help with account setup, duties, attendance, announcements and finding pages. Which one do you need?", guide.actions, "wave");
}
