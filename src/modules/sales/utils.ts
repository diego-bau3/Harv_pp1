import type {
  Client,
  ClientStatus,
  DocumentType,
  OrderLine,
  OrderStatus,
  PaymentMethod,
  PaymentTerm,
  Priority,
  Product,
  ProductComponent,
  ProductCurrency,
  ProductComponentOrigin,
  ProductComponentProcess,
  ProductComponentType,
  ProductSupplierContactMethod,
  QuoteStatus,
  SalesOrder,
  SalesUser,
  ShippingAddress,
  ShippingDeliveryMethod
} from "./types";

export const salesClientsStorageKey = "harv:sales-clients:v1";
export const salesGeneratedOrdersStorageKey = "harv:sales-generated-orders:v1";
export const salesSentQuotesStorageKey = "harv:sales-sent-quotes:v1";

export const clientStatusLabels: Record<ClientStatus, string> = {
  activo: "Activo",
  incompleto: "Incompleto",
  bloqueado: "Bloqueado",
  inactivo: "Inactivo"
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  borrador: "Borrador",
  "pendiente-informacion": "Pendiente de información",
  "pendiente-producto": "Pendiente de producto",
  "pendiente-pago": "Pendiente de pago",
  "pendiente-credito": "Pendiente de crédito",
  "aprobada-comercialmente": "Aprobada comercialmente",
  cancelada: "Cancelada"
};

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  enviada: "Enviada",
  seguimiento: "En seguimiento",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida"
};

export const paymentTermLabels: Record<PaymentTerm, string> = {
  contado: "Contado",
  credito: "Crédito",
  anticipo: "Anticipo",
  pendiente: "Pendiente por definir"
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  efectivo: "Efectivo",
  credito: "Crédito",
  "por-definir": "Por definir"
};

export const shippingDeliveryMethodLabels: Record<ShippingDeliveryMethod, string> = {
  paqueteria: "Paquetería",
  "flete-propio": "Flete propio",
  "cliente-recoge": "Cliente recoge",
  "por-definir": "Por definir"
};

export const priorityLabels: Record<Priority, string> = {
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
  critica: "Crítica"
};

export const documentTypeLabels: Record<DocumentType, string> = {
  "orden-compra-cliente": "Orden de compra del cliente",
  "comprobante-pago": "Comprobante de pago",
  "documento-fiscal": "Documento fiscal",
  "cotizacion-firmada": "Cotización firmada",
  otro: "Otro"
};

export const productStatusLabels: Record<Product["status"], string> = {
  borrador: "Borrador",
  activo: "Activo",
  inactivo: "Inactivo"
};

export const productUnitLabels: Record<Product["unit"], string> = {
  pieza: "Pieza",
  metro: "Metro",
  kg: "Kg",
  g: "g",
  ml: "ml",
  litro: "Litro",
  set: "Set",
  paquete: "Paquete",
  rollo: "Rollo",
  formato: "Formato"
};

export const currencyLabels: Record<ProductCurrency, string> = {
  MXN: "MXN - PESOS",
  USD: "USD - DOLARES",
  EUR: "EUR - EUROS"
};

export const productCategoryOptions = [
  "Robot",
  "Máquina",
  "Subensamble",
  "Kit",
  "Refacción",
  "Empaque",
  "Servicio"
] as const;

export const materialOptions = ["PLA", "PETG", "TPU", "OTRO"] as const;

export const colorOptions = ["NEGRO", "BLANCO", "AZUL", "OTRO"] as const;

export const supplierContactMethodLabels: Record<ProductSupplierContactMethod, string> = {
  whatsapp: "WHATSAPP",
  email: "EMAIL",
  externa: "EXTERNA"
};

export const supplierExternalPlatformOptions = ["ALIBABA", "AMAZON BUSINESS", "MERCADO LIBRE", "OTRO"] as const;

