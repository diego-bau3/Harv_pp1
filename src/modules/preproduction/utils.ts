import type {
  PreproductionProcessType,
  PreproductionResource,
  PreproductionRoute,
  PreproductionRouteStatus,
  PreproductionStep,
  PreproductionStepDraft
} from "./types";

export const preproductionProcessLabels: Record<PreproductionProcessType, string> = {
  kitting: "Kitting / Recolección",
  preparacion: "Preparación",
  ensamble: "Ensamble",
  fabricacion: "Fabricación",
  "impresion-3d": "Impresión 3D",
  inspeccion: "Inspección",
  prueba: "Prueba",
  empaque: "Empaque"
};

export const preproductionRouteStatusLabels: Record<PreproductionRouteStatus, string> = {
  borrador: "Borrador",
  "en-revision": "En revisión",
  liberada: "Liberada"
};

export const preproductionRequiredAreaOptions = [
  "Almacén / Kitting",
  "Impresión 3D",
  "CNC / Maquinado",
  "Fabricación manual",
  "Ensamble",
  "Calidad / Inspección",
  "Prueba funcional",
  "Empaque"
] as const;

const defaultPreproductionRequiredAreaByProcess: Record<PreproductionProcessType, string> = {
  kitting: "Almacén / Kitting",
  preparacion: "Fabricación manual",
  ensamble: "Ensamble",
  fabricacion: "Fabricación manual",
  "impresion-3d": "Impresión 3D",
  inspeccion: "Calidad / Inspección",
  prueba: "Prueba funcional",
  empaque: "Empaque"
};

export function getDefaultPreproductionRequiredArea(processType: PreproductionProcessType) {
  return defaultPreproductionRequiredAreaByProcess[processType] ?? "Ensamble";
}

export function getPreproductionRequiredAreaOptions(currentArea = "") {
  const normalizedCurrentArea = currentArea.trim();
  const baseOptions = Array.from(preproductionRequiredAreaOptions);

  if (normalizedCurrentArea && !baseOptions.includes(normalizedCurrentArea as (typeof preproductionRequiredAreaOptions)[number])) {
    return [normalizedCurrentArea, ...baseOptions];
  }

  return baseOptions;
}

export const emptyPreproductionStepDraft: PreproductionStepDraft = {
  isKittingStep: false,
  name: "",
  processType: "ensamble",
  station: getDefaultPreproductionRequiredArea("ensamble"),
  estimatedMinutes: 1,
  outputName: "",
  outputQuantity: 1,
  outputUnit: "subensamble",
  instructions: "",
  kittingComponents: [],
  componentUses: [],
  subassemblyUses: [],
  tools: [],
  consumables: []
};

export function preproductionId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createEmptyRoute(productId: string): PreproductionRoute {
  return {
    id: preproductionId("pre-route"),
    productId,
    status: "borrador",
    steps: [],
    updatedAt: nowIso()
  };
}

export function normalizeStepSequence(steps: PreproductionStep[]) {
  return steps.map((step, index) => ({
    ...step,
    sequence: index + 1
  }));
}

export function routeTotalMinutes(route: PreproductionRoute) {
  return route.steps.reduce((total, step) => total + Number(step.estimatedMinutes || 0), 0);
}

export function summarizeRouteMinutesByStation(route: PreproductionRoute) {
  const stationMap = new Map<string, number>();

  route.steps.forEach((step) => {
    const station = step.station || "Sin área definida";
    stationMap.set(station, (stationMap.get(station) ?? 0) + Number(step.estimatedMinutes || 0));
  });

  return Array.from(stationMap.entries()).map(([station, minutes]) => ({ station, minutes }));
}

export function summarizeRouteMinutesByProcess(route: PreproductionRoute) {
  const processMap = new Map<PreproductionProcessType, number>();

  route.steps.forEach((step) => {
    processMap.set(step.processType, (processMap.get(step.processType) ?? 0) + Number(step.estimatedMinutes || 0));
  });

  return Array.from(processMap.entries()).map(([processType, minutes]) => ({ processType, minutes }));
}

function resourceKey(resource: PreproductionResource) {
  return `${resource.name.trim().toLowerCase()}:${resource.unit.trim().toLowerCase()}`;
}

function addResourceToMap(resourceMap: Map<string, PreproductionResource>, resource: PreproductionResource) {
  const key = resourceKey(resource);
  const currentResource = resourceMap.get(key);

  if (!currentResource) {
    resourceMap.set(key, { ...resource });
    return;
  }

  resourceMap.set(key, {
    ...currentResource,
    quantity: currentResource.quantity + resource.quantity,
    notes: [currentResource.notes, resource.notes].filter(Boolean).join(" / ")
  });
}

export function summarizeRouteResourcesByStation(route: PreproductionRoute) {
  const stationMap = new Map<
    string,
    {
      station: string;
      tools: Map<string, PreproductionResource>;
      consumables: Map<string, PreproductionResource>;
    }
  >();

  route.steps.forEach((step) => {
    const station = step.station || "Sin área definida";
    const stationSummary =
      stationMap.get(station) ??
      {
        station,
        tools: new Map<string, PreproductionResource>(),
        consumables: new Map<string, PreproductionResource>()
      };

    step.tools.forEach((tool) => addResourceToMap(stationSummary.tools, tool));
    step.consumables.forEach((consumable) => addResourceToMap(stationSummary.consumables, consumable));
    stationMap.set(station, stationSummary);
  });

  return Array.from(stationMap.values()).map((summary) => ({
    station: summary.station,
    tools: Array.from(summary.tools.values()),
    consumables: Array.from(summary.consumables.values())
  }));
}

export function formatRouteMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}
