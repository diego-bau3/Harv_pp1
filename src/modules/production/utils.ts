import type { Client, Priority, Product, ProductComponent, SalesOrder } from "../sales/types";
import {
  createId,
  priorityLabels,
  salesClientsStorageKey,
  salesGeneratedOrdersStorageKey,
  todayIso
} from "../sales/utils";
import { preproductionRoutesStorageKey } from "../preproduction/storage";
import type { PreproductionRoute, PreproductionStep } from "../preproduction/types";
import type { WarehouseEntry } from "../warehouse/types";
import type {
  ProductionGeneratedPlan,
  ProductionIssueSeverity,
  ProductionOptimizationSummary,
  ProductionPendingOrder,
  ProductionPendingOrderStatus,
  ProductionPendingQueue,
  ProductionPickupGroup,
  ProductionPlanBlock,
  ProductionPlanIssue,
  ProductionPlannerSummary,
  ProductionPlanningContext,
  ProductionPlanStrategy,
  ProductionRecommendation,
  ProductionShiftSettings
} from "./types";

export const productionPlanStrategyLabels: Record<ProductionPlanStrategy, string> = {
  "agrupar-producto": "Agrupar por producto",
  "agrupar-recoleccion": "Agrupar recolección",
  "fecha-prioridad": "Fecha y prioridad",
  "optimizar-turno": "Optimización automática"
};

export const productionPendingOrderStatusLabels: Record<ProductionPendingOrderStatus, string> = {
  bloqueada: "Bloqueada",
  lista: "Lista",
  riesgo: "En riesgo"
};

export const productionIssueSeverityLabels: Record<ProductionIssueSeverity, string> = {
  aviso: "Aviso",
  bloqueo: "Bloqueo",
  riesgo: "Riesgo"
};

const warehouseEntriesStorageKey = "harv:warehouse-entries:v2";
export const productionLatestPlanStorageKey = "harv:production-latest-plan:v1";

const priorityWeight: Record<Priority, number> = {
  alta: 3,
  critica: 4,
  normal: 1,
  urgente: 5
};

const assemblyProcessTypes = new Set(["ensamble", "preparacion", "fabricacion", "impresion-3d"]);
const qualityProcessTypes = new Set(["inspeccion", "prueba"]);

export function productionId(prefix: string) {
  return createId(prefix);
}

export function nowIso() {
  return new Date().toISOString();
}

export function createDefaultShiftSettings(): ProductionShiftSettings {
  return {
    planDate: todayIso(),
    shiftStart: "08:00",
    shiftEnd: "17:00",
    peopleAvailable: 4,
    assemblyStations: 2,
    qualityStations: 1,
    strategy: "optimizar-turno"
  };
}

export function loadProductionPlanningContext(): ProductionPlanningContext {
  return {
    routes: loadStoredList<PreproductionRoute>(preproductionRoutesStorageKey, []),
    warehouseEntries: loadStoredList<WarehouseEntry>(warehouseEntriesStorageKey, [])
  };
}

export function createProductionPendingQueue(products: Product[], planDate = todayIso()): ProductionPendingQueue {
  const salesOrders = loadStoredList<SalesOrder>(salesGeneratedOrdersStorageKey, []);
  const clients = loadStoredList<Client>(salesClientsStorageKey, []);
  const salesPendingOrders = createPendingOrdersFromSales(salesOrders, clients, products, planDate);

  if (salesPendingOrders.length > 0) {
    return {
      source: "ventas",
      sourceLabel: "Órdenes aprobadas de Ventas",
      orders: salesPendingOrders
    };
  }

  return {
    source: "ventas",
    sourceLabel: "Ordenes aprobadas de Ventas",
    orders: []
  };
}

