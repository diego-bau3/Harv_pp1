export type HumanResourcesEmployeeStatus = "activo" | "inactivo" | "vacaciones" | "incapacidad" | "baja";

export type HumanResourcesArea =
  | "pre-produccion"
  | "compras"
  | "almacen"
  | "ventas"
  | "produccion"
  | "fabricacion"
  | "ensamble"
  | "calidad"
  | "prueba"
  | "logistica"
  | "ingenieria"
  | "finanzas"
  | "recursos-humanos"
  | "seguridad"
  | "mantenimiento"
  | "administracion";

export type HumanResourcesShift = "matutino" | "vespertino" | "nocturno" | "mixto" | "administrativo";

export type HumanResourcesSkill =
  | "impresion-3d"
  | "cnc"
  | "ensamble"
  | "almacen"
  | "calidad"
  | "prueba"
  | "logistica"
  | "compras"
  | "ventas"
  | "mantenimiento"
  | "ingenieria"
  | "seguridad";

export type HumanResourcesSkillLevel = "basico" | "intermedio" | "avanzado" | "certificado";

export type HumanResourcesWorkstationStatus = "activa" | "pausada" | "inactiva";

export type HumanResourcesEmployeeSkill = {
  id: string;
  skill: HumanResourcesSkill;
  level: HumanResourcesSkillLevel;
  expiresAt: string;
  notes: string;
};

export type HumanResourcesEmployee = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  area: HumanResourcesArea;
  position: string;
  shift: HumanResourcesShift;
  hiredAt: string;
  status: HumanResourcesEmployeeStatus;
  hourlyCost: number;
  weeklyHours: number;
  skills: HumanResourcesEmployeeSkill[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type HumanResourcesEmployeeDraft = Omit<HumanResourcesEmployee, "id" | "createdAt" | "updatedAt">;

export type HumanResourcesWorkstation = {
  id: string;
  name: string;
  area: HumanResourcesArea;
  shift: HumanResourcesShift;
  status: HumanResourcesWorkstationStatus;
  requiredSkills: HumanResourcesSkill[];
  employeeIds: string[];
  targetWeeklyOutput: number;
  outputUnit: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type HumanResourcesWorkstationDraft = Omit<HumanResourcesWorkstation, "id" | "createdAt" | "updatedAt">;
