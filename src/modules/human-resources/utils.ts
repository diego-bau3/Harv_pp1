import type {
  HumanResourcesArea,
  HumanResourcesEmployee,
  HumanResourcesEmployeeDraft,
  HumanResourcesEmployeeSkill,
  HumanResourcesEmployeeStatus,
  HumanResourcesShift,
  HumanResourcesSkill,
  HumanResourcesSkillLevel,
  HumanResourcesWorkstation,
  HumanResourcesWorkstationDraft,
  HumanResourcesWorkstationStatus
} from "./types";

export const humanResourcesEmployeesStorageKey = "harv:human-resources-employees:v1";
export const humanResourcesWorkstationsStorageKey = "harv:human-resources-workstations:v1";
export const humanResourcesWorkdaysPerWeek = 5;
export const humanResourcesWeeksPerPayPeriod = 2;
export const humanResourcesPayPeriodsPerMonth = 2;

export const humanResourcesAreaLabels: Record<HumanResourcesArea, string> = {
  "pre-produccion": "Preproduccion",
  compras: "Compras",
  almacen: "Almacen",
  ventas: "Ventas",
  produccion: "Produccion",
  fabricacion: "Fabricacion",
  ensamble: "Ensamble",
  calidad: "Calidad",
  prueba: "Prueba",
  logistica: "Logistica",
  ingenieria: "Ingenieria",
  finanzas: "Finanzas",
  "recursos-humanos": "Recursos Humanos",
  seguridad: "Seguridad",
  mantenimiento: "Mantenimiento",
  administracion: "Administracion"
};

export const humanResourcesAreaOptions = Object.keys(humanResourcesAreaLabels) as HumanResourcesArea[];

export const humanResourcesEmployeeStatusLabels: Record<HumanResourcesEmployeeStatus, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  vacaciones: "Vacaciones",
  incapacidad: "Incapacidad",
  baja: "Baja"
};

export const humanResourcesEmployeeStatusOptions = Object.keys(
  humanResourcesEmployeeStatusLabels
) as HumanResourcesEmployeeStatus[];

export const humanResourcesShiftLabels: Record<HumanResourcesShift, string> = {
  matutino: "Matutino",
  vespertino: "Vespertino",
  nocturno: "Nocturno",
  mixto: "Mixto",
  administrativo: "Administrativo"
};

export const humanResourcesShiftOptions = Object.keys(humanResourcesShiftLabels) as HumanResourcesShift[];

export const humanResourcesSkillLabels: Record<HumanResourcesSkill, string> = {
  "impresion-3d": "Impresion 3D",
  cnc: "CNC",
  ensamble: "Ensamble",
  almacen: "Almacen",
  calidad: "Calidad",
  prueba: "Prueba",
  logistica: "Logistica",
  compras: "Compras",
  ventas: "Ventas",
  mantenimiento: "Mantenimiento",
  ingenieria: "Ingenieria",
  seguridad: "Seguridad"
};

export const humanResourcesSkillOptions = Object.keys(humanResourcesSkillLabels) as HumanResourcesSkill[];

export const humanResourcesSkillLevelLabels: Record<HumanResourcesSkillLevel, string> = {
  basico: "Basico",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  certificado: "Certificado"
};

export const humanResourcesSkillLevelOptions = Object.keys(
  humanResourcesSkillLevelLabels
) as HumanResourcesSkillLevel[];

export const humanResourcesWorkstationStatusLabels: Record<HumanResourcesWorkstationStatus, string> = {
  activa: "Activa",
  pausada: "Pausada",
  inactiva: "Inactiva"
};

export const humanResourcesWorkstationStatusOptions = Object.keys(
  humanResourcesWorkstationStatusLabels
) as HumanResourcesWorkstationStatus[];

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeArea(value: unknown): HumanResourcesArea {
  return humanResourcesAreaOptions.includes(value as HumanResourcesArea) ? (value as HumanResourcesArea) : "produccion";
}

function normalizeStatus(value: unknown): HumanResourcesEmployeeStatus {
  return humanResourcesEmployeeStatusOptions.includes(value as HumanResourcesEmployeeStatus)
    ? (value as HumanResourcesEmployeeStatus)
    : "activo";
}

function normalizeShift(value: unknown): HumanResourcesShift {
  return humanResourcesShiftOptions.includes(value as HumanResourcesShift) ? (value as HumanResourcesShift) : "matutino";
}