export const componentTypeLabels: Record<ProductComponentType, string> = {
  "pieza-impresa-3d": "Pieza impresa 3D",
  "pieza-fabricada": "Pieza fabricada",
  tornilleria: "Tornillería",
  motor: "Motor",
  cableado: "Cableado",
  electronico: "Electrónico",
  empaque: "Empaque",
  comprado: "Comprado",
  "servicio-externo": "Servicio externo",
  otro: "Otro"
};

export const componentOriginLabels: Record<ProductComponentOrigin, string> = {
  "fabricado-en-planta": "Fabricado en planta",
  comprado: "Comprado",
  "servicio-externo": "Servicio externo",
  pendiente: "Pendiente por definir"
};

export const componentProcessLabels: Record<ProductComponentProcess, string> = {
  "impresion-3d": "Impresión 3D",
  cnc: "CNC / Maquinado",
  "corte-laser": "Corte laser",
  doblado: "Doblado",
  soldadura: "Soldadura",
  cableado: "Cableado",
  ensamble: "Ensamble",
  acabado: "Acabado / postproceso",
  "fabricacion-manual": "Fabricacion manual",
  pendiente: "Pendiente"
};

export function getProductComponentOrigin(component: Pick<ProductComponent, "process"> & { origin?: ProductComponentOrigin }) {
  if (component.origin) {
    return component.origin;
  }

  const legacyProcess = String(component.process);

  if (legacyProcess === "comprado" || legacyProcess === "servicio-externo") {
    return legacyProcess;
  }

  if (legacyProcess === "pendiente") {
    return "pendiente";
  }

  return "fabricado-en-planta";
}

export function getDefaultProductComponentProcess(type: ProductComponentType, origin: ProductComponentOrigin) {
  if (origin !== "fabricado-en-planta") {
    return "pendiente";
  }

  if (type === "pieza-impresa-3d") {
    return "impresion-3d";
  }

  if (type === "pieza-fabricada") {
    return "fabricacion-manual";
  }

  if (type === "cableado") {
    return "cableado";
  }

  return "pendiente";
}

export function normalizeProductComponentProcess(
  type: ProductComponentType,
  origin: ProductComponentOrigin,
  process?: ProductComponentProcess | string
) {
  if (origin !== "fabricado-en-planta") {
    return "pendiente";
  }

  const currentProcess = String(process ?? "");

  return Object.prototype.hasOwnProperty.call(componentProcessLabels, currentProcess)
    ? (currentProcess as ProductComponentProcess)
    : getDefaultProductComponentProcess(type, origin);
}

export function isExternalProductComponent(component: Pick<ProductComponent, "process"> & { origin?: ProductComponentOrigin }) {
  const origin = getProductComponentOrigin(component);

  return origin === "comprado" || origin === "servicio-externo";
}

export function isPrintableProductComponent(
  component: Pick<ProductComponent, "process" | "type"> & { origin?: ProductComponentOrigin }
) {
  const origin = getProductComponentOrigin(component);

  return origin === "fabricado-en-planta" && normalizeProductComponentProcess(component.type, origin, component.process) === "impresion-3d";
}

export type ProductComponentSpecField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
};

