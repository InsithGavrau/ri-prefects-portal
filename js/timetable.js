import { requireClient } from "./supabase.js";
import { $, escapeHtml, toast, setBusy, badge, renderRoleBadge, PORTAL_CREDIT_TEXT, TECH_ISSUES_MAILTO, LINKEDIN_URL } from "./ui.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const STAFF_ROLES = new Set(["teacher", "admin"]);
const CHECKPOINT_GROUP_SIZE = 3;
const CORRIDOR_GROUP_SIZE = 3;
const CANTEEN_GROUP_SIZE = 3;

const FLOOR_SECTIONS = [
  { floor: "Ground Floor (Old Building)", classes: ["1NA", "1NB", "2N", "3NA", "3NB"] },
  { floor: "1st Floor (Old Building)", classes: ["3CA", "3CB", "3CC", "4NA", "4NB", "5NA", "5NB", "Staircase"] },
  { floor: "1st Floor (New Building)", classes: ["10NA", "10NB", "11NA", "11NB", "Staircase"] },
  { floor: "1st Floor (New New Building)", classes: ["1CA", "1CB", "1CC", "2CA", "2CB", "2CC"] },
  { floor: "2nd Floor (Old Building)", classes: ["4CA", "4CB", "5CA", "5CB", "6NA", "6NB", "7NA", "7NB", "Staircase"] },
  { floor: "2nd Floor (New Building)", classes: ["8NA", "8NB", "9NA", "9NB", "Staircase"] },
  { floor: "2nd Floor (New New Building)", classes: ["11 Edexcel", "12 Edexcel"] },
  { floor: "3rd Floor (New Building)", classes: ["6CA", "6CB", "8NC", "7CB", "Staircase"] },
  { floor: "3rd Floor (New New Building)", classes: ["10CA", "9CA", "12N Art/Commerce", "12N Sci./Math", "13N Art/Commerce", "7CA", "13N Sci./Math", "Staircase"] },
  { floor: "4th Floor (New Building)", classes: ["8CA", "8CB", "10CB", "9CB", "Staircase"] },
];

let context = {};
let state = {
  profiles: [],
  prefectPool: [],
  coordinatorPool: [],
  profileMap: new Map(),
  version: null,
  cells: [],
  draftCells: null,
  isDraft: false,
};

export async function timetableFull(options) {
  context = options;
  await refreshTimetable();
}

async function refreshTimetable() {
  try {
    const loaded = await loadTimetableData();
    state = { ...state, ...loaded, draftCells: null, isDraft: false };
    renderTimetablePage();
  } catch (err) {
    context.layout(`
      <section class="card">
        <h2>Timetable could not load</h2>
        <p>${escapeHtml(context.errorMessage ? context.errorMessage(err) : err.message)}</p>
        <div class="info-card">Run <strong>sql/add-timetable-feature.sql</strong> in Supabase, then reload this page.</div>
      </section>
    `);
  }
}

async function loadTimetableData() {
  const [{ data: profiles, error: profileError }, { data: versions, error: versionError }] = await Promise.all([
    requireClient()
      .from("profiles")
      .select("id,first_name,current_class,role,account_status")
      .in("role", ["prefect", "coordinator"])
      .eq("account_status", "active")
      .order("first_name", { ascending: true }),
    requireClient()
      .from("timetable_versions")
      .select("*")
      .eq("status", "active")
      .order("generated_at", { ascending: false })
      .limit(1),
  ]);
  if (profileError) throw profileError;
  if (versionError) throw versionError;

  const activeProfiles = profiles || [];
  const version = versions?.[0] || null;
  let cells = [];
  if (version) {
    const { data, error } = await requireClient()
      .from("timetable_cells")
      .select("*")
      .eq("version_id", version.id)
      .order("sort_order", { ascending: true })
      .order("display_order", { ascending: true });
    if (error) throw error;
    cells = data || [];
  }

  return {
    profiles: activeProfiles,
    prefectPool: activeProfiles.filter(person => person.role === "prefect" || person.role === "coordinator"),
    coordinatorPool: activeProfiles.filter(person => person.role === "coordinator"),
    profileMap: new Map(activeProfiles.map(person => [person.id, person])),
    version,
    cells,
  };
}

