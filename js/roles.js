export const NORMAL_DUTY_ROLES = Object.freeze(["prefect", "coordinator"]);
export const ATTENDANCE_MARKING_ROLES = Object.freeze(["coordinator", "teacher", "admin"]);

export function canPerformNormalPrefectDuties(role) {
  return NORMAL_DUTY_ROLES.includes(role);
}

export function canMarkAttendance(role) {
  return ATTENDANCE_MARKING_ROLES.includes(role);
}
