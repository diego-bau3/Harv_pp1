import type { Priority, ProductUnit } from "../sales/types";

export type FabricationMachineType = "impresora-3d" | "otro";

export type FabricationConnectionType = "manual" | "mock-agent" | "bambu-lan";

export type FabricationMachineStatus =
  | "disponible"
  | "imprimiendo"
  | "pausada"
  | "error"
  | "mantenimiento"
  | "offline";

export type FabricationJobStatus =
  | "pendiente"
  | "listo"
  | "asignado"
  | "enviado"
  | "imprimiendo"
  | "terminado"
  | "bloqueado"
  | "cancelado";

export type FabricationDispatchMode = "manual" | "auto";

export type FabricationAgentConnectionState =
  | "setup-required"
  | "connecting"
  | "connected"
  | "offline"
  | "error";

export type FabricationMaterialSlot = {
  slot: string;
  material: string;
  color: string;
};

export type FabricationMachine = {
  id: string;
  name: string;
  type: FabricationMachineType;
  brand: string;
  model: string;
  location: string;
  connectionType: FabricationConnectionType;
  agentMachineId: string;
  ipAddress: string;
  serialNumber: string;
  status: FabricationMachineStatus;
  loadedMaterial: string;
  materialSlots: FabricationMaterialSlot[];
  supportedMaterials: string;
  nozzleSize: number;
  buildVolume: string;
  currentJobName: string;
  progress: number;
  nozzleTemp: number;
  bedTemp: number;
  chamberTemp: number;
  remainingMinutes: number;
  estimatedFinishAt: string;
  lastSeenAt: string;
  agentConnectionState: FabricationAgentConnectionState;
  agentMessage: string;
  notes: string;
};

export type FabricationMachineDraft = Omit<FabricationMachine, "id">;

export type FabricationDiscoveryPrinter = {
  id: string;
  name: string;
  brand: string;
  model: string;
  ipAddress: string;
  serial: string;
  source: string;
  signal: string;
  openPorts: number[];
  lastSeenAt: string;
};

export type FabricationPrinterTelemetry = {
  printerId: string;
  connectionState: FabricationAgentConnectionState;
  status: FabricationMachineStatus;
  loadedMaterial: string;
  materialSlots: FabricationMaterialSlot[];
  currentJobName: string;
  progress: number;
  remainingMinutes: number;
  estimatedFinishAt: string;
  nozzleTemp: number;
  bedTemp: number;
  chamberTemp: number;
  message: string;
  lastSeenAt: string;
  source: string;
};

export type FabricationLinkedPrinter = {
  id: string;
  name: string;
  brand: string;
  model: string;
  location: string;
  ipAddress: string;
  serial: string;
  hasAccessCode: boolean;
  linkedAt: string;
  updatedAt: string;
  status: FabricationPrinterTelemetry;
};

export type FabricationJob = {
  id: string;
  createdAt: string;
  sourceRef?: string;
  orderReference: string;
  partName: string;
  productName: string;
  componentId: string;
  quantity: number;
  unit: ProductUnit;
  material: string;
  priority: Priority;
  requiredDate: string;
  estimatedHours: number;
  assignedMachineId: string;
  dispatchMode: FabricationDispatchMode;
  status: FabricationJobStatus;
  fileName: string;
  notes: string;
};

export type FabricationJobDraft = Omit<FabricationJob, "id" | "createdAt">;
