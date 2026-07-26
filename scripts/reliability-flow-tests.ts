import { createPreproductionPurchaseRequests } from "../src/modules/purchases/preproductionRequests";
import { createProductSupplierRequests } from "../src/modules/purchases/productRequests";
import { createFabricationJobsFromSales } from "../src/modules/fabrication/utils";
import type { FabricationMachine } from "../src/modules/fabrication/types";
import type {
  PendingReceipt,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequest,
  PurchaseSupplier
} from "../src/modules/purchases/types";
import type { PreproductionResource, PreproductionRoute, PreproductionStep } from "../src/modules/preproduction/types";
import type { Product, ProductComponent, ProductComponentOrigin, ProductUnit, SalesOrder } from "../src/modules/sales/types";
import type { PlantSupply } from "../src/modules/supplies/types";
import type { WarehouseEntry } from "../src/modules/warehouse/types";
import {
  createDefaultShiftSettings,
  generateProductionPlan
} from "../src/modules/production/utils";
import type { ProductionGeneratedPlan, ProductionPendingOrder } from "../src/modules/production/types";

type TestResult = {
  name: string;
  ok: boolean;
  detail: string;
};

type ScenarioOptions = {
  name: string;
  orderQuantity?: number;
  warehouseCoverage?: number;
  damagedComponentIds?: string[];
  missingComponentSupplierIds?: string[];
  missingSupplySupplier?: boolean;
  duplicateRequests?: boolean;
  routeStatus?: PreproductionRoute["status"];
  includeRoute?: boolean;
  orderDueOffset?: number;
  orderStatus?: ProductionPendingOrder["status"];
  shiftHours?: { start: string; end: string };
  secondOrderQuantity?: number;
};

