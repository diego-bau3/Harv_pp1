import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit3,
  FileUp,
  PackagePlus,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { initialClients, salesUser } from "../data";
import type {
  Client,
  DocumentType,
  HistoryEvent,
  OrderLine,
  PaymentMethod,
  PaymentTerm,
  Priority,
  Product,
  ProductCurrency,
  SalesDocument,
  SalesOrder,
  SalesQuote
} from "../types";
import {
  calculateClientStatus,
  clientMatches,
  clientStatusLabels,
  createId,
  createInitialOrder,
  documentTypeLabels,
  evaluateOrderDraft,
  evaluateQuote,
  formatCurrency,
  formatDateTime,
  formatShippingAddress,
  isValidLine,
  lineSubtotal,
  orderStatusLabels,
  orderTotals,
  paymentMethodLabels,
  paymentTermLabels,
  priorityLabels,
  quoteStatusLabels,
  salesClientsStorageKey,
  salesGeneratedOrdersStorageKey,
  salesSentQuotesStorageKey
} from "../utils";
import { downloadSalesQuotePdf } from "../quotePdf";
import { ClientModal } from "./ClientModal";
import { ProductModal } from "./ProductModal";

type SalesViewProps = {
  onBack: () => void;
  products: Product[];
};

type ClientDraft = Omit<Client, "id" | "status">;

function createHistory(action: string, detail: string): HistoryEvent {
  return {
    id: createId("history"),
    user: salesUser.name || "Ventas",
    at: new Date().toISOString(),
    action,
    detail
  };
}

function withHistory(currentOrder: SalesOrder, nextOrder: SalesOrder, action: string, detail: string) {
  return {
    ...nextOrder,
    history: [createHistory(action, detail), ...currentOrder.history]
  };
}

function currencyForLines(lines: OrderLine[]): ProductCurrency {
  return lines[0]?.product.currency ?? "MXN";
}

