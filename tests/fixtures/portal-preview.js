import { createIcons, Menu, X, LayoutDashboard, ClipboardCheck } from "lucide";
import { roleNav } from "../../js/router.js";
import { initPortalAssistant } from "../../js/portalAssistant.js";
import { initMobileMenu } from "../../js/navigation.js";

// This fixture renders real shared controls without authentication or database writes.
document.querySelectorAll("[data-fixture-nav]").forEach(nav => {
  nav.innerHTML = roleNav.coordinator.map(([href, label]) => `<a class="nav-link ${href === "coordinator-mark-attendance.html" ? "active" : ""}" href="/${href}"><span class="nav-icon"><i data-lucide="${label === "Overview" ? "layout-dashboard" : "clipboard-check"}"></i></span><span>${label}</span></a>`).join("");
});
createIcons({ icons: { Menu, X, LayoutDashboard, ClipboardCheck } });
initMobileMenu();
initPortalAssistant({ page: "coordinator-mark-attendance", profile: { role: "coordinator", first_name: "Preview" } });
document.querySelector("[data-fixture-form]").addEventListener("submit", event => event.preventDefault());
document.querySelector("[data-fixture-confirm]").addEventListener("click", () => {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = '<section class="card modal" role="dialog" aria-modal="true" aria-label="Confirm attendance"><h2>Confirm attendance</h2><p>Checkpoint Duty | Friday | Oct 9, 2026</p><div class="grid two"><div class="stat"><strong>1</strong><span>present</span></div><div class="stat"><strong>1</strong><span>late</span></div></div><div class="actions"><button class="btn" data-close-preview>Confirm and submit</button><button class="btn ghost" data-close-preview>Go back</button></div></section>';
  document.body.appendChild(backdrop);
  backdrop.querySelectorAll("[data-close-preview]").forEach(button => button.addEventListener("click", () => backdrop.remove()));
});
