import test from "node:test";
import assert from "node:assert/strict";
import { allowedAssistantRoutes, canRunAssistantAction, getAssistantReply, getPageGuide } from "../js/assistantKnowledge.js";
import { pageTitles } from "../js/router.js";

const answer = (question, role = "prefect", page = `${role}-dashboard`) => getAssistantReply(question, { role, page });
const targets = reply => reply.actions.map(([, target]) => target);

test("anonymous help never links to authenticated portal tools", () => {
  for (const question of ["mark attendance", "admin users", "duty roster", "announcements", "CSV reports", "wall of honor"]) {
    const reply = answer(question, null, "login");
    assert.deepEqual(targets(reply), ["login.html", "signup.html"]);
    assert.match(reply.text, /sign in/i);
  }
});

test("password help takes precedence over navigation keywords", () => {
  const reply = answer("I forgot my password for my profile");
  assert.deepEqual(targets(reply), ["support"]);
  assert.match(reply.text, /cannot be viewed/i);
});

test("signup guidance links to the specific account field", () => {
  assert.ok(targets(answer("help with my class", null, "signup")).includes("focus:[name='current_class']"));
  assert.ok(targets(answer("how to set a password", null, "signup")).includes("focus:[name='confirm_password']"));
  assert.ok(targets(answer("phone number", null, "signup")).includes("focus:[name='phone']"));
});

test("coordinators distinguish marking attendance from their own history", () => {
  assert.deepEqual(targets(answer("mark attendance", "coordinator")), ["coordinator-mark-attendance.html"]);
  assert.deepEqual(targets(answer("my attendance history", "coordinator")), ["prefect-attendance-history.html"]);
  assert.deepEqual(targets(answer("my submitted sessions", "coordinator")), ["coordinator-sessions.html"]);
});

test("coordinator attendance guidance preserves the manual weekday selection", () => {
  const reply = answer("how do I submit attendance", "coordinator", "coordinator-mark-attendance");
  assert.match(reply.text, /select the weekday roster yourself/);
  assert.match(reply.text, /Confirm and submit/);
  assert.ok(targets(reply).includes("focus:[name='date']"));
});

test("prefects are not offered staff attendance corrections or reports", () => {
  assert.deepEqual(targets(answer("correct my wrong attendance")), ["prefect-attendance-history.html"]);
  assert.deepEqual(targets(answer("export CSV report")), ["prefect-attendance-history.html"]);
  assert.equal(canRunAssistantAction("teacher-attendance-review.html", { role: "prefect" }), false);
  assert.equal(canRunAssistantAction("admin-users.html", { role: "coordinator" }), false);
});

test("teachers and administrators can find reports and correction tools", () => {
  for (const role of ["teacher", "admin"]) {
    assert.deepEqual(targets(answer("correct attendance", role)), ["teacher-attendance-review.html"]);
    assert.deepEqual(targets(answer("CSV reports", role)), ["teacher-reports.html"]);
  }
});

test("announcement guidance respects staff-only management", () => {
  assert.match(answer("delete announcements", "coordinator").text, /reserved for teachers and administrators/);
  assert.match(answer("delete announcements", "teacher").text, /edit or delete/);
});

test("database errors are not mistaken for a successful submission", () => {
  const reply = answer("attendance failed with RLS error", "coordinator");
  assert.match(reply.text, /cannot repair/);
  assert.ok(targets(reply).includes("coordinator-sessions.html"));
  assert.ok(targets(reply).includes("support"));
  assert.doesNotMatch(reply.text, /saved successfully|has been submitted/i);
});

test("pending approval help never claims to activate accounts", () => {
  assert.match(answer("activate my pending account").text, /cannot approve/);
  assert.deepEqual(targets(answer("approve pending accounts", "teacher")), ["teacher-prefects.html"]);
});

test("staff account setup does not redirect to a prefect-only profile", () => {
  assert.deepEqual(targets(answer("change my phone and class", "teacher")), ["support"]);
  assert.deepEqual(targets(answer("change my email", "admin")), ["admin-users.html"]);
});

test("all role/page guides only offer authorized destinations", () => {
  for (const role of ["prefect", "coordinator", "teacher", "admin", undefined]) {
    for (const page of [...Object.keys(pageTitles), "login", "signup"]) {
      for (const [, target] of getPageGuide({ page, role }).actions) {
        assert.equal(canRunAssistantAction(target, { page, role }), true, `${role}: ${page}: ${target}`);
      }
    }
  }
});

test("navigation cannot escape to unlisted or external destinations", () => {
  for (const target of ["javascript:alert(1)", "https://example.com", "//example.com", "missing.html"]) {
    assert.equal(canRunAssistantAction(target, { role: "admin" }), false);
  }
  assert.equal(canRunAssistantAction("anchor:#hof-archive", { page: "login" }), false);
  assert.equal(canRunAssistantAction("anchor:#hof-archive", { page: "hall-of-fame" }), true);
  assert.deepEqual(allowedAssistantRoutes(undefined), ["login.html", "signup.html"]);
});

test("unknown questions ask for clarification instead of inventing an answer", () => {
  assert.match(answer("bananas and spaceships").text, /Which one do you need/);
  assert.ok(answer("").actions.length);
});

test("common portal spelling mistakes still resolve to the right topic", () => {
  assert.deepEqual(targets(answer("mark attendence", "coordinator")), ["coordinator-mark-attendance.html"]);
  assert.deepEqual(targets(answer("annoucements")), ["announcements.html"]);
  assert.ok(targets(answer("singup", null, "login")).includes("signup.html"));
});