export function generateProductionPlan(
  pendingOrders: ProductionPendingOrder[],
  products: Product[],
  settings: ProductionShiftSettings,
  context: ProductionPlanningContext,
  sourceLabel: string
): ProductionGeneratedPlan {
  const orderedQueue = sortPendingOrders(pendingOrders, settings.strategy);
  const availableMinutes = getShiftMinutes(settings);
  const groupedOrders = groupOrdersForPlanning(orderedQueue, settings.strategy);
  const scheduledBlocks: ProductionPlanBlock[] = [];
  const scheduledOrderIds = new Set<string>();
  const issues = createPlanIssues(orderedQueue, products, settings, context);
  let cursorMinutes = toMinutes(settings.shiftStart);
  let usedMinutes = 0;
  let savedPickupMinutes = 0;

  groupedOrders.forEach((group) => {
    const product = products.find((currentProduct) => currentProduct.id === group.productId);
    const route = findBestRoute(context.routes, group.productId);
    const groupQuantity = group.orders.reduce((total, order) => total + order.quantity, 0);
    const recoleccionMinutes = estimateKittingMinutes(product, groupQuantity, settings, route);
    const individualKittingMinutes = group.orders.reduce(
      (total, order) => total + estimateKittingMinutes(product, order.quantity, settings, route),
      0
    );
    const assemblyMinutes = estimateAssemblyMinutes(product, groupQuantity, settings, route);
    const qualityMinutes = estimateQualityMinutes(groupQuantity, settings, route);
    const totalGroupMinutes = recoleccionMinutes + assemblyMinutes + qualityMinutes;

    if (usedMinutes + totalGroupMinutes > availableMinutes) {
      return;
    }

    const sourceOrders = group.orders.map((order) => order.sourceOrder);
    const sharedReason =
      group.orders.length > 1
        ? `Se agrupan ${group.orders.length} órdenes del mismo producto para evitar recolecciones repetidas.`
        : "Se agenda por prioridad y fecha de entrega.";

    const recoleccionBlock = createPlanBlock({
      type: "recoleccion",
      title: `Recolección agrupada ${group.productSku}`,
      startMinutes: cursorMinutes,
      estimatedMinutes: recoleccionMinutes,
      owner: "Producción / Almacén",
      productSku: group.productSku,
      productName: group.productName,
      quantity: groupQuantity,
      sourceOrders,
      reason: sharedReason,
      details: createKittingDetails(product, groupQuantity, context)
    });

    cursorMinutes += recoleccionMinutes;

    const assemblyBlock = createPlanBlock({
      type: "ensamble",
      title: `Ensamble lote ${group.productSku}`,
      startMinutes: cursorMinutes,
      estimatedMinutes: assemblyMinutes,
      owner: `${Math.max(settings.assemblyStations, 1)} estación(es) de ensamble`,
      productSku: group.productSku,
      productName: group.productName,
      quantity: groupQuantity,
      sourceOrders,
      reason: route
        ? "Ensamble calculado con ruta de Preproducción."
        : "Ensamble estimado; falta ruta de Preproducción liberada.",
      details: createAssemblyDetails(route, groupQuantity)
    });

    cursorMinutes += assemblyMinutes;

    const qualityBlock = createPlanBlock({
      type: "calidad",
      title: `Calidad lote ${group.productSku}`,
      startMinutes: cursorMinutes,
      estimatedMinutes: qualityMinutes,
      owner: `${Math.max(settings.qualityStations, 1)} estación(es) de calidad`,
      productSku: group.productSku,
      productName: group.productName,
      quantity: groupQuantity,
      sourceOrders,
      reason: route ? "Calidad calculada desde inspección/prueba de Preproducción." : "Calidad estimada por lote.",
      details: createQualityDetails(route)
    });

    cursorMinutes += qualityMinutes;
    usedMinutes += totalGroupMinutes;
    savedPickupMinutes += Math.max(individualKittingMinutes - recoleccionMinutes, 0);
    scheduledBlocks.push(recoleccionBlock, assemblyBlock, qualityBlock);
    group.orders.forEach((order) => scheduledOrderIds.add(order.id));
  });

  const overflowOrders = orderedQueue.filter((order) => !scheduledOrderIds.has(order.id));
  const scheduledOrders = orderedQueue.filter((order) => scheduledOrderIds.has(order.id));
  const scheduledUnits = orderedQueue
    .filter((order) => scheduledOrderIds.has(order.id))
    .reduce((total, order) => total + order.quantity, 0);
  const totalUnits = pendingOrders.reduce((total, order) => total + order.quantity, 0);
  const pickupGroups = createPickupGroups(scheduledOrders, products, context);
  const nextShiftDate = addDays(settings.planDate, 1);
  const nextShiftBlocks = createNextShiftPreview(overflowOrders, products, settings, context, nextShiftDate);
  const optimization = {
    capacityMinutes: availableMinutes,
    utilizationPercent: availableMinutes > 0 ? Math.min(Math.round((usedMinutes / availableMinutes) * 100), 100) : 0,
    savedPickupMinutes,
    groupedPickupCount: pickupGroups.length,
    blockedIssueCount: issues.filter((issue) => issue.severity === "bloqueo").length,
    nextShiftDate
  };

  overflowOrders.forEach((order) => {
    issues.push({
      id: productionId("prod-issue"),
      severity: "riesgo",
      sourceOrder: order.sourceOrder,
      title: "Fuera de capacidad del turno",
      detail: `${order.sourceOrder} no cupo en el turno de ${settings.shiftStart} a ${settings.shiftEnd}.`
    });
  });

  return {
    id: productionId("prod-plan"),
    generatedAt: nowIso(),
    settings,
    sourceLabel,
    pendingOrders,
    scheduledBlocks,
    overflowOrders,
    pickupGroups,
    nextShiftBlocks,
    recommendations: createRecommendations({
      issues,
      optimization,
      overflowOrders,
      pickupGroups,
      scheduledBlocks,
      settings
    }),
    optimization,
    issues,
    totalUnits,
    scheduledUnits,
    scheduledMinutes: usedMinutes
  };
}