export const productComponentSpecTemplates: Partial<Record<ProductComponentType, ProductComponentSpecField[]>> = {
  tornilleria: [
    { key: "threadSize", label: "Rosca / medida", placeholder: "M3, M4, 1/4-20", required: true },
    { key: "length", label: "Largo", placeholder: "12 mm", required: true },
    { key: "headType", label: "Cabeza", placeholder: "Allen, hexagonal, avellanada" },
    { key: "finish", label: "Acabado / grado", placeholder: "Negro 12.9, zincado 8.8" }
  ],
  motor: [
    { key: "motorType", label: "Tipo de motor", placeholder: "Servo, stepper, DC, BLDC", required: true },
    { key: "voltage", label: "Voltaje", placeholder: "12V, 24V", required: true },
    { key: "torque", label: "Torque / fuerza", placeholder: "20 kg-cm, 1.8 Nm" },
    { key: "rpm", label: "RPM / velocidad", placeholder: "60 RPM" },
    { key: "shaft", label: "Eje / salida", placeholder: "D-shaft 6 mm" },
    { key: "connector", label: "Conector / driver", placeholder: "JST-XH, A4988" }
  ],
  cableado: [
    { key: "cableType", label: "Tipo", placeholder: "Arnes, cable suelto, ribbon", required: true },
    { key: "gauge", label: "Calibre", placeholder: "22 AWG" },
    { key: "length", label: "Longitud", placeholder: "300 mm", required: true },
    { key: "connectorA", label: "Conector A", placeholder: "JST-XH 4p" },
    { key: "connectorB", label: "Conector B", placeholder: "Terminal ferrul" },
    { key: "pinout", label: "Pinout / notas", placeholder: "1=VCC, 2=GND..." }
  ],
  electronico: [
    { key: "function", label: "Funcion", placeholder: "Sensor, controlador, fuente", required: true },
    { key: "mpn", label: "MPN / modelo", placeholder: "ESP32-WROOM, LM2596", required: true },
    { key: "voltage", label: "Voltaje", placeholder: "3.3V, 5V, 24V" },
    { key: "current", label: "Corriente", placeholder: "2A max" },
    { key: "protocol", label: "Comunicacion", placeholder: "I2C, UART, CAN, USB" },
    { key: "datasheet", label: "Datasheet / link", placeholder: "https://..." }
  ],
  "pieza-impresa-3d": [
    { key: "file", label: "Archivo maestro", placeholder: "base-motor.3mf" },
    { key: "infill", label: "Infill / parametros", placeholder: "35%, 4 paredes" },
    { key: "orientation", label: "Orientacion critica", placeholder: "Cara plana hacia cama" }
  ],
  "pieza-fabricada": [
    { key: "process", label: "Proceso", placeholder: "CNC, corte laser, doblez", required: true },
    { key: "drawing", label: "Plano / archivo", placeholder: "DWG, STEP, PDF" },
    { key: "tolerance", label: "Tolerancia critica", placeholder: "+/-0.1 mm" },
    { key: "finish", label: "Acabado", placeholder: "Anodizado, pintura, natural" }
  ],
  comprado: [
    { key: "brandModel", label: "Marca / modelo", placeholder: "Marca y modelo exacto" },
    { key: "criticalSpec", label: "Especificacion critica", placeholder: "Dimension, capacidad, rating" },
    { key: "datasheet", label: "Ficha / link", placeholder: "https://..." }
  ],
  "servicio-externo": [
    { key: "serviceType", label: "Tipo de servicio", placeholder: "Maquinado, pintura, tratamiento", required: true },
    { key: "deliverable", label: "Entregable", placeholder: "Pieza tratada, certificado, reporte" },
    { key: "requirement", label: "Requisito critico", placeholder: "Tolerancia, acabado, norma" }
  ],
  empaque: [
    { key: "size", label: "Medida", placeholder: "20 x 15 x 8 cm" },
    { key: "material", label: "Material / tipo", placeholder: "Carton corrugado, foam" },
    { key: "labeling", label: "Etiqueta / impresion", placeholder: "SKU, logo, advertencia" }
  ],
  otro: [
    { key: "description", label: "Descripcion tecnica", placeholder: "Que lo distingue exactamente", required: true },
    { key: "criticalSpec", label: "Especificacion critica", placeholder: "Valor, medida o condicion clave" }
  ]
};

export function getProductComponentSpecFields(type: ProductComponentType) {
  return productComponentSpecTemplates[type] ?? [];
}

export function normalizeProductComponentSpecs(type: ProductComponentType, specs: ProductComponent["specs"] = {}) {
  const fields = getProductComponentSpecFields(type);
  const allowedKeys = new Set(fields.map((field) => field.key));

  return Object.fromEntries(
    Object.entries(specs)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0)
  );
}

