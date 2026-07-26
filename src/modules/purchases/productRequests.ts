import type { Product, ProductComponent } from "../sales/types";
import { formatProductComponentSpecs, isExternalProductComponent } from "../sales/utils";
import type { PurchaseRequest } from "./types";
import { futureDate } from "./utils";

function needsSupplierRequest(component: ProductComponent) {
  if (!isExternalProductComponent(component)) {
    return false;
  }

  if (component.needsSupplierResearch) {
    return true;
  }

  return !component.supplierCompany.trim();
}

function requestNotesForComponent(component: ProductComponent) {
  const specSummary = formatProductComponentSpecs(component.type, component.specs ?? {});
  const guidance =
    component.supplierResearchNotes ||
    component.notes ||
    "Compras debe investigar supplier, costo, lead time y datos de contacto.";

  return [specSummary ? `Especificaciones: ${specSummary}.` : "", guidance].filter(Boolean).join(" ");
}

export function createProductSupplierRequests(products: Product[], existingRequests: PurchaseRequest[] = []) {
  const existingKeys = new Set(
    existingRequests
      .filter((request) => request.source === "manual" || request.source === "producto")
      .map((request) => `${request.productId}:${request.componentId}`)
  );

  return products.flatMap((product) =>
    product.components
      .filter(needsSupplierRequest)
      .map((component): PurchaseRequest => ({
        id: `request-product-${product.id}-${component.id}`,
        type: "problema",
        source: "producto",
        sourceRef: `product:${product.id}:${component.id}`,
        productId: product.id,
        componentId: component.id,
        itemName: component.name,
        productSku: product.sku,
        quantity: component.quantity,
        unit: component.unit,
        supplierId: null,
        requiredDate: futureDate(7),
        priority: component.needsSupplierResearch ? "alta" : "normal",
        status: "bloqueado",
        reason: "Componente marcado Sin proveedor desde Productos.",
        notes: requestNotesForComponent(component)
      }))
      .filter((request) => !existingKeys.has(`${request.productId}:${request.componentId}`))
  );
}
