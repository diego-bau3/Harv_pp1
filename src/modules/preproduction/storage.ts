import type { Product } from "../sales/types";
import type { PreproductionResource, PreproductionRoute } from "./types";
import { getDefaultPreproductionRequiredArea, normalizeStepSequence, nowIso, preproductionId } from "./utils";

export const preproductionRoutesStorageKey = "harv:preproduction-routes:v1";

export function getDefaultPreproductionProductId(products: Product[]) {
  return products[0]?.id ?? "";
}

function normalizeResources(resources: unknown): PreproductionResource[] {
  if (!Array.isArray(resources)) {
    return [];
  }

  return resources.map((resource) => {
    const currentResource = resource as Partial<PreproductionResource>;

    return {
      id: currentResource.id ?? preproductionId("pre-resource"),
      supplyId: currentResource.supplyId ?? "",
      name: currentResource.name ?? "",
      quantity: Number(currentResource.quantity ?? 1),
      unit: currentResource.unit ?? "pieza",
      notes: currentResource.notes ?? ""
    };
  });
}

export function normalizePreproductionRoute(route: Partial<PreproductionRoute>, productId: string): PreproductionRoute {
  const steps = Array.isArray(route.steps) ? route.steps : [];

  return {
    id: route.id ?? preproductionId("pre-route"),
    productId: route.productId ?? productId,
    status: route.status ?? "borrador",
    steps: normalizeStepSequence(
      steps.map((step, index) => ({
        id: step.id ?? preproductionId("pre-step"),
        sequence: step.sequence ?? index + 1,
        isKittingStep: step.isKittingStep ?? false,
        name: step.name ?? "",
        processType: step.processType ?? "ensamble",
        station: step.station ?? getDefaultPreproductionRequiredArea(step.processType ?? "ensamble"),
        estimatedMinutes: Number(step.estimatedMinutes ?? 1),
        outputName: step.outputName ?? "",
        outputQuantity: Number(step.outputQuantity ?? (step.outputName ? 1 : 0)),
        outputUnit: step.outputUnit ?? "subensamble",
        instructions: step.instructions ?? "",
        kittingComponents: Array.isArray(step.kittingComponents) ? step.kittingComponents : [],
        componentUses: Array.isArray(step.componentUses) ? step.componentUses : [],
        subassemblyUses: Array.isArray(step.subassemblyUses) ? step.subassemblyUses : [],
        tools: normalizeResources(step.tools),
        consumables: normalizeResources(step.consumables)
      }))
    ),
    updatedAt: route.updatedAt ?? nowIso()
  };
}

function isSampleRoute(route: PreproductionRoute) {
  return route.id.toLowerCase().includes("sample") || route.productId === "product-so101";
}

export function loadStoredPreproductionRoutes(products: Product[]) {
  try {
    const storedRoutes = window.localStorage.getItem(preproductionRoutesStorageKey);

    if (!storedRoutes) {
      return [];
    }

    const allowedProductIds = new Set(products.map((product) => product.id));
    const parsedRoutes = JSON.parse(storedRoutes);

    return Array.isArray(parsedRoutes)
      ? parsedRoutes
          .map((route) => normalizePreproductionRoute(route, getDefaultPreproductionProductId(products)))
          .filter((route) => allowedProductIds.has(route.productId) && !isSampleRoute(route))
      : [];
  } catch {
    return [];
  }
}

export function saveStoredPreproductionRoutes(routes: PreproductionRoute[]) {
  try {
    window.localStorage.setItem(preproductionRoutesStorageKey, JSON.stringify(routes.filter((route) => !isSampleRoute(route))));
  } catch {
    return;
  }
}