export function formatProductComponentSpecs(type: ProductComponentType, specs: ProductComponent["specs"] = {}) {
  return getProductComponentSpecFields(type)
    .map((field) => {
      const value = specs[field.key]?.trim();

      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

const skuStopWords = new Set(["DE", "DEL", "CON", "PARA", "Y", "LA", "EL", "LOS", "LAS", "UN", "UNA", "THE", "AND", "OF", "FOR"]);

function normalizeSkuText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createProductSkuPrefix(productName: string) {
  const words = normalizeSkuText(productName)
    .split(/[^A-Z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !skuStopWords.has(word));

  const modelCode = words.find((word) => /[A-Z]/.test(word) && /\d/.test(word));

  if (modelCode) {
    return modelCode.slice(0, 6);
  }

  if (words.length === 0) {
    return "PRD";
  }

  if (words.length === 1) {
    return words[0].slice(0, 4).padEnd(3, "X").slice(0, 4);
  }

  return words
    .slice(0, 4)
    .map((word) => word[0])
    .join("")
    .padEnd(3, "X")
    .slice(0, 4);
}

export function generateProductSku(productName: string, products: Pick<Product, "id" | "sku">[], currentProductId?: string) {
  const prefix = createProductSkuPrefix(productName);
  const skuPattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const highestSuffix = products.reduce((highest, product) => {
    if (product.id === currentProductId) {
      return highest;
    }

    const match = product.sku.trim().toUpperCase().match(skuPattern);

    return match ? Math.max(highest, Number(match[1] || 0)) : highest;
  }, 0);

  return `${prefix}-${String(highestSuffix + 1).padStart(3, "0")}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatCurrency(value: number, currency: ProductCurrency = "MXN") {
  const symbol = currency === "EUR" ? "€" : "$";
  const amount = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

  return `${symbol}${amount} ${currency}`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export const emptyShippingAddress: ShippingAddress = {
  recipientName: "",
  recipientPhone: "",
  recipientEmail: "",
  company: "",
  street: "",
  exteriorNumber: "",
  interiorNumber: "",
  neighborhood: "",
  postalCode: "",
  city: "",
  state: "",
  country: "México",
  deliveryMethod: "por-definir",
  deliveryHours: "",
  references: "",
  deliveryInstructions: "",
  locationLink: ""
};

export function normalizeShippingAddress(value: ShippingAddress | string | null | undefined): ShippingAddress {
  if (typeof value === "string") {
    return {
      ...emptyShippingAddress,
      references: value
    };
  }

  return {
    ...emptyShippingAddress,
    ...(value ?? {})
  };
}

export function isShippingAddressComplete(value: ShippingAddress | string | null | undefined) {
  const address = normalizeShippingAddress(value);
  const requiredFields = [
    address.recipientName,
    address.recipientPhone,
    address.street,
    address.exteriorNumber,
    address.neighborhood,
    address.postalCode,
    address.city,
    address.state,
    address.country,
    address.deliveryMethod === "por-definir" ? "" : address.deliveryMethod
  ];

  return requiredFields.every((field) => field.trim().length > 0);
}

export function formatShippingAddress(value: ShippingAddress | string | null | undefined) {
  const address = normalizeShippingAddress(value);
  const streetLine = [address.street, address.exteriorNumber].filter(Boolean).join(" ");
  const locationLine = [address.neighborhood, address.city, address.state].filter(Boolean).join(", ");
  const postalLine = address.postalCode ? `CP ${address.postalCode}` : "";
  const summary = [streetLine, locationLine, postalLine].filter(Boolean).join(" · ");

  return summary || "Sin dirección de envío";
}

export function calculateClientStatus(client: Omit<Client, "id" | "status">, currentStatus?: ClientStatus) {
  if (currentStatus === "bloqueado" || currentStatus === "inactivo") {
    return currentStatus;
  }

  const requiredFields = [
    client.commercialName,
    client.legalName,
    client.taxId,
    client.contactName,
    client.email,
    client.phone,
    client.fiscalAddress,
    isShippingAddressComplete(client.shippingAddress) ? "direccion-envio-completa" : "",
    client.paymentTerm === "pendiente" ? "" : client.paymentTerm
  ];

  return requiredFields.every((field) => field.trim().length > 0) ? "activo" : "incompleto";
}

export function clientMatches(client: Client, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    client.commercialName,
    client.legalName,
    client.taxId,
    client.email,
    client.phone,
    ...Object.values(normalizeShippingAddress(client.shippingAddress))
  ].some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function productMatches(product: Product, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableFields = [
    product.name,
    product.sku,
    product.category,
    product.shortDescription,
    ...product.components.flatMap((component) => {
      const origin = getProductComponentOrigin(component);
      const process = normalizeProductComponentProcess(component.type, origin, component.process);

      return [
        component.name,
        component.material,
        componentOriginLabels[origin],
        componentProcessLabels[process],
        supplierContactMethodLabels[component.supplierContactMethod],
        component.supplierExternalPlatform,
        component.supplierCompany,
        component.supplierPartNumber,
        component.needsSupplierResearch ? "sin proveedor pendiente compras" : "",
        component.supplierResearchNotes,
        ...component.printDesigns.flatMap((design) => [design.printer, design.fileName])
      ];
    })
  ];

  return searchableFields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function lineSubtotal(line: OrderLine) {
  const rawSubtotal = line.quantity * line.unitPrice;
  return Math.max(rawSubtotal - line.discount, 0);
}

export function orderTotals(lines: OrderLine[]) {
  const subtotal = lines.reduce((total, line) => total + lineSubtotal(line), 0);
  const taxes = subtotal * 0.16;

  return {
    subtotal,
    taxes,
    total: subtotal + taxes
  };
}

export function isValidLine(line: OrderLine) {
  if (line.product.status !== "activo" || line.quantity <= 0) {
    return false;
  }

  if (line.product.unit === "pieza" && !Number.isInteger(line.quantity)) {
    return false;
  }

  return true;
}

export function createInitialOrder(user: SalesUser): SalesOrder {
  const createdAt = new Date().toISOString();
  const folio = `HV-V-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  return {
    folio,
    seller: user.name,
    createdAt,
    status: "borrador",
    commercialStatus: "captura",
    selectedClientId: null,
    lines: [],
    requiredDate: "",
    priority: "normal",
    priorityReason: "",
    internalNotes: "",
    paymentTerm: "pendiente",
    paymentMethod: "por-definir",
    paymentLink: "",
    paymentVerifiedBy: null,
    paymentVerifiedAt: null,
    creditReviewedBy: null,
    creditReviewedAt: null,
    documents: [],
    history: []
  };
}

function baseDocumentChecklist(order: SalesOrder, client: Client | undefined) {
  const selectedClient = Boolean(client);
  const clientAvailable = client ? client.status !== "bloqueado" : false;
  const hasValidProduct = order.lines.length > 0 && order.lines.every(isValidLine);
  const requiredDateOk = Boolean(order.requiredDate) && order.requiredDate >= todayIso();
  const priorityOk = Boolean(order.priority);
  const priorityReasonOk =
    order.priority !== "urgente" && order.priority !== "critica"
      ? true
      : order.priorityReason.trim().length > 0;

  return {
    selectedClient,
    clientAvailable,
    hasValidProduct,
    requiredDateOk,
    priorityOk,
    priorityReasonOk
  };
}

export type ChecklistItem = {
  id: string;
  label: string;
  passed: boolean;
};

export function evaluateQuote(order: SalesOrder, client: Client | undefined) {
  const base = baseDocumentChecklist(order, client);
  const clientContactOk = Boolean(client?.email.trim() || client?.phone.trim());

  const checklist: ChecklistItem[] = [
    { id: "client-selected", label: "Cliente seleccionado", passed: base.selectedClient },
    { id: "client-available", label: "Cliente no bloqueado", passed: base.clientAvailable },
    { id: "client-contact", label: "Cliente con correo o teléfono", passed: clientContactOk },
    { id: "product", label: "Al menos un producto activo seleccionado", passed: base.hasValidProduct },
    { id: "quantity", label: "Cantidades válidas en todas las líneas", passed: order.lines.every(isValidLine) && order.lines.length > 0 },
    { id: "date", label: "Fecha requerida capturada y vigente", passed: base.requiredDateOk },
    { id: "priority", label: "Prioridad definida", passed: base.priorityOk },
    { id: "priority-reason", label: "Motivo de prioridad cuando aplica", passed: base.priorityReasonOk }
  ];

  return {
    checklist,
    canSend: checklist.every((item) => item.passed) && order.status !== "cancelada"
  };
}

export function evaluateOrderDraft(order: SalesOrder, client: Client | undefined) {
  const base = baseDocumentChecklist(order, client);
  const clientIsActive = client?.status === "activo";
  const clientComplete = client ? client.status !== "incompleto" : false;
  const paymentTermOk = order.paymentTerm !== "pendiente";
  const paymentMethodOk = order.paymentMethod !== "por-definir";

  const checklist: ChecklistItem[] = [
    { id: "client-selected", label: "Cliente seleccionado", passed: base.selectedClient },
    { id: "client-active", label: "Cliente activo", passed: clientIsActive },
    { id: "client-complete", label: "Datos obligatorios del cliente completos", passed: clientComplete },
    { id: "product", label: "Al menos un producto activo seleccionado", passed: base.hasValidProduct },
    { id: "quantity", label: "Cantidades válidas en todas las líneas", passed: order.lines.every(isValidLine) && order.lines.length > 0 },
    { id: "date", label: "Fecha requerida capturada y vigente", passed: base.requiredDateOk },
    { id: "priority", label: "Prioridad definida", passed: base.priorityOk },
    { id: "priority-reason", label: "Motivo de prioridad cuando aplica", passed: base.priorityReasonOk },
    { id: "payment-term", label: "Condición de pago definida", passed: paymentTermOk },
    { id: "payment-method", label: "Método de pago definido", passed: paymentMethodOk }
  ];

  return {
    checklist,
    canGenerate: checklist.every((item) => item.passed) && order.status !== "cancelada"
  };
}

export function evaluateOrder(order: SalesOrder, client: Client | undefined) {
  const base = baseDocumentChecklist(order, client);
  const clientIsActive = client?.status === "activo";
  const clientComplete = client ? client.status !== "incompleto" : false;
  const paymentTermOk = order.paymentTerm !== "pendiente";
  const paymentMethodOk = order.paymentMethod !== "por-definir";
  const paymentOk =
    order.paymentTerm === "contado" || order.paymentTerm === "anticipo"
      ? order.commercialStatus === "pago-verificado"
      : true;
  const creditOk = order.paymentTerm === "credito" ? order.commercialStatus === "credito-aprobado" : true;

  const checklist: ChecklistItem[] = [
    { id: "client-selected", label: "Cliente seleccionado", passed: base.selectedClient },
    { id: "client-active", label: "Cliente activo", passed: clientIsActive },
    { id: "client-complete", label: "Datos obligatorios del cliente completos", passed: clientComplete },
    { id: "product", label: "Al menos un producto activo seleccionado", passed: base.hasValidProduct },
    { id: "quantity", label: "Cantidades válidas en todas las líneas", passed: order.lines.every(isValidLine) && order.lines.length > 0 },
    { id: "date", label: "Fecha requerida capturada y vigente", passed: base.requiredDateOk },
    { id: "priority", label: "Prioridad definida", passed: base.priorityOk },
    { id: "priority-reason", label: "Motivo de prioridad cuando aplica", passed: base.priorityReasonOk },
    { id: "payment-term", label: "Condición de pago definida", passed: paymentTermOk },
    { id: "payment-method", label: "Método de pago definido", passed: paymentMethodOk },
    { id: "payment-credit", label: "Pago o crédito aprobado si aplica", passed: paymentOk && creditOk }
  ];

  return {
    checklist,
    canApprove: checklist.every((item) => item.passed) && order.status !== "cancelada"
  };
}
