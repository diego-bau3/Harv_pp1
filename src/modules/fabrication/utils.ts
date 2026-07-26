import type { Priority, Product, ProductComponent, SalesOrder } from "../sales/types";
import { isPrintableProductComponent } from "../sales/utils";
import type {
  FabricationConnectionType,
  FabricationDispatchMode,
  FabricationJob,
  FabricationJobStatus,
  FabricationMachine,
  FabricationMachineStatus,
  FabricationMachineType
} from "./types";

type FabricationSalesQueueInput = {
  products: Product[];
  salesOrders: SalesOrder[];
  machines: FabricationMachine[];
  existingJobs: FabricationJob[];
};

export type FabricationSalesQueueSummary = {
  approvedOrders: number;
  requirements: number;
  totalPieces: number;
  newJobs: number;
  existingJobs: number;
  blockedJobs: number;
};

export type FabricationSalesQueueResult = {
  jobsToCreate: FabricationJob[];
  summary: FabricationSalesQueueSummary;
};

const salesJobStatusWeight: Record<FabricationJobStatus, number> = {
  pendiente: 0,
  listo: 1,
  asignado: 2,
  enviado: 3,
  imprimiendo: 4,
  terminado: 5,
  bloqueado: 6,
  cancelado: 7
};

const salesPriorityWeight: Record<Priority, number> = {
  normal: 1,
  alta: 2,
  urgente: 3,
  critica: 4
};

export const fabricationMachineTypeLabels: Record<FabricationMachineType, string> = {
  "impresora-3d": "Impresora 3D",
  otro: "Otro"
};

export const fabricationConnectionLabels: Record<FabricationConnectionType, string> = {
  manual: "Manual",
  "mock-agent": "Harv Agent mock",
  "bambu-lan": "Bambu LAN"
};

export const fabricationControlModeLabels: Record<FabricationConnectionType, string> = {
  manual: "Manual",
  "mock-agent": "Automatico",
  "bambu-lan": "Automatico"
};

export const fabricationMachineStatusLabels: Record<FabricationMachineStatus, string> = {
  disponible: "Disponible",
  imprimiendo: "Imprimiendo",
  pausada: "Pausada",
  error: "Error",
  mantenimiento: "Mantenimiento",
  offline: "Offline"
};

export const fabricationJobStatusLabels: Record<FabricationJobStatus, string> = {
  pendiente: "Pendiente",
  listo: "Listo",
  asignado: "Asignado",
  enviado: "Enviado",
  imprimiendo: "Imprimiendo",
  terminado: "Terminado",
  bloqueado: "Bloqueado",
  cancelado: "Cancelado"
};

export const fabricationDispatchModeLabels: Record<FabricationDispatchMode, string> = {
  manual: "Confirmar envio",
  auto: "Auto cuando se libere"
};

export const fabricationPriorityLabels: Record<Priority, string> = {
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
  critica: "Critica"
};

export function createFabricationJobsFromSales(input: FabricationSalesQueueInput): FabricationSalesQueueResult {
  const approvedOrders = input.salesOrders.filter((order) => order.status === "aprobada-comercialmente");
  const existingJobKeys = new Set<string>();

  input.existingJobs.forEach((job) => {
    if (job.sourceRef?.trim()) {
      existingJobKeys.add(job.sourceRef);
    }

    if (job.id.trim()) {
      existingJobKeys.add(job.id);
    }
  });
  const requirements = approvedOrders.flatMap((order) =>
    order.lines.flatMap((line, lineIndex) => {
      const product = resolveSalesLineProduct(line.product, input.products);

      if (!product || product.status !== "activo") {
        return [];
      }

      return product.components
        .filter(isPrintableProductComponent)
        .filter((component) => Number(component.quantity || 0) > 0)
        .map((component) => {
          const sourceRef = createSalesJobSourceRef(order.folio, line.id || `line-${lineIndex + 1}`, component.id);
          const quantity = Number((Number(line.quantity || 0) * Number(component.quantity || 0)).toFixed(3));

          return {
            order,
            product,
            component,
            quantity,
            sourceRef
          };
        })
        .filter((requirement) => requirement.quantity > 0);
    })
  );
  const jobsToCreate = requirements
    .filter((requirement) => !existingJobKeys.has(requirement.sourceRef) && !existingJobKeys.has(sourceRefToId(requirement.sourceRef)))
    .map((requirement) => createFabricationJobFromRequirement(requirement, input.machines))
    .sort(sortGeneratedSalesJobs);

  return {
    jobsToCreate,
    summary: {
      approvedOrders: approvedOrders.length,
      requirements: requirements.length,
      totalPieces: requirements.reduce((total, requirement) => total + requirement.quantity, 0),
      newJobs: jobsToCreate.length,
      existingJobs: requirements.length - jobsToCreate.length,
      blockedJobs: jobsToCreate.filter((job) => job.status === "bloqueado").length
    }
  };
}

