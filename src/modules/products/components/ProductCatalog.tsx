import { Edit3, PackagePlus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Product, ProductStatus } from "../../sales/types";
import { componentTypeLabels, formatCurrency, productMatches, productStatusLabels } from "../../sales/utils";
import { ProductEditorModal } from "./ProductEditorModal";

type ProductDraft = Omit<Product, "id">;

type ProductCatalogProps = {
  products: Product[];
  openNewProduct?: boolean;
  onNewProductOpened?: () => void;
  onSaveProduct: (product: ProductDraft, existingProduct?: Product) => void;
  onTrashProduct: (productId: string) => void;
  onUpdateProductStatus: (productId: string, status: ProductStatus) => void;
};

export function ProductCatalog({
  products,
  openNewProduct = false,
  onNewProductOpened,
  onSaveProduct,
  onTrashProduct,
  onUpdateProductStatus
}: ProductCatalogProps) {
  const [query, setQuery] = useState("");
  const [productEditorModal, setProductEditorModal] = useState<{ product?: Product } | null>(null);

  useEffect(() => {
    if (!openNewProduct) {
      return;
    }

    setProductEditorModal({});
    onNewProductOpened?.();
  }, [openNewProduct, onNewProductOpened]);

  const productResults = useMemo(() => {
    return products.filter((product) => productMatches(product, query));
  }, [products, query]);

  return (
    <section className="main-panel products-panel">
      <div className="clean-section-heading">
        <div>
          <h2>Lista de productos</h2>
          <p>Define productos, piezas, tornillería, motores, cableado y archivos técnicos.</p>
        </div>
        <button className="primary-button" onClick={() => setProductEditorModal({})} type="button">
          <PackagePlus size={17} />
          Agregar producto
        </button>
      </div>

      <label className="search-field client-search">
        <Search size={18} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, SKU, componente o proveedor" />
      </label>

      <div className="product-catalog-list">
        {productResults.map((product) => (
          <article className="product-catalog-row" key={product.id}>
            <div className="product-catalog-main">
              <span className="sku">{product.sku || "Sin SKU"}</span>
              <div>
                <strong>{product.name || "Producto sin nombre"}</strong>
                <p>{product.shortDescription || "Sin descripción"}</p>
              </div>
            </div>

            <div className="product-catalog-stat">
              <span>Componentes</span>
              <strong>{product.components.length}</strong>
            </div>

            <div className="product-catalog-stat">
              <span>Precio de venta</span>
              <strong>{formatCurrency(product.basePrice, product.currency)}</strong>
            </div>

            <div className="product-component-preview">
              {product.components.slice(0, 4).map((component) => (
                <span key={component.id}>{componentTypeLabels[component.type]}</span>
              ))}
              {product.components.length > 4 ? <span>+{product.components.length - 4}</span> : null}
            </div>

            <div className="client-actions">
              <label className="product-status-control">
                <span>Estado</span>
                <select
                  className={`product-status-select ${product.status}`}
                  value={product.status}
                  onChange={(event) => onUpdateProductStatus(product.id, event.target.value as ProductStatus)}
                >
                  {Object.entries(productStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-button compact-button" onClick={() => setProductEditorModal({ product })} type="button">
                <Edit3 size={15} />
                Editar
              </button>
              <button
                aria-label={`Mandar ${product.name || product.sku || "producto"} a la basura`}
                className="icon-button ghost product-trash-button"
                onClick={() => {
                  const shouldTrashProduct = window.confirm(`¿Mandar ${product.name || product.sku || "este producto"} a la basura?`);

                  if (shouldTrashProduct) {
                    onTrashProduct(product.id);
                  }
                }}
                title="Mandar a la basura"
                type="button"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}

        {products.length === 0 ? <p className="empty-state">Todavía no hay productos registrados.</p> : null}
        {products.length > 0 && productResults.length === 0 ? <p className="empty-state">No hay productos con esa búsqueda.</p> : null}
      </div>

      {productEditorModal ? (
        <ProductEditorModal
          product={productEditorModal.product}
          products={products}
          onClose={() => setProductEditorModal(null)}
          onSave={(product, existingProduct) => {
            onSaveProduct(product, existingProduct);
            setProductEditorModal(null);
            setQuery("");
          }}
        />
      ) : null}
    </section>
  );
}
