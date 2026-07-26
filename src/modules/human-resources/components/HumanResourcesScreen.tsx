import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Banknote,
  BriefcaseBusiness,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  HumanResourcesEmployee,
  HumanResourcesEmployeeDraft,
  HumanResourcesSkill,
  HumanResourcesSkillLevel,
  HumanResourcesWorkstation,
  HumanResourcesWorkstationDraft
} from "../types";
import {
  calculateEmployeePayrollBreakdown,
  calculateHumanResourcesStats,
  calculateHumanResourcesSkillMatrix,
  calculateHumanResourcesWorkstationStats,
  calculateHumanResourcesWorkstationSummary,
  createEmptyHumanResourcesEmployeeDraft,
  createEmptyHumanResourcesWorkstationDraft,
  createHumanResourcesEmployeeSkill,
  getHumanResourcesEmployeeStationMap,
  humanResourcesAreaLabels,
  humanResourcesAreaOptions,
  humanResourcesEmployeeMatches,
  humanResourcesEmployeeStatusLabels,
  humanResourcesEmployeeStatusOptions,
  humanResourcesShiftLabels,
  humanResourcesShiftOptions,
  humanResourcesSkillLabels,
  humanResourcesSkillLevelLabels,
  humanResourcesSkillLevelOptions,
  humanResourcesSkillOptions,
  humanResourcesWorkstationStatusLabels,
  humanResourcesWorkstationStatusOptions,
  loadStoredHumanResourcesEmployees,
  loadStoredHumanResourcesWorkstations,
  normalizeHumanResourcesEmployee,
  normalizeHumanResourcesWorkstation,
  saveStoredHumanResourcesEmployees,
  saveStoredHumanResourcesWorkstations
} from "../utils";

type HumanResourcesScreenProps = {
  onBack: () => void;
};

function formatMoney(value: number) {
  return `$${new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} MXN`;
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits
  }).format(value);
}

function formatDate(value: string) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium"
  }).format(date);
}

function formatSkillDetail(expiresAt: string, notes: string) {
  const details = [expiresAt ? `Vence ${formatDate(expiresAt)}` : "", notes.trim()].filter(Boolean);

  return details.join(" / ");
}