function normalizeSkill(value: unknown): HumanResourcesSkill {
  return humanResourcesSkillOptions.includes(value as HumanResourcesSkill) ? (value as HumanResourcesSkill) : "ensamble";
}

function normalizeSkillLevel(value: unknown): HumanResourcesSkillLevel {
  return humanResourcesSkillLevelOptions.includes(value as HumanResourcesSkillLevel)
    ? (value as HumanResourcesSkillLevel)
    : "basico";
}

function normalizeWorkstationStatus(value: unknown): HumanResourcesWorkstationStatus {
  return humanResourcesWorkstationStatusOptions.includes(value as HumanResourcesWorkstationStatus)
    ? (value as HumanResourcesWorkstationStatus)
    : "activa";
}

export function createEmptyHumanResourcesEmployeeDraft(): HumanResourcesEmployeeDraft {
  return {
    fullName: "",
    phone: "",
    email: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    area: "produccion",
    position: "",
    shift: "matutino",
    hiredAt: todayIso(),
    status: "activo",
    hourlyCost: 0,
    weeklyHours: 40,
    skills: [],
    notes: ""
  };
}

export function createEmptyHumanResourcesWorkstationDraft(): HumanResourcesWorkstationDraft {
  return {
    name: "",
    area: "produccion",
    shift: "matutino",
    status: "activa",
    requiredSkills: [],
    employeeIds: [],
    targetWeeklyOutput: 0,
    outputUnit: "piezas",
    notes: ""
  };
}

export function createHumanResourcesEmployeeSkill(
  skill: HumanResourcesSkill,
  level: HumanResourcesSkillLevel,
  expiresAt = "",
  notes = ""
): HumanResourcesEmployeeSkill {
  return {
    id: createId("skill"),
    skill,
    level,
    expiresAt: cleanString(expiresAt),
    notes: cleanString(notes)
  };
}

export function normalizeHumanResourcesEmployeeSkill(
  skill: Partial<HumanResourcesEmployeeSkill>
): HumanResourcesEmployeeSkill {
  return {
    id: cleanString(skill.id) || createId("skill"),
    skill: normalizeSkill(skill.skill),
    level: normalizeSkillLevel(skill.level),
    expiresAt: cleanString(skill.expiresAt),
    notes: cleanString(skill.notes)
  };
}

export function normalizeHumanResourcesEmployee(
  employee: Partial<HumanResourcesEmployee>
): HumanResourcesEmployee {
  const now = new Date().toISOString();

  return {
    id: cleanString(employee.id) || createId("employee"),
    fullName: cleanString(employee.fullName),
    phone: cleanString(employee.phone),
    email: cleanString(employee.email),
    emergencyContactName: cleanString(employee.emergencyContactName),
    emergencyContactPhone: cleanString(employee.emergencyContactPhone),
    area: normalizeArea(employee.area),
    position: cleanString(employee.position),
    shift: normalizeShift(employee.shift),
    hiredAt: cleanString(employee.hiredAt) || todayIso(),
    status: normalizeStatus(employee.status),
    hourlyCost: Math.max(0, Number(employee.hourlyCost || 0)),
    weeklyHours: Math.max(0, Number(employee.weeklyHours ?? 40)),
    skills: Array.isArray(employee.skills) ? employee.skills.map(normalizeHumanResourcesEmployeeSkill) : [],
    notes: cleanString(employee.notes),
    createdAt: cleanString(employee.createdAt) || now,
    updatedAt: cleanString(employee.updatedAt) || now
  };
}

export function normalizeHumanResourcesWorkstation(
  workstation: Partial<HumanResourcesWorkstation>
): HumanResourcesWorkstation {
  const now = new Date().toISOString();
  const requiredSkills = Array.isArray(workstation.requiredSkills)
    ? workstation.requiredSkills.map(normalizeSkill)
    : [];
  const employeeIds = Array.isArray(workstation.employeeIds)
    ? workstation.employeeIds.map(cleanString).filter(Boolean)
    : [];

  return {
    id: cleanString(workstation.id) || createId("workstation"),
    name: cleanString(workstation.name),
    area: normalizeArea(workstation.area),
    shift: normalizeShift(workstation.shift),
    status: normalizeWorkstationStatus(workstation.status),
    requiredSkills: Array.from(new Set(requiredSkills)),
    employeeIds: Array.from(new Set(employeeIds)),
    targetWeeklyOutput: Math.max(0, Number(workstation.targetWeeklyOutput || 0)),
    outputUnit: cleanString(workstation.outputUnit) || "piezas",
    notes: cleanString(workstation.notes),
    createdAt: cleanString(workstation.createdAt) || now,
    updatedAt: cleanString(workstation.updatedAt) || now
  };
}

