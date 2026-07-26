import {
  ArrowLeft,
  Banknote,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CircleAlert,
  Download,
  ExternalLink,
  Factory,
  PackageSearch,
  RefreshCw,
  UsersRound,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { FabricationMachine } from "../../fabrication/types";
import type { HumanResourcesEmployee } from "../../human-resources/types";
import {
  calculateEmployeeMonthlyCost,
  calculateHumanResourcesAreaFinance,
  calculateHumanResourcesFinanceAlerts,
  calculateHumanResourcesStats,
  createHumanResourcesFinanceCsv,
  humanResourcesAreaLabels,
  humanResourcesEmployeeStatusLabels,
  humanResourcesShiftLabels,
  loadStoredHumanResourcesEmployees
} from "../../human-resources/utils";
import type { PurchaseOrder } from "../../purchases/types";
import type { Product, ProductComponent, ProductCurrency, SalesOrder } from "../../sales/types";
import { formatCurrency, orderTotals, productStatusLabels, salesGeneratedOrdersStorageKey } from "../../sales/utils";
import type { WarehouseEntry, WarehouseMaterialType } from "../../warehouse/types";

type FinanceScreenProps = {
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  onBack: () => void;
};

type FinanceTabId = "dashboard" | "productos" | "personal" | "activos" | "empresa";

type FinanceTab = {
  id: FinanceTabId;
  label: string;
  detail: string;
  icon: LucideIcon;
};

type FinanceAgentStatus = "idle" | "working" | "ready" | "error";

type FinanceAssetValuationMethod = "internet" | "reference" | "manual" | "unavailable";

type FinanceAssetValuation = {
  assetId: string;
  marketValue: number;
  replacementValue: number;
  currency: ProductCurrency;
  confidence: number;
  sourceLabel: string;
  sourceUrl: string;
  lastValuedAt: string;
  method: FinanceAssetValuationMethod;
  message: string;
};

type FinanceDashboardSlice = {
  id: string;
  label: string;
  value: number;
  color: string;
};

type FinanceWarehouseValuation = {
  totalValue: number;
  availableValue: number;
  blockedValue: number;
  damagedValue: number;
  incomingValue: number;
  sellableFinishedGoodsValue: number;
  sellableFinishedGoodsUnits: number;
  potentialAssemblyValue: number;
  potentialAssemblyUnits: number;
  valueByType: FinanceDashboardSlice[];
};

const financeTabs: FinanceTab[] = [
  {
    id: "dashboard",
    label: "Dashboard mensual",
    detail: "Ingresos, egresos e inventario",
    icon: Banknote
  },
  {
    id: "productos",
    label: "Mis productos",
    detail: "Catalogo y precios",
    icon: PackageSearch
  },
  {
    id: "personal",
    label: "Personal",
    detail: "Equipo y nomina",
    icon: UsersRound
  },
  {
    id: "activos",
    label: "Activos fisicos",
    detail: "Maquinas y equipo",
    icon: Factory
  },
  {
    id: "empresa",
    label: "Empresa",
    detail: "Datos generales",
    icon: Building2
  }
];

const fabricationMachinesStorageKey = "harv:fabrication-machines:v1";
const financeAssetValuationsStorageKey = "harv:finance-asset-valuations:v1";
const warehouseEntriesStorageKey = "harv:warehouse-entries:v2";
const financeAgentBaseUrl = "http://127.0.0.1:8787";
const financeDashboardColors = {
  income: "#2f8f5b",
  expenses: "#a94f35",
  purchases: "#9b6b1f",
  personnel: "#667a4c",
  inventory: "#7d5a2f",
  finishedGoods: "#2f6f8f",
  blocked: "#8d6a2f",
  damaged: "#9a3826",
  incoming: "#486f9f",
  neutral: "#d8d0b7"
};

function formatMoney(value: number) {
  return formatCurrency(value, "MXN");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthLabel(value: string) {
  if (!value) {
    return "Mes actual";
  }

  const date = new Date(`${value}-02T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "Mes actual";
  }

  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function isSameMonth(value: string | null | undefined, month: string) {
  return Boolean(value && value.slice(0, 7) === month);
}

function normalizeDashboardKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function calculatePurchaseOrderTotal(order: PurchaseOrder) {
  if (order.status === "cancelada") {
    return 0;
  }

  const lineTotal = order.lines.reduce(
    (total, line) => total + Number(line.quantity || 0) * Number(line.unitCost || 0),
    0
  );

  return lineTotal + Number(order.shippingCost || 0) + Number(order.taxes || 0);
}

function findProductBySku(products: Product[], sku: string) {
  const normalizedSku = normalizeDashboardKey(sku);

  return products.find((product) => normalizeDashboardKey(product.sku) === normalizedSku);
}

function findComponentForEntry(entry: WarehouseEntry, products: Product[]) {
  const normalizedItemName = normalizeDashboardKey(entry.itemName);
  const product = findProductBySku(products, entry.sku);
  const productComponent = product?.components.find(
    (component) => normalizeDashboardKey(component.name) === normalizedItemName
  );

  if (productComponent) {
    return productComponent;
  }

  return products
    .flatMap((currentProduct) => currentProduct.components)
    .find((component) => normalizeDashboardKey(component.name) === normalizedItemName);
}

function getWarehouseEntryUnitValue(entry: WarehouseEntry, products: Product[]) {
  const product = findProductBySku(products, entry.sku);

  if (entry.materialType === "producto-terminado" && product) {
    return Number(product.basePrice || 0);
  }

  const component = findComponentForEntry(entry, products);

  if (component) {
    return Number(component.unitCost || 0);
  }

  const productByName = products.find((currentProduct) => normalizeDashboardKey(currentProduct.name) === normalizeDashboardKey(entry.itemName));

  return productByName ? Number(productByName.basePrice || 0) : 0;
}

function warehouseEntryMatchesComponent(entry: WarehouseEntry, product: Product, component: ProductComponent) {
  const entrySku = normalizeDashboardKey(entry.sku);
  const productSku = normalizeDashboardKey(product.sku);
  const entryName = normalizeDashboardKey(entry.itemName);
  const componentName = normalizeDashboardKey(component.name);

  return entry.status === "disponible" && entryName === componentName && (!entrySku || entrySku === productSku);
}

function calculateAvailableComponentQuantity(component: ProductComponent, product: Product, entries: WarehouseEntry[]) {
  return entries
    .filter((entry) => warehouseEntryMatchesComponent(entry, product, component))
    .reduce((total, entry) => total + Number(entry.quantity || 0), 0);
}

function calculateWarehouseValuation(entries: WarehouseEntry[], products: Product[]): FinanceWarehouseValuation {
  const typeTotals = new Map<WarehouseMaterialType, number>();
  let totalValue = 0;
  let availableValue = 0;
  let blockedValue = 0;
  let damagedValue = 0;
  let incomingValue = 0;
  let sellableFinishedGoodsValue = 0;
  let sellableFinishedGoodsUnits = 0;

  entries.forEach((entry) => {
    const quantity = Number(entry.quantity || 0);
    const incomingQuantity = Number(entry.incomingQuantity || 0);
    const unitValue = getWarehouseEntryUnitValue(entry, products);
    const entryValue = quantity * unitValue;
    const entryIncomingValue = incomingQuantity * unitValue;

    totalValue += entryValue;
    incomingValue += entryIncomingValue;
    typeTotals.set(entry.materialType, (typeTotals.get(entry.materialType) ?? 0) + entryValue);

    if (entry.status === "disponible") {
      availableValue += entryValue;
    }

    if (entry.status === "bloqueado" || entry.status === "pendiente-revision" || entry.status === "pendiente-ubicacion") {
      blockedValue += entryValue;
    }

    if (entry.status === "danado") {
      damagedValue += entryValue;
    }

    if (entry.status === "disponible" && entry.materialType === "producto-terminado") {
      sellableFinishedGoodsValue += entryValue;
      sellableFinishedGoodsUnits += quantity;
    }
  });

  const buildableProducts = products
    .filter((product) => product.status === "activo" && product.components.length > 0)
    .map((product) => {
      const buildableUnits = product.components.reduce((minimumUnits, component) => {
        const requiredQuantity = Number(component.quantity || 0);

        if (requiredQuantity <= 0) {
          return minimumUnits;
        }

        const availableQuantity = calculateAvailableComponentQuantity(component, product, entries);
        const componentUnits = Math.floor(availableQuantity / requiredQuantity);

        return Math.min(minimumUnits, componentUnits);
      }, Number.POSITIVE_INFINITY);

      return Number.isFinite(buildableUnits) ? Math.max(buildableUnits, 0) : 0;
    });
  const potentialAssemblyUnits = buildableProducts.reduce((total, units) => total + units, 0);
  const potentialAssemblyValue = products
    .filter((product) => product.status === "activo" && product.components.length > 0)
    .reduce((total, product, index) => total + buildableProducts[index] * Number(product.basePrice || 0), 0);
  const valueByType = Array.from(typeTotals.entries()).map(([type, value], index) => {
    const labels: Record<WarehouseMaterialType, string> = {
      componente: "Componentes",
      "materia-prima": "Materia prima",
      "producto-terminado": "Producto terminado",
      empaque: "Empaque",
      herramienta: "Herramienta",
      otro: "Otro"
    };
    const colors = [
      financeDashboardColors.inventory,
      financeDashboardColors.finishedGoods,
      financeDashboardColors.purchases,
      financeDashboardColors.personnel,
      financeDashboardColors.incoming,
      financeDashboardColors.blocked
    ];

    return {
      id: type,
      label: labels[type],
      value,
      color: colors[index % colors.length]
    };
  });

  return {
    totalValue,
    availableValue,
    blockedValue,
    damagedValue,
    incomingValue,
    sellableFinishedGoodsValue,
    sellableFinishedGoodsUnits,
    potentialAssemblyValue,
    potentialAssemblyUnits,
    valueByType
  };
}

function formatOptionalDateTime(value: string) {
  if (!value) {
    return "Sin actualizar";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sin actualizar";
  }

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeCurrency(value: string): ProductCurrency {
  if (value === "USD" || value === "EUR" || value === "MXN") {
    return value;
  }

  return "USD";
}

function normalizeValuation(value: Partial<FinanceAssetValuation>): FinanceAssetValuation {
  return {
    assetId: String(value.assetId ?? ""),
    marketValue: Number(value.marketValue || 0),
    replacementValue: Number(value.replacementValue || 0),
    currency: normalizeCurrency(String(value.currency ?? "USD")),
    confidence: Math.min(Math.max(Number(value.confidence || 0), 0), 1),
    sourceLabel: String(value.sourceLabel ?? ""),
    sourceUrl: String(value.sourceUrl ?? ""),
    lastValuedAt: String(value.lastValuedAt ?? ""),
    method: value.method ?? "unavailable",
    message: String(value.message ?? "")
  };
}

function loadStoredList<Item>(key: string, fallback: Item[]): Item[] {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(key);
    const parsedValue = storedValue ? JSON.parse(storedValue) : fallback;

    return Array.isArray(parsedValue) ? parsedValue : fallback;
  } catch {
    return fallback;
  }
}

function loadFabricationMachines() {
  return loadStoredList<FabricationMachine>(fabricationMachinesStorageKey, []);
}

function loadStoredValuations() {
  return loadStoredList<Partial<FinanceAssetValuation>>(financeAssetValuationsStorageKey, [])
    .map(normalizeValuation)
    .filter((valuation) => valuation.assetId);
}

function saveStoredValuations(valuations: FinanceAssetValuation[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(financeAssetValuationsStorageKey, JSON.stringify(valuations));
}

function getProductComponentCost(product: Product) {
  return product.components.reduce((total, component) => total + Number(component.quantity || 0) * Number(component.unitCost || 0), 0);
}

async function fetchFinanceAgentJson<Payload>(path: string, options?: RequestInit): Promise<Payload> {
  const response = await fetch(`${financeAgentBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "Harv Agent no respondio correctamente.");
  }

  return payload as Payload;
}

function FinanceDonutChart({
  slices,
  title,
  total
}: {
  slices: FinanceDashboardSlice[];
  title: string;
  total: number;
}) {
  const visibleSlices = slices.filter((slice) => slice.value > 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <article className="finance-dashboard-chart">
      <div className="finance-dashboard-chart-visual" aria-hidden="true">
        <svg viewBox="0 0 120 120" role="img">
          <circle className="finance-dashboard-chart-track" cx="60" cy="60" r={radius} />
          {visibleSlices.length > 0 ? (
            visibleSlices.map((slice) => {
              const share = total > 0 ? slice.value / total : 0;
              const dash = share * circumference;
              const strokeDasharray = `${dash} ${circumference - dash}`;
              const strokeDashoffset = -offset;

              offset += dash;

              return (
                <circle
                  className="finance-dashboard-chart-slice"
                  cx="60"
                  cy="60"
                  key={slice.id}
                  r={radius}
                  stroke={slice.color}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                />
              );
            })
          ) : (
            <circle
              className="finance-dashboard-chart-slice"
              cx="60"
              cy="60"
              r={radius}
              stroke={financeDashboardColors.neutral}
              strokeDasharray={`${circumference} 0`}
            />
          )}
        </svg>
        <div>
          <span>Total</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </div>
      <div className="finance-dashboard-chart-copy">
        <h3>{title}</h3>
        <div className="finance-dashboard-chart-legend">
          {slices.map((slice) => (
            <div key={slice.id}>
              <span style={{ "--slice-color": slice.color } as CSSProperties} />
              <strong>{slice.label}</strong>
              <small>{formatMoney(slice.value)}</small>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function FinanceScreen({ products, purchaseOrders, onBack }: FinanceScreenProps) {
  const [activeTab, setActiveTab] = useState<FinanceTabId>("dashboard");
  const [dashboardMonth, setDashboardMonth] = useState(currentMonthValue);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(() =>
    loadStoredList<SalesOrder>(salesGeneratedOrdersStorageKey, [])
  );
  const [warehouseEntries, setWarehouseEntries] = useState<WarehouseEntry[]>(() =>
    loadStoredList<WarehouseEntry>(warehouseEntriesStorageKey, [])
  );
  const [fabricationMachines, setFabricationMachines] = useState<FabricationMachine[]>(loadFabricationMachines);
  const [assetValuations, setAssetValuations] = useState<FinanceAssetValuation[]>(loadStoredValuations);
  const [humanResourcesEmployees, setHumanResourcesEmployees] = useState<HumanResourcesEmployee[]>(
    loadStoredHumanResourcesEmployees
  );
  const [assetAgentStatus, setAssetAgentStatus] = useState<FinanceAgentStatus>("idle");
  const [assetAgentMessage, setAssetAgentMessage] = useState("");
  const productStats = useMemo(() => {
    const activeProducts = products.filter((product) => product.status === "activo");
    const totalBasePrice = activeProducts.reduce((total, product) => total + Number(product.basePrice || 0), 0);
    const totalComponentCost = activeProducts.reduce((total, product) => total + getProductComponentCost(product), 0);
    const componentCount = products.reduce((total, product) => total + product.components.length, 0);

    return {
      products: products.length,
      activeProducts: activeProducts.length,
      totalBasePrice,
      totalComponentCost,
      componentCount
    };
  }, [products]);
  const valuationByAssetId = useMemo(
    () => new Map(assetValuations.map((valuation) => [valuation.assetId, valuation])),
    [assetValuations]
  );
  const assetStats = useMemo(() => {
    const valuedMachines = fabricationMachines.filter((machine) => {
      const valuation = valuationByAssetId.get(machine.id);

      return Boolean(valuation && valuation.marketValue > 0);
    });
    const marketValue = fabricationMachines.reduce((total, machine) => {
      const valuation = valuationByAssetId.get(machine.id);

      return total + Number(valuation?.marketValue || 0);
    }, 0);
    const replacementValue = fabricationMachines.reduce((total, machine) => {
      const valuation = valuationByAssetId.get(machine.id);

      return total + Number(valuation?.replacementValue || 0);
    }, 0);
    const reviewCount = fabricationMachines.filter((machine) => {
      const valuation = valuationByAssetId.get(machine.id);

      return !valuation || valuation.method === "unavailable" || valuation.confidence < 0.55;
    }).length;

    return {
      machines: fabricationMachines.length,
      valuedMachines: valuedMachines.length,
      marketValue,
      replacementValue,
      reviewCount
    };
  }, [fabricationMachines, valuationByAssetId]);
  const humanResourcesStats = useMemo(
    () => calculateHumanResourcesStats(humanResourcesEmployees),
    [humanResourcesEmployees]
  );
  const humanResourcesAreaFinance = useMemo(
    () => calculateHumanResourcesAreaFinance(humanResourcesEmployees),
    [humanResourcesEmployees]
  );
  const humanResourcesFinanceAlerts = useMemo(
    () => calculateHumanResourcesFinanceAlerts(humanResourcesEmployees),
    [humanResourcesEmployees]
  );
  const monthlySalesOrders = useMemo(
    () =>
      salesOrders.filter(
        (order) =>
          order.status === "aprobada-comercialmente" &&
          isSameMonth(order.paymentVerifiedAt ?? order.creditReviewedAt ?? order.createdAt, dashboardMonth)
      ),
    [dashboardMonth, salesOrders]
  );
  const monthlyPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter(
        (order) => order.status !== "cancelada" && isSameMonth(order.createdAt, dashboardMonth)
      ),
    [dashboardMonth, purchaseOrders]
  );
  const inventoryStats = useMemo(
    () => calculateWarehouseValuation(warehouseEntries, products),
    [products, warehouseEntries]
  );
  const dashboardStats = useMemo(() => {
    const income = monthlySalesOrders.reduce((total, order) => total + orderTotals(order.lines).total, 0);
    const purchaseExpense = monthlyPurchaseOrders.reduce((total, order) => total + calculatePurchaseOrderTotal(order), 0);
    const personnelExpense = humanResourcesStats.estimatedMonthlyCost;
    const expenses = purchaseExpense + personnelExpense;
    const balance = income - expenses;
    const incomeExpenseTotal = income + expenses;
    const incomeExpenseSlices: FinanceDashboardSlice[] = [
      {
        id: "income",
        label: "Ingresos",
        value: income,
        color: financeDashboardColors.income
      },
      {
        id: "expenses",
        label: "Egresos",
        value: expenses,
        color: financeDashboardColors.expenses
      }
    ];
    const expenseSlices: FinanceDashboardSlice[] = [
      {
        id: "purchases",
        label: "Compras",
        value: purchaseExpense,
        color: financeDashboardColors.purchases
      },
      {
        id: "personnel",
        label: "Personal",
        value: personnelExpense,
        color: financeDashboardColors.personnel
      }
    ];

    return {
      income,
      expenses,
      balance,
      incomeExpenseTotal,
      purchaseExpense,
      personnelExpense,
      incomeExpenseSlices,
      expenseSlices,
      expenseTotal: expenses
    };
  }, [humanResourcesStats.estimatedMonthlyCost, monthlyPurchaseOrders, monthlySalesOrders]);

  useEffect(() => {
    saveStoredValuations(assetValuations);
  }, [assetValuations]);

  useEffect(() => {
    if (activeTab === "dashboard") {
      setSalesOrders(loadStoredList<SalesOrder>(salesGeneratedOrdersStorageKey, []));
      setWarehouseEntries(loadStoredList<WarehouseEntry>(warehouseEntriesStorageKey, []));
      setHumanResourcesEmployees(loadStoredHumanResourcesEmployees());
      setFabricationMachines(loadFabricationMachines());
    }

    if (activeTab === "activos") {
      setFabricationMachines(loadFabricationMachines());
    }

    if (activeTab === "personal") {
      setHumanResourcesEmployees(loadStoredHumanResourcesEmployees());
    }
  }, [activeTab]);

  function syncDashboardData() {
    setSalesOrders(loadStoredList<SalesOrder>(salesGeneratedOrdersStorageKey, []));
    setWarehouseEntries(loadStoredList<WarehouseEntry>(warehouseEntriesStorageKey, []));
    setHumanResourcesEmployees(loadStoredHumanResourcesEmployees());
    setFabricationMachines(loadFabricationMachines());
  }

  function syncHumanResourcesEmployees() {
    setHumanResourcesEmployees(loadStoredHumanResourcesEmployees());
  }

  function downloadHumanResourcesFinanceCsv() {
    const employees = loadStoredHumanResourcesEmployees();
    const csv = createHumanResourcesFinanceCsv(employees);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    setHumanResourcesEmployees(employees);
    link.href = url;
    link.download = `harv-personal-finanzas-${todayIso()}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  function syncFabricationMachines() {
    const machines = loadFabricationMachines();

    setFabricationMachines(machines);
    setAssetAgentStatus("ready");
    setAssetAgentMessage(
      machines.length > 0
        ? `${machines.length} maquina(s) sincronizada(s) desde Fabricacion.`
        : "No hay maquinaria registrada en Fabricacion todavia."
    );
  }

  async function updateAssetValuations() {
    const machines = loadFabricationMachines();

    setFabricationMachines(machines);

    if (machines.length === 0) {
      setAssetAgentStatus("ready");
      setAssetAgentMessage("No hay maquinaria registrada en Fabricacion todavia.");
      return;
    }

    setAssetAgentStatus("working");
    setAssetAgentMessage("Consultando referencias de mercado con Harv Agent...");

    try {
      const payload = await fetchFinanceAgentJson<{ valuations?: Partial<FinanceAssetValuation>[]; message?: string }>(
        "/api/finance/asset-valuations",
        {
          method: "POST",
          body: JSON.stringify({
            assets: machines.map((machine) => ({
              id: machine.id,
              name: machine.name,
              type: machine.type,
              brand: machine.brand,
              model: machine.model,
              serialNumber: machine.serialNumber,
              location: machine.location
            }))
          })
        }
      );
      const nextValuations = (payload.valuations ?? []).map(normalizeValuation).filter((valuation) => valuation.assetId);

      setAssetValuations((currentValuations) => {
        const merged = new Map(currentValuations.map((valuation) => [valuation.assetId, valuation]));

        nextValuations.forEach((valuation) => merged.set(valuation.assetId, valuation));

        return Array.from(merged.values());
      });
      setAssetAgentStatus("ready");
      setAssetAgentMessage(payload.message ?? `${nextValuations.length} activo(s) valuado(s).`);
    } catch (error) {
      setAssetAgentStatus("error");
      setAssetAgentMessage(
        error instanceof TypeError
          ? "Harv Agent no esta disponible. Abre una terminal y corre npm run agent:dev para actualizar valores."
          : error instanceof Error
            ? error.message
            : "No se pudo consultar Harv Agent."
      );
    }
  }

  return (
    <main className="profile-screen finance-profile-screen">
      <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span className="screen-icon finance-screen-icon" aria-hidden="true">
            <Banknote size={22} />
          </span>
          <h1>Finanzas</h1>
        </div>
      </header>

      <section className="finance-body">
        <section className="finance-command-panel">
          <div>
            <span className="section-kicker">Control financiero</span>
            <h2>Base financiera de planta</h2>
          </div>
          <div className="finance-command-total">
            <span>Valor base activo</span>
            <strong>{formatMoney(productStats.totalBasePrice)}</strong>
          </div>
        </section>

        <nav className="finance-tabs" aria-label="Secciones de finanzas">
          {financeTabs.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{tab.label}</strong>
                  <small>{tab.detail}</small>
                </span>
              </button>
            );
          })}
        </nav>

        {activeTab === "dashboard" ? (
          <section className="main-panel finance-panel finance-dashboard-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Dashboard mensual</h2>
                <p>Lectura ejecutiva de ingresos, egresos, inventario y valor vendible.</p>
              </div>
              <div className="finance-dashboard-controls">
                <label className="field compact">
                  <span>Mes</span>
                  <input
                    onChange={(event) => setDashboardMonth(event.target.value || currentMonthValue())}
                    type="month"
                    value={dashboardMonth}
                  />
                </label>
                <button className="secondary-button" onClick={syncDashboardData} type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Sincronizar
                </button>
              </div>
            </div>

            <div className="finance-dashboard-period">
              <span>Periodo</span>
              <strong>{formatMonthLabel(dashboardMonth)}</strong>
            </div>

            <div className="finance-dashboard-kpi-grid">
              <article>
                <Banknote size={18} aria-hidden="true" />
                <span>Ingresos</span>
                <strong>{formatMoney(dashboardStats.income)}</strong>
                <small>{monthlySalesOrders.length} orden(es) aprobadas</small>
              </article>
              <article>
                <CircleAlert size={18} aria-hidden="true" />
                <span>Egresos</span>
                <strong>{formatMoney(dashboardStats.expenses)}</strong>
                <small>Compras + personal</small>
              </article>
              <article className={dashboardStats.balance >= 0 ? "positive" : "negative"}>
                <Banknote size={18} aria-hidden="true" />
                <span>Balance</span>
                <strong>{formatMoney(dashboardStats.balance)}</strong>
                <small>{dashboardStats.balance >= 0 ? "Mes positivo" : "Mes negativo"}</small>
              </article>
              <article>
                <Boxes size={18} aria-hidden="true" />
                <span>Valor almacen</span>
                <strong>{formatMoney(inventoryStats.totalValue)}</strong>
                <small>{warehouseEntries.length} entrada(s)</small>
              </article>
              <article>
                <PackageSearch size={18} aria-hidden="true" />
                <span>Valor vendible</span>
                <strong>{formatMoney(inventoryStats.sellableFinishedGoodsValue)}</strong>
                <small>{inventoryStats.sellableFinishedGoodsUnits} equipo(s) listos</small>
              </article>
              <article>
                <BriefcaseBusiness size={18} aria-hidden="true" />
                <span>Kits posibles</span>
                <strong>{inventoryStats.potentialAssemblyUnits}</strong>
                <small>{formatMoney(inventoryStats.potentialAssemblyValue)} potencial</small>
              </article>
            </div>

            <div className="finance-dashboard-chart-grid">
              <FinanceDonutChart
                slices={dashboardStats.incomeExpenseSlices}
                title="Ingresos vs egresos"
                total={dashboardStats.incomeExpenseTotal}
              />
              <FinanceDonutChart
                slices={dashboardStats.expenseSlices}
                title="Egresos por categoria"
                total={dashboardStats.expenseTotal}
              />
              <FinanceDonutChart
                slices={inventoryStats.valueByType}
                title="Valor de inventario"
                total={inventoryStats.totalValue}
              />
            </div>

            <div className="finance-dashboard-detail-grid">
              <article>
                <span>Compras del mes</span>
                <strong>{formatMoney(dashboardStats.purchaseExpense)}</strong>
                <small>{monthlyPurchaseOrders.length} orden(es) de compra</small>
              </article>
              <article>
                <span>Personal mensual</span>
                <strong>{formatMoney(dashboardStats.personnelExpense)}</strong>
                <small>{humanResourcesStats.activeEmployees} persona(s) activas</small>
              </article>
              <article>
                <span>Inventario disponible</span>
                <strong>{formatMoney(inventoryStats.availableValue)}</strong>
                <small>Material disponible para operacion</small>
              </article>
              <article>
                <span>Bloqueado / revision</span>
                <strong>{formatMoney(inventoryStats.blockedValue)}</strong>
                <small>No debe contarse como disponible</small>
              </article>
              <article>
                <span>Danado</span>
                <strong>{formatMoney(inventoryStats.damagedValue)}</strong>
                <small>Valor con problema registrado</small>
              </article>
              <article>
                <span>Por llegar</span>
                <strong>{formatMoney(inventoryStats.incomingValue)}</strong>
                <small>Registrado como cantidad por llegar</small>
              </article>
              <article>
                <span>Activos fisicos</span>
                <strong>{formatCurrency(assetStats.marketValue, "USD")}</strong>
                <small>{assetStats.valuedMachines}/{assetStats.machines} valuados</small>
              </article>
            </div>
          </section>
        ) : null}

        {activeTab === "productos" ? (
          <section className="main-panel finance-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Mis productos</h2>
                <p>Precio de venta, estado comercial y componentes ligados al catalogo.</p>
              </div>
            </div>

            <div className="finance-metric-grid">
              <article>
                <PackageSearch size={18} aria-hidden="true" />
                <span>Productos</span>
                <strong>{productStats.products}</strong>
              </article>
              <article>
                <Boxes size={18} aria-hidden="true" />
                <span>Activos</span>
                <strong>{productStats.activeProducts}</strong>
              </article>
              <article>
                <Banknote size={18} aria-hidden="true" />
                <span>Valor base</span>
                <strong>{formatMoney(productStats.totalBasePrice)}</strong>
              </article>
              <article>
                <BriefcaseBusiness size={18} aria-hidden="true" />
                <span>Componentes</span>
                <strong>{productStats.componentCount}</strong>
              </article>
              <article>
                <Banknote size={18} aria-hidden="true" />
                <span>Costo piezas</span>
                <strong>{formatMoney(productStats.totalComponentCost)}</strong>
              </article>
            </div>

            <div className="finance-product-list">
              {products.map((product) => {
                const componentCost = getProductComponentCost(product);
                const margin = Number(product.basePrice || 0) - componentCost;

                return (
                  <article className="finance-product-row" key={product.id}>
                    <div>
                      <span>{product.sku || "Sin SKU"}</span>
                      <strong>{product.name || "Producto sin nombre"}</strong>
                    </div>
                    <div>
                      <span>Precio</span>
                      <strong>{formatCurrency(product.basePrice, product.currency)}</strong>
                    </div>
                    <div>
                      <span>Costo piezas</span>
                      <strong>{formatCurrency(componentCost, product.currency)}</strong>
                    </div>
                    <div>
                      <span>Margen base</span>
                      <strong>{formatCurrency(margin, product.currency)}</strong>
                    </div>
                    <div>
                      <span>Componentes</span>
                      <strong>{product.components.length}</strong>
                    </div>
                    <span className={`status-pill ${product.status}`}>{productStatusLabels[product.status]}</span>
                  </article>
                );
              })}

              {products.length === 0 ? <p className="empty-state">Sin productos registrados.</p> : null}
            </div>
          </section>
        ) : null}

        {activeTab === "personal" ? (
          <section className="main-panel finance-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Personal</h2>
                <p>Lectura financiera del directorio operativo de Recursos Humanos.</p>
              </div>
              <div className="finance-personnel-actions">
                <button className="secondary-button" onClick={syncHumanResourcesEmployees} type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Sincronizar RH
                </button>
                <button
                  className="secondary-button"
                  disabled={humanResourcesEmployees.length === 0}
                  onClick={downloadHumanResourcesFinanceCsv}
                  type="button"
                >
                  <Download size={16} aria-hidden="true" />
                  Descargar CSV
                </button>
              </div>
            </div>

            <div className="finance-metric-grid">
              <article>
                <UsersRound size={18} aria-hidden="true" />
                <span>Personas</span>
                <strong>{humanResourcesStats.employees}</strong>
              </article>
              <article>
                <BriefcaseBusiness size={18} aria-hidden="true" />
                <span>Activos</span>
                <strong>{humanResourcesStats.activeEmployees}</strong>
              </article>
              <article>
                <Banknote size={18} aria-hidden="true" />
                <span>Costo hora activo</span>
                <strong>{formatMoney(humanResourcesStats.totalHourlyCost)}</strong>
              </article>
              <article>
                <Boxes size={18} aria-hidden="true" />
                <span>Estimado mensual</span>
                <strong>{formatMoney(humanResourcesStats.estimatedMonthlyCost)}</strong>
              </article>
              <article>
                <UsersRound size={18} aria-hidden="true" />
                <span>Horas semanales</span>
                <strong>{humanResourcesStats.totalWeeklyHours}</strong>
              </article>
              <article>
                <BriefcaseBusiness size={18} aria-hidden="true" />
                <span>Roles</span>
                <strong>{humanResourcesStats.roleCount}</strong>
              </article>
              <article>
                <UsersRound size={18} aria-hidden="true" />
                <span>No disponibles</span>
                <strong>{humanResourcesStats.unavailableEmployees}</strong>
              </article>
              <article>
                <CircleAlert size={18} aria-hidden="true" />
                <span>Alertas datos</span>
                <strong>{humanResourcesFinanceAlerts.length}</strong>
              </article>
            </div>

            {humanResourcesFinanceAlerts.length > 0 ? (
              <div className="finance-personnel-alert-list">
                {humanResourcesFinanceAlerts.map((alert) => (
                  <article className="finance-personnel-alert" key={alert.id}>
                    <CircleAlert size={17} aria-hidden="true" />
                    <div>
                      <strong>{alert.label}</strong>
                      <span>{alert.detail}</span>
                    </div>
                    <b>{alert.count}</b>
                  </article>
                ))}
              </div>
            ) : null}

            {humanResourcesAreaFinance.length > 0 ? (
              <section className="finance-personnel-area-section" aria-label="Costo de personal por area">
                <div className="clean-section-heading">
                  <div>
                    <h2>Costo por area</h2>
                    <p>Desglose operativo calculado desde empleados activos en Recursos Humanos.</p>
                  </div>
                </div>
                <div className="finance-personnel-area-grid">
                  {humanResourcesAreaFinance.map((areaFinance) => (
                    <article className="finance-personnel-area-card" key={areaFinance.area}>
                      <div>
                        <span>Area</span>
                        <strong>{areaFinance.label}</strong>
                      </div>
                      <div>
                        <span>Costo mensual</span>
                        <strong>{formatMoney(areaFinance.monthlyCost)}</strong>
                      </div>
                      <div>
                        <span>Activos</span>
                        <strong>{areaFinance.activeEmployees}</strong>
                      </div>
                      <div>
                        <span>Horas semanales</span>
                        <strong>{areaFinance.weeklyHours}</strong>
                      </div>
                      <div>
                        <span>Promedio hora</span>
                        <strong>{formatMoney(areaFinance.averageHourlyCost)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {humanResourcesEmployees.length > 0 ? (
              <div className="finance-personnel-list">
                {humanResourcesEmployees.map((employee) => (
                  <article className="finance-personnel-row" key={employee.id}>
                    <div>
                      <span>Empleado</span>
                      <strong>{employee.fullName}</strong>
                      <small>{employee.position || "Sin puesto"}</small>
                    </div>
                    <div>
                      <span>Area</span>
                      <strong>{humanResourcesAreaLabels[employee.area]}</strong>
                    </div>
                    <div>
                      <span>Turno</span>
                      <strong>{humanResourcesShiftLabels[employee.shift]}</strong>
                    </div>
                    <div>
                      <span>Costo hora</span>
                      <strong>{formatMoney(employee.hourlyCost)}</strong>
                    </div>
                    <div>
                      <span>Costo mensual</span>
                      <strong>{formatMoney(calculateEmployeeMonthlyCost(employee))}</strong>
                      <small>{employee.weeklyHours} h/semana</small>
                    </div>
                    <div>
                      <span>Habilidades</span>
                      <strong>{employee.skills.length}</strong>
                    </div>
                    <span className={`status-pill human-resources-status-pill status-${employee.status}`}>
                      {humanResourcesEmployeeStatusLabels[employee.status]}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="finance-empty-panel">
                <strong>Sin personal registrado.</strong>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "activos" ? (
          <section className="main-panel finance-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Activos fisicos</h2>
                <p>Maquinaria registrada en Fabricacion con referencia financiera separada.</p>
              </div>
              <div className="finance-asset-actions">
                <button className="secondary-button" onClick={syncFabricationMachines} type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Sincronizar
                </button>
                <button
                  className="primary-button"
                  disabled={assetAgentStatus === "working"}
                  onClick={updateAssetValuations}
                  type="button"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Actualizar valor
                </button>
              </div>
            </div>

            <div className="finance-asset-grid">
              <article>
                <Factory size={18} aria-hidden="true" />
                <span>Maquinaria</span>
                <strong>{assetStats.machines}</strong>
                <small>{assetStats.valuedMachines} valuadas</small>
              </article>
              <article>
                <Banknote size={18} aria-hidden="true" />
                <span>Valor mercado</span>
                <strong>{formatCurrency(assetStats.marketValue, "USD")}</strong>
                <small>Estimado financiero</small>
              </article>
              <article>
                <BriefcaseBusiness size={18} aria-hidden="true" />
                <span>Reposicion</span>
                <strong>{formatCurrency(assetStats.replacementValue, "USD")}</strong>
                <small>Referencia nueva</small>
              </article>
              <article>
                <CircleAlert size={18} aria-hidden="true" />
                <span>Por revisar</span>
                <strong>{assetStats.reviewCount}</strong>
                <small>Sin referencia clara</small>
              </article>
            </div>

            {assetAgentMessage ? <p className={`finance-agent-message ${assetAgentStatus}`}>{assetAgentMessage}</p> : null}

            {fabricationMachines.length > 0 ? (
              <div className="finance-asset-list">
                {fabricationMachines.map((machine) => {
                  const valuation = valuationByAssetId.get(machine.id);
                  const brandModel = [machine.brand, machine.model].filter(Boolean).join(" / ") || "Sin marca o modelo";

                  return (
                    <article className="finance-asset-row" key={machine.id}>
                      <div className="finance-asset-main">
                        <Factory size={18} aria-hidden="true" />
                        <div>
                          <span>Activo</span>
                          <strong>{machine.name || "Maquina sin nombre"}</strong>
                          <small>{brandModel}</small>
                        </div>
                      </div>
                      <div>
                        <span>Ubicacion</span>
                        <strong>{machine.location || "Sin ubicacion"}</strong>
                      </div>
                      <div>
                        <span>Valor mercado</span>
                        <strong>
                          {valuation && valuation.marketValue > 0
                            ? formatCurrency(valuation.marketValue, valuation.currency)
                            : "Por valuar"}
                        </strong>
                      </div>
                      <div>
                        <span>Reposicion</span>
                        <strong>
                          {valuation && valuation.replacementValue > 0
                            ? formatCurrency(valuation.replacementValue, valuation.currency)
                            : "Sin dato"}
                        </strong>
                      </div>
                      <div>
                        <span>Confianza</span>
                        <strong>{valuation ? `${Math.round(valuation.confidence * 100)}%` : "0%"}</strong>
                        <small>{valuation?.method === "internet" ? "Internet" : valuation?.method === "reference" ? "Referencia" : "Pendiente"}</small>
                      </div>
                      <div>
                        <span>Actualizado</span>
                        <strong>{formatOptionalDateTime(valuation?.lastValuedAt ?? "")}</strong>
                        {valuation?.sourceUrl ? (
                          <a className="finance-asset-source" href={valuation.sourceUrl} rel="noreferrer" target="_blank">
                            {valuation.sourceLabel || "Fuente"}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : (
                          <small>{valuation?.message || "Sin fuente"}</small>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="finance-empty-panel">
                <Factory size={18} aria-hidden="true" />
                <strong>Sin maquinaria registrada.</strong>
                <span>Agrega impresoras o maquinas desde Fabricacion y sincroniza esta vista.</span>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "empresa" ? (
          <section className="main-panel finance-panel">
            <div className="clean-section-heading">
              <div>
                <h2>Empresa</h2>
                <p>Datos fiscales, cuentas, impuestos y gastos generales.</p>
              </div>
            </div>

            <div className="finance-company-grid">
              <article>
                <span>Razon social</span>
                <strong>Sin definir</strong>
              </article>
              <article>
                <span>RFC / Tax ID</span>
                <strong>Sin definir</strong>
              </article>
              <article>
                <span>Moneda base</span>
                <strong>MXN</strong>
              </article>
              <article>
                <span>Gasto fijo mensual</span>
                <strong>{formatMoney(0)}</strong>
              </article>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