function createQuoteFolio() {
  return `HV-C-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generatedOrderStatus(order: SalesOrder) {
  if (order.paymentTerm === "credito" && order.commercialStatus !== "credito-aprobado") {
    return "pendiente-credito" as const;
  }

  if ((order.paymentTerm === "contado" || order.paymentTerm === "anticipo") && order.commercialStatus !== "pago-verificado") {
    return "pendiente-pago" as const;
  }

  return "aprobada-comercialmente" as const;
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

function saveStoredList<Item>(key: string, value: Item[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function SalesView({ onBack, products }: SalesViewProps) {
  const [clients, setClients] = useState<Client[]>(() => loadStoredList(salesClientsStorageKey, initialClients));
  const [order, setOrder] = useState<SalesOrder>(() => createInitialOrder(salesUser));
  const [sentQuotes, setSentQuotes] = useState<SalesQuote[]>(() => loadStoredList(salesSentQuotesStorageKey, []));
  const [generatedOrders, setGeneratedOrders] = useState<SalesOrder[]>(() =>
    loadStoredList(salesGeneratedOrdersStorageKey, [])
  );
  const [clientQuery, setClientQuery] = useState("");
  const [clientModal, setClientModal] = useState<{ client?: Client } | null>(null);
  const [isProductModalOpen, setProductModalOpen] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType>("orden-compra-cliente");
  const [quotePdfState, setQuotePdfState] = useState<Record<string, "idle" | "generating" | "error">>({});
  const [quotePdfMessage, setQuotePdfMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === order.selectedClientId),
    [clients, order.selectedClientId]
  );

  const clientResults = useMemo(() => {
    return clients.filter((client) => clientMatches(client, clientQuery));
  }, [clientQuery, clients]);

  const totals = useMemo(() => orderTotals(order.lines), [order.lines]);
  const orderCurrency = currencyForLines(order.lines);
  const quoteEvaluation = useMemo(() => evaluateQuote(order, selectedClient), [order, selectedClient]);
  const orderDraftEvaluation = useMemo(() => evaluateOrderDraft(order, selectedClient), [order, selectedClient]);
  const quoteMissingItems = quoteEvaluation.checklist.filter((item) => !item.passed);
  const orderMissingItems = orderDraftEvaluation.checklist.filter((item) => !item.passed);

  useEffect(() => {
    saveStoredList(salesClientsStorageKey, clients);
  }, [clients]);

  useEffect(() => {
    saveStoredList(salesSentQuotesStorageKey, sentQuotes);
  }, [sentQuotes]);

  useEffect(() => {
    saveStoredList(salesGeneratedOrdersStorageKey, generatedOrders);
  }, [generatedOrders]);

  function updateOrder(patch: Partial<SalesOrder>, action?: string, detail?: string) {
    setOrder((currentOrder) => {
      const nextOrder = { ...currentOrder, ...patch };
      return action && detail ? withHistory(currentOrder, nextOrder, action, detail) : nextOrder;
    });
  }

  function selectClient(client: Client) {
    setOrder((currentOrder) => {
      const nextOrder: SalesOrder = {
        ...currentOrder,
        selectedClientId: client.id,
        paymentTerm: client.paymentTerm,
        status: client.status === "incompleto" ? "pendiente-informacion" : currentOrder.status
      };

      return withHistory(currentOrder, nextOrder, "Cliente seleccionado", `Se seleccionó ${client.commercialName}.`);
    });
  }

  function saveClient(draft: ClientDraft, existingClient?: Client) {
    const status = calculateClientStatus(draft, existingClient?.status);
    const savedClient: Client = {
      ...draft,
      id: existingClient?.id ?? createId("client"),
      status
    };

    setClients((currentClients) => {
      if (existingClient) {
        return currentClients.map((client) => (client.id === existingClient.id ? savedClient : client));
      }

      return [savedClient, ...currentClients];
    });

    setOrder((currentOrder) => {
      const nextOrder: SalesOrder = {
        ...currentOrder,
        selectedClientId: savedClient.id,
        paymentTerm: savedClient.paymentTerm,
        status: savedClient.status === "incompleto" ? "pendiente-informacion" : currentOrder.status
      };
      const action = existingClient ? "Edición de cliente" : "Creación de cliente";
      const detail = `${savedClient.commercialName} quedó como ${clientStatusLabels[savedClient.status].toLowerCase()}.`;

      return withHistory(currentOrder, nextOrder, action, detail);
    });

    setClientModal(null);
    setClientQuery("");
  }

  function addProduct(product: Product) {
    if (product.status !== "activo") {
      return;
    }

    setOrder((currentOrder) => {
      const existingLine = currentOrder.lines.find((line) => line.product.id === product.id);
      const lines = existingLine
        ? currentOrder.lines.map((line) =>
            line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
          )
        : [
            ...currentOrder.lines,
            {
              id: createId("line"),
              product,
              quantity: 1,
              unitPrice: product.basePrice,
              discount: 0,
              notes: ""
            }
          ];

      const nextOrder = {
        ...currentOrder,
        lines,
        status: currentOrder.status === "pendiente-producto" ? "borrador" : currentOrder.status
      };

      return withHistory(currentOrder, nextOrder, "Producto agregado", `${product.sku} - ${product.name}.`);
    });

    setProductModalOpen(false);
  }

  function updateLine(lineId: string, patch: Partial<OrderLine>, action: string, detail: string) {
    setOrder((currentOrder) => {
      const nextOrder = {
        ...currentOrder,
        lines: currentOrder.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
      };

      return withHistory(currentOrder, nextOrder, action, detail);
    });
  }

  function removeLine(line: OrderLine) {
    setOrder((currentOrder) => {
      const nextOrder = {
        ...currentOrder,
        lines: currentOrder.lines.filter((currentLine) => currentLine.id !== line.id)
      };

      return withHistory(currentOrder, nextOrder, "Producto eliminado", `${line.product.sku} - ${line.product.name}.`);
    });
  }

  function changePaymentTerm(paymentTerm: PaymentTerm) {
    const commercialStatus =
      paymentTerm === "credito" ? "pendiente-credito" : paymentTerm === "pendiente" ? "captura" : "pendiente-pago";

    updateOrder(
      {
        paymentTerm,
        commercialStatus,
        paymentVerifiedAt: null,
        paymentVerifiedBy: null,
        creditReviewedAt: null,
        creditReviewedBy: null,
        status:
          paymentTerm === "credito"
            ? "pendiente-credito"
            : paymentTerm === "pendiente"
              ? "pendiente-informacion"
              : "pendiente-pago"
      },
      "Condición de pago modificada",
      paymentTermLabels[paymentTerm]
    );
  }

  function attachDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    const uploadedAt = new Date().toISOString();
    const documents: SalesDocument[] = files.map((file) => ({
      id: createId("doc"),
      fileName: file.name,
      type: documentType,
      uploadedAt
    }));

    setOrder((currentOrder) => {
      const nextOrder = {
        ...currentOrder,
        documents: [...documents, ...currentOrder.documents]
      };
      const names = documents.map((document) => document.fileName).join(", ");

      return withHistory(currentOrder, nextOrder, "Documento adjuntado", names);
    });

    event.target.value = "";
  }

  function verifyPayment() {
    if (!salesUser.permissions.verifyPayment) {
      return;
    }

    updateOrder(
      {
        commercialStatus: "pago-verificado",
        status: order.status === "pendiente-pago" ? "borrador" : order.status,
        paymentVerifiedAt: new Date().toISOString(),
        paymentVerifiedBy: salesUser.name || "Ventas"
      },
      "Pago verificado",
      `Verificado por ${salesUser.name || "Ventas"}.`
    );
  }

  function markCredit(status: "pendiente" | "aprobado" | "rechazado") {
    if (!salesUser.permissions.approveCredit) {
      return;
    }

    const statusMap = {
      pendiente: {
        orderStatus: "pendiente-credito" as const,
        commercialStatus: "pendiente-credito" as const,
        action: "Orden marcada pendiente de crédito",
        detail: "Crédito pendiente de revisión."
      },
      aprobado: {
        orderStatus: order.status === "pendiente-credito" ? ("borrador" as const) : order.status,
        commercialStatus: "credito-aprobado" as const,
        action: "Crédito aprobado",
        detail: `Aprobado por ${salesUser.name || "Ventas"}.`
      },
      rechazado: {
        orderStatus: "pendiente-credito" as const,
        commercialStatus: "credito-rechazado" as const,
        action: "Crédito rechazado",
        detail: `Rechazado por ${salesUser.name || "Ventas"}.`
      }
    }[status];

    updateOrder(
      {
        status: statusMap.orderStatus,
        commercialStatus: statusMap.commercialStatus,
        creditReviewedAt: status === "pendiente" ? null : new Date().toISOString(),
        creditReviewedBy: status === "pendiente" ? null : salesUser.name || "Ventas"
      },
      statusMap.action,
      statusMap.detail
    );
  }

  function saveDraft() {
    updateOrder({ status: "borrador" }, "Orden guardada", "Se guardó como borrador.");
  }

  function sendQuote() {
    if (!quoteEvaluation.canSend) {
      return;
    }

    const sentAt = new Date().toISOString();
    const quoteFolio = createQuoteFolio();
    const sentQuote: SalesQuote = {
      folio: quoteFolio,
      seller: salesUser.name,
      createdAt: order.createdAt,
      sentAt,
      status: "enviada",
      selectedClientId: order.selectedClientId,
      lines: order.lines,
      requiredDate: order.requiredDate,
      priority: order.priority,
      priorityReason: order.priorityReason,
      internalNotes: order.internalNotes,
      paymentTerm: order.paymentTerm,
      paymentMethod: order.paymentMethod,
      documents: order.documents,
      history: [createHistory("Cotización enviada", `La cotización ${quoteFolio} fue enviada.`), ...order.history]
    };

    setSentQuotes((currentQuotes) => [sentQuote, ...currentQuotes]);
    setOrder(createInitialOrder(salesUser));
  }

  function generateOrder() {
    if (!orderDraftEvaluation.canGenerate) {
      return;
    }

    const nextStatus = generatedOrderStatus(order);
    const completedOrder = withHistory(
      order,
      { ...order, status: nextStatus },
      "Orden generada",
      nextStatus === "aprobada-comercialmente"
        ? `La orden ${order.folio} fue generada y aprobada comercialmente.`
        : `La orden ${order.folio} fue generada como ${orderStatusLabels[nextStatus].toLowerCase()}.`
    );

    setGeneratedOrders((currentOrders) => [completedOrder, ...currentOrders]);
    setOrder(createInitialOrder(salesUser));
  }

  async function downloadQuotePdf(quote: SalesQuote, client?: Client) {
    setQuotePdfMessage("");
    setQuotePdfState((currentState) => ({ ...currentState, [quote.folio]: "generating" }));

    try {
      await downloadSalesQuotePdf(quote, client);
      setQuotePdfState((currentState) => ({ ...currentState, [quote.folio]: "idle" }));
    } catch (error) {
      setQuotePdfState((currentState) => ({ ...currentState, [quote.folio]: "error" }));
      setQuotePdfMessage(error instanceof Error ? error.message : "No se pudo descargar la cotizacion.");
    }
  }

  function markGeneratedOrderPaid(orderFolio: string) {
    if (!salesUser.permissions.verifyPayment) {
      return;
    }

    setGeneratedOrders((currentOrders) =>
      currentOrders.map((generatedOrder) =>
        generatedOrder.folio === orderFolio
          ? {
              ...generatedOrder,
              status: "aprobada-comercialmente",
              commercialStatus: "pago-verificado",
              paymentVerifiedAt: new Date().toISOString(),
              paymentVerifiedBy: salesUser.name || "Ventas",
              history: [
                createHistory("Pago verificado", `La orden ${generatedOrder.folio} fue marcada como pagada.`),
                ...generatedOrder.history
              ]
            }
          : generatedOrder
      )
    );
  }

  function cancelOrder() {
    if (!salesUser.permissions.cancelOrder) {
      return;
    }

    updateOrder({ status: "cancelada" }, "Cancelación", `La orden ${order.folio} fue cancelada.`);
  }

  function resetOrder() {
    setOrder(createInitialOrder(salesUser));
  }

  const clientAlert =
    selectedClient?.status === "bloqueado"
      ? "Cliente bloqueado. No se puede generar la orden."
      : selectedClient?.status === "incompleto"
        ? "Cliente incompleto. Puedes guardar la orden como borrador."
        : null;

  return (
    <main className="sales-view">
      <header className="sales-topbar">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="sales-title">
          <span>Ventas</span>
          <h1>Cotizaciones y órdenes</h1>
        </div>
        <span className={`order-status status-${order.status}`}>{orderStatusLabels[order.status]}</span>
      </header>

      <section className="sales-workspace">
        <section className="sales-panel clients-panel">
          <div className="clean-section-heading">
            <div>
              <h2>Clientes</h2>
              <p>Registra o selecciona el cliente para la orden.</p>
            </div>
            <button className="primary-button" onClick={() => setClientModal({})} type="button">
              <Plus size={17} />
              Agregar nuevo cliente
            </button>
          </div>

          <label className="search-field client-search">
            <Search size={18} aria-hidden="true" />
            <input
              value={clientQuery}
              onChange={(event) => setClientQuery(event.target.value)}
              placeholder="Buscar cliente"
            />
          </label>

          <div className="client-clean-list">
            {clientResults.map((client) => (
              <article className={`client-clean-row ${client.id === selectedClient?.id ? "selected" : ""}`} key={client.id}>
                <span className="client-avatar" aria-hidden="true">
                  <UserRound size={18} />
                </span>
                <div className="client-clean-copy">
                  <strong>{client.commercialName}</strong>
                  <span>
                    {client.legalName || "Sin razón social"} · {client.taxId || "Sin RFC"}
                  </span>
                  <span>{formatShippingAddress(client.shippingAddress)}</span>
                </div>
                <span className={`status-pill ${client.status}`}>{clientStatusLabels[client.status]}</span>
                <div className="client-actions">
                  <button className="secondary-button compact-button" onClick={() => setClientModal({ client })} type="button">
                    <Edit3 size={15} />
                    Editar
                  </button>
                  <button className="secondary-button compact-button" onClick={() => selectClient(client)} type="button">
                    Seleccionar
                  </button>
                </div>
              </article>
            ))}

            {clients.length === 0 ? <p className="empty-state">Todavía no hay clientes registrados.</p> : null}
            {clients.length > 0 && clientResults.length === 0 ? (
              <p className="empty-state">No hay clientes con esa búsqueda.</p>
            ) : null}
          </div>
        </section>

        <section className="sales-panel order-builder-panel">
          <div className="clean-section-heading">
            <div>
              <h2>Generar cotización u orden</h2>
              <p>Captura cliente, producto, cantidad, entrega y condiciones comerciales.</p>
            </div>
            <div className="button-row">
              <button className="secondary-button" onClick={resetOrder} type="button">
                Nueva orden
              </button>
              <button className="secondary-button" onClick={saveDraft} type="button">
                <Save size={16} />
                Guardar borrador
              </button>
            </div>
          </div>

          <div className="order-builder-grid">
            <div className="order-capture">
              <div className="order-meta-strip">
                <div>
                  <span>Folio</span>
                  <strong>{order.folio}</strong>
                </div>
                <div>
                  <span>Cliente</span>
                  <strong>{selectedClient?.commercialName || "Sin seleccionar"}</strong>
                </div>
                <div>
                  <span>Estado</span>
                  <strong>{orderStatusLabels[order.status]}</strong>
                </div>
              </div>

              <div className="form-grid two-columns">
                <label className="field">
                  <span>Seleccionar cliente</span>
                  <select
                    disabled={clients.length === 0}
                    value={order.selectedClientId ?? ""}
                    onChange={(event) => {
                      const client = clients.find((currentClient) => currentClient.id === event.target.value);
                      if (client) {
                        selectClient(client);
                      }
                    }}
                  >
                    <option value="">Selecciona un cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.commercialName}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field">
                  <span>Seleccionar producto</span>
                  <button className="secondary-button input-height-button" onClick={() => setProductModalOpen(true)} type="button">
                    <PackagePlus size={16} />
                    Seleccionar producto
                  </button>
                </div>

                <label className="field">
                  <span>Fecha de entrega</span>
                  <input
                    type="date"
                    value={order.requiredDate}
                    onChange={(event) =>
                      updateOrder(
                        { requiredDate: event.target.value },
                        "Fecha de entrega modificada",
                        event.target.value || "Sin fecha"
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Prioridad</span>
                  <select
                    value={order.priority}
                    onChange={(event) =>
                      updateOrder(
                        { priority: event.target.value as Priority },
                        "Prioridad modificada",
                        priorityLabels[event.target.value as Priority]
                      )
                    }
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {(order.priority === "urgente" || order.priority === "critica") && (
                  <label className="field wide-field">
                    <span>Motivo de prioridad</span>
                    <input
                      value={order.priorityReason}
                      onChange={(event) => updateOrder({ priorityReason: event.target.value })}
                    />
                  </label>
                )}
              </div>

              <div className="line-items clean-line-items">
                <div className="line-header">
                  <span>Producto</span>
                  <span>Cantidad</span>
                  <span>Precio</span>
                  <span>Descuento</span>
                  <span>Subtotal</span>
                  <span>Notas</span>
                  <span />
                </div>

                {order.lines.map((line) => {
                  const validLine = isValidLine(line);

                  return (
                    <div className={`line-row ${validLine ? "" : "invalid"}`} key={line.id}>
                      <div className="line-product">
                        <strong>{line.product.name}</strong>
                        <span>
                          {line.product.sku} · {line.product.unit} · {line.product.currency}
                        </span>
                      </div>
                      <input
                        min="0"
                        step={line.product.unit === "pieza" ? "1" : "0.01"}
                        type="number"
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(
                            line.id,
                            { quantity: Number(event.target.value) },
                            "Cantidad modificada",
                            `${line.product.sku}: ${event.target.value}`
                          )
                        }
                      />
                      <input
                        min="0"
                        type="number"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateLine(
                            line.id,
                            { unitPrice: Number(event.target.value) },
                            "Precio modificado",
                            `${line.product.sku}: ${formatCurrency(Number(event.target.value), line.product.currency)}`
                          )
                        }
                      />
                      <input
                        min="0"
                        type="number"
                        value={line.discount}
                        onChange={(event) =>
                          updateLine(
                            line.id,
                            { discount: Number(event.target.value) },
                            "Descuento modificado",
                            `${line.product.sku}: ${formatCurrency(Number(event.target.value), line.product.currency)}`
                          )
                        }
                      />
                      <strong>{formatCurrency(lineSubtotal(line), line.product.currency)}</strong>
                      <input
                        value={line.notes}
                        onChange={(event) =>
                          updateLine(line.id, { notes: event.target.value }, "Nota de línea", line.product.sku)
                        }
                        placeholder="Notas"
                      />
                      <button
                        className="icon-button ghost"
                        onClick={() => removeLine(line)}
                        type="button"
                        aria-label="Eliminar producto"
                      >
                        <Trash2 size={17} />
                      </button>
                      {!validLine ? <p className="line-error">Cantidad inválida para este producto.</p> : null}
                    </div>
                  );
                })}

                {order.lines.length === 0 ? <p className="empty-state">Sin productos seleccionados.</p> : null}
              </div>

              <div className="form-grid two-columns">
                <label className="field">
                  <span>Condición de pago</span>
                  <select value={order.paymentTerm} onChange={(event) => changePaymentTerm(event.target.value as PaymentTerm)}>
                    {Object.entries(paymentTermLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Método de pago</span>
                  <select
                    value={order.paymentMethod}
                    onChange={(event) =>
                      updateOrder(
                        { paymentMethod: event.target.value as PaymentMethod },
                        "Método de pago modificado",
                        paymentMethodLabels[event.target.value as PaymentMethod]
                      )
                    }
                  >
                    {Object.entries(paymentMethodLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {(order.paymentTerm === "contado" || order.paymentTerm === "anticipo") && (
                  <>
                    <label className="field wide-field">
                      <span>Link de pago</span>
                      <input
                        value={order.paymentLink}
                        onChange={(event) => updateOrder({ paymentLink: event.target.value })}
                        placeholder="https://"
                      />
                    </label>
                    <button className="secondary-button input-height-button" onClick={verifyPayment} type="button">
                      <CheckCircle2 size={16} />
                      Marcar pago verificado
                    </button>
                  </>
                )}
              </div>

              {order.paymentTerm === "credito" && (
                <div className="credit-tools clean-credit-tools">
                  <button className="secondary-button" onClick={() => markCredit("pendiente")} type="button">
                    Pendiente de crédito
                  </button>
                  <button className="secondary-button" onClick={() => markCredit("aprobado")} type="button">
                    <CheckCircle2 size={16} />
                    Crédito aprobado
                  </button>
                  <button className="secondary-button danger" onClick={() => markCredit("rechazado")} type="button">
                    <Ban size={16} />
                    Crédito rechazado
                  </button>
                </div>
              )}

              <div className="form-grid two-columns">
                <label className="field">
                  <span>Tipo de documento</span>
                  <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
                    {Object.entries(documentTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>Documentos</span>
                  <button className="secondary-button input-height-button" onClick={() => fileInputRef.current?.click()} type="button">
                    <FileUp size={16} />
                    Adjuntar documento
                  </button>
                  <input ref={fileInputRef} hidden multiple type="file" onChange={attachDocuments} />
                </div>
              </div>

              {order.documents.length > 0 ? (
                <div className="compact-document-list">
                  {order.documents.map((document) => (
                    <span key={document.id}>
                      {document.fileName} · {documentTypeLabels[document.type]}
                    </span>
                  ))}
                </div>
              ) : null}

              <label className="field">
                <span>Notas comerciales</span>
                <textarea
                  value={order.internalNotes}
                  onChange={(event) => updateOrder({ internalNotes: event.target.value })}
                />
              </label>

              {clientAlert ? (
                <div className={`inline-alert ${selectedClient?.status}`}>
                  <AlertCircle size={17} />
                  <span>{clientAlert}</span>
                </div>
              ) : null}
            </div>

            <aside className="order-total-card">
              <div>
                <span>Subtotal</span>
                <strong>{formatCurrency(totals.subtotal, orderCurrency)}</strong>
              </div>
              <div>
                <span>Impuestos</span>
                <strong>{formatCurrency(totals.taxes, orderCurrency)}</strong>
              </div>
              <div className="grand-total">
                <span>Total</span>
                <strong>{formatCurrency(totals.total, orderCurrency)}</strong>
              </div>

              {quoteMissingItems.length > 0 ? (
                <div className="order-missing">
                  <AlertCircle size={18} />
                  <span>Falta para cotizar: {quoteMissingItems.slice(0, 3).map((item) => item.label.toLowerCase()).join(", ")}.</span>
                </div>
              ) : (
                <div className="order-ready">
                  <CheckCircle2 size={18} />
                  <span>Cotización lista para enviar.</span>
                </div>
              )}

              {orderMissingItems.length > 0 ? (
                <div className="order-missing">
                  <AlertCircle size={18} />
                  <span>Falta para orden: {orderMissingItems.slice(0, 3).map((item) => item.label.toLowerCase()).join(", ")}.</span>
                </div>
              ) : (
                <div className="order-ready">
                  <CheckCircle2 size={18} />
                  <span>Orden lista para generar y cobrar.</span>
                </div>
              )}

              <div className="sales-document-actions">
                <button className="secondary-button" disabled={!quoteEvaluation.canSend} onClick={sendQuote} type="button">
                  <Send size={16} />
                  Enviar cotización
                </button>
                <button
                  className="approve-button generate-order-button"
                  disabled={!orderDraftEvaluation.canGenerate}
                  onClick={generateOrder}
                  type="button"
                >
                  <ClipboardCheck size={18} />
                  Generar orden
                </button>
              </div>
              <button className="secondary-button danger" onClick={cancelOrder} type="button">
                Cancelar
              </button>
            </aside>
          </div>
        </section>

        <section className="sales-panel quotations-panel">
          <div className="clean-section-heading">
            <div>
              <h2>Cotizaciones enviadas</h2>
              <p>Seguimiento comercial de cotizaciones mandadas al cliente.</p>
            </div>
          </div>

          <div className="generated-orders-list">
            {sentQuotes.map((quote) => {
              const quoteClient = clients.find((client) => client.id === quote.selectedClientId);
              const quoteTotal = orderTotals(quote.lines).total;
              const quoteCurrency = currencyForLines(quote.lines);
              const isPdfGenerating = quotePdfState[quote.folio] === "generating";

              return (
                <article className="generated-order-row quote-row" key={quote.folio}>
                  <div>
                    <span>Folio</span>
                    <strong>{quote.folio}</strong>
                  </div>
                  <div>
                    <span>Cliente</span>
                    <strong>{quoteClient?.commercialName || "Sin cliente"}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{formatCurrency(quoteTotal, quoteCurrency)}</strong>
                  </div>
                  <div>
                    <span>Enviada</span>
                    <strong>{formatDateTime(quote.sentAt)}</strong>
                  </div>
                  <span className={`order-status status-${quote.status}`}>{quoteStatusLabels[quote.status]}</span>
                  <div className="generated-order-actions quote-actions">
                    <button
                      className="secondary-button compact-button"
                      disabled={isPdfGenerating}
                      onClick={() => void downloadQuotePdf(quote, quoteClient)}
                      type="button"
                    >
                      <Download size={15} />
                      {isPdfGenerating ? "Generando" : "Descargar PDF"}
                    </button>
                  </div>
                </article>
              );
            })}

            {sentQuotes.length === 0 ? <p className="empty-state">Todavía no hay cotizaciones enviadas.</p> : null}
            {quotePdfMessage ? <p className="quote-pdf-message">{quotePdfMessage}</p> : null}
          </div>
        </section>

        <section className="sales-panel generated-orders-panel">
          <div className="clean-section-heading">
            <div>
              <h2>Órdenes por cobrar</h2>
              <p>Órdenes generadas desde Ventas con pago o crédito pendiente de seguimiento.</p>
            </div>
          </div>

          <div className="generated-orders-list">
            {generatedOrders.map((generatedOrder) => {
              const generatedClient = clients.find((client) => client.id === generatedOrder.selectedClientId);
              const generatedTotal = orderTotals(generatedOrder.lines).total;
              const generatedCurrency = currencyForLines(generatedOrder.lines);

              return (
                <article className="generated-order-row order-row" key={generatedOrder.folio}>
                  <div>
                    <span>Folio</span>
                    <strong>{generatedOrder.folio}</strong>
                  </div>
                  <div>
                    <span>Cliente</span>
                    <strong>{generatedClient?.commercialName || "Sin cliente"}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{formatCurrency(generatedTotal, generatedCurrency)}</strong>
                  </div>
                  <div>
                    <span>Pago</span>
                    <strong>{generatedOrder.paymentLink || paymentTermLabels[generatedOrder.paymentTerm]}</strong>
                  </div>
                  <div>
                    <span>Entrega</span>
                    <strong>{generatedOrder.requiredDate || "Sin fecha"}</strong>
                  </div>
                  <div className="generated-order-actions">
                    <span className={`order-status status-${generatedOrder.status}`}>{orderStatusLabels[generatedOrder.status]}</span>
                    {generatedOrder.status === "pendiente-pago" ? (
                      <button className="secondary-button compact-button" onClick={() => markGeneratedOrderPaid(generatedOrder.folio)} type="button">
                        <CheckCircle2 size={15} />
                        Marcar pagada
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {generatedOrders.length === 0 ? <p className="empty-state">Todavía no hay órdenes por cobrar.</p> : null}
          </div>
        </section>
      </section>

      {clientModal ? (
        <ClientModal client={clientModal.client} onClose={() => setClientModal(null)} onSave={saveClient} />
      ) : null}

      {isProductModalOpen ? <ProductModal products={products} onClose={() => setProductModalOpen(false)} onSelect={addProduct} /> : null}
    </main>
  );
}
