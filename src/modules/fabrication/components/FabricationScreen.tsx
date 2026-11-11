import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Factory,
  FileUp,
  Gauge,
  Link2,
  Play,
  Plus,
  Printer,
  Radar,
  Radio,
  RefreshCw,
  Search
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Product, ProductComponent, ProductUnit, SalesOrder } from "../../sales/types";
import { createId, isPrintableProductComponent, salesGeneratedOrdersStorageKey, todayIso } from "../../sales/utils";
import { initialFabricationJobs, initialFabricationMachines } from "../data";
import type {
  FabricationDispatchMode,
  FabricationConnectionType,
  FabricationDiscoveryPrinter,
  FabricationJob,
  FabricationJobDraft,
  FabricationJobStatus,
  FabricationLinkedPrinter,
  FabricationMachine,
  FabricationMachineDraft,
  FabricationMachineStatus
} from "../types";
import {
  calculateFabricationStats,
  clampProgress,
  createFabricationJobsFromSales,
  fabricationConnectionLabels,
  fabricationDispatchModeLabels,
  fabricationJobStatusLabels,
  fabricationMachineStatusLabels,
  fabricationMachineTypeLabels,
  fabricationPriorityLabels,
  formatMinutes,
  getMachineLabel,
  isManualMachine,
  jobMatches,
  machineMatches,
  recommendMachine
} from "../utils";

type FabricationScreenProps = {
  products: Product[];
  onBack: () => void;
  embedded?: boolean;
};

type PrintableComponentOption = {
  id: string;
  productName: string;
  productSku: string;
  component: ProductComponent;
};

type DiscoveryStatus = "idle" | "scanning" | "ready" | "error";
type AgentRequestStatus = "idle" | "working" | "ready" | "error";

type PrinterLinkDraft = {
  name: string;
  brand: string;
  model: string;
  location: string;
  ipAddress: string;
  serial: string;
  accessCode: string;
};

const machinesStorageKey = "harv:fabrication-machines:v1";
const jobsStorageKey = "harv:fabrication-jobs:v1";
const agentBaseUrl = "http://127.0.0.1:8787";
const discoveryTimeoutMs = 15000;
const agentRequestTimeoutMs = 12000;
const removedDemoMachineIds = new Set(["machine-bambu-p1s-01", "machine-bambu-x1c-01"]);
const removedDemoAgentIds = new Set(["bambu-p1s-01", "bambu-x1c-01"]);

function nowIso() {
  return new Date().toISOString();
}

function createEmptyMachineDraft(): FabricationMachineDraft {
  return {
    name: "",
    type: "impresora-3d",
    brand: "Bambu Lab",
    model: "P1S",
    location: "Celda 3D",
    connectionType: "manual",
    agentMachineId: "",
    ipAddress: "",
    serialNumber: "",
    status: "disponible",
    loadedMaterial: "PETG",
    materialSlots: [],
    supportedMaterials: "PLA, PETG",
    nozzleSize: 0.4,
    buildVolume: "256 x 256 x 256 mm",
    currentJobName: "",
    progress: 0,
    nozzleTemp: 28,
    bedTemp: 30,
    chamberTemp: 0,
    remainingMinutes: 0,
    estimatedFinishAt: "",
    lastSeenAt: nowIso(),
    agentConnectionState: "offline",
    agentMessage: "",
    notes: ""
  };
}

function createEmptyJobDraft(): FabricationJobDraft {
  return {
    orderReference: "",
    partName: "",
    productName: "",
    componentId: "",
    quantity: 1,
    unit: "pieza",
    material: "PETG",
    priority: "normal",
    requiredDate: "",
    estimatedHours: 1,
    assignedMachineId: "",
    dispatchMode: "manual",
    status: "pendiente",
    fileName: "",
    notes: ""
  };
}

function normalizeMachine(machine: Partial<FabricationMachine>): FabricationMachine {
  return {
    ...createEmptyMachineDraft(),
    ...machine,
    id: machine.id ?? createId("machine"),
    name: machine.name ?? "",
    brand: machine.brand ?? "",
    model: machine.model ?? "",
    location: machine.location ?? "",
    agentMachineId: machine.agentMachineId ?? "",
    ipAddress: machine.ipAddress ?? "",
    serialNumber: machine.serialNumber ?? "",
    loadedMaterial: machine.loadedMaterial ?? "",
    materialSlots: Array.isArray(machine.materialSlots) ? machine.materialSlots : [],
    supportedMaterials: machine.supportedMaterials ?? "",
    nozzleSize: Number(machine.nozzleSize ?? 0.4),
    progress: clampProgress(Number(machine.progress ?? 0)),
    nozzleTemp: Number(machine.nozzleTemp ?? 0),
    bedTemp: Number(machine.bedTemp ?? 0),
    chamberTemp: Number(machine.chamberTemp ?? 0),
    remainingMinutes: Number(machine.remainingMinutes ?? 0),
    estimatedFinishAt: machine.estimatedFinishAt ?? "",
    lastSeenAt: machine.lastSeenAt || nowIso(),
    agentConnectionState: machine.agentConnectionState ?? (machine.connectionType === "mock-agent" ? "connected" : "offline"),
    agentMessage: machine.agentMessage ?? "",
    notes: machine.notes ?? ""
  };
}

function normalizeJob(job: Partial<FabricationJob>): FabricationJob {
  return {
    ...createEmptyJobDraft(),
    ...job,
    id: job.id ?? createId("fab-job"),
    createdAt: job.createdAt ?? todayIso(),
    orderReference: job.orderReference ?? "",
    partName: job.partName ?? "",
    productName: job.productName ?? "",
    componentId: job.componentId ?? "",
    quantity: Number(job.quantity ?? 1),
    estimatedHours: Number(job.estimatedHours ?? 0),
    assignedMachineId: job.assignedMachineId ?? "",
    dispatchMode: job.dispatchMode ?? "manual",
    fileName: job.fileName ?? "",
    notes: job.notes ?? ""
  };
}

