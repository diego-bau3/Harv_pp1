import { ArrowLeft } from "lucide-react";
import type { Profile } from "../data/profiles";
import { AssemblyScreen } from "../modules/assembly/components/AssemblyScreen";
import { FabricationScreen } from "../modules/fabrication/components/FabricationScreen";
import { FinanceScreen } from "../modules/finance/components/FinanceScreen";
import { HumanResourcesScreen } from "../modules/human-resources/components/HumanResourcesScreen";
import { PreproductionScreen } from "../modules/preproduction/components/PreproductionScreen";
import type { PreproductionRoute } from "../modules/preproduction/types";
import { ProductionScreen } from "../modules/production/components/ProductionScreen";
import { PurchasesView } from "../modules/purchases/components/PurchasesView";
import type {
  PendingReceipt,
  PurchaseMessage,
  PurchaseOrder,
  PurchaseOrderDocument,
  PurchaseRequest,
  PurchaseReceiptIssue,
  PurchaseReceiptLineUpdate,
  PurchaseReceiptStatus,
  PurchaseSupplier
} from "../modules/purchases/types";
import { SalesView } from "../modules/sales/components/SalesView";
import type { Product } from "../modules/sales/types";
import { WarehouseScreen } from "../modules/warehouse/components/WarehouseScreen";

type ProfileScreenProps = {
  profile: Profile;
  products: Product[];
  preproductionRoutes: PreproductionRoute[];
  suppliers: PurchaseSupplier[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  pendingReceipts: PendingReceipt[];
  purchaseMessages: PurchaseMessage[];
  onBack: () => void;
  onOpenProducts: () => void;
  onPreproductionRoutesChange: (routes: PreproductionRoute[]) => void;
  onAddSupplier: (supplier: PurchaseSupplier) => void;
  onResolveRequestSupplier: (requestId: string, supplier: PurchaseSupplier) => void;
  onCreatePurchaseOrder: (purchaseOrder: PurchaseOrder, pendingReceipt: PendingReceipt) => void;
  onAddPurchaseOrderDocument: (orderId: string, document: PurchaseOrderDocument) => void;
  onAddPurchaseMessage: (message: PurchaseMessage) => void;
  onReceivePurchaseReceipt: (
    receiptId: string,
    lineUpdates: PurchaseReceiptLineUpdate[],
    status: PurchaseReceiptStatus,
    issue: PurchaseReceiptIssue | "",
    issueNotes: string
  ) => void;
};

export function ProfileScreen({
  pendingReceipts,
  preproductionRoutes,
  products,
  profile,
  purchaseMessages,
  purchaseOrders,
  purchaseRequests,
  suppliers,
  onAddPurchaseMessage,
  onAddPurchaseOrderDocument,
  onAddSupplier,
  onBack,
  onOpenProducts,
  onPreproductionRoutesChange,
  onCreatePurchaseOrder,
  onReceivePurchaseReceipt,
  onResolveRequestSupplier
}: ProfileScreenProps) {
  const Icon = profile.icon;

  if (profile.id === "ventas") {
    return <SalesView products={products} onBack={onBack} />;
  }

  if (profile.id === "compras") {
    return (
      <PurchasesView
        messages={purchaseMessages}
        pendingReceipts={pendingReceipts}
        products={products}
        purchaseOrders={purchaseOrders}
        requests={purchaseRequests}
        suppliers={suppliers}
        onAddMessage={onAddPurchaseMessage}
        onAddPurchaseOrderDocument={onAddPurchaseOrderDocument}
        onAddSupplier={onAddSupplier}
        onBack={onBack}
        onCreatePurchaseOrder={onCreatePurchaseOrder}
        onResolveRequestSupplier={onResolveRequestSupplier}
      />
    );
  }

  if (profile.id === "almacen") {
    return (
      <WarehouseScreen
        pendingReceipts={pendingReceipts}
        products={products}
        purchaseOrders={purchaseOrders}
        onBack={onBack}
        onReceivePurchaseReceipt={onReceivePurchaseReceipt}
      />
    );
  }

  if (profile.id === "fabricacion") {
    return <FabricationScreen products={products} onBack={onBack} />;
  }

  if (profile.id === "pre-produccion") {
    return (
      <PreproductionScreen
        products={products}
        routes={preproductionRoutes}
        onBack={onBack}
        onOpenProducts={onOpenProducts}
        onRoutesChange={onPreproductionRoutesChange}
      />
    );
  }

  if (profile.id === "produccion") {
    return <ProductionScreen products={products} onBack={onBack} />;
  }

  if (profile.id === "ensamble") {
    return <AssemblyScreen products={products} onBack={onBack} />;
  }

  if (profile.id === "finanzas") {
    return <FinanceScreen products={products} purchaseOrders={purchaseOrders} onBack={onBack} />;
  }

  if (profile.id === "recursos-humanos") {
    return <HumanResourcesScreen onBack={onBack} />;
  }

  return (
    <main className="profile-screen">
      <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span
            className="screen-icon"
            style={
              {
                "--accent": profile.accent,
                "--tint": profile.tint
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            <Icon size={22} />
          </span>
          <h1>{profile.name}</h1>
        </div>
      </header>
      <section className="blank-canvas" aria-label={`Pantalla de ${profile.name}`} />
    </main>
  );
}