export function HumanResourcesScreen({ onBack }: HumanResourcesScreenProps) {
  const [employees, setEmployees] = useState<HumanResourcesEmployee[]>(loadStoredHumanResourcesEmployees);
  const [workstations, setWorkstations] = useState<HumanResourcesWorkstation[]>(loadStoredHumanResourcesWorkstations);
  const [draft, setDraft] = useState<HumanResourcesEmployeeDraft>(createEmptyHumanResourcesEmployeeDraft);
  const [stationDraft, setStationDraft] = useState<HumanResourcesWorkstationDraft>(
    createEmptyHumanResourcesWorkstationDraft
  );
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingWorkstationId, setEditingWorkstationId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<HumanResourcesSkill>("ensamble");
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<HumanResourcesSkillLevel>("basico");
  const [selectedSkillExpiresAt, setSelectedSkillExpiresAt] = useState("");
  const [selectedSkillNotes, setSelectedSkillNotes] = useState("");
  const [selectedStationSkill, setSelectedStationSkill] = useState<HumanResourcesSkill>("ensamble");
  const [selectedStationEmployeeId, setSelectedStationEmployeeId] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [stationMessage, setStationMessage] = useState("");
  const stats = useMemo(() => calculateHumanResourcesStats(employees), [employees]);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "activo"), [employees]);
  const workstationStats = useMemo(
    () => calculateHumanResourcesWorkstationStats(workstations, employees),
    [workstations, employees]
  );
  const workstationSummaries = useMemo(
    () => workstations.map((workstation) => calculateHumanResourcesWorkstationSummary(workstation, employees)),
    [workstations, employees]
  );
  const stationByEmployeeId = useMemo(() => getHumanResourcesEmployeeStationMap(workstations), [workstations]);
  const assignableEmployees = useMemo(
    () => activeEmployees.filter((employee) => !stationDraft.employeeIds.includes(employee.id)),
    [activeEmployees, stationDraft.employeeIds]
  );
  const stationDraftEmployees = useMemo(
    () =>
      stationDraft.employeeIds
        .map((employeeId) => employees.find((employee) => employee.id === employeeId))
        .filter((employee): employee is HumanResourcesEmployee => Boolean(employee)),
    [employees, stationDraft.employeeIds]
  );
  const skillMatrix = useMemo(() => calculateHumanResourcesSkillMatrix(employees), [employees]);
  const filteredEmployees = useMemo(
    () => employees.filter((employee) => humanResourcesEmployeeMatches(employee, query)),
    [employees, query]
  );

  useEffect(() => {
    saveStoredHumanResourcesEmployees(employees);
  }, [employees]);

  useEffect(() => {
    saveStoredHumanResourcesWorkstations(workstations);
  }, [workstations]);

  function updateDraft<Key extends keyof HumanResourcesEmployeeDraft>(key: Key, value: HumanResourcesEmployeeDraft[Key]) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value
    }));
  }

  function updateStationDraft<Key extends keyof HumanResourcesWorkstationDraft>(
    key: Key,
    value: HumanResourcesWorkstationDraft[Key]
  ) {
    setStationDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value
    }));
  }

  function resetForm() {
    setDraft(createEmptyHumanResourcesEmployeeDraft());
    setEditingEmployeeId(null);
    setFormMessage("");
    setSelectedSkill("ensamble");
    setSelectedSkillLevel("basico");
    setSelectedSkillExpiresAt("");
    setSelectedSkillNotes("");
  }

  function resetWorkstationForm() {
    setStationDraft(createEmptyHumanResourcesWorkstationDraft());
    setEditingWorkstationId(null);
    setSelectedStationSkill("ensamble");
    setSelectedStationEmployeeId("");
    setStationMessage("");
  }

  function addSkill() {
    const nextSkill = createHumanResourcesEmployeeSkill(
      selectedSkill,
      selectedSkillLevel,
      selectedSkillExpiresAt,
      selectedSkillNotes
    );

    setDraft((currentDraft) => ({
      ...currentDraft,
      skills: [...currentDraft.skills.filter((skill) => skill.skill !== selectedSkill), nextSkill]
    }));
    setSelectedSkillExpiresAt("");
    setSelectedSkillNotes("");
  }

  function removeSkill(skillId: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      skills: currentDraft.skills.filter((skill) => skill.id !== skillId)
    }));
  }

  function addStationSkill() {
    setStationDraft((currentDraft) => ({
      ...currentDraft,
      requiredSkills: Array.from(new Set([...currentDraft.requiredSkills, selectedStationSkill]))
    }));
  }

  function removeStationSkill(skill: HumanResourcesSkill) {
    setStationDraft((currentDraft) => ({
      ...currentDraft,
      requiredSkills: currentDraft.requiredSkills.filter((requiredSkill) => requiredSkill !== skill)
    }));
  }

  function addEmployeeToStationDraft() {
    const employeeId = selectedStationEmployeeId || assignableEmployees[0]?.id || "";

    if (!employeeId) {
      setStationMessage("No hay empleados activos disponibles para asignar.");
      return;
    }

    const currentStation = stationByEmployeeId.get(employeeId);

    setStationDraft((currentDraft) => ({
      ...currentDraft,
      employeeIds: Array.from(new Set([...currentDraft.employeeIds, employeeId]))
    }));
    setSelectedStationEmployeeId("");
    setStationMessage(
      currentStation && currentStation.id !== editingWorkstationId
        ? `Se movera desde ${currentStation.name} al guardar.`
        : ""
    );
  }

  function removeEmployeeFromStationDraft(employeeId: string) {
    setStationDraft((currentDraft) => ({
      ...currentDraft,
      employeeIds: currentDraft.employeeIds.filter((currentEmployeeId) => currentEmployeeId !== employeeId)
    }));
  }

  function editEmployee(employee: HumanResourcesEmployee) {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...employeeDraft } = employee;

    setDraft(employeeDraft);
    setEditingEmployeeId(employee.id);
    setFormMessage("");
  }

  function editWorkstation(workstation: HumanResourcesWorkstation) {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...workstationDraft } = workstation;

    setStationDraft(workstationDraft);
    setEditingWorkstationId(workstation.id);
    setSelectedStationEmployeeId("");
    setStationMessage("");
  }

  function submitEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.fullName.trim()) {
      setFormMessage("Captura el nombre completo del empleado.");
      return;
    }

    if (!draft.position.trim()) {
      setFormMessage("Captura el puesto del empleado.");
      return;
    }

    const now = new Date().toISOString();

    if (editingEmployeeId) {
      setEmployees((currentEmployees) =>
        currentEmployees.map((employee) =>
          employee.id === editingEmployeeId
            ? normalizeHumanResourcesEmployee({
                ...employee,
                ...draft,
                updatedAt: now
              })
            : employee
        )
      );
      setFormMessage("Empleado actualizado.");
    } else {
      const nextEmployee = normalizeHumanResourcesEmployee({
        ...draft,
        createdAt: now,
        updatedAt: now
      });

      setEmployees((currentEmployees) => [nextEmployee, ...currentEmployees]);
      setFormMessage("Empleado agregado.");
    }

    setDraft(createEmptyHumanResourcesEmployeeDraft());
    setEditingEmployeeId(null);
  }

  function submitWorkstation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!stationDraft.name.trim()) {
      setStationMessage("Captura el nombre de la estacion.");
      return;
    }

    const now = new Date().toISOString();

    setWorkstations((currentWorkstations) => {
      const existingWorkstation = editingWorkstationId
        ? currentWorkstations.find((workstation) => workstation.id === editingWorkstationId)
        : undefined;
      const savedWorkstation = normalizeHumanResourcesWorkstation({
        ...existingWorkstation,
        ...stationDraft,
        id: existingWorkstation?.id,
        createdAt: existingWorkstation?.createdAt || now,
        updatedAt: now
      });
      const movedEmployeeIds = new Set(savedWorkstation.employeeIds);
      const cleanedWorkstations = currentWorkstations.map((workstation) => {
        if (workstation.id === savedWorkstation.id) {
          return savedWorkstation;
        }

        const filteredEmployeeIds = workstation.employeeIds.filter((employeeId) => !movedEmployeeIds.has(employeeId));
        const removedAnyEmployee = filteredEmployeeIds.length !== workstation.employeeIds.length;

        return removedAnyEmployee
          ? {
              ...workstation,
              employeeIds: filteredEmployeeIds,
              updatedAt: now
            }
          : workstation;
      });

      return existingWorkstation ? cleanedWorkstations : [savedWorkstation, ...cleanedWorkstations];
    });
    setStationMessage(editingWorkstationId ? "Estacion actualizada." : "Estacion creada.");
    setStationDraft(createEmptyHumanResourcesWorkstationDraft());
    setEditingWorkstationId(null);
    setSelectedStationEmployeeId("");
  }

  function updateWorkstationStatus(workstationId: string, status: HumanResourcesWorkstation["status"]) {
    const now = new Date().toISOString();

    setWorkstations((currentWorkstations) =>
      currentWorkstations.map((workstation) =>
        workstation.id === workstationId
          ? {
              ...workstation,
              status,
              updatedAt: now
            }
          : workstation
      )
    );
  }

  function markEmployeeAsTerminated(employeeId: string) {
    const now = new Date().toISOString();

    setEmployees((currentEmployees) =>
      currentEmployees.map((employee) =>
        employee.id === employeeId
          ? {
              ...employee,
              status: "baja",
              updatedAt: now
            }
          : employee
      )
    );
    setWorkstations((currentWorkstations) =>
      currentWorkstations.map((workstation) =>
        workstation.employeeIds.includes(employeeId)
          ? {
              ...workstation,
              employeeIds: workstation.employeeIds.filter((currentEmployeeId) => currentEmployeeId !== employeeId),
              updatedAt: now
            }
          : workstation
      )
    );
  }

  return (
    <main className="human-resources-profile-screen">
      <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span className="screen-icon human-resources-screen-icon" aria-hidden="true">
            <UsersRound size={22} />
          </span>
          <h1>Recursos Humanos</h1>
        </div>
      </header>

      <section className="human-resources-body">
        <section className="human-resources-command-panel">
          <div>
            <span className="section-kicker">RH operativo</span>
            <h2>Personal, turnos y habilidades</h2>
            <p>Base humana de la planta para despues conectar capacidad, asignaciones y costos reales.</p>
          </div>
          <button className="secondary-button" onClick={resetForm} type="button">
            <Plus size={16} aria-hidden="true" />
            Nuevo empleado
          </button>
        </section>

        <section className="human-resources-stat-grid" aria-label="Resumen de Recursos Humanos">
          <article>
            <UsersRound size={18} aria-hidden="true" />
            <span>Personas</span>
            <strong>{stats.employees}</strong>
          </article>
          <article>
            <UserRound size={18} aria-hidden="true" />
            <span>Activos</span>
            <strong>{stats.activeEmployees}</strong>
          </article>
          <article>
            <Banknote size={18} aria-hidden="true" />
            <span>Costo hora activo</span>
            <strong>{formatMoney(stats.totalHourlyCost)}</strong>
          </article>
          <article>
            <BadgeCheck size={18} aria-hidden="true" />
            <span>Habilidades</span>
            <strong>{stats.skillCount}</strong>
          </article>
          <article>
            <BriefcaseBusiness size={18} aria-hidden="true" />
            <span>Horas semanales</span>
            <strong>{stats.totalWeeklyHours}</strong>
          </article>
          <article>
            <Banknote size={18} aria-hidden="true" />
            <span>Costo mensual</span>
            <strong>{formatMoney(stats.estimatedMonthlyCost)}</strong>
          </article>
          <article>
            <BriefcaseBusiness size={18} aria-hidden="true" />
            <span>Estaciones</span>
            <strong>
              {workstationStats.activeWorkstations}/{workstationStats.workstations}
            </strong>
          </article>
          <article>
            <UsersRound size={18} aria-hidden="true" />
            <span>Personas en estacion</span>
            <strong>{workstationStats.assignedPeople}</strong>
          </article>
          <article>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Por ajustar</span>
            <strong>{workstationStats.stationsMissingSkills + workstationStats.stationsWithoutPeople}</strong>
          </article>
        </section>

        <section className="human-resources-workstation-layout">
          <section className="main-panel human-resources-workstation-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Estaciones de trabajo</h2>
                <p>Equipos por celula para mover personal segun la necesidad real de la planta.</p>
              </div>
              <button className="secondary-button" onClick={resetWorkstationForm} type="button">
                <Plus size={16} aria-hidden="true" />
                Nueva estacion
              </button>
            </div>

            <div className="human-resources-workstation-list">
              {workstationSummaries.map((summary) => {
                const { workstation } = summary;
                const targetLabel =
                  workstation.targetWeeklyOutput > 0
                    ? `${formatNumber(workstation.targetWeeklyOutput)} ${workstation.outputUnit}/semana`
                    : "Sin meta";
                const outputPerHour =
                  summary.capacityPerHour > 0
                    ? `${formatNumber(summary.capacityPerHour, 2)} ${workstation.outputUnit}/h`
                    : "Sin dato";

                return (
                  <article
                    className={`human-resources-workstation-card status-${workstation.status}`}
                    key={workstation.id}
                  >
                    <header>
                      <div>
                        <span className="section-kicker">{humanResourcesAreaLabels[workstation.area]}</span>
                        <h3>{workstation.name}</h3>
                        <p>{humanResourcesShiftLabels[workstation.shift]}</p>
                      </div>
                      <span className={`status-pill human-resources-workstation-status status-${workstation.status}`}>
                        {humanResourcesWorkstationStatusLabels[workstation.status]}
                      </span>
                    </header>

                    <div className="human-resources-workstation-metrics">
                      <div>
                        <span>Personas</span>
                        <strong>
                          {summary.activeEmployees.length}/{summary.assignedEmployees.length}
                        </strong>
                      </div>
                      <div>
                        <span>Horas</span>
                        <strong>{formatNumber(summary.weeklyHours)} h/sem</strong>
                      </div>
                      <div>
                        <span>Costo mensual</span>
                        <strong>{formatMoney(summary.monthlyCost)}</strong>
                      </div>
                      <div>
                        <span>Cobertura</span>
                        <strong>{summary.coveragePercent}%</strong>
                      </div>
                      <div>
                        <span>Meta</span>
                        <strong>{targetLabel}</strong>
                      </div>
                      <div>
                        <span>Rendimiento</span>
                        <strong>{outputPerHour}</strong>
                      </div>
                    </div>

                    <div className="human-resources-workstation-block">
                      <span>Equipo</span>
                      <div className="human-resources-workstation-pill-list">
                        {summary.assignedEmployees.map((employee) => (
                          <span
                            className={`human-resources-workstation-person-pill status-${employee.status}`}
                            key={employee.id}
                          >
                            {employee.fullName}
                          </span>
                        ))}
                        {summary.assignedEmployees.length === 0 ? <small>Sin personas asignadas.</small> : null}
                      </div>
                    </div>

                    <div className="human-resources-workstation-block">
                      <span>Habilidades requeridas</span>
                      <div className="human-resources-workstation-pill-list">
                        {workstation.requiredSkills.map((skill) => (
                          <span
                            className={
                              summary.missingSkills.includes(skill)
                                ? "human-resources-workstation-skill-pill missing"
                                : "human-resources-workstation-skill-pill"
                            }
                            key={skill}
                          >
                            {humanResourcesSkillLabels[skill]}
                          </span>
                        ))}
                        {workstation.requiredSkills.length === 0 ? <small>Sin habilidades requeridas.</small> : null}
                      </div>
                    </div>

                    {summary.missingSkills.length > 0 ? (
                      <div className="human-resources-workstation-alert">
                        <AlertTriangle size={15} aria-hidden="true" />
                        <span>
                          Faltan:{" "}
                          {summary.missingSkills.map((skill) => humanResourcesSkillLabels[skill]).join(", ")}
                        </span>
                      </div>
                    ) : null}

                    {workstation.notes ? <p className="human-resources-workstation-notes">{workstation.notes}</p> : null}

                    <div className="human-resources-workstation-actions">
                      <button className="secondary-button compact-button" onClick={() => editWorkstation(workstation)} type="button">
                        <Pencil size={15} aria-hidden="true" />
                        Editar
                      </button>
                      <button
                        className="secondary-button compact-button"
                        onClick={() =>
                          updateWorkstationStatus(
                            workstation.id,
                            workstation.status === "activa" ? "pausada" : "activa"
                          )
                        }
                        type="button"
                      >
                        {workstation.status === "activa" ? "Pausar" : "Activar"}
                      </button>
                      <button
                        className="secondary-button compact-button danger"
                        onClick={() => updateWorkstationStatus(workstation.id, "inactiva")}
                        type="button"
                      >
                        Inactivar
                      </button>
                    </div>
                  </article>
                );
              })}

              {workstationSummaries.length === 0 ? (
                <div className="human-resources-empty-panel">
                  <BriefcaseBusiness size={20} aria-hidden="true" />
                  <strong>Sin estaciones registradas.</strong>
                  <span>Crea estaciones como Recoleccion, Ensamble, Pintura o Calidad para armar equipos flexibles.</span>
                </div>
              ) : null}
            </div>
          </section>

          <form className="main-panel human-resources-workstation-form-panel" onSubmit={submitWorkstation}>
            <div className="clean-section-heading">
              <div>
                <h2>{editingWorkstationId ? "Editar estacion" : "Agregar estacion"}</h2>
                <p>Define el equipo de trabajo, habilidades necesarias y meta operativa.</p>
              </div>
            </div>

            <div className="human-resources-workstation-form-grid">
              <label className="field">
                <span>Nombre de estacion</span>
                <input
                  onChange={(event) => updateStationDraft("name", event.target.value)}
                  placeholder="Ensamble SO101"
                  type="text"
                  value={stationDraft.name}
                />
              </label>
              <label className="field">
                <span>Area</span>
                <select
                  onChange={(event) =>
                    updateStationDraft("area", event.target.value as HumanResourcesWorkstationDraft["area"])
                  }
                  value={stationDraft.area}
                >
                  {humanResourcesAreaOptions.map((area) => (
                    <option key={area} value={area}>
                      {humanResourcesAreaLabels[area]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Turno</span>
                <select
                  onChange={(event) =>
                    updateStationDraft("shift", event.target.value as HumanResourcesWorkstationDraft["shift"])
                  }
                  value={stationDraft.shift}
                >
                  {humanResourcesShiftOptions.map((shift) => (
                    <option key={shift} value={shift}>
                      {humanResourcesShiftLabels[shift]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Estado</span>
                <select
                  onChange={(event) =>
                    updateStationDraft("status", event.target.value as HumanResourcesWorkstationDraft["status"])
                  }
                  value={stationDraft.status}
                >
                  {humanResourcesWorkstationStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {humanResourcesWorkstationStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Meta semanal</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => updateStationDraft("targetWeeklyOutput", Number(event.target.value || 0))}
                  placeholder="120"
                  type="text"
                  value={stationDraft.targetWeeklyOutput > 0 ? String(stationDraft.targetWeeklyOutput) : ""}
                />
              </label>
              <label className="field">
                <span>Unidad</span>
                <input
                  onChange={(event) => updateStationDraft("outputUnit", event.target.value)}
                  placeholder="piezas"
                  type="text"
                  value={stationDraft.outputUnit}
                />
              </label>
            </div>

            <section className="human-resources-workstation-builder" aria-label="Habilidades requeridas por estacion">
              <div>
                <span className="section-kicker">Habilidades requeridas</span>
                <p>Harv compara esto contra el equipo asignado para detectar huecos.</p>
              </div>
              <div className="human-resources-workstation-controls">
                <label className="field compact">
                  <span>Habilidad</span>
                  <select
                    onChange={(event) => setSelectedStationSkill(event.target.value as HumanResourcesSkill)}
                    value={selectedStationSkill}
                  >
                    {humanResourcesSkillOptions.map((skill) => (
                      <option key={skill} value={skill}>
                        {humanResourcesSkillLabels[skill]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary-button" onClick={addStationSkill} type="button">
                  <Plus size={16} aria-hidden="true" />
                  Agregar
                </button>
              </div>

              <div className="human-resources-skill-list">
                {stationDraft.requiredSkills.map((skill) => (
                  <span className="human-resources-skill-pill" key={skill}>
                    <BadgeCheck size={14} aria-hidden="true" />
                    <strong>{humanResourcesSkillLabels[skill]}</strong>
                    <button onClick={() => removeStationSkill(skill)} type="button" aria-label="Quitar habilidad requerida">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {stationDraft.requiredSkills.length === 0 ? (
                  <span className="human-resources-skill-empty">Sin habilidades requeridas.</span>
                ) : null}
              </div>
            </section>

            <section className="human-resources-workstation-builder" aria-label="Equipo asignado a estacion">
              <div>
                <span className="section-kicker">Equipo asignado</span>
                <p>Una persona solo cuenta en una estacion. Si la agregas aqui, se mueve al guardar.</p>
              </div>
              <div className="human-resources-workstation-controls">
                <label className="field compact">
                  <span>Empleado activo</span>
                  <select
                    disabled={assignableEmployees.length === 0}
                    onChange={(event) => setSelectedStationEmployeeId(event.target.value)}
                    value={selectedStationEmployeeId}
                  >
                    <option value="">
                      {assignableEmployees.length === 0 ? "Sin empleados disponibles" : "Seleccionar empleado"}
                    </option>
                    {assignableEmployees.map((employee) => {
                      const assignedStation = stationByEmployeeId.get(employee.id);
                      const assignedStationLabel =
                        assignedStation && assignedStation.id !== editingWorkstationId
                          ? ` - en ${assignedStation.name}`
                          : "";

                      return (
                        <option key={employee.id} value={employee.id}>
                          {employee.fullName}
                          {assignedStationLabel}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={assignableEmployees.length === 0}
                  onClick={addEmployeeToStationDraft}
                  type="button"
                >
                  <Plus size={16} aria-hidden="true" />
                  Agregar
                </button>
              </div>

              <div className="human-resources-skill-list">
                {stationDraftEmployees.map((employee) => (
                  <span className="human-resources-skill-pill" key={employee.id}>
                    <UserRound size={14} aria-hidden="true" />
                    <strong>{employee.fullName}</strong>
                    <small>{humanResourcesAreaLabels[employee.area]}</small>
                    <button onClick={() => removeEmployeeFromStationDraft(employee.id)} type="button" aria-label="Quitar empleado">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {stationDraftEmployees.length === 0 ? (
                  <span className="human-resources-skill-empty">Sin personas asignadas.</span>
                ) : null}
              </div>
            </section>

            <label className="field">
              <span>Notas de estacion</span>
              <textarea
                onChange={(event) => updateStationDraft("notes", event.target.value)}
                placeholder="Restricciones, balanceo, herramientas, comentarios del supervisor..."
                value={stationDraft.notes}
              />
            </label>

            {stationMessage ? <p className="human-resources-form-message">{stationMessage}</p> : null}

            <div className="modal-actions">
              <button className="secondary-button" onClick={resetWorkstationForm} type="button">
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                <BriefcaseBusiness size={16} aria-hidden="true" />
                {editingWorkstationId ? "Guardar estacion" : "Crear estacion"}
              </button>
            </div>
          </form>
        </section>

        <section className="main-panel human-resources-skill-matrix-panel">
          <div className="clean-section-heading">
            <div>
              <h2>Matriz de habilidades</h2>
              <p>Cobertura activa por habilidad para ver huecos antes de planear produccion.</p>
            </div>
          </div>

          <div className="human-resources-skill-matrix">
            {skillMatrix.map((matrixItem) => (
              <article
                className={matrixItem.employees === 0 ? "needs-coverage" : ""}
                key={matrixItem.skill}
              >
                <div>
                  <strong>{matrixItem.label}</strong>
                  <span>{matrixItem.employees} persona(s)</span>
                </div>
                <div>
                  <span>Avanzado+</span>
                  <strong>{matrixItem.advancedEmployees}</strong>
                </div>
                <div>
                  <span>Certificados</span>
                  <strong>{matrixItem.certifiedEmployees}</strong>
                </div>
                {matrixItem.employees === 0 || matrixItem.expiringCertifications > 0 ? (
                  <small>
                    <AlertTriangle size={13} aria-hidden="true" />
                    {matrixItem.employees === 0
                      ? "Sin cobertura"
                      : `${matrixItem.expiringCertifications} por vencer`}
                  </small>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="human-resources-layout">
          <section className="main-panel human-resources-directory-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Directorio de personal</h2>
                <p>Lista operativa para saber quien trabaja, donde pertenece y que puede hacer.</p>
              </div>
            </div>

            <label className="search-field" aria-label="Buscar empleado">
              <Search size={18} aria-hidden="true" />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre, area, puesto o habilidad"
                type="search"
                value={query}
              />
            </label>

            <div className="human-resources-employee-list">
              {filteredEmployees.map((employee) => {
                const payrollBreakdown = calculateEmployeePayrollBreakdown(employee);

                return (
                  <article className="human-resources-employee-row" key={employee.id}>
                    <div className="human-resources-employee-main">
                      <span className="human-resources-avatar" aria-hidden="true">
                        <UserRound size={18} />
                      </span>
                      <div>
                        <strong>{employee.fullName}</strong>
                        <span>{employee.position}</span>
                        <small>{humanResourcesAreaLabels[employee.area]}</small>
                      </div>
                    </div>
                    <div>
                      <span>Turno</span>
                      <strong>{humanResourcesShiftLabels[employee.shift]}</strong>
                    </div>
                    <div className="human-resources-payroll-breakdown">
                      <span>Costo hora</span>
                      <strong>{formatMoney(employee.hourlyCost)}</strong>
                      <small>Dia: {formatMoney(payrollBreakdown.dailyCost)}</small>
                      <small>Semana: {formatMoney(payrollBreakdown.weeklyCost)}</small>
                      <small>Quincena: {formatMoney(payrollBreakdown.biweeklyCost)}</small>
                      <small>Mensual: {formatMoney(payrollBreakdown.monthlyCost)}</small>
                    </div>
                    <div>
                      <span>Ingreso</span>
                      <strong>{formatDate(employee.hiredAt)}</strong>
                    </div>
                    <div className="human-resources-skill-preview">
                      <span>Habilidades</span>
                      <strong>{employee.skills.length}</strong>
                      <small>
                        {employee.skills.length > 0
                          ? employee.skills
                              .slice(0, 2)
                              .map((skill) => humanResourcesSkillLabels[skill.skill])
                              .join(", ")
                          : "Sin habilidades"}
                      </small>
                    </div>
                    <span className={`status-pill human-resources-status-pill status-${employee.status}`}>
                      {humanResourcesEmployeeStatusLabels[employee.status]}
                    </span>
                    <div className="human-resources-row-actions">
                      <button className="secondary-button compact-button" onClick={() => editEmployee(employee)} type="button">
                        <Pencil size={15} aria-hidden="true" />
                        Editar
                      </button>
                      <button
                        className="secondary-button compact-button danger"
                        onClick={() => markEmployeeAsTerminated(employee.id)}
                        type="button"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        Baja
                      </button>
                    </div>
                  </article>
                );
              })}

              {filteredEmployees.length === 0 ? (
                <div className="human-resources-empty-panel">
                  <UsersRound size={20} aria-hidden="true" />
                  <strong>{employees.length === 0 ? "Sin empleados registrados." : "Sin resultados."}</strong>
                  <span>Agrega personal para que Harv pueda calcular capacidad y costo humano.</span>
                </div>
              ) : null}
            </div>
          </section>

          <form className="main-panel human-resources-form-panel" onSubmit={submitEmployee}>
            <div className="clean-section-heading">
              <div>
                <h2>{editingEmployeeId ? "Editar empleado" : "Agregar empleado"}</h2>
                <p>Datos base de RH operativo. Esto despues alimenta Finanzas y Produccion.</p>
              </div>
            </div>

            <div className="human-resources-form-grid">
              <label className="field">
                <span>Nombre completo</span>
                <input
                  onChange={(event) => updateDraft("fullName", event.target.value)}
                  placeholder="Nombre y apellido"
                  type="text"
                  value={draft.fullName}
                />
              </label>
              <label className="field">
                <span>Puesto</span>
                <input
                  onChange={(event) => updateDraft("position", event.target.value)}
                  placeholder="Tecnico de ensamble"
                  type="text"
                  value={draft.position}
                />
              </label>
              <label className="field">
                <span>Area</span>
                <select
                  onChange={(event) => updateDraft("area", event.target.value as HumanResourcesEmployeeDraft["area"])}
                  value={draft.area}
                >
                  {humanResourcesAreaOptions.map((area) => (
                    <option key={area} value={area}>
                      {humanResourcesAreaLabels[area]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Turno</span>
                <select
                  onChange={(event) => updateDraft("shift", event.target.value as HumanResourcesEmployeeDraft["shift"])}
                  value={draft.shift}
                >
                  {humanResourcesShiftOptions.map((shift) => (
                    <option key={shift} value={shift}>
                      {humanResourcesShiftLabels[shift]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Estado</span>
                <select
                  onChange={(event) => updateDraft("status", event.target.value as HumanResourcesEmployeeDraft["status"])}
                  value={draft.status}
                >
                  {humanResourcesEmployeeStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {humanResourcesEmployeeStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Costo por hora</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => updateDraft("hourlyCost", Number(event.target.value || 0))}
                  placeholder="120"
                  type="text"
                  value={draft.hourlyCost > 0 ? String(draft.hourlyCost) : ""}
                />
              </label>
              <label className="field">
                <span>Horas por semana</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => updateDraft("weeklyHours", Number(event.target.value || 0))}
                  placeholder="40"
                  type="text"
                  value={draft.weeklyHours > 0 ? String(draft.weeklyHours) : ""}
                />
              </label>
              <label className="field">
                <span>Fecha de ingreso</span>
                <input onChange={(event) => updateDraft("hiredAt", event.target.value)} type="date" value={draft.hiredAt} />
              </label>
              <label className="field">
                <span>Telefono</span>
                <input onChange={(event) => updateDraft("phone", event.target.value)} type="tel" value={draft.phone} />
              </label>
              <label className="field">
                <span>Email</span>
                <input onChange={(event) => updateDraft("email", event.target.value)} type="email" value={draft.email} />
              </label>
              <label className="field">
                <span>Contacto emergencia</span>
                <input
                  onChange={(event) => updateDraft("emergencyContactName", event.target.value)}
                  type="text"
                  value={draft.emergencyContactName}
                />
              </label>
              <label className="field">
                <span>Telefono emergencia</span>
                <input
                  onChange={(event) => updateDraft("emergencyContactPhone", event.target.value)}
                  type="tel"
                  value={draft.emergencyContactPhone}
                />
              </label>
            </div>

            <section className="human-resources-skill-builder" aria-label="Habilidades del empleado">
              <div>
                <span className="section-kicker">Habilidades</span>
                <p>Define lo que esta persona puede hacer dentro de la planta.</p>
              </div>
              <div className="human-resources-skill-controls">
                <label className="field compact">
                  <span>Habilidad</span>
                  <select onChange={(event) => setSelectedSkill(event.target.value as HumanResourcesSkill)} value={selectedSkill}>
                    {humanResourcesSkillOptions.map((skill) => (
                      <option key={skill} value={skill}>
                        {humanResourcesSkillLabels[skill]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field compact">
                  <span>Nivel</span>
                  <select
                    onChange={(event) => setSelectedSkillLevel(event.target.value as HumanResourcesSkillLevel)}
                    value={selectedSkillLevel}
                  >
                    {humanResourcesSkillLevelOptions.map((level) => (
                      <option key={level} value={level}>
                        {humanResourcesSkillLevelLabels[level]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field compact">
                  <span>Vence cert.</span>
                  <input
                    onChange={(event) => setSelectedSkillExpiresAt(event.target.value)}
                    type="date"
                    value={selectedSkillExpiresAt}
                  />
                </label>
                <label className="field human-resources-skill-notes-field">
                  <span>Notas</span>
                  <input
                    onChange={(event) => setSelectedSkillNotes(event.target.value)}
                    placeholder="Maquina, producto, restriccion..."
                    type="text"
                    value={selectedSkillNotes}
                  />
                </label>
                <button className="secondary-button" onClick={addSkill} type="button">
                  <Plus size={16} aria-hidden="true" />
                  Agregar
                </button>
              </div>

              <div className="human-resources-skill-list">
                {draft.skills.map((skill) => (
                  <span className="human-resources-skill-pill" key={skill.id}>
                    <BadgeCheck size={14} aria-hidden="true" />
                    <strong>{humanResourcesSkillLabels[skill.skill]}</strong>
                    <small>{humanResourcesSkillLevelLabels[skill.level]}</small>
                    {formatSkillDetail(skill.expiresAt, skill.notes) ? (
                      <small>{formatSkillDetail(skill.expiresAt, skill.notes)}</small>
                    ) : null}
                    <button onClick={() => removeSkill(skill.id)} type="button" aria-label="Quitar habilidad">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}

                {draft.skills.length === 0 ? <span className="human-resources-skill-empty">Sin habilidades definidas.</span> : null}
              </div>
            </section>

            <label className="field">
              <span>Notas</span>
              <textarea
                onChange={(event) => updateDraft("notes", event.target.value)}
                placeholder="Restricciones, documentos pendientes, capacitacion, comentarios internos..."
                value={draft.notes}
              />
            </label>

            {formMessage ? <p className="human-resources-form-message">{formMessage}</p> : null}

            <div className="modal-actions">
              <button className="secondary-button" onClick={resetForm} type="button">
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                <BriefcaseBusiness size={16} aria-hidden="true" />
                {editingEmployeeId ? "Guardar cambios" : "Guardar empleado"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