export function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}

export function splitMaterials(value: string) {
  return value
    .split(",")
    .map((material) => material.trim().toLowerCase())
    .filter(Boolean);
}

export function machineSupportsMaterial(machine: FabricationMachine, material: string) {
  const normalizedMaterial = material.trim().toLowerCase();

  if (!normalizedMaterial) {
    return true;
  }

  const supportedMaterials = splitMaterials(machine.supportedMaterials);
  const loadedMaterial = machine.loadedMaterial.trim().toLowerCase();

  return supportedMaterials.includes(normalizedMaterial) || loadedMaterial === normalizedMaterial;
}

export function getMachineLabel(machineId: string, machines: FabricationMachine[]) {
  return machines.find((machine) => machine.id === machineId)?.name ?? "Sin maquina";
}

export function isManualMachine(machine: Pick<FabricationMachine, "connectionType">) {
  return machine.connectionType === "manual";
}

export function getConnectionSignal(
  machine: Pick<FabricationMachine, "connectionType" | "status" | "agentMachineId"> &
    Partial<Pick<FabricationMachine, "agentConnectionState">>
) {
  if (machine.connectionType === "manual") {
    return "Manual";
  }

  if (machine.connectionType === "mock-agent") {
    return "Con agente";
  }

  if (machine.agentConnectionState === "connected") {
    return "MQTT conectado";
  }

  if (machine.agentConnectionState === "connecting") {
    return "Conectando";
  }

  if (machine.agentConnectionState === "setup-required") {
    return "Falta vinculo";
  }

  if (machine.agentConnectionState === "error") {
    return "Error agente";
  }

  if (!machine.agentMachineId) {
    return "Sin agente";
  }

  if (machine.status === "offline") {
    return "Offline";
  }

  return "Conectada";
}

export function recommendMachine(
  job: Pick<FabricationJob, "material" | "priority">,
  machines: FabricationMachine[]
) {
  const statusScore: Record<FabricationMachineStatus, number> = {
    disponible: 0,
    pausada: 1,
    imprimiendo: 2,
    mantenimiento: 4,
    error: 5,
    offline: 6
  };

  return machines
    .filter((machine) => machine.type === "impresora-3d")
    .filter((machine) => machineSupportsMaterial(machine, job.material))
    .sort((firstMachine, secondMachine) => {
      const scoreDiff = statusScore[firstMachine.status] - statusScore[secondMachine.status];

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return firstMachine.progress - secondMachine.progress;
    })[0];
}

function resolveSalesLineProduct(lineProduct: Product, products: Product[]) {
  return products.find((product) => product.id === lineProduct.id || product.sku === lineProduct.sku);
}

function createSalesJobSourceRef(orderFolio: string, lineId: string, componentId: string) {
  return `sales:${orderFolio}:${lineId}:${componentId}`;
}