export function summarizePlannerQueue(
  pendingOrders: ProductionPendingOrder[],
  products: Product[],
  settings: ProductionShiftSettings,
  context: ProductionPlanningContext
): ProductionPlannerSummary {
  const estimatedMinutes = groupOrdersForPlanning(pendingOrders, settings.strategy).reduce((total, group) => {
    const product = products.find((currentProduct) => currentProduct.id === group.productId);
    const route = findBestRoute(context.routes, group.productId);
    const quantity = group.orders.reduce((groupTotal, order) => groupTotal + order.quantity, 0);

    return (
      total +
      estimateKittingMinutes(product, quantity, settings, route) +
      estimateAssemblyMinutes(product, quantity, settings, route) +
      estimateQualityMinutes(quantity, settings, route)
    );
  }, 0);

  return {
    pendingOrders: pendingOrders.length,
    totalUnits: pendingOrders.reduce((total, order) => total + order.quantity, 0),
    dueToday: pendingOrders.filter((order) => order.dueDate <= settings.planDate).length,
    atRisk: pendingOrders.filter((order) => order.status !== "lista" || order.dueDate < settings.planDate).length,
    estimatedMinutes
  };
}

export function formatProductionMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}

export function formatPlanTime(value: string) {
  return value;
}

function createPickupGroups(
  scheduledOrders: ProductionPendingOrder[],
  products: Product[],
  context: ProductionPlanningContext
): ProductionPickupGroup[] {
  const groups = new Map<
    string,
    {
      locationId: string;
      locationLabel: string;
      status: ProductionPickupGroup["status"];
      sourceOrders: Set<string>;
      details: Map<string, string>;
    }
  >();

  scheduledOrders.forEach((order) => {
    const product = products.find((currentProduct) => currentProduct.id === order.productId);

    product?.components.forEach((component) => {
      const requiredQuantity = Number(component.quantity || 0) * order.quantity;
      const availableQuantity = getAvailableQuantityForComponent(component, context.warehouseEntries);
      const locations = getLocationsForComponent(component, context.warehouseEntries);
      const locationIds = locations.length > 0 ? locations : ["sin-ubicacion"];
      const status: ProductionPickupGroup["status"] = availableQuantity >= requiredQuantity ? "lista" : "faltante";

      locationIds.forEach((locationId) => {
        const group = groups.get(locationId) ?? {
          locationId,
          locationLabel: locationId === "sin-ubicacion" ? "Sin ubicación definida" : locationId,
          status: "lista",
          sourceOrders: new Set<string>(),
          details: new Map<string, string>()
        };
        const detailKey = `${component.id}:${order.sourceOrder}`;
        const missingQuantity = Math.max(requiredQuantity - availableQuantity, 0);
        const detail =
          missingQuantity > 0
            ? `${component.name}: requiere ${requiredQuantity} ${component.unit}, faltan ${missingQuantity}`
            : `${component.name}: ${requiredQuantity} ${component.unit}`;

        group.status = group.status === "faltante" || status === "faltante" ? "faltante" : "lista";
        group.sourceOrders.add(order.sourceOrder);
        group.details.set(detailKey, detail);
        groups.set(locationId, group);
      });
    });
  });

  return Array.from(groups.values()).map((group) => ({
    id: productionId("prod-pickup"),
    locationId: group.locationId,
    locationLabel: group.locationLabel,
    status: group.status,
    itemCount: group.details.size,
    sourceOrders: Array.from(group.sourceOrders),
    details: Array.from(group.details.values()).slice(0, 5)
  }));
}

