export const pageTitles = {
  "prefect-dashboard": ["Prefect Dashboard", "Your profile and duty overview"],
  "prefect-profile": ["My Profile", "Keep your school contact details current"],
  "prefect-duty-selection": ["Duty Selection", "Choose and review your assigned duties"],
  "prefect-attendance-history": ["Attendance History", "Your submitted duty attendance records"],
  "coordinator-dashboard": ["Coordinator Dashboard", "Today's duty attendance at a glance"],
  "coordinator-mark-attendance": ["Mark Attendance", "Record one duty session accurately"],
  "coordinator-sessions": ["My Sessions", "Track every attendance session you submitted"],
  "teacher-dashboard": ["Teacher Dashboard", "Live attendance and prefect oversight"],
  "teacher-attendance-review": ["Attendance Corrections", "Correct official attendance records when needed"],
  "teacher-prefects": ["Prefect Management", "Approve accounts and duty assignments"],
  "teacher-reports": ["Attendance Reports", "Filter records and export CSV"],
  "admin-dashboard": ["Administration", "System access and duty configuration"],
  "admin-users": ["User Management", "Roles and account status"],
  "admin-duty-options": ["Duty Options", "Manage duty types and locations"],
  "admin-roster": ["Duty Roster", "Review every selected duty assignment"],
  "hall-of-fame": ["Hall of Fame", "Recognising RI prefect leadership and service"],
};

export const roleHome = {
  prefect: "prefect-dashboard.html",
  coordinator: "coordinator-dashboard.html",
  teacher: "teacher-dashboard.html",
  admin: "admin-dashboard.html",
};

export const roleNav = {
  prefect: [
    ["prefect-dashboard.html", "Overview"],
    ["prefect-profile.html", "My profile"],
    ["prefect-duty-selection.html", "Duty selection"],
    ["prefect-attendance-history.html", "Attendance"],
    ["hall-of-fame.html", "Hall of Fame"],
  ],
  coordinator: [
    ["coordinator-dashboard.html", "Overview"],
    ["prefect-profile.html", "My profile"],
    ["coordinator-mark-attendance.html", "Mark attendance"],
    ["coordinator-sessions.html", "My sessions"],
    ["hall-of-fame.html", "Hall of Fame"],
  ],
  teacher: [
    ["teacher-dashboard.html", "Overview"],
    ["teacher-attendance-review.html", "Correct attendance"],
    ["teacher-prefects.html", "Prefects"],
    ["teacher-reports.html", "Reports"],
    ["hall-of-fame.html", "Hall of Fame"],
  ],
  admin: [
    ["admin-dashboard.html", "Overview"],
    ["admin-users.html", "Users"],
    ["admin-duty-options.html", "Duty options"],
    ["admin-roster.html", "Roster"],
    ["teacher-dashboard.html", "Teacher view"],
    ["hall-of-fame.html", "Hall of Fame"],
  ],
};