function renderTimetablePage() {
  const canEdit = STAFF_ROLES.has(context.profile.role);
  const activeCells = state.isDraft ? state.draftCells || [] : state.cells || [];
  const printDate = formatPrintDate(new Date());
  const printTitle = `Updated Duty roster and created on ${printDate}`;
  const versionLabel = state.isDraft
    ? "Unsaved generated preview"
    : state.version?.version_label || "No active timetable yet";
  const versionMeta = state.version && !state.isDraft
    ? `Saved ${new Date(state.version.generated_at || state.version.created_at).toLocaleString("en-LK")}`
    : "Generated from the June 2026 duty roster structure";

  context.layout(`
    <section id="timetable-root">
      <section class="card timetable-hero">
        <div>
          <p class="eyebrow">Global timetable</p>
          <h2>${escapeHtml(versionLabel)}</h2>
          <p>${escapeHtml(versionMeta)}</p>
          <div class="badge-row">${renderRoleBadge(context.profile.role)} ${badge(canEdit ? "editable" : "read only")}</div>
        </div>
        <div class="timetable-summary">
          <span><strong>${state.prefectPool.length}</strong> active prefect/coordinator pool</span>
          <span><strong>${state.coordinatorPool.length}</strong> active coordinators</span>
          <span><strong>${activeCells.length}</strong> timetable cells</span>
        </div>
      </section>

      ${canEdit ? controlsMarkup() : readOnlyControlsMarkup()}

      <section class="print-area" aria-label="Printable timetable">
        <div class="print-only print-header">
          <h1>${escapeHtml(printTitle)}</h1>
          <p>Date created: ${escapeHtml(printDate)}</p>
        </div>
        ${activeCells.length ? timetableMarkup(activeCells, canEdit) : emptyTimetableMarkup(canEdit)}
        <footer class="print-only print-footer">${PORTAL_CREDIT_TEXT} <span>|</span> <a href="${TECH_ISSUES_MAILTO}">Technical Issues</a> <span>|</span> <a href="${LINKEDIN_URL}">LinkedIn</a></footer>
      </section>
    </section>
  `);
  bindTimetableActions();
}

function controlsMarkup() {
  return `
    <section class="card section-gap timetable-controls no-print">
      <div>
        <h2>Teacher/Admin controls</h2>
        <p>Generate creates a preview only. Click Save to publish it as the active timetable.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-generate-timetable>${state.version ? "Regenerate preview" : "Generate preview"}</button>
        <button type="button" class="btn secondary" data-save-timetable ${state.isDraft ? "" : "disabled"}>Save active timetable</button>
        <button type="button" class="btn ghost" data-refresh-timetable>Reset / reload</button>
        <button type="button" class="btn ghost" data-print-timetable>Print</button>
      </div>
    </section>
  `;
}

function readOnlyControlsMarkup() {
  return `
    <section class="card section-gap timetable-controls no-print">
      <div>
        <h2>Read-only timetable</h2>
        <p>This timetable is read-only for prefects and coordinators. Teacher/admin edits appear here after saving.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" data-print-timetable>Print</button>
      </div>
    </section>
  `;
}

function emptyTimetableMarkup(canEdit) {
  return `
    <section class="card empty section-gap">
      <h2>No active timetable has been saved yet.</h2>
      <p>${canEdit ? "Generate a preview from active prefects and coordinators, then save it." : "Ask a teacher or admin to generate and save the timetable."}</p>
    </section>
  `;
}

function timetableMarkup(cells, canEdit) {
  return `
    <section class="timetable-stack section-gap">
      ${floorDutyMarkup(cells, canEdit)}
      ${weeklyTableMarkup(cells, canEdit, "checkpoint", "Checkpoint Duty (6.50am-7.50am)", ["Coordinator", "Duty Group 1", "Duty Group 2"])}
      ${weeklyTableMarkup(cells, canEdit, "corridor", "Floor Duty (6.50am-7.30am) - 1st Floor Corridor", ["Coordinator", "Old/New/New New Building 1st Floor Corridor"])}
      ${weeklyTableMarkup(cells, canEdit, "canteen", "Canteen Duty", ["Coordinator", "Prefects"])}
    </section>
  `;
}

