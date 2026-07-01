import { defineConfig } from "vite";
import { resolve } from "node:path";

const pages = [
  "index", "login", "signup",
  "prefect-dashboard", "prefect-profile", "prefect-duty-selection", "prefect-attendance-history",
  "coordinator-dashboard", "coordinator-mark-attendance", "coordinator-sessions",
  "teacher-dashboard", "teacher-attendance-review", "teacher-prefects", "teacher-reports",
  "admin-dashboard", "admin-users", "admin-duty-options", "admin-roster",
  "hall-of-fame",
];

export default defineConfig({
  server: {
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((name) => [name, resolve(import.meta.dirname, `${name}.html`)])),
    },
  },
});