function normalizeKey(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function keysMatch(firstValue: string | undefined, secondValue: string | undefined) {
  const firstKey = normalizeKey(firstValue);
  const secondKey = normalizeKey(secondValue);

  return Boolean(firstKey && secondKey && firstKey === secondKey);
}

function isRemovedDemoMachine(machine: Partial<FabricationMachine>) {
  return (
    removedDemoMachineIds.has(machine.id ?? "") ||
    (machine.connectionType === "mock-agent" && removedDemoAgentIds.has(machine.agentMachineId ?? ""))
  );
}

function machineMatchesPrinter(machine: FabricationMachine, printer: FabricationDiscoveryPrinter) {
  return (
    keysMatch(machine.ipAddress, printer.ipAddress) ||
    keysMatch(machine.serialNumber, printer.serial) ||
    keysMatch(machine.agentMachineId, printer.id)
  );
}

function machineMatchesLinkedPrinter(machine: FabricationMachine, printer: FabricationLinkedPrinter) {
  return (
    keysMatch(machine.ipAddress, printer.ipAddress) ||
    keysMatch(machine.serialNumber, printer.serial) ||
    keysMatch(machine.agentMachineId, printer.id)
  );
}

function linkedPrinterMatchesDiscovery(printer: FabricationLinkedPrinter, discoveryPrinter: FabricationDiscoveryPrinter) {
  return (
    keysMatch(printer.ipAddress, discoveryPrinter.ipAddress) ||
    keysMatch(printer.serial, discoveryPrinter.serial) ||
    keysMatch(printer.id, discoveryPrinter.id)
  );
}

function machineMatchesDraft(machine: FabricationMachine, draft: FabricationMachineDraft) {
  return (
    keysMatch(machine.ipAddress, draft.ipAddress) ||
    keysMatch(machine.serialNumber, draft.serialNumber) ||
    keysMatch(machine.agentMachineId, draft.agentMachineId)
  );
}

function dedupeMachines(machines: FabricationMachine[]) {
  const deduped: FabricationMachine[] = [];

  for (const machine of machines) {
    if (isRemovedDemoMachine(machine)) {
      continue;
    }

    if (deduped.some((currentMachine) => machineMatchesDraft(currentMachine, machine))) {
      continue;
    }

    deduped.push(machine);
  }

  return deduped;
}

function loadStoredMachines() {
  try {
    const storedMachines = window.localStorage.getItem(machinesStorageKey);
    const machines = storedMachines ? JSON.parse(storedMachines) : initialFabricationMachines;

    return Array.isArray(machines)
      ? dedupeMachines(machines.map(normalizeMachine))
      : initialFabricationMachines.map(normalizeMachine);
  } catch {
    return initialFabricationMachines.map(normalizeMachine);
  }
}

function loadStoredJobs() {
  try {
    const storedJobs = window.localStorage.getItem(jobsStorageKey);
    const jobs = storedJobs ? JSON.parse(storedJobs) : initialFabricationJobs;

    return Array.isArray(jobs) ? jobs.map(normalizeJob) : initialFabricationJobs.map(normalizeJob);
  } catch {
    return initialFabricationJobs.map(normalizeJob);
  }
}

function loadStoredList<Item>(key: string, fallback: Item[]): Item[] {
  try {
    const storedValue = window.localStorage.getItem(key);

    if (!storedValue) {
      return fallback;
    }

    const parsedValue = JSON.parse(storedValue);

    return Array.isArray(parsedValue) ? parsedValue : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredSalesOrders() {
  return loadStoredList<SalesOrder>(salesGeneratedOrdersStorageKey, []);
}

function saveStoredMachines(machines: FabricationMachine[]) {
  try {
    window.localStorage.setItem(machinesStorageKey, JSON.stringify(machines));
  } catch {
    return;
  }
}

function saveStoredJobs(jobs: FabricationJob[]) {
  try {
    window.localStorage.setItem(jobsStorageKey, JSON.stringify(jobs));
  } catch {
    return;
  }
}

async function fetchAgentJson<T>(path: string, init?: RequestInit, timeoutMs = agentRequestTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init?.headers);

  headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`${agentBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(typeof payload.message === "string" ? payload.message : `Harv Agent respondio ${response.status}`);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Harv Agent tardo demasiado en responder.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function createLinkDraftFromPrinter(printer: FabricationDiscoveryPrinter): PrinterLinkDraft {
  return {
    name: printer.name || `Bambu ${printer.ipAddress}`,
    brand: printer.brand || "Bambu Lab",
    model: printer.model || "",
    location: "Celda 3D",
    ipAddress: printer.ipAddress,
    serial: printer.serial,
    accessCode: ""
  };
}

function getLinkedPrinterPatch(printer: FabricationLinkedPrinter): Partial<FabricationMachine> {
  const telemetry = printer.status;

  return {
    name: printer.name,
    brand: printer.brand || "Bambu Lab",
    model: printer.model || "Bambu",
    location: printer.location || "Celda 3D",
    connectionType: "bambu-lan",
    agentMachineId: printer.id,
    ipAddress: printer.ipAddress,
    serialNumber: printer.serial,
    status: telemetry.status,
    loadedMaterial: telemetry.loadedMaterial,
    materialSlots: telemetry.materialSlots,
    currentJobName: telemetry.currentJobName,
    progress: clampProgress(telemetry.progress),
    nozzleTemp: telemetry.nozzleTemp,
    bedTemp: telemetry.bedTemp,
    chamberTemp: telemetry.chamberTemp,
    remainingMinutes: telemetry.remainingMinutes,
    estimatedFinishAt: telemetry.estimatedFinishAt,
    lastSeenAt: telemetry.lastSeenAt || nowIso(),
    agentConnectionState: telemetry.connectionState,
    agentMessage: telemetry.message
  };
}

function createMachineFromLinkedPrinter(printer: FabricationLinkedPrinter): FabricationMachine {
  return normalizeMachine({
    ...createEmptyMachineDraft(),
    id: createId("machine"),
    type: "impresora-3d",
    supportedMaterials: "PLA, PETG, ABS, ASA",
    buildVolume: "256 x 256 x 256 mm",
    notes: "Vinculada con Harv Agent",
    ...getLinkedPrinterPatch(printer)
  });
}

function isJobReadyForPrint(job: Pick<FabricationJob, "fileName" | "material" | "partName">) {
  return Boolean(job.fileName.trim() && job.material.trim() && job.partName.trim());
}

function getQueueGroupId(job: FabricationJob) {
  if (job.status === "enviado" || job.status === "imprimiendo") {
    return "active";
  }

  if (job.status === "terminado" || job.status === "bloqueado" || job.status === "cancelado") {
    return "history";
  }

  return "next";
}

export function FabricationScreen({ products, onBack, embedded = false }: FabricationScreenProps) {
  const [machines, setMachines] = useState<FabricationMachine[]>(loadStoredMachines);
  const [jobs, setJobs] = useState<FabricationJob[]>(loadStoredJobs);
  const [machineDraft, setMachineDraft] = useState<FabricationMachineDraft>(createEmptyMachineDraft);
  const [jobDraft, setJobDraft] = useState<FabricationJobDraft>(createEmptyJobDraft);
  const [selectedComponentId, setSelectedComponentId] = useState("manual");
  const [machineQuery, setMachineQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [machineError, setMachineError] = useState("");
  const [jobError, setJobError] = useState("");
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>("idle");
  const [discoveryMessage, setDiscoveryMessage] = useState("");
  const [discoveredPrinters, setDiscoveredPrinters] = useState<FabricationDiscoveryPrinter[]>([]);
  const [printerLinkDraft, setPrinterLinkDraft] = useState<PrinterLinkDraft | null>(null);
  const [linkStatus, setLinkStatus] = useState<AgentRequestStatus>("idle");
  const [linkMessage, setLinkMessage] = useState("");
  const [agentSyncStatus, setAgentSyncStatus] = useState<AgentRequestStatus>("idle");
  const [agentSyncMessage, setAgentSyncMessage] = useState("");
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(loadStoredSalesOrders);
  const [autoQueueMessage, setAutoQueueMessage] = useState("");

  useEffect(() => {
    setMachines((currentMachines) => {
      const cleanedMachines = dedupeMachines(currentMachines);

      return cleanedMachines.length === currentMachines.length ? currentMachines : cleanedMachines;
    });
  }, []);

  useEffect(() => {
    void refreshAgentTelemetry({ quiet: true });
  }, []);

  useEffect(() => {
    saveStoredMachines(machines);
  }, [machines]);

  useEffect(() => {
    saveStoredJobs(jobs);
  }, [jobs]);

  const printableComponents = useMemo<PrintableComponentOption[]>(() => {
    return products.flatMap((product) =>
      product.components
        .filter(isPrintableProductComponent)
        .map((component) => ({
          id: `${product.id}-${component.id}`,
          productName: product.name,
          productSku: product.sku,
          component
        }))
    );
  }, [products]);

  const filteredMachines = useMemo(() => {
    return machines.filter((machine) => machineMatches(machine, machineQuery));
  }, [machines, machineQuery]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => jobMatches(job, jobQuery, machines));
  }, [jobs, jobQuery, machines]);

  const stats = useMemo(() => calculateFabricationStats(machines, jobs), [machines, jobs]);
  const suggestedMachine = useMemo(() => recommendMachine(jobDraft, machines), [jobDraft, machines]);
  const salesQueuePreview = useMemo(
    () =>
      createFabricationJobsFromSales({
        products,
        salesOrders,
        machines,
        existingJobs: jobs
      }),
    [products, salesOrders, machines, jobs]
  );
  const queueGroups = useMemo(
    () => [
      {
        id: "next",
        title: "Por imprimir",
        empty: "No hay trabajos listos para cola.",
        jobs: filteredJobs.filter((job) => getQueueGroupId(job) === "next")
      },
      {
        id: "active",
        title: "En proceso",
        empty: "No hay trabajos enviados o imprimiendo.",
        jobs: filteredJobs.filter((job) => getQueueGroupId(job) === "active")
      },
      {
        id: "history",
        title: "Historial y bloqueos",
        empty: "Todavia no hay trabajos cerrados o bloqueados.",
        jobs: filteredJobs.filter((job) => getQueueGroupId(job) === "history")
      }
    ],
    [filteredJobs]
  );
  const hasAgentMachines = useMemo(
    () => machines.some((machine) => machine.connectionType === "bambu-lan" && Boolean(machine.agentMachineId)),
    [machines]
  );
  const visibleDiscoveredPrinters = useMemo(
    () => discoveredPrinters.filter((printer) => !machines.some((machine) => machineMatchesPrinter(machine, printer))),
    [discoveredPrinters, machines]
  );

  useEffect(() => {
    if (!hasAgentMachines) {
      return;
    }

    void refreshAgentTelemetry({ quiet: true });
    const intervalId = window.setInterval(() => {
      void refreshAgentTelemetry({ quiet: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [hasAgentMachines]);

  function updateMachineDraft<Key extends keyof FabricationMachineDraft>(
    key: Key,
    value: FabricationMachineDraft[Key]
  ) {
    setMachineDraft((currentDraft) => {
      if (key === "connectionType") {
        const connectionType = value as FabricationConnectionType;

        return {
          ...currentDraft,
          connectionType,
          status: connectionType === "bambu-lan" ? "offline" : "disponible",
          progress: 0,
          currentJobName: "",
          remainingMinutes: 0,
          agentConnectionState: connectionType === "mock-agent" ? "connected" : "offline",
          agentMessage: ""
        };
      }

      return { ...currentDraft, [key]: value };
    });
  }

  function updateJobDraft<Key extends keyof FabricationJobDraft>(key: Key, value: FabricationJobDraft[Key]) {
    setJobDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  function updateJobFile(file: File | null) {
    if (!file) {
      return;
    }

    updateJobDraft("fileName", file.name);
  }

  function refreshSalesQueuePreview() {
    setSalesOrders(loadStoredSalesOrders());
    setAutoQueueMessage("Ordenes de Ventas sincronizadas.");
  }

  function handleMachineSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!machineDraft.name.trim()) {
      setMachineError("Captura el nombre de la maquina.");
      return;
    }

    if (machineDraft.connectionType === "bambu-lan" && !machineDraft.agentMachineId.trim()) {
      setMachineError("Captura el ID de la maquina en el agente local.");
      return;
    }

    if (machines.some((machine) => machineMatchesDraft(machine, machineDraft))) {
      setMachineError("Esa impresora ya esta agregada.");
      return;
    }

    const isManualDraft = isManualMachine(machineDraft);

    const savedMachine: FabricationMachine = {
      ...machineDraft,
      id: createId("machine"),
      name: machineDraft.name.trim(),
      brand: machineDraft.brand.trim(),
      model: machineDraft.model.trim(),
      location: machineDraft.location.trim(),
      agentMachineId: machineDraft.agentMachineId.trim(),
      ipAddress: machineDraft.ipAddress.trim(),
      serialNumber: machineDraft.serialNumber.trim(),
      loadedMaterial: machineDraft.loadedMaterial.trim(),
      materialSlots: machineDraft.materialSlots,
      supportedMaterials: machineDraft.supportedMaterials.trim(),
      status: isManualDraft ? machineDraft.status : machineDraft.connectionType === "mock-agent" ? "disponible" : "offline",
      progress: isManualDraft ? clampProgress(machineDraft.progress) : 0,
      currentJobName: isManualDraft ? machineDraft.currentJobName.trim() : "",
      remainingMinutes: isManualDraft ? machineDraft.remainingMinutes : 0,
      estimatedFinishAt: "",
      lastSeenAt: nowIso(),
      agentConnectionState: machineDraft.connectionType === "mock-agent" ? "connected" : "offline",
      agentMessage: "",
      notes: machineDraft.notes.trim()
    };

    setMachines((currentMachines) => [savedMachine, ...currentMachines]);
    setDiscoveredPrinters((currentPrinters) =>
      currentPrinters.filter((printer) => !machineMatchesPrinter(savedMachine, printer))
    );
    setMachineDraft(createEmptyMachineDraft());
    setMachineError("");
  }

  function updateMachine(machineId: string, patch: Partial<FabricationMachine>) {
    setMachines((currentMachines) =>
      currentMachines.map((machine) =>
        machine.id === machineId
          ? {
              ...machine,
              ...patch,
              progress: patch.progress === undefined ? machine.progress : clampProgress(Number(patch.progress)),
              lastSeenAt: nowIso()
            }
          : machine
      )
    );
  }

  function updateMachineStatus(machineId: string, status: FabricationMachineStatus) {
    setMachines((currentMachines) =>
      currentMachines.map((machine) => {
        if (machine.id !== machineId) {
          return machine;
        }

        if (!isManualMachine(machine)) {
          return machine;
        }

        return {
          ...machine,
          status,
          progress: status === "disponible" ? 0 : machine.progress,
          currentJobName: status === "disponible" ? "" : machine.currentJobName,
          remainingMinutes: status === "disponible" ? 0 : machine.remainingMinutes,
          lastSeenAt: nowIso()
        };
      })
    );
  }

  async function analyzePrinters() {
    setDiscoveryStatus("scanning");
    setDiscoveryMessage("Analizando red local...");
    setDiscoveredPrinters([]);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), discoveryTimeoutMs);

    try {
      const response = await fetch(`${agentBaseUrl}/api/discovery/bambu`, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Harv Agent respondio ${response.status}`);
      }

      const payload = (await response.json()) as {
        printers?: FabricationDiscoveryPrinter[];
        message?: string;
      };
      const printers = Array.isArray(payload.printers) ? payload.printers : [];

      setDiscoveredPrinters(printers);
      setDiscoveryStatus("ready");
      setDiscoveryMessage(payload.message ?? `${printers.length} impresora(s) detectada(s).`);
    } catch (error) {
      setDiscoveryStatus("error");
      setDiscoveryMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "Harv Agent tardo demasiado en responder."
          : error instanceof Error
          ? `Harv Agent no esta disponible: ${error.message}`
          : "Harv Agent no esta disponible."
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function loadDiscoveredPrinter(printer: FabricationDiscoveryPrinter) {
    setMachineDraft({
      ...createEmptyMachineDraft(),
      name: printer.name || `Bambu ${printer.model || "detectada"}`,
      brand: printer.brand || "Bambu Lab",
      model: printer.model || "Bambu",
      location: "Celda 3D",
      connectionType: "bambu-lan",
      agentMachineId: printer.id || printer.serial || printer.ipAddress,
      ipAddress: printer.ipAddress,
      serialNumber: printer.serial,
      status: "offline",
      loadedMaterial: "",
      supportedMaterials: "PLA, PETG, ABS",
      progress: 0,
      currentJobName: "",
      remainingMinutes: 0,
      agentConnectionState: "setup-required",
      agentMessage: "Pendiente de vincular con access code",
      notes: `Detectada por ${printer.source || "Harv Agent"}`
    });
    setMachineError("");
  }

  function upsertLinkedPrinters(printers: FabricationLinkedPrinter[]) {
    setMachines((currentMachines) => {
      const nextMachines = [...currentMachines];

      for (const printer of printers) {
        const existingIndex = nextMachines.findIndex((machine) => machineMatchesLinkedPrinter(machine, printer));
        const patch = getLinkedPrinterPatch(printer);

        if (existingIndex >= 0) {
          nextMachines[existingIndex] = normalizeMachine({
            ...nextMachines[existingIndex],
            ...patch
          });
          continue;
        }

        nextMachines.unshift(createMachineFromLinkedPrinter(printer));
      }

      return nextMachines;
    });
    setDiscoveredPrinters((currentPrinters) =>
      currentPrinters.filter((discoveryPrinter) =>
        printers.every((printer) => !linkedPrinterMatchesDiscovery(printer, discoveryPrinter))
      )
    );
  }

  function preparePrinterLink(printer: FabricationDiscoveryPrinter) {
    setPrinterLinkDraft(createLinkDraftFromPrinter(printer));
    setLinkStatus("idle");
    setLinkMessage("");
  }

  function updatePrinterLinkDraft<Key extends keyof PrinterLinkDraft>(key: Key, value: PrinterLinkDraft[Key]) {
    setPrinterLinkDraft((currentDraft) => (currentDraft ? { ...currentDraft, [key]: value } : currentDraft));
  }

  async function handlePrinterLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!printerLinkDraft) {
      return;
    }

    if (!printerLinkDraft.serial.trim()) {
      setLinkStatus("error");
      setLinkMessage("Captura el serial de la impresora.");
      return;
    }

    if (!printerLinkDraft.accessCode.trim()) {
      setLinkStatus("error");
      setLinkMessage("Captura el access code de Bambu LAN.");
      return;
    }

    if (
      machines.some(
        (machine) =>
          keysMatch(machine.ipAddress, printerLinkDraft.ipAddress) ||
          keysMatch(machine.serialNumber, printerLinkDraft.serial)
      )
    ) {
      setLinkStatus("error");
      setLinkMessage("Esa impresora ya esta agregada.");
      return;
    }

    setLinkStatus("working");
    setLinkMessage("Vinculando con Harv Agent...");

    try {
      const payload = await fetchAgentJson<{ printer: FabricationLinkedPrinter; message?: string }>("/api/printers/link", {
        method: "POST",
        body: JSON.stringify(printerLinkDraft)
      });

      upsertLinkedPrinters([payload.printer]);
      setPrinterLinkDraft(null);
      setLinkStatus("ready");
      setLinkMessage(payload.message ?? "Impresora vinculada.");
      window.setTimeout(() => {
        void refreshAgentTelemetry({ quiet: true });
      }, 1800);
    } catch (error) {
      setLinkStatus("error");
      setLinkMessage(error instanceof Error ? error.message : "No se pudo vincular la impresora.");
    }
  }

  async function refreshAgentTelemetry(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setAgentSyncStatus("working");
      setAgentSyncMessage("Sincronizando Harv Agent...");
    }

    try {
      const payload = await fetchAgentJson<{ printers?: FabricationLinkedPrinter[]; message?: string }>("/api/printers");
      const printers = Array.isArray(payload.printers) ? payload.printers : [];

      upsertLinkedPrinters(printers);
      if (!options.quiet) {
        setAgentSyncStatus("ready");
        setAgentSyncMessage(payload.message ?? `${printers.length} impresora(s) sincronizada(s).`);
      }
    } catch (error) {
      if (!options.quiet) {
        setAgentSyncStatus("error");
        setAgentSyncMessage(error instanceof Error ? error.message : "No se pudo sincronizar Harv Agent.");
      }
    }
  }

  function selectPrintableComponent(optionId: string) {
    setSelectedComponentId(optionId);

    if (optionId === "manual") {
      return;
    }

    const option = printableComponents.find((componentOption) => componentOption.id === optionId);

    if (!option) {
      return;
    }

    const printDesign = option.component.printDesigns[0];

    setJobDraft((currentDraft) => ({
      ...currentDraft,
      partName: option.component.name,
      productName: option.productName,
      componentId: option.component.id,
      quantity: option.component.quantity || currentDraft.quantity,
      unit: option.component.unit,
      material: option.component.material || currentDraft.material,
      fileName: printDesign?.fileName ?? "",
      notes: option.component.notes || currentDraft.notes
    }));
  }

  function applySuggestedMachine() {
    if (!suggestedMachine) {
      setJobError("No hay una maquina compatible disponible.");
      return;
    }

    setJobDraft((currentDraft) => ({
      ...currentDraft,
      assignedMachineId: suggestedMachine.id,
      status: "asignado"
    }));
    setJobError("");
  }

  function handleJobSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!jobDraft.partName.trim()) {
      setJobError("Captura la pieza o trabajo.");
      return;
    }

    if (jobDraft.quantity <= 0) {
      setJobError("La cantidad debe ser mayor a cero.");
      return;
    }

    if (!jobDraft.material.trim()) {
      setJobError("Captura el material requerido.");
      return;
    }

    if (!jobDraft.fileName.trim()) {
      setJobError("Selecciona el archivo de impresion.");
      return;
    }

    const savedJob: FabricationJob = {
      ...jobDraft,
      id: createId("fab-job"),
      createdAt: todayIso(),
      orderReference: jobDraft.orderReference.trim(),
      partName: jobDraft.partName.trim(),
      productName: jobDraft.productName.trim(),
      material: jobDraft.material.trim(),
      estimatedHours: Number(jobDraft.estimatedHours),
      assignedMachineId: jobDraft.assignedMachineId,
      dispatchMode: jobDraft.dispatchMode,
      status: jobDraft.assignedMachineId ? "asignado" : "listo",
      fileName: jobDraft.fileName.trim(),
      notes: jobDraft.notes.trim()
    };

    setJobs((currentJobs) => [savedJob, ...currentJobs]);
    setJobDraft(createEmptyJobDraft());
    setSelectedComponentId("manual");
    setJobError("");
  }

  function generateSalesFabricationQueue() {
    const latestSalesOrders = loadStoredSalesOrders();
    const result = createFabricationJobsFromSales({
      products,
      salesOrders: latestSalesOrders,
      machines,
      existingJobs: jobs
    });
    const totalPieces = result.jobsToCreate.reduce((total, job) => total + Number(job.quantity || 0), 0);
    const blockedJobs = result.jobsToCreate.filter((job) => job.status === "bloqueado").length;

    setSalesOrders(latestSalesOrders);

    if (result.jobsToCreate.length === 0) {
      setAutoQueueMessage(
        result.summary.requirements > 0
          ? "No hay trabajos nuevos; la demanda de impresion ya esta en cola."
          : "No hay piezas 3D pendientes en ordenes aprobadas de Ventas."
      );
      return;
    }

    setJobs((currentJobs) => [...result.jobsToCreate, ...currentJobs]);
    setAutoQueueMessage(
      `Se agregaron ${result.jobsToCreate.length} trabajo(s), ${totalPieces} pieza(s) 3D.` +
        (blockedJobs > 0 ? ` ${blockedJobs} quedaron bloqueado(s) por datos faltantes.` : "")
    );
  }

  function updateJob(jobId: string, patch: Partial<FabricationJob>) {
    setJobs((currentJobs) => currentJobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  }

  function assignSuggestedMachine(job: FabricationJob) {
    const suggestedJobMachine = recommendMachine(job, machines);

    if (!suggestedJobMachine) {
      return;
    }

    updateJob(job.id, {
      assignedMachineId: suggestedJobMachine.id,
      status: isJobReadyForPrint(job) ? "asignado" : job.status
    });
  }

  function markJobReady(job: FabricationJob) {
    if (!isJobReadyForPrint(job)) {
      return;
    }

    updateJob(job.id, {
      status: job.assignedMachineId ? "asignado" : "listo"
    });
  }

  function prepareJobDispatch(job: FabricationJob) {
    if (!isJobReadyForPrint(job)) {
      return;
    }

    const machineId = job.assignedMachineId || recommendMachine(job, machines)?.id || "";

    updateJob(job.id, {
      assignedMachineId: machineId,
      status: machineId ? "enviado" : "listo"
    });
  }

  function refreshMockTelemetry() {
    setMachines((currentMachines) =>
      currentMachines.map((machine) => {
        if (machine.connectionType !== "mock-agent") {
          return {
            ...machine,
            lastSeenAt: nowIso()
          };
        }

        if (machine.status !== "imprimiendo") {
          return {
            ...machine,
            nozzleTemp: machine.status === "disponible" ? 28 : machine.nozzleTemp,
            bedTemp: machine.status === "disponible" ? 30 : machine.bedTemp,
            lastSeenAt: nowIso()
          };
        }

        const progress = clampProgress(machine.progress + 8);
        const isFinished = progress >= 100;

        return {
          ...machine,
          status: isFinished ? "disponible" : machine.status,
          progress: isFinished ? 0 : progress,
          currentJobName: isFinished ? "" : machine.currentJobName,
          remainingMinutes: isFinished ? 0 : Math.max(machine.remainingMinutes - 8, 0),
          nozzleTemp: isFinished ? 32 : machine.nozzleTemp,
          bedTemp: isFinished ? 34 : machine.bedTemp,
          lastSeenAt: nowIso()
        };
      })
    );
  }

  function refreshAllTelemetry() {
    refreshMockTelemetry();
    void refreshAgentTelemetry();
  }

  function startJob(job: FabricationJob) {
    const assignedMachine = machines.find((machine) => machine.id === job.assignedMachineId);

    if (!assignedMachine || assignedMachine.connectionType === "bambu-lan") {
      return;
    }

    updateJob(job.id, { status: "imprimiendo" });
    updateMachine(job.assignedMachineId, {
      status: "imprimiendo",
      currentJobName: job.partName,
      progress: 1,
      remainingMinutes: Math.max(Math.round(job.estimatedHours * 60), 15)
    });
  }

  function canStartJob(job: FabricationJob) {
    const assignedMachine = machines.find((machine) => machine.id === job.assignedMachineId);

    return Boolean(
      assignedMachine &&
        assignedMachine.connectionType !== "bambu-lan" &&
        job.status !== "imprimiendo" &&
        job.status !== "terminado" &&
        job.status !== "bloqueado" &&
        job.status !== "cancelado"
    );
  }

  return (
    <main className="profile-screen fabrication-profile-screen">
      {!embedded && <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span className="screen-icon fabrication-screen-icon" aria-hidden="true">
            <Factory size={22} />
          </span>
          <h1>Fabricacion</h1>
        </div>
      </header>}

      <section className="fabrication-body">
        <section className="fabrication-command-panel">
          <div>
            <span className="section-kicker">Impresion 3D</span>
          </div>
          <div className="fabrication-command-actions">
            <button className="primary-button" disabled={discoveryStatus === "scanning"} onClick={analyzePrinters} type="button">
              <Radar size={17} />
              {discoveryStatus === "scanning" ? "Analizando..." : "Analizar impresoras 3D"}
            </button>
            <button className="secondary-button" disabled={agentSyncStatus === "working"} onClick={refreshAllTelemetry} type="button">
              <RefreshCw size={17} />
              {agentSyncStatus === "working" ? "Sincronizando..." : "Actualizar estados"}
            </button>
          </div>
        </section>

        {agentSyncStatus !== "idle" ? (
          <section className={`fabrication-agent-status-panel ${agentSyncStatus}`}>
            <Radio size={17} aria-hidden="true" />
            <span>{agentSyncMessage}</span>
          </section>
        ) : null}

        {discoveryStatus !== "idle" ? (
          <section className={`fabrication-discovery-panel ${discoveryStatus}`}>
            <div className="fabrication-discovery-header">
              <div>
                <span className="section-kicker">Discovery</span>
                <strong>{discoveryMessage}</strong>
              </div>
              <span>{visibleDiscoveredPrinters.length} pendientes</span>
            </div>

            {visibleDiscoveredPrinters.length > 0 ? (
              <div className="fabrication-discovery-list">
                {visibleDiscoveredPrinters.map((printer) => (
                  <article className="fabrication-discovery-row" key={printer.id}>
                    <div>
                      <strong>{printer.name || "Bambu detectada"}</strong>
                      <span>{[printer.ipAddress, printer.model].filter(Boolean).join(" / ")}</span>
                    </div>
                    <button className="secondary-button compact-button" onClick={() => loadDiscoveredPrinter(printer)} type="button">
                      Manual
                    </button>
                    <button className="primary-button compact-button" onClick={() => preparePrinterLink(printer)} type="button">
                      <Link2 size={15} />
                      Vincular
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            {discoveredPrinters.length > 0 && visibleDiscoveredPrinters.length === 0 ? (
              <p className="fabrication-form-note">Todas las impresoras detectadas ya estan agregadas.</p>
            ) : null}
          </section>
        ) : null}

        {printerLinkDraft ? (
          <form className={`fabrication-link-panel ${linkStatus}`} onSubmit={handlePrinterLinkSubmit}>
            <div className="fabrication-link-heading">
              <div>
                <span className="section-kicker">Bambu LAN</span>
                <strong>{printerLinkDraft.name || printerLinkDraft.ipAddress}</strong>
              </div>
              <button className="secondary-button compact-button" onClick={() => setPrinterLinkDraft(null)} type="button">
                Cancelar
              </button>
            </div>

            <div className="form-grid two-columns">
              <label className="field">
                <span>Alias</span>
                <input value={printerLinkDraft.name} onChange={(event) => updatePrinterLinkDraft("name", event.target.value)} />
              </label>

              <label className="field">
                <span>Ubicacion</span>
                <input
                  value={printerLinkDraft.location}
                  onChange={(event) => updatePrinterLinkDraft("location", event.target.value)}
                />
              </label>

              <label className="field">
                <span>IP local</span>
                <input
                  value={printerLinkDraft.ipAddress}
                  onChange={(event) => updatePrinterLinkDraft("ipAddress", event.target.value)}
                />
              </label>

              <label className="field">
                <span>Serial</span>
                <input value={printerLinkDraft.serial} onChange={(event) => updatePrinterLinkDraft("serial", event.target.value)} />
              </label>

              <label className="field">
                <span>Modelo</span>
                <input value={printerLinkDraft.model} onChange={(event) => updatePrinterLinkDraft("model", event.target.value)} />
              </label>

              <label className="field">
                <span>Access code</span>
                <input
                  type="password"
                  value={printerLinkDraft.accessCode}
                  onChange={(event) => updatePrinterLinkDraft("accessCode", event.target.value)}
                />
              </label>
            </div>

            {linkMessage ? <p className={linkStatus === "error" ? "form-error" : "fabrication-form-note"}>{linkMessage}</p> : null}

            <button className="primary-button input-height-button" disabled={linkStatus === "working"} type="submit">
              <Link2 size={17} />
              {linkStatus === "working" ? "Vinculando..." : "Vincular impresora"}
            </button>
          </form>
        ) : linkMessage && linkStatus === "ready" ? (
          <section className="fabrication-agent-status-panel ready">
            <Link2 size={17} aria-hidden="true" />
            <span>{linkMessage}</span>
          </section>
        ) : null}

        <section className="fabrication-stat-grid" aria-label="Resumen de fabricacion">
          <article>
            <Printer size={20} aria-hidden="true" />
            <span>Maquinas</span>
            <strong>{stats.machines}</strong>
          </article>
          <article>
            <Gauge size={20} aria-hidden="true" />
            <span>Disponibles</span>
            <strong>{stats.available}</strong>
          </article>
          <article>
            <Activity size={20} aria-hidden="true" />
            <span>Imprimiendo</span>
            <strong>{stats.printing}</strong>
          </article>
          <article>
            <Clock3 size={20} aria-hidden="true" />
            <span>Trabajos abiertos</span>
            <strong>{stats.pendingJobs}</strong>
          </article>
        </section>

        <div className="fabrication-layout">
          <section className="main-panel fabrication-machine-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Maquinas</h2>
                <p>Registra impresoras y controla el estado operativo de cada una.</p>
              </div>
            </div>

            <form className="fabrication-machine-form" onSubmit={handleMachineSubmit}>
              <div className="form-grid two-columns">
                <label className="field">
                  <span>Nombre</span>
                  <input
                    value={machineDraft.name}
                    onChange={(event) => updateMachineDraft("name", event.target.value)}
                    placeholder="Ej. Bambu P1S 02"
                  />
                </label>

                <label className="field">
                  <span>Tipo</span>
                  <select
                    value={machineDraft.type}
                    onChange={(event) => updateMachineDraft("type", event.target.value as FabricationMachine["type"])}
                  >
                    {Object.entries(fabricationMachineTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Marca</span>
                  <input value={machineDraft.brand} onChange={(event) => updateMachineDraft("brand", event.target.value)} />
                </label>

                <label className="field">
                  <span>Modelo</span>
                  <input value={machineDraft.model} onChange={(event) => updateMachineDraft("model", event.target.value)} />
                </label>

                <label className="field">
                  <span>Ubicacion</span>
                  <input
                    value={machineDraft.location}
                    onChange={(event) => updateMachineDraft("location", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Conexion</span>
                  <select
                    value={machineDraft.connectionType}
                    onChange={(event) =>
                      updateMachineDraft("connectionType", event.target.value as FabricationConnectionType)
                    }
                  >
                    {Object.entries(fabricationConnectionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>ID agente</span>
                  <input
                    value={machineDraft.agentMachineId}
                    onChange={(event) => updateMachineDraft("agentMachineId", event.target.value)}
                    placeholder="Ej. bambu-p1s-02"
                  />
                </label>

                <label className="field">
                  <span>IP local</span>
                  <input
                    value={machineDraft.ipAddress}
                    onChange={(event) => updateMachineDraft("ipAddress", event.target.value)}
                    placeholder="Ej. 192.168.1.45"
                  />
                </label>

                <label className="field">
                  <span>Serial</span>
                  <input
                    value={machineDraft.serialNumber}
                    onChange={(event) => updateMachineDraft("serialNumber", event.target.value)}
                    placeholder="Ej. 01S00..."
                  />
                </label>

                <label className="field">
                  <span>Material cargado</span>
                  <input
                    value={machineDraft.loadedMaterial}
                    onChange={(event) => updateMachineDraft("loadedMaterial", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Materiales soportados</span>
                  <input
                    value={machineDraft.supportedMaterials}
                    onChange={(event) => updateMachineDraft("supportedMaterials", event.target.value)}
                    placeholder="PLA, PETG, ABS"
                  />
                </label>

                {isManualMachine(machineDraft) ? (
                  <>
                    <label className="field">
                      <span>Estado</span>
                      <select
                        value={machineDraft.status}
                        onChange={(event) =>
                          updateMachineDraft("status", event.target.value as FabricationMachineStatus)
                        }
                      >
                        {Object.entries(fabricationMachineStatusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Progreso</span>
                      <input
                        min="0"
                        max="100"
                        type="number"
                        value={machineDraft.progress}
                        onChange={(event) => updateMachineDraft("progress", Number(event.target.value))}
                      />
                    </label>
                  </>
                ) : null}
              </div>

              {machineError ? <p className="form-error">{machineError}</p> : null}

              <button className="primary-button input-height-button" type="submit">
                <Plus size={17} />
                Agregar maquina
              </button>
            </form>

            <label className="search-field client-search">
              <Search size={18} aria-hidden="true" />
              <input
                value={machineQuery}
                onChange={(event) => setMachineQuery(event.target.value)}
                placeholder="Buscar maquina, material o ubicacion"
              />
            </label>

            <div className="fabrication-machine-list">
              {filteredMachines.map((machine) => (
                <article className="fabrication-machine-card" key={machine.id}>
                  <div className="fabrication-machine-card-header">
                    <div className="fabrication-machine-title">
                      <Printer size={18} aria-hidden="true" />
                      <div>
                        <strong>{machine.name}</strong>
                        <span>
                          {machine.brand} / {machine.model}
                        </span>
                      </div>
                    </div>
                    <span className={`status-pill ${machine.status}`}>{fabricationMachineStatusLabels[machine.status]}</span>
                  </div>

                  <div
                    className="fabrication-progress"
                    style={{ "--progress": `${machine.progress}%` } as CSSProperties}
                    aria-label={`Progreso ${machine.progress}%`}
                  >
                    <span />
                  </div>

                  <dl className="fabrication-machine-meta">
                    <div>
                      <dt>Material</dt>
                      <dd>{machine.loadedMaterial || "Sin material"}</dd>
                    </div>
                    <div>
                      <dt>Progreso</dt>
                      <dd>{machine.progress}%</dd>
                    </div>
                    <div>
                      <dt>Restante</dt>
                      <dd>{formatMinutes(machine.remainingMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Temp</dt>
                      <dd>
                        {machine.nozzleTemp}C / {machine.bedTemp}C
                      </dd>
                    </div>
                  </dl>

                  {machine.currentJobName ? <p className="fabrication-current-job">{machine.currentJobName}</p> : null}
                  {!isManualMachine(machine) &&
                  machine.agentMessage &&
                  (machine.agentConnectionState === "error" || machine.status === "error") ? (
                    <p className="fabrication-agent-message">{machine.agentMessage}</p>
                  ) : null}
                  {machine.materialSlots.length > 0 ? (
                    <div className="fabrication-material-slots" aria-label="Materiales cargados">
                      {machine.materialSlots.slice(0, 6).map((slot) => (
                        <span key={`${machine.id}-${slot.slot}-${slot.material}`}>
                          {slot.color ? <i style={{ background: slot.color }} aria-hidden="true" /> : null}
                          {slot.slot}: {slot.material}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {isManualMachine(machine) ? (
                    <div className="fabrication-card-controls">
                      <label className="field">
                        <span>Estado</span>
                        <select
                          value={machine.status}
                          onChange={(event) =>
                            updateMachineStatus(machine.id, event.target.value as FabricationMachineStatus)
                          }
                        >
                          {Object.entries(fabricationMachineStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Progreso</span>
                        <input
                          min="0"
                          max="100"
                          type="number"
                          value={machine.progress}
                          onChange={(event) => updateMachine(machine.id, { progress: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  ) : (
                    null
                  )}
                </article>
              ))}

              {machines.length === 0 ? <p className="empty-state">Todavia no hay maquinas registradas.</p> : null}
              {machines.length > 0 && filteredMachines.length === 0 ? (
                <p className="empty-state">No hay maquinas con esa busqueda.</p>
              ) : null}
            </div>
          </section>

          <section className="main-panel fabrication-queue-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Cola de fabricacion</h2>
                <p>Piezas pendientes, prioridad, material y maquina sugerida.</p>
              </div>
            </div>

            <section className="fabrication-auto-queue-panel">
              <div className="fabrication-auto-queue-heading">
                <div>
                  <span className="section-kicker">Desde Ventas</span>
                  <strong>Demanda automatica de impresion</strong>
                </div>
                <div className="fabrication-auto-queue-actions">
                  <button className="secondary-button compact-button" onClick={refreshSalesQueuePreview} type="button">
                    <RefreshCw size={15} />
                    Actualizar
                  </button>
                  <button
                    className="primary-button compact-button"
                    disabled={salesQueuePreview.summary.newJobs === 0}
                    onClick={generateSalesFabricationQueue}
                    type="button"
                  >
                    <Plus size={15} />
                    Generar cola
                  </button>
                </div>
              </div>

              <div className="fabrication-auto-queue-metrics">
                <article>
                  <span>Ordenes</span>
                  <strong>{salesQueuePreview.summary.approvedOrders}</strong>
                </article>
                <article>
                  <span>Piezas 3D</span>
                  <strong>{salesQueuePreview.summary.totalPieces}</strong>
                </article>
                <article>
                  <span>Por generar</span>
                  <strong>{salesQueuePreview.summary.newJobs}</strong>
                </article>
                <article>
                  <span>En cola</span>
                  <strong>{salesQueuePreview.summary.existingJobs}</strong>
                </article>
                <article>
                  <span>Bloqueos</span>
                  <strong>{salesQueuePreview.summary.blockedJobs}</strong>
                </article>
              </div>

              {autoQueueMessage ? <p className="fabrication-form-note">{autoQueueMessage}</p> : null}
            </section>

            <form className="fabrication-job-form" onSubmit={handleJobSubmit}>
              <label className="field wide-field">
                <span>Usar pieza 3D de productos</span>
                <select value={selectedComponentId} onChange={(event) => selectPrintableComponent(event.target.value)}>
                  <option value="manual">Captura manual</option>
                  {printableComponents.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.component.name} / {option.productName || option.productSku}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-grid two-columns">
                <label className="field">
                  <span>Orden origen</span>
                  <input
                    value={jobDraft.orderReference}
                    onChange={(event) => updateJobDraft("orderReference", event.target.value)}
                    placeholder="Ej. OP-0001"
                  />
                </label>

                <label className="field">
                  <span>Pieza o trabajo</span>
                  <input
                    value={jobDraft.partName}
                    onChange={(event) => updateJobDraft("partName", event.target.value)}
                    placeholder="Ej. Base de motor"
                  />
                </label>

                <label className="field">
                  <span>Material</span>
                  <input value={jobDraft.material} onChange={(event) => updateJobDraft("material", event.target.value)} />
                </label>

                <label className="field">
                  <span>Cantidad</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={jobDraft.quantity}
                    onChange={(event) => updateJobDraft("quantity", Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span>Unidad</span>
                  <select value={jobDraft.unit} onChange={(event) => updateJobDraft("unit", event.target.value as ProductUnit)}>
                    <option value="pieza">Pieza</option>
                    <option value="metro">Metro</option>
                    <option value="kg">Kg</option>
                    <option value="set">Set</option>
                  </select>
                </label>

                <label className="field">
                  <span>Prioridad</span>
                  <select
                    value={jobDraft.priority}
                    onChange={(event) => updateJobDraft("priority", event.target.value as FabricationJob["priority"])}
                  >
                    {Object.entries(fabricationPriorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Fecha requerida</span>
                  <input
                    type="date"
                    value={jobDraft.requiredDate}
                    onChange={(event) => updateJobDraft("requiredDate", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Horas estimadas</span>
                  <input
                    min="0"
                    step="0.25"
                    type="number"
                    value={jobDraft.estimatedHours}
                    onChange={(event) => updateJobDraft("estimatedHours", Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span>Despacho</span>
                  <select
                    value={jobDraft.dispatchMode}
                    onChange={(event) => updateJobDraft("dispatchMode", event.target.value as FabricationDispatchMode)}
                  >
                    {Object.entries(fabricationDispatchModeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Impresora</span>
                  <select
                    value={jobDraft.assignedMachineId}
                    onChange={(event) => updateJobDraft("assignedMachineId", event.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {machines.map((machine) => (
                      <option key={machine.id} value={machine.id}>
                        {machine.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {suggestedMachine ? (
                <div className="fabrication-suggestion">
                  <Printer size={16} aria-hidden="true" />
                  <span>{suggestedMachine.name}</span>
                  <button className="secondary-button compact-button" onClick={applySuggestedMachine} type="button">
                    Usar sugerida
                  </button>
                </div>
              ) : null}

              <label className="field wide-field">
                <span>Archivo de impresion</span>
                <input type="file" accept=".3mf,.stl,.gcode,.gcode.3mf" onChange={(event) => updateJobFile(event.target.files?.[0] ?? null)} />
              </label>

              {jobDraft.fileName ? (
                <div className="fabrication-selected-file">
                  <FileUp size={16} aria-hidden="true" />
                  <span>{jobDraft.fileName}</span>
                </div>
              ) : null}

              <label className="field wide-field">
                <span>Notas</span>
                <textarea
                  value={jobDraft.notes}
                  onChange={(event) => updateJobDraft("notes", event.target.value)}
                  placeholder="Indicaciones, color, restricciones o revision pendiente"
                />
              </label>

              {jobError ? <p className="form-error">{jobError}</p> : null}

              <button className="primary-button input-height-button" type="submit">
                <Plus size={17} />
                Agregar trabajo
              </button>
            </form>

            <label className="search-field client-search">
              <Search size={18} aria-hidden="true" />
              <input
                value={jobQuery}
                onChange={(event) => setJobQuery(event.target.value)}
                placeholder="Buscar pieza, material o maquina"
              />
            </label>

            <div className="fabrication-queue-groups">
              {queueGroups.map((group) => (
                <section className="fabrication-queue-group" key={group.id}>
                  <div className="fabrication-queue-group-header">
                    <strong>{group.title}</strong>
                    <span>{group.jobs.length}</span>
                  </div>

                  <div className="fabrication-job-list">
                    {group.jobs.map((job) => {
                      const rowSuggestedMachine = job.assignedMachineId
                        ? machines.find((machine) => machine.id === job.assignedMachineId)
                        : recommendMachine(job, machines);
                      const readyForPrint = isJobReadyForPrint(job);

                      return (
                        <article className="fabrication-job-row" key={job.id}>
                          <div className="fabrication-job-main">
                            <strong>{job.partName}</strong>
                            <span>{job.orderReference || job.productName || "Sin orden origen"}</span>
                          </div>

                          <div className="fabrication-job-file">
                            <FileUp size={15} aria-hidden="true" />
                            <span>{job.fileName}</span>
                          </div>

                          <div className="fabrication-job-stat">
                            <span>Material</span>
                            <strong>{job.material || "Sin material"}</strong>
                          </div>

                          <div className="fabrication-job-stat">
                            <span>Cantidad</span>
                            <strong>
                              {job.quantity} {job.unit}
                            </strong>
                          </div>

                          <div className="fabrication-job-stat">
                            <span>Impresora</span>
                            <strong>{rowSuggestedMachine?.name ?? "Auto"}</strong>
                          </div>

                          <span className={`status-pill ${job.status}`}>{fabricationJobStatusLabels[job.status]}</span>

                          <div className="fabrication-job-actions">
                            <select
                              value={job.status}
                              onChange={(event) => updateJob(job.id, { status: event.target.value as FabricationJobStatus })}
                              aria-label="Cambiar estado de trabajo"
                            >
                              {Object.entries(fabricationJobStatusLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <button
                              className="secondary-button compact-button"
                              disabled={Boolean(job.assignedMachineId) || !rowSuggestedMachine}
                              onClick={() => assignSuggestedMachine(job)}
                              type="button"
                            >
                              <CheckCircle2 size={15} />
                              Asignar
                            </button>
                            <button
                              className="secondary-button compact-button"
                              disabled={!readyForPrint || job.status === "listo" || job.status === "asignado"}
                              onClick={() => markJobReady(job)}
                              type="button"
                            >
                              Listo
                            </button>
                            <button
                              className="secondary-button compact-button"
                              disabled={!readyForPrint || job.status === "enviado" || job.status === "imprimiendo"}
                              onClick={() => prepareJobDispatch(job)}
                              type="button"
                            >
                              Preparar
                            </button>
                            <button
                              className="secondary-button compact-button"
                              disabled={!canStartJob(job)}
                              onClick={() => startJob(job)}
                              type="button"
                            >
                              <Play size={15} />
                              Iniciar
                            </button>
                          </div>
                        </article>
                      );
                    })}

                    {jobs.length > 0 && filteredJobs.length > 0 && group.jobs.length === 0 ? (
                      <p className="empty-state">{group.empty}</p>
                    ) : null}
                  </div>
                </section>
              ))}

              {jobs.length === 0 ? <p className="empty-state">Todavia no hay trabajos en cola.</p> : null}
              {jobs.length > 0 && filteredJobs.length === 0 ? <p className="empty-state">No hay trabajos con esa busqueda.</p> : null}
            </div>
          </section>
        </div>

      </section>
    </main>
  );
}