function createNextShiftPreview(
  overflowOrders: ProductionPendingOrder[],
  products: Product[],
  settings: ProductionShiftSettings,
  context: ProductionPlanningContext,
  nextShiftDate: string
) {
  if (overflowOrders.length === 0) {
    return [];
  }

  const nextSettings: ProductionShiftSettings = {
    ...settings,
    planDate: nextShiftDate
  };
  const groupedOrders = groupOrdersForPlanning(sortPendingOrders(overflowOrders, settings.strategy), settings.strategy);
  const availableMinutes = getShiftMinutes(settings);
  const previewBlocks: ProductionPlanBlock[] = [];
  let cursorMinutes = toMinutes(settings.shiftStart);
  let usedMinutes = 0;

  groupedOrders.forEach((group) => {
    const product = products.find((currentProduct) => currentProduct.id === group.productId);
    const route = findBestRoute(context.routes, group.productId);
    const groupQuantity = group.orders.reduce((total, order) => total + order.quantity, 0);
    const recoleccionMinutes = estimateKittingMinutes(product, groupQuantity, nextSettings, route);
    const assemblyMinutes = estimateAssemblyMinutes(product, groupQuantity, nextSettings, route);
    const qualityMinutes = estimateQualityMinutes(groupQuantity, nextSettings, route);
    const totalMinutes = recoleccionMinutes + assemblyMinutes + qualityMinutes;

    if (usedMinutes + totalMinutes > availableMinutes && previewBlocks.length > 0) {
      return;
    }

    const sourceOrders = group.orders.map((order) => order.sourceOrder);

    previewBlocks.push(
      createPlanBlock({
        type: "recoleccion",
        title: `Siguiente turno: recolección ${group.productSku}`,
        startMinutes: cursorMinutes,
        estimatedMinutes: recoleccionMinutes,
        owner: "Producción / Almacén",
        productSku: group.productSku,
        productName: group.productName,
        quantity: groupQuantity,
        sourceOrders,
        reason: `Propuesto para ${nextShiftDate} por capacidad del turno actual.`,
        details: createKittingDetails(product, groupQuantity, context)
      })
    );
    cursorMinutes += recoleccionMinutes;

    previewBlocks.push(
      createPlanBlock({
        type: "ensamble",
        title: `Siguiente turno: ensamble ${group.productSku}`,
        startMinutes: cursorMinutes,
        estimatedMinutes: assemblyMinutes,
        owner: `${Math.max(settings.assemblyStations, 1)} estación(es) de ensamble`,
        productSku: group.productSku,
        productName: group.productName,
        quantity: groupQuantity,
        sourceOrders,
        reason: "Bloque sugerido si se mantiene la misma capacidad.",
        details: createAssemblyDetails(route, groupQuantity)
      })
    );
    cursorMinutes += assemblyMinutes;

    previewBlocks.push(
      createPlanBlock({
        type: "calidad",
        title: `Siguiente turno: calidad ${group.productSku}`,
        startMinutes: cursorMinutes,
        estimatedMinutes: qualityMinutes,
        owner: `${Math.max(settings.qualityStations, 1)} estación(es) de calidad`,
        productSku: group.productSku,
        productName: group.productName,
        quantity: groupQuantity,
        sourceOrders,
        reason: "Liberación sugerida para cerrar lote pendiente.",
        details: createQualityDetails(route)
      })
    );
    cursorMinutes += qualityMinutes;
    usedMinutes += totalMinutes;
  });

  return previewBlocks;
}

