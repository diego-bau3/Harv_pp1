export type ClientStatus = "activo" | "incompleto" | "bloqueado" | "inactivo";

export type PaymentTerm = "contado" | "credito" | "anticipo" | "pendiente";

export type PaymentMethod = "transferencia" | "tarjeta" | "efectivo" | "credito" | "por-definir";

export type ProductStatus = "borrador" | "activo" | "inactivo";

export type ProductUnit = "pieza" | "metro" | "kg" | "g" | "ml" | "litro" | "set" | "paquete" | "rollo" | "formato";

export type ProductCurrency = "MXN" | "USD" | "EUR";

export type ProductSupplierContactMethod = "whatsapp" | "email" | "externa";

export type ShippingDeliveryMethod = "paqueteria" | "flete-propio" | "cliente-recoge" | "por-definir";

export type ShippingAddress = {
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  company: string;
  street: string;
  exteriorNumber: string;
  interiorNumber: string;
  neighborhood: string;
  postalCode: string;
  city: string;
  state: string;
  country: string;
  deliveryMethod: ShippingDeliveryMethod;
  deliveryHours: string;
  references: string;
  deliveryInstructions: string;
  locationLink: string;
};

export type ProductComponentType =
  | "pieza-impresa-3d"
  | "pieza-fabricada"
  | "tornilleria"
  | "motor"
  | "cableado"
  | "electronico"
  | "empaque"
  | "comprado"
  | "servicio-externo"
  | "otro";

export type ProductComponentOrigin = "fabricado-en-planta" | "comprado" | "servicio-externo" | "pendiente";

export type ProductComponentProcess =
  | "impresion-3d"
  | "cnc"
  | "corte-laser"
  | "doblado"
  | "soldadura"
  | "cableado"
  | "ensamble"
  | "acabado"
  | "fabricacion-manual"
  | "pendiente";

export type ProductComponentSpecs = Record<string, string>;

export type Priority = "normal" | "alta" | "urgente" | "critica";

export type OrderStatus =
  | "borrador"
  | "pendiente-informacion"
  | "pendiente-producto"
  | "pendiente-pago"
  | "pendiente-credito"
  | "aprobada-comercialmente"
  | "cancelada";

export type QuoteStatus = "enviada" | "seguimiento" | "aceptada" | "rechazada" | "vencida";

export type CommercialStatus =
  | "captura"
  | "pendiente-pago"
  | "pago-verificado"
  | "pendiente-credito"
  | "credito-aprobado"
  | "credito-rechazado";

export type DocumentType =
  | "orden-compra-cliente"
  | "comprobante-pago"
  | "documento-fiscal"
  | "cotizacion-firmada"
  | "otro";

export type Client = {
  id: string;
  commercialName: string;
  legalName: string;
  taxId: string;
  contactName: string;
  email: string;
  phone: string;
  fiscalAddress: string;
  shippingAddress: ShippingAddress;
  paymentTerm: PaymentTerm;
  notes: string;
  status: ClientStatus;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  shortDescription: string;
  category: string;
  basePrice: number;
  currency: ProductCurrency;
  unit: ProductUnit;
  status: ProductStatus;
  commercialNotes: string;
  technicalNotes: string;
  components: ProductComponent[];
};

export type ProductComponent = {
  id: string;
  name: string;
  type: ProductComponentType;
  quantity: number;
  unit: ProductUnit;
  origin: ProductComponentOrigin;
  process: ProductComponentProcess;
  specs: ProductComponentSpecs;
  material: string;
  color: string;
  supplierContactMethod: ProductSupplierContactMethod;
  supplierExternalPlatform: string;
  supplierCompany: string;
  supplierContact: string;
  supplierEmail: string;
  supplierPhone: string;
  supplierPartNumber: string;
  unitCost: number;
  leadTime: string;
  minimumPurchaseQuantity: string;
  referenceLink: string;
  needsSupplierResearch: boolean;
  supplierResearchNotes: string;
  printDesigns: ProductPrintDesign[];
  notes: string;
};

export type ProductPrintDesign = {
  id: string;
  printer: string;
  fileName: string;
  notes: string;
};

export type OrderLine = {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
  notes: string;
};

export type SalesDocument = {
  id: string;
  fileName: string;
  type: DocumentType;
  uploadedAt: string;
};

export type HistoryEvent = {
  id: string;
  user: string;
  at: string;
  action: string;
  detail: string;
};

export type SalesQuote = {
  folio: string;
  seller: string;
  createdAt: string;
  sentAt: string;
  status: QuoteStatus;
  selectedClientId: string | null;
  lines: OrderLine[];
  requiredDate: string;
  priority: Priority;
  priorityReason: string;
  internalNotes: string;
  paymentTerm: PaymentTerm;
  paymentMethod: PaymentMethod;
  documents: SalesDocument[];
  history: HistoryEvent[];
};

export type SalesOrder = {
  folio: string;
  seller: string;
  createdAt: string;
  status: OrderStatus;
  commercialStatus: CommercialStatus;
  selectedClientId: string | null;
  lines: OrderLine[];
  requiredDate: string;
  priority: Priority;
  priorityReason: string;
  internalNotes: string;
  paymentTerm: PaymentTerm;
  paymentMethod: PaymentMethod;
  paymentLink: string;
  paymentVerifiedBy: string | null;
  paymentVerifiedAt: string | null;
  creditReviewedBy: string | null;
  creditReviewedAt: string | null;
  documents: SalesDocument[];
  history: HistoryEvent[];
};

export type SalesUser = {
  name: string;
  permissions: {
    verifyPayment: boolean;
    approveCredit: boolean;
    approveCommercial: boolean;
    cancelOrder: boolean;
  };
};