type ScenarioOutput = {
  product: Product;
  route: PreproductionRoute | undefined;
  suppliers: PurchaseSupplier[];
  supplies: PlantSupply[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  receipts: PendingReceipt[];
  warehouseEntries: WarehouseEntry[];
  plan: ProductionGeneratedPlan;
};

const today = "2026-07-16";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function daysFromToday(days: number) {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function component(input: {
  id: string;
  name: string;
  type: ProductComponent["type"];
  origin?: ProductComponentOrigin;
  process?: ProductComponent["process"];
  quantity: number;
  supplierId?: string;
  needsSupplierResearch?: boolean;
  unitCost?: number;
}): ProductComponent {
  const origin = input.origin ?? "comprado";
  const process = input.process ?? "pendiente";

  return {
    id: input.id,
    name: input.name,
    type: input.type,
    quantity: input.quantity,
    unit: "pieza",
    origin,
    process,
    specs: {},
    material: input.type === "pieza-impresa-3d" ? "PETG" : "ACERO",
    color: "NEGRO",
    supplierContactMethod: "email",
    supplierExternalPlatform: "",
    supplierCompany: input.supplierId ? `Supplier ${input.supplierId}` : "",
    supplierContact: input.supplierId ? "Compras" : "",
    supplierEmail: input.supplierId ? `${input.supplierId}@example.com` : "",
    supplierPhone: "",
    supplierPartNumber: `${input.id.toUpperCase()}-PN`,
    unitCost: input.unitCost ?? 10,
    leadTime: input.supplierId ? "5 dias" : "",
    minimumPurchaseQuantity: "",
    referenceLink: "",
    needsSupplierResearch: input.needsSupplierResearch ?? false,
    supplierResearchNotes: input.needsSupplierResearch ? "Resolver proveedor antes de liberar compra." : "",
    printDesigns:
      origin === "fabricado-en-planta" && process === "impresion-3d"
        ? [{ id: `${input.id}-file`, printer: "P1S", fileName: `${input.id}.3mf`, notes: "" }]
        : [],
    notes: ""
  };
}

function makeProduct(options: ScenarioOptions): Product {
  const missingSupplierIds = new Set(options.missingComponentSupplierIds ?? []);

  return {
    id: "product-test-actuator",
    sku: "TEST-ACT",
    name: "Actuador de prueba Harv",
    shortDescription: "Producto generado por reliability test.",
    category: "Validacion",
    basePrice: 1200,
    currency: "MXN",
    unit: "set",
    status: "activo",
    commercialNotes: "",
    technicalNotes: "",
    components: [
      component({
        id: "comp-screw-m3",
        name: "Tornillo M3x12",
        type: "tornilleria",
        origin: "comprado",
        quantity: 8,
        supplierId: missingSupplierIds.has("comp-screw-m3") ? "" : "supplier-fasteners",
        needsSupplierResearch: missingSupplierIds.has("comp-screw-m3"),
        unitCost: 1.5
      }),
      component({
        id: "comp-servo",
        name: "Servo compacto",
        type: "motor",
        origin: "comprado",
        quantity: 2,
        supplierId: missingSupplierIds.has("comp-servo") ? "" : "supplier-motion",
        needsSupplierResearch: missingSupplierIds.has("comp-servo"),
        unitCost: 180
      }),
      component({
        id: "comp-bracket",
        name: "Bracket impreso PETG",
        type: "pieza-impresa-3d",
        origin: "fabricado-en-planta",
        process: "impresion-3d",
        quantity: 1,
        supplierId: "internal-fab",
        unitCost: 25
      })
    ]
  };
}

function makeSupplier(id: string, name: string): PurchaseSupplier {
  return {
    id,
    name,
    legalName: name,
    taxId: `${id.toUpperCase()}0101`,
    category: "Prueba",
    sells: "Componentes de prueba",
    contactName: "Compras",
    whatsapp: "",
    email: `${id}@example.com`,
    contactMethod: "email",
    externalPlatform: "",
    country: "Mexico",
    city: "Monterrey",
    currency: "MXN",
    leadTimeDays: 5,
    minimumOrder: "",
    paymentTerms: "credito",
    status: "activo",
    notes: ""
  };
}

function makeSupply(missingSupplier: boolean): PlantSupply {
  return {
    id: "supply-threadlocker",
    name: "Fijador de rosca medio",
    category: "quimico",
    unit: "ml",
    preferredSupplierId: missingSupplier ? null : "supplier-chemicals",
    stockMinimum: 25,
    notes: "Consumible requerido por ensamble."
  };
}

function resource(input: { id: string; supplyId?: string; name: string; quantity: number; unit: string }): PreproductionResource {
  return {
    id: input.id,
    supplyId: input.supplyId,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    notes: ""
  };
}

function step(input: Partial<PreproductionStep> & Pick<PreproductionStep, "id" | "sequence" | "name" | "processType">): PreproductionStep {
  return {
    isKittingStep: false,
    station: "Linea 1",
    estimatedMinutes: 5,
    outputName: "",
    outputQuantity: 0,
    outputUnit: "",
    instructions: "",
    kittingComponents: [],
    componentUses: [],
    subassemblyUses: [],
    tools: [],
    consumables: [],
    ...input
  };
}

function makeRoute(product: Product, status: PreproductionRoute["status"] = "liberada"): PreproductionRoute {
  return {
    id: "route-test-actuator",
    productId: product.id,
    status,
    updatedAt: `${today}T08:00:00.000Z`,
    steps: [
      step({
        id: "route-step-kit",
        sequence: 1,
        isKittingStep: true,
        name: "Kitting de actuador",
        processType: "kitting",
        station: "Almacen",
        estimatedMinutes: 8,
        outputName: "Kit actuador",
        outputQuantity: 1,
        outputUnit: "kit"
      }),
      step({
        id: "route-step-assembly",
        sequence: 2,
        name: "Ensamble mecanico",
        processType: "ensamble",
        estimatedMinutes: 18,
        componentUses: product.components.map((item) => ({
          id: `use-${item.id}`,
          componentId: item.id,
          componentName: item.name,
          quantity: item.quantity,
          unit: item.unit
        })),
        tools: [resource({ id: "tool-torque", name: "Torque driver", quantity: 1, unit: "pieza" })],
        consumables: [
          resource({
            id: "cons-threadlocker",
            supplyId: "supply-threadlocker",
            name: "Fijador de rosca medio",
            quantity: 0.8,
            unit: "ml"
          })
        ]
      }),
      step({
        id: "route-step-quality",
        sequence: 3,
        name: "Prueba funcional",
        processType: "prueba",
        station: "Calidad",
        estimatedMinutes: 10,
        outputName: "Actuador probado",
        outputQuantity: 1,
        outputUnit: "set"
      })
    ]
  };
}

function createPreproductionRequests(
  product: Product,
  route: PreproductionRoute | undefined,
  supplies: PlantSupply[],
  existingRequests: PurchaseRequest[]
) {
  return route ? createPreproductionPurchaseRequests([product], [route], supplies, existingRequests) : [];
}

function createPurchaseOrdersFromRequests(requests: PurchaseRequest[], suppliers: PurchaseSupplier[]): PurchaseOrder[] {
  return requests
    .filter((request) => request.status !== "bloqueado" && request.supplierId)
    .map((request, index): PurchaseOrder => {
      const supplier = suppliers.find((item) => item.id === request.supplierId);
      const line: PurchaseOrderLine = {
        id: `po-line-${request.id}`,
        productId: request.productId,
        componentId: request.componentId,
        sourceRequestId: request.id,
        productSku: request.productSku,
        itemName: request.itemName,
        quantity: request.quantity,
        unit: request.unit,
        unitCost: 10,
        currency: supplier?.currency ?? "MXN",
        notes: request.notes
      };

      return {
        id: `po-${index + 1}`,
        folio: `PO-REL-${String(index + 1).padStart(3, "0")}`,
        supplierId: request.supplierId ?? "",
        supplierName: supplier?.name ?? "Supplier pendiente",
        createdAt: `${today}T09:00:00.000Z`,
        expectedDate: daysFromToday(5),
        status: "por-recibir",
        priority: request.priority,
        internalDestination: "Almacen",
        deliveryMethod: "paqueteria",
        paymentTerms: "credito",
        currency: supplier?.currency ?? "MXN",
        shippingCost: 0,
        taxes: 0,
        lines: [line],
        notes: "",
        documents: [],
        history: []
      };
    });
}

function createReceipts(orders: PurchaseOrder[], coverage: number): PendingReceipt[] {
  return orders.map((order) => ({
    id: `receipt-${order.id}`,
    purchaseOrderId: order.id,
    purchaseOrderFolio: order.folio,
    supplierName: order.supplierName,
    expectedDate: order.expectedDate,
    internalDestination: order.internalDestination,
    status: coverage >= 1 ? "recibida" : "parcial",
    receivedAt: `${today}T12:00:00.000Z`,
    issue: coverage >= 1 ? "" : "incompleto",
    issueNotes: coverage >= 1 ? "" : "Recepcion parcial generada por reliability test.",
    lines: order.lines.map((line) => ({
      ...line,
      receivedQuantity: Math.floor(line.quantity * coverage),
      damagedQuantity: 0,
      reviewQuantity: 0,
      receiptNotes: ""
    }))
  }));
}

function createWarehouseEntries(
  product: Product,
  orderQuantity: number,
  coverage: number,
  damagedComponentIds: string[] = []
): WarehouseEntry[] {
  const damagedSet = new Set(damagedComponentIds);

  return product.components.map((item, index) => {
    const requiredQuantity = item.quantity * orderQuantity;
    const quantity = Math.floor(requiredQuantity * coverage);
    const isDamaged = damagedSet.has(item.id);

    return {
      id: `wh-entry-${item.id}`,
      receivedAt: `${today}T13:00:00.000Z`,
      itemName: item.name,
      sku: item.supplierPartNumber,
      materialType: "componente",
      quantity,
      incomingQuantity: Math.max(requiredQuantity - quantity, 0),
      expectedArrivalDate: daysFromToday(3),
      unit: item.unit,
      locationId: `A-${index + 1}`,
      maxPerLocation: 100,
      allocations: [{ id: `alloc-${item.id}`, locationId: `A-${index + 1}`, quantity }],
      supplier: item.supplierCompany || "Interno",
      receivedBy: "Reliability Test",
      status: isDamaged ? "danado" : "disponible",
      notes: isDamaged ? "Entrada marcada como danada para validar bloqueo." : ""
    };
  });
}

function makePendingOrders(product: Product, options: ScenarioOptions): ProductionPendingOrder[] {
  const firstQuantity = options.orderQuantity ?? 2;
  const orders: ProductionPendingOrder[] = [
    {
      id: "pending-1",
      sourceType: "ventas",
      sourceOrder: "OV-REL-001",
      clientName: "Cliente Reliability",
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      quantity: firstQuantity,
      dueDate: daysFromToday(options.orderDueOffset ?? 1),
      priority: "alta",
      status: options.orderStatus ?? "lista",
      notes: options.orderStatus && options.orderStatus !== "lista" ? "Orden marcada con revision para prueba." : ""
    }
  ];

  if (options.secondOrderQuantity) {
    orders.push({
      ...orders[0],
      id: "pending-2",
      sourceOrder: "OV-REL-002",
      quantity: options.secondOrderQuantity,
      dueDate: daysFromToday(2),
      priority: "normal"
    });
  }

  return orders;
}

function makeSalesOrder(product: Product, quantity: number): SalesOrder {
  return {
    folio: "OV-REL-FAB-001",
    seller: "Reliability",
    createdAt: `${today}T08:30:00.000Z`,
    status: "aprobada-comercialmente",
    commercialStatus: "pago-verificado",
    selectedClientId: null,
    lines: [
      {
        id: "line-fab-1",
        product,
        quantity,
        unitPrice: product.basePrice,
        discount: 0,
        notes: ""
      }
    ],
    requiredDate: daysFromToday(2),
    priority: "urgente",
    priorityReason: "",
    internalNotes: "",
    paymentTerm: "contado",
    paymentMethod: "transferencia",
    paymentLink: "",
    paymentVerifiedBy: "Reliability",
    paymentVerifiedAt: `${today}T08:35:00.000Z`,
    creditReviewedBy: null,
    creditReviewedAt: null,
    documents: [],
    history: []
  };
}

function makeFabricationMachine(): FabricationMachine {
  return {
    id: "machine-rel-p1s",
    name: "Bambu P1S Reliability",
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
    lastSeenAt: `${today}T08:00:00.000Z`,
    agentConnectionState: "offline",
    agentMessage: "",
    notes: ""
  };
}

function runScenario(options: ScenarioOptions): ScenarioOutput {
  const product = makeProduct(options);
  const route = options.includeRoute === false ? undefined : makeRoute(product, options.routeStatus ?? "liberada");
  const suppliers = [
    makeSupplier("supplier-fasteners", "Fasteners Reliability"),
    makeSupplier("supplier-motion", "Motion Reliability"),
    makeSupplier("supplier-chemicals", "Chemicals Reliability")
  ];
  const supplies = [makeSupply(Boolean(options.missingSupplySupplier))];
  const productRequests = createProductSupplierRequests([product], []);
  const preproductionRequests = createPreproductionRequests(product, route, supplies, productRequests);
  const purchaseRequests = options.duplicateRequests
    ? [
        ...productRequests,
        ...preproductionRequests,
        ...createProductSupplierRequests([product], productRequests),
        ...createPreproductionRequests(product, route, supplies, [...productRequests, ...preproductionRequests])
      ]
    : [...productRequests, ...preproductionRequests];
  const purchaseOrders = createPurchaseOrdersFromRequests(purchaseRequests, suppliers);
  const receipts = createReceipts(purchaseOrders, options.warehouseCoverage ?? 1);
  const orderQuantity = (options.orderQuantity ?? 2) + (options.secondOrderQuantity ?? 0);
  const warehouseEntries = createWarehouseEntries(
    product,
    orderQuantity,
    options.warehouseCoverage ?? 1,
    options.damagedComponentIds
  );
  const pendingOrders = makePendingOrders(product, options);
  const shiftSettings = {
    ...createDefaultShiftSettings(),
    planDate: today,
    shiftStart: options.shiftHours?.start ?? "08:00",
    shiftEnd: options.shiftHours?.end ?? "17:00"
  };
  const plan = generateProductionPlan(
    pendingOrders,
    [product],
    shiftSettings,
    { routes: route ? [route] : [], warehouseEntries },
    "Ordenes reliability"
  );

  return {
    product,
    route,
    suppliers,
    supplies,
    purchaseRequests,
    purchaseOrders,
    receipts,
    warehouseEntries,
    plan
  };
}

function test(name: string, options: ScenarioOptions, validate: (output: ScenarioOutput) => void): TestResult {
  try {
    validate(runScenario({ ...options, name }));

    return { name, ok: true, detail: "OK" };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const tests: TestResult[] = [
  test("01 happy path completo", { name: "", orderQuantity: 2 }, ({ purchaseRequests, purchaseOrders, receipts, plan }) => {
    assert(purchaseRequests.length === 1, `esperaba 1 solicitud de insumo, recibio ${purchaseRequests.length}`);
    assert(purchaseOrders.length === 1, `esperaba 1 OC, recibio ${purchaseOrders.length}`);
    assert(receipts.every((receipt) => receipt.status === "recibida"), "todas las recepciones debian estar recibidas");
    assert(plan.scheduledBlocks.length === 3, `esperaba 3 bloques del plan, recibio ${plan.scheduledBlocks.length}`);
    assert(!plan.issues.some((issue) => issue.severity === "bloqueo"), "no esperaba bloqueos en happy path");
  }),
  test(
    "02 componente comprado sin proveedor",
    { name: "", missingComponentSupplierIds: ["comp-servo"] },
    ({ purchaseRequests, plan }) => {
      assert(purchaseRequests.some((request) => request.source === "producto" && request.status === "bloqueado"), "faltaba solicitud bloqueada desde Productos");
      assert(plan.issues.some((issue) => issue.title === "Componentes sin proveedor"), "Produccion debia alertar componente sin proveedor");
    }
  ),
  test("03 insumo de preproduccion sin proveedor", { name: "", missingSupplySupplier: true }, ({ purchaseRequests }) => {
    const request = purchaseRequests.find((item) => item.source === "preproduccion");
    assert(Boolean(request), "faltaba solicitud desde Preproduccion");
    assert(request?.status === "bloqueado", "la solicitud de insumo debia quedar bloqueada");
  }),
  test("04 generadores no duplican solicitudes", { name: "", duplicateRequests: true }, ({ purchaseRequests }) => {
    const uniqueRefs = new Set(purchaseRequests.map((request) => request.sourceRef));
    assert(uniqueRefs.size === purchaseRequests.length, "se detectaron sourceRef duplicados");
  }),
  test("05 recepcion parcial genera faltante de almacen", { name: "", warehouseCoverage: 0.5 }, ({ receipts, plan }) => {
    assert(receipts.some((receipt) => receipt.status === "parcial"), "esperaba recepcion parcial");
    assert(
      plan.issues.some((issue) => issue.title.includes("Faltante") && issue.title.includes("Almac") && issue.severity === "bloqueo"),
      "Produccion debia bloquear por faltante"
    );
  }),
  test("06 material danado no cuenta como disponible", { name: "", damagedComponentIds: ["comp-servo"] }, ({ warehouseEntries, plan }) => {
    assert(warehouseEntries.some((entry) => entry.status === "danado"), "esperaba entrada danada");
    assert(plan.issues.some((issue) => issue.detail.includes("Servo compacto")), "Produccion debia detectar servo faltante por dano");
  }),
  test("07 orden atrasada se bloquea", { name: "", orderDueOffset: -1 }, ({ plan }) => {
    assert(plan.issues.some((issue) => issue.title === "Orden atrasada" && issue.severity === "bloqueo"), "esperaba bloqueo por orden atrasada");
  }),
  test("08 producto sin ruta liberada usa estimado y alerta", { name: "", includeRoute: false }, ({ plan }) => {
    assert(
      plan.issues.some((issue) => issue.title.includes("Ruta") && issue.title.includes("Preproducci") && issue.title.includes("liberada")),
      "esperaba alerta por ruta faltante"
    );
    assert(plan.scheduledBlocks.length === 3, "el planner debia generar bloques estimados");
  }),
  test(
    "09 capacidad del turno manda overflow",
    { name: "", orderQuantity: 30, shiftHours: { start: "08:00", end: "09:00" } },
    ({ plan }) => {
      assert(plan.overflowOrders.length > 0, "esperaba orden fuera de capacidad");
      assert(plan.issues.some((issue) => issue.title === "Fuera de capacidad del turno"), "faltaba issue de capacidad");
    }
  ),
  test("10 dos ordenes mismo producto se agrupan", { name: "", orderQuantity: 1, secondOrderQuantity: 2 }, ({ plan }) => {
    const assemblyBlock = plan.scheduledBlocks.find((block) => block.type === "ensamble");
    assert(Boolean(assemblyBlock), "faltaba bloque de ensamble");
    assert(assemblyBlock?.sourceOrders.length === 2, "las dos ordenes debian agruparse en el mismo bloque");
    assert(plan.totalUnits === 3, `esperaba 3 unidades totales, recibio ${plan.totalUnits}`);
  }),
  test("11 ventas aprobadas generan cola de fabricacion", { name: "" }, ({ product }) => {
    const salesOrder = makeSalesOrder(product, 40);
    const firstRun = createFabricationJobsFromSales({
      products: [product],
      salesOrders: [salesOrder],
      machines: [makeFabricationMachine()],
      existingJobs: []
    });
    const generatedJob = firstRun.jobsToCreate[0];

    assert(firstRun.jobsToCreate.length === 1, `esperaba 1 trabajo de impresion, recibio ${firstRun.jobsToCreate.length}`);
    assert(generatedJob.quantity === 40, `esperaba 40 piezas, recibio ${generatedJob.quantity}`);
    assert(generatedJob.status === "asignado", `esperaba trabajo asignado, recibio ${generatedJob.status}`);

    const secondRun = createFabricationJobsFromSales({
      products: [product],
      salesOrders: [salesOrder],
      machines: [makeFabricationMachine()],
      existingJobs: firstRun.jobsToCreate
    });

    assert(secondRun.jobsToCreate.length === 0, "la segunda corrida no debia duplicar trabajos");
    assert(secondRun.summary.existingJobs === 1, "esperaba detectar el trabajo existente en cola");
  })
];

const passed = tests.filter((item) => item.ok).length;

tests.forEach((result) => {
  const mark = result.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${result.name} - ${result.detail}`);
});

console.log(`\n${passed}/${tests.length} reliability tests passed.`);

if (passed !== tests.length) {
  process.exitCode = 1;
}