export function loadStoredHumanResourcesEmployees() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(humanResourcesEmployeesStorageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue) ? parsedValue.map(normalizeHumanResourcesEmployee) : [];
  } catch {
    return [];
  }
}

export function saveStoredHumanResourcesEmployees(employees: HumanResourcesEmployee[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(humanResourcesEmployeesStorageKey, JSON.stringify(employees));
}

export function loadStoredHumanResourcesWorkstations() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(humanResourcesWorkstationsStorageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue) ? parsedValue.map(normalizeHumanResourcesWorkstation) : [];
  } catch {
    return [];
  }
}

export function saveStoredHumanResourcesWorkstations(workstations: HumanResourcesWorkstation[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(humanResourcesWorkstationsStorageKey, JSON.stringify(workstations));
}

export function humanResourcesEmployeeMatches(employee: HumanResourcesEmployee, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableFields = [
    employee.fullName,
    employee.phone,
    employee.email,
    employee.position,
    humanResourcesAreaLabels[employee.area],
    humanResourcesShiftLabels[employee.shift],
    humanResourcesEmployeeStatusLabels[employee.status],
    ...employee.skills.flatMap((skill) => [
      humanResourcesSkillLabels[skill.skill],
      humanResourcesSkillLevelLabels[skill.level],
      skill.notes
    ])
  ];

  return searchableFields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function calculateHumanResourcesStats(employees: HumanResourcesEmployee[]) {
  const activeEmployees = employees.filter((employee) => employee.status === "activo");
  const unavailableEmployees = employees.filter(
    (employee) => employee.status === "vacaciones" || employee.status === "incapacidad"
  );
  const totalHourlyCost = activeEmployees.reduce((total, employee) => total + Number(employee.hourlyCost || 0), 0);
  const totalWeeklyHours = activeEmployees.reduce((total, employee) => total + Number(employee.weeklyHours || 0), 0);
  const roleCount = new Set(employees.map((employee) => employee.position.trim()).filter(Boolean)).size;
  const skillCount = employees.reduce((total, employee) => total + employee.skills.length, 0);

  return {
    employees: employees.length,
    activeEmployees: activeEmployees.length,
    unavailableEmployees: unavailableEmployees.length,
    totalHourlyCost,
    totalWeeklyHours,
    averageHourlyCost: activeEmployees.length > 0 ? totalHourlyCost / activeEmployees.length : 0,
    estimatedMonthlyCost: activeEmployees.reduce((total, employee) => total + calculateEmployeeMonthlyCost(employee), 0),
    roleCount,
    skillCount
  };
}

export function calculateEmployeePayrollBreakdown(
  employee: Pick<HumanResourcesEmployee, "hourlyCost" | "weeklyHours">
) {
  const hourlyCost = Number(employee.hourlyCost || 0);
  const weeklyHours = Number(employee.weeklyHours || 0);
  const weeklyCost = hourlyCost * weeklyHours;
  const dailyCost = humanResourcesWorkdaysPerWeek > 0 ? weeklyCost / humanResourcesWorkdaysPerWeek : 0;
  const biweeklyCost = weeklyCost * humanResourcesWeeksPerPayPeriod;
  const monthlyCost = biweeklyCost * humanResourcesPayPeriodsPerMonth;

  return {
    dailyCost,
    weeklyCost,
    biweeklyCost,
    monthlyCost
  };
}

export function calculateEmployeeMonthlyCost(employee: Pick<HumanResourcesEmployee, "hourlyCost" | "weeklyHours">) {
  return calculateEmployeePayrollBreakdown(employee).monthlyCost;
}

export function calculateHumanResourcesWorkstationSummary(
  workstation: HumanResourcesWorkstation,
  employees: HumanResourcesEmployee[]
) {
  const assignedEmployees = workstation.employeeIds
    .map((employeeId) => employees.find((employee) => employee.id === employeeId))
    .filter((employee): employee is HumanResourcesEmployee => Boolean(employee));
  const activeEmployees = assignedEmployees.filter((employee) => employee.status === "activo");
  const assignedSkillSet = new Set(activeEmployees.flatMap((employee) => employee.skills.map((skill) => skill.skill)));
  const missingSkills = workstation.requiredSkills.filter((skill) => !assignedSkillSet.has(skill));
  const weeklyHours = activeEmployees.reduce((total, employee) => total + Number(employee.weeklyHours || 0), 0);
  const hourlyCost = activeEmployees.reduce((total, employee) => total + Number(employee.hourlyCost || 0), 0);
  const monthlyCost = activeEmployees.reduce((total, employee) => total + calculateEmployeeMonthlyCost(employee), 0);
  const coveragePercent =
    workstation.requiredSkills.length === 0
      ? 100
      : Math.round(((workstation.requiredSkills.length - missingSkills.length) / workstation.requiredSkills.length) * 100);
  const capacityPerHour =
    workstation.targetWeeklyOutput > 0 && weeklyHours > 0 ? workstation.targetWeeklyOutput / weeklyHours : 0;

  return {
    workstation,
    assignedEmployees,
    activeEmployees,
    missingSkills,
    weeklyHours,
    hourlyCost,
    monthlyCost,
    coveragePercent,
    capacityPerHour
  };
}

export function calculateHumanResourcesWorkstationStats(
  workstations: HumanResourcesWorkstation[],
  employees: HumanResourcesEmployee[]
) {
  const activeWorkstations = workstations.filter((workstation) => workstation.status === "activa");
  const summaries = workstations.map((workstation) => calculateHumanResourcesWorkstationSummary(workstation, employees));
  const activeSummaries = summaries.filter((summary) => summary.workstation.status === "activa");
  const uniqueAssignedEmployeeIds = new Set(activeSummaries.flatMap((summary) => summary.activeEmployees.map((employee) => employee.id)));
  const totalWeeklyHours = activeSummaries.reduce((total, summary) => total + summary.weeklyHours, 0);
  const totalMonthlyCost = activeSummaries.reduce((total, summary) => total + summary.monthlyCost, 0);
  const stationsMissingSkills = activeSummaries.filter((summary) => summary.missingSkills.length > 0).length;
  const stationsWithoutPeople = activeSummaries.filter((summary) => summary.activeEmployees.length === 0).length;

  return {
    workstations: workstations.length,
    activeWorkstations: activeWorkstations.length,
    assignedPeople: uniqueAssignedEmployeeIds.size,
    totalWeeklyHours,
    totalMonthlyCost,
    stationsMissingSkills,
    stationsWithoutPeople
  };
}

export function getHumanResourcesEmployeeStationMap(workstations: HumanResourcesWorkstation[]) {
  const stationByEmployeeId = new Map<string, HumanResourcesWorkstation>();

  workstations.forEach((workstation) => {
    workstation.employeeIds.forEach((employeeId) => {
      stationByEmployeeId.set(employeeId, workstation);
    });
  });

  return stationByEmployeeId;
}

export function calculateHumanResourcesAreaFinance(employees: HumanResourcesEmployee[]) {
  return humanResourcesAreaOptions
    .map((area) => {
      const areaEmployees = employees.filter((employee) => employee.area === area);
      const activeEmployees = areaEmployees.filter((employee) => employee.status === "activo");
      const monthlyCost = activeEmployees.reduce((total, employee) => total + calculateEmployeeMonthlyCost(employee), 0);
      const weeklyHours = activeEmployees.reduce((total, employee) => total + Number(employee.weeklyHours || 0), 0);
      const hourlyCost = activeEmployees.reduce((total, employee) => total + Number(employee.hourlyCost || 0), 0);

      return {
        area,
        label: humanResourcesAreaLabels[area],
        employees: areaEmployees.length,
        activeEmployees: activeEmployees.length,
        weeklyHours,
        hourlyCost,
        monthlyCost,
        averageHourlyCost: activeEmployees.length > 0 ? hourlyCost / activeEmployees.length : 0
      };
    })
    .filter((areaFinance) => areaFinance.employees > 0 || areaFinance.monthlyCost > 0)
    .sort((firstArea, secondArea) => secondArea.monthlyCost - firstArea.monthlyCost);
}

export function calculateHumanResourcesFinanceAlerts(employees: HumanResourcesEmployee[]) {
  const activeEmployees = employees.filter((employee) => employee.status === "activo");
  const missingHourlyCost = activeEmployees.filter((employee) => Number(employee.hourlyCost || 0) <= 0);
  const missingWeeklyHours = activeEmployees.filter((employee) => Number(employee.weeklyHours || 0) <= 0);
  const missingSkills = activeEmployees.filter((employee) => employee.skills.length === 0);
  const certificationsToReview = activeEmployees.filter((employee) =>
    employee.skills.some((skill) => {
      if (!skill.expiresAt) {
        return false;
      }

      const expiresAt = new Date(skill.expiresAt);

      if (Number.isNaN(expiresAt.getTime())) {
        return false;
      }

      const daysToExpire = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);

      return daysToExpire <= 45;
    })
  );

  return [
    {
      id: "missing-hourly-cost",
      label: "Costo/hora faltante",
      count: missingHourlyCost.length,
      detail: "Empleados activos sin costo por hora no entran bien al costo operativo."
    },
    {
      id: "missing-weekly-hours",
      label: "Horas faltantes",
      count: missingWeeklyHours.length,
      detail: "Empleados activos sin horas semanales no calculan costo mensual."
    },
    {
      id: "missing-skills",
      label: "Sin habilidades",
      count: missingSkills.length,
      detail: "Empleados activos sin habilidades no ayudan a planear capacidad."
    },
    {
      id: "certifications-to-review",
      label: "Certificaciones por revisar",
      count: certificationsToReview.length,
      detail: "Hay certificaciones vencidas o proximas a vencer."
    }
  ].filter((alert) => alert.count > 0);
}

function escapeCsvValue(value: unknown) {
  const stringValue = String(value ?? "");

  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function createHumanResourcesFinanceCsv(employees: HumanResourcesEmployee[]) {
  const headers = [
    "Empleado",
    "Area",
    "Puesto",
    "Estado",
    "Turno",
    "Costo por hora MXN",
    "Horas por semana",
    "Costo mensual estimado MXN",
    "Habilidades",
    "Certificaciones por vencer",
    "Email",
    "Telefono"
  ];
  const rows = employees.map((employee) => {
    const certificationsToReview = employee.skills
      .filter((skill) => {
        if (!skill.expiresAt) {
          return false;
        }

        const expiresAt = new Date(skill.expiresAt);

        if (Number.isNaN(expiresAt.getTime())) {
          return false;
        }

        const daysToExpire = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);

        return daysToExpire <= 45;
      })
      .map((skill) => `${humanResourcesSkillLabels[skill.skill]} ${skill.expiresAt}`)
      .join("; ");

    return [
      employee.fullName,
      humanResourcesAreaLabels[employee.area],
      employee.position,
      humanResourcesEmployeeStatusLabels[employee.status],
      humanResourcesShiftLabels[employee.shift],
      employee.hourlyCost,
      employee.weeklyHours,
      calculateEmployeeMonthlyCost(employee).toFixed(2),
      employee.skills.map((skill) => `${humanResourcesSkillLabels[skill.skill]} (${humanResourcesSkillLevelLabels[skill.level]})`).join("; "),
      certificationsToReview,
      employee.email,
      employee.phone
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

export function calculateHumanResourcesSkillMatrix(employees: HumanResourcesEmployee[]) {
  const activeEmployees = employees.filter((employee) => employee.status === "activo");

  return humanResourcesSkillOptions.map((skill) => {
    const employeesWithSkill = activeEmployees.filter((employee) =>
      employee.skills.some((employeeSkill) => employeeSkill.skill === skill)
    );
    const certifiedEmployees = employeesWithSkill.filter((employee) =>
      employee.skills.some((employeeSkill) => employeeSkill.skill === skill && employeeSkill.level === "certificado")
    );
    const advancedEmployees = employeesWithSkill.filter((employee) =>
      employee.skills.some(
        (employeeSkill) =>
          employeeSkill.skill === skill && (employeeSkill.level === "avanzado" || employeeSkill.level === "certificado")
      )
    );
    const expiringCertifications = employeesWithSkill.reduce((total, employee) => {
      const matchingSkill = employee.skills.find((employeeSkill) => employeeSkill.skill === skill);

      if (!matchingSkill?.expiresAt) {
        return total;
      }

      const expiresAt = new Date(matchingSkill.expiresAt);

      if (Number.isNaN(expiresAt.getTime())) {
        return total;
      }

      const daysToExpire = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);

      return daysToExpire <= 45 ? total + 1 : total;
    }, 0);

    return {
      skill,
      label: humanResourcesSkillLabels[skill],
      employees: employeesWithSkill.length,
      certifiedEmployees: certifiedEmployees.length,
      advancedEmployees: advancedEmployees.length,
      expiringCertifications
    };
  });
}