function createRecommendations(input: {
  issues: ProductionPlanIssue[];
  optimization: ProductionOptimizationSummary;
  overflowOrders: ProductionPendingOrder[];
  pickupGroups: ProductionPickupGroup[];
  scheduledBlocks: ProductionPlanBlock[];
  settings: ProductionShiftSettings;
}): ProductionRecommendation[] {
  const recommendations: ProductionRecommendation[] = [];

  if (input.optimization.blockedIssueCount > 0) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "riesgo",
      title: "Resolver bloqueos antes de liberar el plan",
      detail: `${input.optimization.blockedIssueCount} bloqueo(s) pueden impedir que el turno fluya. Prioriza faltantes de almacén, rutas y órdenes atrasadas.`
    });
  }

  if (input.optimization.savedPickupMinutes > 0) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "eficiencia",
      title: "Mantener recolección agrupada",
      detail: `Agrupar por producto/ubicación ahorra aproximadamente ${formatProductionMinutes(input.optimization.savedPickupMinutes)} contra recolectar orden por orden.`
    });
  }

  if (input.pickupGroups.some((group) => group.status === "faltante")) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "riesgo",
      title: "Separar pickup listo de faltantes",
      detail: "Recolecta primero ubicaciones completas y manda los faltantes a Compras/Almacén para no detener ensamble."
    });
  }

  if (input.overflowOrders.length > 0) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "siguiente-turno",
      title: "Preparar siguiente turno",
      detail: `${input.overflowOrders.length} orden(es) quedaron fuera. Harv ya propone bloques para ${input.optimization.nextShiftDate}.`
    });
  }

  if (input.optimization.utilizationPercent >= 92) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "capacidad",
      title: "Turno muy cargado",
      detail: `Uso estimado ${input.optimization.utilizationPercent}%. Conviene proteger buffers para calidad, retrabajo o faltantes.`
    });
  }

  if (input.optimization.utilizationPercent < 65 && input.overflowOrders.length === 0 && input.scheduledBlocks.length > 0) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "capacidad",
      title: "Hay capacidad libre",
      detail: `Uso estimado ${input.optimization.utilizationPercent}%. Puedes adelantar órdenes de mañana o reducir estaciones asignadas.`
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: productionId("prod-rec"),
      type: "eficiencia",
      title: "Plan estable",
      detail: "El turno está balanceado con la capacidad actual y sin bloqueos críticos."
    });
  }

  return recommendations;
}

function createPendingOrdersFromSales(
  salesOrders: SalesOrder[],
  clients: Client[],
  products: Product[],
  planDate: string
): ProductionPendingOrder[] {
  const clientById = new Map(clients.map((client) => [client.id, client]));

  return salesOrders
    .filter((order) => order.status === "aprobada-comercialmente")
    .flatMap((order) => {
      const client = order.selectedClientId ? clientById.get(order.selectedClientId) : undefined;

      return order.lines.flatMap((line, lineIndex) => {
        const product = resolveLineProduct(line.product, products);
        const sourceOrder = order.lines.length > 1 ? `${order.folio} · L${lineIndex + 1}` : order.folio;

        if (!product || product.status !== "activo") {
          return [];
        }

        return [createPendingOrder({
          id: `prod-pending-sales-${order.folio}-${line.id}`,
          sourceType: "ventas",
          sourceOrder,
          clientName: client?.commercialName || client?.legalName || "Cliente de Ventas",
          product,
          quantity: line.quantity,
          dueDate: order.requiredDate || planDate,
          priority: order.priority,
          status: product.components.length > 0 ? "lista" : "riesgo",
          notes: order.internalNotes || order.priorityReason || "Orden aprobada comercialmente."
        })];
      });
    });
}

function createPendingOrder(input: {
  id: string;
  sourceType: ProductionPendingOrder["sourceType"];
  sourceOrder: string;
  clientName: string;
  product: Product;
  quantity: number;
  dueDate: string;
  priority: Priority;
  status: ProductionPendingOrderStatus;
  notes: string;
}): ProductionPendingOrder {
  return {
    id: input.id,
    sourceType: input.sourceType,
    sourceOrder: input.sourceOrder,
    clientName: input.clientName,
    productId: input.product.id,
    productSku: input.product.sku,
    productName: input.product.name,
    quantity: input.quantity,
    dueDate: input.dueDate,
    priority: input.priority,
    status: input.status,
    notes: input.notes
  };
}

function resolveLineProduct(lineProduct: Product, products: Product[]) {
  return products.find((product) => product.id === lineProduct.id || product.sku === lineProduct.sku);
}