function floorDutyMarkup(cells, canEdit) {
  const rows = cells.filter(cell => cell.table_type === "floor-detail");
  return `
    <section class="card timetable-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Permanent floor duty</p>
          <h2>Detailed Floor Duty</h2>
        </div>
      </div>
      <div class="table-wrap timetable-wrap">
        <table class="timetable-table">
          <thead><tr><th>Floor</th><th>Class</th><th>Name</th><th>Coordinator</th></tr></thead>
          <tbody>${floorDutyRows(rows, canEdit)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function floorDutyRows(rows, canEdit) {
  if (!rows.length) return `<tr><td colspan="4" class="empty">No floor duty rows.</td></tr>`;
  return FLOOR_SECTIONS.map(section => {
    const sectionRows = rows.filter(cell => cell.floor_label === section.floor);
    return sectionRows.map((cell, index) => `
      <tr>
        ${index === 0 ? `<td rowspan="${sectionRows.length || 1}"><strong>${escapeHtml(section.floor)}</strong></td>` : ""}
        <td>${escapeHtml(cell.class_label || cell.row_label || "")}</td>
        <td>${personPill(cell, "assigned", canEdit)}</td>
        ${index === 0 ? `<td rowspan="${sectionRows.length || 1}">${personPill(cell, "coordinator", canEdit)}</td>` : ""}
      </tr>
    `).join("");
  }).join("");
}

function weeklyTableMarkup(cells, canEdit, tableType, title, rows) {
  const tableCells = cells.filter(cell => cell.table_type === tableType);
  return `
    <section class="card timetable-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">${escapeHtml(tableType)} duty</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </div>
      <div class="table-wrap timetable-wrap">
        <table class="timetable-table weekly">
          <thead><tr><th></th>${DAYS.map(day => `<th>${escapeHtml(day)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td><strong>${escapeHtml(row)}</strong></td>
                ${DAYS.map(day => `<td>${weeklyCellMarkup(tableCells, row, day, canEdit)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function weeklyCellMarkup(cells, rowLabel, day, canEdit) {
  const matches = cells.filter(cell => cell.row_label === rowLabel && cell.column_label === day);
  if (!matches.length) return '<span class="muted">Unassigned</span>';
  const field = rowLabel === "Coordinator" ? "coordinator" : "assigned";
  return `<div class="timetable-person-list">${matches.map(cell => personPill(cell, field, canEdit)).join("")}</div>`;
}

function personPill(cell, field, canEdit) {
  const person = field === "coordinator" ? coordinatorForCell(cell) : assignedForCell(cell);
  const label = personLabel(person, field === "coordinator" ? cell.coordinator_display_name : cell.display_name, field === "coordinator" ? cell.coordinator_display_class : cell.display_class);
  const editable = canEdit && !state.isDraft;
  const draftEditable = canEdit && state.isDraft;
  if (!editable && !draftEditable) return `<span class="person-pill ${person ? "" : "empty"}">${escapeHtml(label)}</span>`;
  return `<button type="button" class="person-pill editable ${person ? "" : "empty"}" data-edit-cell="${escapeHtml(cell.id || cell.local_id)}" data-edit-field="${field}">${escapeHtml(label)}</button>`;
}

function coordinatorForCell(cell) {
  return cell.coordinator_profile_id ? state.profileMap.get(cell.coordinator_profile_id) || null : null;
}

function assignedForCell(cell) {
  return cell.assigned_profile_id ? state.profileMap.get(cell.assigned_profile_id) || null : null;
}

function personLabel(person, fallbackName, fallbackClass) {
  if (person) return `${person.first_name}${person.current_class ? ` (${person.current_class})` : ""}`;
  if (fallbackName) return `${fallbackName}${fallbackClass ? ` (${fallbackClass})` : ""}`;
  return "Unassigned";
}

function bindTimetableActions() {
  $("#timetable-root")?.addEventListener("click", async event => {
    const generate = event.target.closest("[data-generate-timetable]");
    const save = event.target.closest("[data-save-timetable]");
    const refresh = event.target.closest("[data-refresh-timetable]");
    const print = event.target.closest("[data-print-timetable]");
    const edit = event.target.closest("[data-edit-cell]");

    if (generate) {
      state.draftCells = generateTimetableCells();
      state.isDraft = true;
      toast("Generated an unsaved timetable preview.");
      renderTimetablePage();
      return;
    }
    if (save) {
      await saveDraftTimetable(save);
      return;
    }
    if (refresh) {
      await refreshTimetable();
      return;
    }
    if (print) {
      printTimetable();
      return;
    }
    if (edit) {
      openEditModal(edit.dataset.editCell, edit.dataset.editField);
    }
  });
}

function printTimetable() {
  const printDate = formatPrintDate(new Date());
  const title = `Updated Duty roster and created on ${printDate}`;
  const previousTitle = document.title;
  const cleanup = () => {
    document.body.classList.remove("printing-timetable");
    document.title = previousTitle;
    window.removeEventListener("afterprint", cleanup);
  };
  document.body.classList.add("printing-timetable");
  document.title = title;
  window.addEventListener("afterprint", cleanup);
  requestAnimationFrame(() => {
    window.print();
    setTimeout(cleanup, 800);
  });
}

function formatPrintDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function generateTimetableCells() {
  const cursors = {};
  const cells = [];
  let sort = 0;
  const usedFloor = new Set();
  const usedCheckpoint = new Set();
  const usedCanteen = new Set();

  FLOOR_SECTIONS.forEach(section => {
    const coordinator = nextPerson(state.coordinatorPool, cursors, "floor-coordinator");
    section.classes.forEach((className, index) => {
      const person = nextPerson(state.prefectPool, cursors, "floor-prefect", { used: usedFloor });
      if (person) usedFloor.add(person.id);
      cells.push(makeCell({
        localId: `draft-floor-${sort}`,
        tableType: "floor-detail",
        rowLabel: className,
        floorLabel: section.floor,
        classLabel: className,
        cellGroup: `floor:${section.floor}`,
        assigned: person,
        coordinator: index === 0 ? coordinator : null,
        sortOrder: ++sort,
      }));
    });
  });

  DAYS.forEach(day => {
    const coordinator = nextPerson(state.coordinatorPool, cursors, "checkpoint-coordinator");
    cells.push(makeCell({
      localId: `draft-checkpoint-coordinator-${day}`,
      tableType: "checkpoint",
      rowLabel: "Coordinator",
      columnLabel: day,
      cellGroup: `checkpoint:${day}:coordinator`,
      coordinator,
      sortOrder: ++sort,
    }));
    ["Duty Group 1", "Duty Group 2"].forEach(rowLabel => {
      const usedDay = new Set();
      for (let slot = 1; slot <= CHECKPOINT_GROUP_SIZE; slot += 1) {
        const person = nextPerson(state.prefectPool, cursors, "checkpoint-prefect", { used: usedDay });
        if (person) {
          usedDay.add(person.id);
          usedCheckpoint.add(person.id);
        }
        cells.push(makeCell({
          localId: `draft-checkpoint-${day}-${rowLabel}-${slot}`,
          tableType: "checkpoint",
          rowLabel,
          columnLabel: day,
          cellGroup: `checkpoint:${day}:${rowLabel}`,
          assigned: person,
          displayOrder: slot,
          sortOrder: ++sort,
        }));
      }
    });
  });

  DAYS.forEach(day => {
    const coordinator = nextPerson(state.coordinatorPool, cursors, "corridor-coordinator");
    cells.push(makeCell({
      localId: `draft-corridor-coordinator-${day}`,
      tableType: "corridor",
      rowLabel: "Coordinator",
      columnLabel: day,
      cellGroup: `corridor:${day}:coordinator`,
      coordinator,
      sortOrder: ++sort,
    }));
    const usedDay = new Set();
    for (let slot = 1; slot <= CORRIDOR_GROUP_SIZE; slot += 1) {
      const person = nextPerson(state.prefectPool, cursors, "corridor-prefect", { avoid: usedCheckpoint, used: usedDay });
      if (person) usedDay.add(person.id);
      cells.push(makeCell({
        localId: `draft-corridor-${day}-${slot}`,
        tableType: "corridor",
        rowLabel: "Old/New/New New Building 1st Floor Corridor",
        columnLabel: day,
        cellGroup: `corridor:${day}:prefects`,
        assigned: person,
        displayOrder: slot,
        sortOrder: ++sort,
      }));
    }
  });

  DAYS.forEach(day => {
    const coordinator = nextPerson(state.coordinatorPool, cursors, "canteen-coordinator");
    cells.push(makeCell({
      localId: `draft-canteen-coordinator-${day}`,
      tableType: "canteen",
      rowLabel: "Coordinator",
      columnLabel: day,
      cellGroup: `canteen:${day}:coordinator`,
      coordinator,
      sortOrder: ++sort,
    }));
    const usedDay = new Set();
    for (let slot = 1; slot <= CANTEEN_GROUP_SIZE; slot += 1) {
      const person = nextPerson(state.prefectPool, cursors, "canteen-prefect", { used: usedCanteen.size < state.prefectPool.length ? usedCanteen : usedDay });
      if (person) {
        usedCanteen.add(person.id);
        usedDay.add(person.id);
      }
      cells.push(makeCell({
        localId: `draft-canteen-${day}-${slot}`,
        tableType: "canteen",
        rowLabel: "Prefects",
        columnLabel: day,
        cellGroup: `canteen:${day}:prefects`,
        assigned: person,
        displayOrder: slot,
        sortOrder: ++sort,
      }));
    }
  });

  return cells;
}

function makeCell({ localId, tableType, rowLabel, columnLabel = null, floorLabel = null, classLabel = null, cellGroup, assigned = null, coordinator = null, displayOrder = 1, sortOrder }) {
  return {
    local_id: localId,
    table_type: tableType,
    row_label: rowLabel,
    column_label: columnLabel,
    floor_label: floorLabel,
    class_label: classLabel,
    cell_group: cellGroup,
    cell_key: localId,
    assigned_profile_id: assigned?.id || null,
    coordinator_profile_id: coordinator?.id || null,
    display_name: assigned?.first_name || null,
    display_class: assigned?.current_class || null,
    coordinator_display_name: coordinator?.first_name || null,
    coordinator_display_class: coordinator?.current_class || null,
    display_order: displayOrder,
    sort_order: sortOrder,
  };
}

function nextPerson(pool, cursors, key, options = {}) {
  if (!pool.length) return null;
  const avoid = options.avoid || new Set();
  const used = options.used || new Set();
  let candidates = pool.filter(person => !avoid.has(person.id) && !used.has(person.id));
  if (!candidates.length) candidates = pool.filter(person => !avoid.has(person.id));
  if (!candidates.length) candidates = pool;
  const index = cursors[key] || 0;
  const person = candidates[index % candidates.length] || null;
  cursors[key] = index + 1;
  return person;
}

async function saveDraftTimetable(button) {
  if (!state.isDraft || !state.draftCells?.length) {
    toast("Generate a preview first.", "error");
    return;
  }
  setBusy(button, true, "Saving...");
  try {
    const { data: version, error: versionError } = await requireClient()
      .from("timetable_versions")
      .insert({
        version_label: `Generated ${new Date().toLocaleString("en-LK")}`,
        source_month: "2026-06",
        source_document: "Prefects Duty Roster - 2026 June.pdf",
        generated_by: context.profile.id,
        status: "draft",
        notes: "Generated from active prefect/coordinator profiles using the June 2026 roster table structure.",
      })
      .select("*")
      .single();
    if (versionError) throw versionError;

    const payload = state.draftCells.map(cell => persistedCellPayload(cell, version.id));
    const { error: cellError } = await requireClient().from("timetable_cells").insert(payload);
    if (cellError) throw cellError;
    const { error: archiveError } = await requireClient().from("timetable_versions").update({ status: "archived" }).eq("status", "active");
    if (archiveError) throw archiveError;
    const { error: activateError } = await requireClient().from("timetable_versions").update({ status: "active" }).eq("id", version.id);
    if (activateError) throw activateError;
    toast("Timetable saved and published.");
    await refreshTimetable();
  } catch (err) {
    toast(context.errorMessage ? context.errorMessage(err) : err.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function persistedCellPayload(cell, versionId) {
  const {
    id,
    local_id,
    created_at,
    updated_at,
    ...payload
  } = cell;
  return {
    ...payload,
    version_id: versionId,
  };
}

function openEditModal(cellToken, field) {
  const cell = findCell(cellToken);
  if (!cell) return;
  const pool = field === "coordinator" ? state.coordinatorPool : state.prefectPool;
  const currentId = field === "coordinator" ? cell.coordinator_profile_id : cell.assigned_profile_id;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="card modal">
      <p class="eyebrow">Edit timetable cell</p>
      <h2>${field === "coordinator" ? "Coordinator" : "Prefect"} assignment</h2>
      <div class="field">
        <label>Assign active ${field === "coordinator" ? "coordinator" : "prefect/coordinator"}</label>
        <select data-timetable-person>
          <option value="">Unassigned</option>
          ${pool.map(person => `<option value="${person.id}" ${person.id === currentId ? "selected" : ""}>${escapeHtml(person.first_name)}${person.current_class ? ` (${escapeHtml(person.current_class)})` : ""} - ${escapeHtml(person.role)}</option>`).join("")}
        </select>
        <div class="badge-row">${field === "coordinator" ? renderRoleBadge("coordinator") : `${renderRoleBadge("prefect")} ${renderRoleBadge("coordinator")}`}</div>
      </div>
      <div class="form-message" data-edit-message></div>
      <div class="actions">
        <button type="button" class="btn" data-save-cell>Save cell</button>
        <button type="button" class="btn ghost" data-cancel-cell>Cancel</button>
      </div>
    </section>
  `;
  document.body.append(modal);
  $("[data-cancel-cell]", modal).addEventListener("click", () => modal.remove());
  $("[data-save-cell]", modal).addEventListener("click", async event => {
    const button = event.currentTarget;
    const selected = $("[data-timetable-person]", modal).value;
    const person = selected ? state.profileMap.get(selected) : null;
    setBusy(button, true, "Saving...");
    try {
      if (state.isDraft) {
        applyPersonToCell(cell, field, person);
        modal.remove();
        renderTimetablePage();
        toast("Preview cell updated.");
        return;
      }
      await saveCellEdit(cell, field, person);
      modal.remove();
      toast("Timetable cell updated.");
      await refreshTimetable();
    } catch (err) {
      const message = $("[data-edit-message]", modal);
      message.textContent = context.errorMessage ? context.errorMessage(err) : err.message;
      message.className = "form-message error";
      setBusy(button, false);
    }
  });
}

function findCell(token) {
  const cells = state.isDraft ? state.draftCells || [] : state.cells || [];
  return cells.find(cell => cell.id === token || cell.local_id === token) || null;
}

function applyPersonToCell(cell, field, person) {
  if (field === "coordinator") {
    cell.coordinator_profile_id = person?.id || null;
    cell.coordinator_display_name = person?.first_name || null;
    cell.coordinator_display_class = person?.current_class || null;
  } else {
    cell.assigned_profile_id = person?.id || null;
    cell.display_name = person?.first_name || null;
    cell.display_class = person?.current_class || null;
  }
}

async function saveCellEdit(cell, field, person) {
  const payload = field === "coordinator"
    ? {
        coordinator_profile_id: person?.id || null,
        coordinator_display_name: person?.first_name || null,
        coordinator_display_class: person?.current_class || null,
      }
    : {
        assigned_profile_id: person?.id || null,
        display_name: person?.first_name || null,
        display_class: person?.current_class || null,
      };
  const { error } = await requireClient().from("timetable_cells").update(payload).eq("id", cell.id);
  if (error) throw error;
}