function sourceRefToId(sourceRef: string) {
  return `fab-job-${sourceRef.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

function designMatchesMachine(designPrinter: string, machine: FabricationMachine) {
  const printer = designPrinter.trim().toLowerCase();

  if (!printer || printer === "otra") {
    return false;
  }

  return [machine.name, machine.model, machine.brand].some((value) => value.toLowerCase().includes(printer));
}

function choosePrintDesign(component: ProductComponent, material: string, priority: Priority, machines: FabricationMachine[]) {
  const designsWithFiles = component.printDesigns.filter((design) => design.fileName.trim().length > 0);
  const supportedMachines = machines.filter((machine) => machine.type === "impresora-3d" && machineSupportsMaterial(machine, material));

  for (const design of designsWithFiles) {
    const machine = supportedMachines.find((currentMachine) => designMatchesMachine(design.printer, currentMachine));

    if (machine) {
      return { design, machine };
    }
  }

  return {
    design: designsWithFiles[0],
    machine: recommendMachine({ material, priority }, supportedMachines)
  };
}

function machineCanReceiveGeneratedJob(machine: FabricationMachine | undefined) {
  return Boolean(machine && machine.status !== "offline" && machine.status !== "error" && machine.status !== "mantenimiento");
}

function estimatePrintHours(component: ProductComponent, quantity: number) {
  const baseHoursByType = component.type === "pieza-impresa-3d" ? 0.5 : 0.25;
  const estimatedHours = quantity * baseHoursByType;

  return Math.max(0.25, Math.round(estimatedHours * 4) / 4);
}

function createFabricationJobFromRequirement(requirement: {
  order: SalesOrder;
  product: Product;
  component: ProductComponent;
  quantity: number;
  sourceRef: string;
}, machines: FabricationMachine[]): FabricationJob {
  const material = requirement.component.material.trim();
  const { design, machine } = choosePrintDesign(requirement.component, material, requirement.order.priority, machines);
  const missingReasons = [
    material ? "" : "Falta material en el componente.",
    design?.fileName ? "" : "Falta archivo 3MF en el componente.",
    machine ? "" : "No hay impresora compatible registrada."
  ].filter(Boolean);
  const canAssignMachine = machineCanReceiveGeneratedJob(machine);
  const status: FabricationJobStatus =
    missingReasons.length > 0 ? "bloqueado" : canAssignMachine ? "asignado" : "listo";
  const notes = [
    `Generado desde orden de venta ${requirement.order.folio}.`,
    `Producto: ${requirement.product.sku} - ${requirement.product.name}.`,
    design?.printer ? `Diseño para ${design.printer}.` : "",
    requirement.component.color ? `Color: ${requirement.component.color}.` : "",
    requirement.component.notes,
    ...missingReasons
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: sourceRefToId(requirement.sourceRef),
    createdAt: new Date().toISOString().slice(0, 10),
    sourceRef: requirement.sourceRef,
    orderReference: requirement.order.folio,
    partName: requirement.component.name,
    productName: requirement.product.name,
    componentId: requirement.component.id,
    quantity: requirement.quantity,
    unit: requirement.component.unit,
    material,
    priority: requirement.order.priority,
    requiredDate: requirement.order.requiredDate,
    estimatedHours: estimatePrintHours(requirement.component, requirement.quantity),
    assignedMachineId: canAssignMachine && machine ? machine.id : "",
    dispatchMode: "auto",
    status,
    fileName: design?.fileName.trim() ?? "",
    notes
  };
}

function sortGeneratedSalesJobs(firstJob: FabricationJob, secondJob: FabricationJob) {
  if (firstJob.requiredDate !== secondJob.requiredDate) {
    return firstJob.requiredDate.localeCompare(secondJob.requiredDate);
  }

  const priorityDiff = salesPriorityWeight[secondJob.priority] - salesPriorityWeight[firstJob.priority];

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  if (firstJob.material !== secondJob.material) {
    return firstJob.material.localeCompare(secondJob.material);
  }

  const statusDiff = salesJobStatusWeight[firstJob.status] - salesJobStatusWeight[secondJob.status];

  if (statusDiff !== 0) {
    return statusDiff;
  }

  return firstJob.partName.localeCompare(secondJob.partName);
}

export function calculateFabricationStats(machines: FabricationMachine[], jobs: FabricationJob[]) {
  return {
    machines: machines.length,
    available: machines.filter((machine) => machine.status === "disponible").length,
    printing: machines.filter((machine) => machine.status === "imprimiendo").length,
    pendingJobs: jobs.filter((job) => job.status === "pendiente" || job.status === "listo" || job.status === "asignado").length
  };
}

export function machineMatches(machine: FabricationMachine, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    machine.name,
    machine.brand,
    machine.model,
    machine.location,
    machine.loadedMaterial,
    machine.supportedMaterials,
    machine.ipAddress,
    machine.agentMachineId,
    machine.serialNumber,
    machine.agentMessage
  ].some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function jobMatches(job: FabricationJob, query: string, machines: FabricationMachine[]) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    job.partName,
    job.productName,
    job.orderReference,
    job.material,
    job.fileName,
    job.notes,
    getMachineLabel(job.assignedMachineId, machines)
  ].some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function formatMinutes(value: number) {
  if (!value || value <= 0) {
    return "0 min";
  }

  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);

  if (hours <= 0) {
    return `${minutes} min`;
  }

  return `${hours} h ${minutes} min`;
}