function sortPendingOrders(orders: ProductionPendingOrder[], strategy: ProductionPlanStrategy) {
  const sortedOrders = [...orders].sort((firstOrder, secondOrder) => {
    if (strategy === "agrupar-producto" && firstOrder.productSku !== secondOrder.productSku) {
      return firstOrder.productSku.localeCompare(secondOrder.productSku);
    }

    if (firstOrder.dueDate !== secondOrder.dueDate) {
      return firstOrder.dueDate.localeCompare(secondOrder.dueDate);
    }

    return priorityWeight[secondOrder.priority] - priorityWeight[firstOrder.priority];
  });

  if (strategy !== "agrupar-recoleccion") {
    return sortedOrders;
  }

  return sortedOrders.sort((firstOrder, secondOrder) => {
    const dueComparison = firstOrder.dueDate.localeCompare(secondOrder.dueDate);

    if (dueComparison !== 0 && firstOrder.dueDate <= todayIso()) {
      return dueComparison;
    }

    if (firstOrder.productSku !== secondOrder.productSku) {
      return firstOrder.productSku.localeCompare(secondOrder.productSku);
    }

    return priorityWeight[secondOrder.priority] - priorityWeight[firstOrder.priority];
  });
}

function groupOrdersForPlanning(orders: ProductionPendingOrder[], strategy: ProductionPlanStrategy) {
  if (strategy === "fecha-prioridad") {
    return orders.map((order) => ({
      productId: order.productId,
      productSku: order.productSku,
      productName: order.productName,
      orders: [order]
    }));
  }

  const groups = new Map<
    string,
    {
      productId: string;
      productSku: string;
      productName: string;
      orders: ProductionPendingOrder[];
    }
  >();

  orders.forEach((order) => {
    const key = order.productId;
    const group = groups.get(key);

    if (group) {
      group.orders.push(order);
      return;
    }

    groups.set(key, {
      productId: order.productId,
      productSku: order.productSku,
      productName: order.productName,
      orders: [order]
    });
  });

  return Array.from(groups.values());
}

function createPlanIssues(
  orders: ProductionPendingOrder[],
  products: Product[],
  settings: ProductionShiftSettings,
  context: ProductionPlanningContext
): ProductionPlanIssue[] {
  const issues: ProductionPlanIssue[] = [];

  orders.forEach((order) => {
    const product = products.find((currentProduct) => currentProduct.id === order.productId);
    const route = findBestRoute(context.routes, order.productId);

    if (order.dueDate < settings.planDate) {
      issues.push({
        id: productionId("prod-issue"),
        severity: "bloqueo",
        sourceOrder: order.sourceOrder,
        title: "Orden atrasada",
        detail: `${order.sourceOrder} venció el ${order.dueDate}. Debe entrar al plan primero.`
      });
    }

    if (!product || product.components.length === 0) {
      issues.push({
        id: productionId("prod-issue"),
        severity: "riesgo",
        sourceOrder: order.sourceOrder,
        title: "Producto sin componentes completos",
        detail: `${order.productSku} todavía no tiene componentes suficientes para calcular recolección real.`
      });
    }

    if (!route) {
      issues.push({
        id: productionId("prod-issue"),
        severity: "riesgo",
        sourceOrder: order.sourceOrder,
        title: "Ruta de Preproducción no liberada",
        detail: `${order.productSku} no tiene ruta liberada; el tiempo de ensamble se estimó.`
      });
    }

    const supplierResearchCount = product?.components.filter((component) => component.needsSupplierResearch).length ?? 0;

    if (supplierResearchCount > 0) {
      issues.push({
        id: productionId("prod-issue"),
        severity: "riesgo",
        sourceOrder: order.sourceOrder,
        title: "Componentes sin proveedor",
        detail: `${order.productSku} tiene ${supplierResearchCount} componente(s) que Compras debe resolver.`
      });
    }

    const shortages = product
      ? product.components
          .map((component) => {
            const requiredQuantity = Number(component.quantity || 0) * order.quantity;
            const availableQuantity = getAvailableQuantityForComponent(component, context.warehouseEntries);

            return {
              component,
              requiredQuantity,
              availableQuantity,
              missingQuantity: Math.max(requiredQuantity - availableQuantity, 0)
            };
          })
          .filter((shortage) => shortage.missingQuantity > 0)
      : [];

    shortages.slice(0, 3).forEach((shortage) => {
      issues.push({
        id: productionId("prod-issue"),
        severity: "bloqueo",
        sourceOrder: order.sourceOrder,
        title: "Faltante de Almacén",
        detail: `${shortage.component.name}: requiere ${shortage.requiredQuantity} ${shortage.component.unit}, disponible ${shortage.availableQuantity}.`
      });
    });

    if (shortages.length > 3) {
      issues.push({
        id: productionId("prod-issue"),
        severity: "riesgo",
        sourceOrder: order.sourceOrder,
        title: "Más faltantes detectados",
        detail: `${order.productSku} tiene ${shortages.length - 3} faltante(s) adicional(es) en Almacén.`
      });
    }

    if (order.status !== "lista") {
      issues.push({
        id: productionId("prod-issue"),
        severity: order.status === "bloqueada" ? "bloqueo" : "aviso",
        sourceOrder: order.sourceOrder,
        title: "Orden marcada con revisión",
        detail: order.notes || `${order.sourceOrder} requiere validación antes de liberarse completa.`
      });
    }
  });

  return issues;
}

