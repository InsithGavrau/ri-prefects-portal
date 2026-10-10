let listenersBound = false;

function setOpen(open, restoreFocus = true) {
  const toggle = document.querySelector("[data-mobile-menu-toggle]");
  const menu = document.querySelector("#mobile-menu");
  if (!menu) return;
  document.body.classList.toggle("mobile-menu-open", open);
  toggle?.setAttribute("aria-expanded", String(open));
  toggle?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  menu.setAttribute("aria-hidden", String(!open));
  menu.inert = !open;
  if (open) menu.querySelector("[data-mobile-menu-close]")?.focus({ preventScroll: true });
  else if (restoreFocus) toggle?.focus({ preventScroll: true });
}

export function initMobileMenu() {
  setOpen(false, false);
  document.querySelector("[data-mobile-menu-toggle]")?.addEventListener("click", () => setOpen(!document.body.classList.contains("mobile-menu-open")));
  document.querySelector("[data-mobile-menu-close]")?.addEventListener("click", () => setOpen(false));
  document.querySelector("[data-mobile-nav-backdrop]")?.addEventListener("click", () => setOpen(false));
  document.querySelectorAll(".mobile-nav .nav-link").forEach(link => link.addEventListener("click", () => setOpen(false, false)));
  if (listenersBound) return;
  document.addEventListener("keydown", event => {
    if (!document.body.classList.contains("mobile-menu-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      const buttons = [...document.querySelectorAll("#mobile-menu a[href],#mobile-menu button:not(:disabled)")].filter(el => el.getClientRects().length);
      const first = buttons[0];
      const last = buttons.at(-1);
      const outside = !document.querySelector("#mobile-menu")?.contains(document.activeElement);
      if (outside || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  });
  matchMedia("(max-width: 640px)").addEventListener("change", () => setOpen(false, false));
  listenersBound = true;
}