function createPlanBlock(input: {
  type: ProductionPlanBlock["type"];
  title: string;
  startMinutes: number;
  estimatedMinutes: number;
  owner: string;
  productSku: string;
  productName: string;
  quantity: number;
  sourceOrders: string[];
  reason: string;
  details: string[];
}): ProductionPlanBlock {
  return {
    id: productionId("prod-block"),
    type: input.type,
    title: input.title,
    startTime: fromMinutes(input.startMinutes),
    endTime: fromMinutes(input.startMinutes + input.estimatedMinutes),
    estimatedMinutes: input.estimatedMinutes,
    owner: input.owner,
    productSku: input.productSku,
    productName: input.productName,
    quantity: input.quantity,
    sourceOrders: input.sourceOrders,
    reason: input.reason,
    details: input.details
  };
}

function createKittingDetails(product: Product | undefined, quantity: number, context: ProductionPlanningContext) {
  if (!product || product.components.length === 0) {
    return ["Componentes por validar en catálogo", "Agrupar piezas por ubicación cuando Almacén esté conectado"];
  }

  const topComponents = product.components.slice(0, 4).map((component) => {
    const totalQuantity = Number(component.quantity || 0) * quantity;
    const availableQuantity = getAvailableQuantityForComponent(component, context.warehouseEntries);
    const missingQuantity = Math.max(totalQuantity - availableQuantity, 0);
    const locations = getLocationsForComponent(component, context.warehouseEntries);
    const locationLabel = locations.length > 0 ? ` · ${locations.slice(0, 2).join(", ")}` : "";
    const availability = missingQuantity > 0 ? `faltan ${missingQuantity}` : "disponible";

    return `${totalQuantity} ${component.unit} · ${component.name} · ${availability}${locationLabel}`;
  });

  return [
    ...topComponents,
    product.components.length > 4 ? `+${product.components.length - 4} componentes adicionales` : "",
    "Separar kits por orden al terminar recolección"
  ].filter(Boolean);
}

function createAssemblyDetails(route: PreproductionRoute | undefined, quantity: number) {
  if (!route) {
    return [
      `${quantity} ${quantity === 1 ? "equipo" : "equipos"} en lote operativo`,
      "Ruta detallada pendiente en Preproducción",
      "Usar estimación base hasta liberar proceso"
    ];
  }

  const steps = route.steps.filter((step) => assemblyProcessTypes.has(step.processType)).slice(0, 4);

  return [
    ...steps.map((step) => `Paso ${step.sequence}: ${step.name} · ${step.estimatedMinutes} min`),
    route.steps.length > steps.length ? `+${route.steps.length - steps.length} paso(s) adicionales en ruta` : "",
    `Ruta ${route.status}`
  ].filter(Boolean);
}

function createQualityDetails(route: PreproductionRoute | undefined) {
  const qualitySteps = route?.steps.filter((step) => qualityProcessTypes.has(step.processType)) ?? [];

  if (qualitySteps.length === 0) {
    return ["Inspección visual y funcional base", "Checklist formal se conectará desde Calidad en Fase 3"];
  }

  return qualitySteps.slice(0, 4).map((step) => `${step.name} · ${step.estimatedMinutes} min`);
}

function estimateKittingMinutes(
  product: Product | undefined,
  quantity: number,
  settings: ProductionShiftSettings,
  route: PreproductionRoute | undefined
) {
  const routeKittingMinutes = route?.steps
    .filter((step) => step.processType === "kitting")
    .reduce((total, step) => total + Number(step.estimatedMinutes || 0), 0);
  const componentCount = product?.components.length ?? 4;
  const sharedPickupSavings = quantity > 1 ? Math.min(quantity * 2, 18) : 0;
  const activeCollectors = Math.max(Math.min(settings.peopleAvailable, 3), 1);
  const rawMinutes = Math.max(routeKittingMinutes || 12, componentCount * 3 + quantity * 4 - sharedPickupSavings);

  return Math.max(10, Math.ceil(rawMinutes / activeCollectors));
}

function estimateAssemblyMinutes(
  product: Product | undefined,
  quantity: number,
  settings: ProductionShiftSettings,
  route: PreproductionRoute | undefined
) {
  const routeAssemblyMinutes = route?.steps
    .filter((step) => assemblyProcessTypes.has(step.processType))
    .reduce((total, step) => total + Number(step.estimatedMinutes || 0), 0);
  const complexityFactor = Math.max(product?.components.length ?? 6, 4);
  const estimatedPerUnit = routeAssemblyMinutes && routeAssemblyMinutes > 0 ? routeAssemblyMinutes : 22 + Math.ceil(complexityFactor * 1.8);
  const rawMinutes = quantity * estimatedPerUnit;

  return Math.ceil(rawMinutes / Math.max(settings.assemblyStations, 1));
}

function estimateQualityMinutes(
  quantity: number,
  settings: ProductionShiftSettings,
  route: PreproductionRoute | undefined
) {
  const routeQualityMinutes = route?.steps
    .filter((step) => qualityProcessTypes.has(step.processType))
    .reduce((total, step) => total + Number(step.estimatedMinutes || 0), 0);
  const estimatedPerUnit = routeQualityMinutes && routeQualityMinutes > 0 ? routeQualityMinutes : 12;

  return Math.ceil((quantity * estimatedPerUnit) / Math.max(settings.qualityStations, 1));
}

function findBestRoute(routes: PreproductionRoute[], productId: string) {
  const productRoutes = routes.filter((route) => route.productId === productId && route.steps.length > 0);

  return productRoutes.find((route) => route.status === "liberada") ?? productRoutes[0];
}

function getAvailableQuantityForComponent(component: ProductComponent, entries: WarehouseEntry[]) {
  return getMatchingEntries(component, entries)
    .filter((entry) => entry.status === "disponible")
    .reduce((total, entry) => total + Number(entry.quantity || 0), 0);
}

function getLocationsForComponent(component: ProductComponent, entries: WarehouseEntry[]) {
  return Array.from(
    new Set(
      getMatchingEntries(component, entries)
        .filter((entry) => entry.status === "disponible")
        .flatMap((entry) => entry.allocations?.map((allocation) => allocation.locationId) ?? [entry.locationId])
        .filter(Boolean)
    )
  );
}

function getMatchingEntries(component: ProductComponent, entries: WarehouseEntry[]) {
  const componentName = normalizeLookup(component.name);
  const supplierPartNumber = normalizeLookup(component.supplierPartNumber);

  return entries.filter((entry) => {
    const entryName = normalizeLookup(entry.itemName);
    const entrySku = normalizeLookup(entry.sku);

    return (
      Boolean(supplierPartNumber && entrySku && supplierPartNumber === entrySku) ||
      Boolean(componentName && entryName && (componentName === entryName || entryName.includes(componentName)))
    );
  });
}

function getShiftMinutes(settings: ProductionShiftSettings) {
  return Math.max(toMinutes(settings.shiftEnd) - toMinutes(settings.shiftStart), 0);
}

function toMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");

  return Number(hours) * 60 + Number(minutes);
}

function fromMinutes(value: number) {
  const hours = Math.floor(value / 60) % 24;
  const minutes = value % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);

  return value.toISOString().slice(0, 10);
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase();
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
