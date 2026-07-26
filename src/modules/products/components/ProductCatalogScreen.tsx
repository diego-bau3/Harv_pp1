import { ArrowLeft, PackageSearch } from "lucide-react";
import type { Product, ProductStatus } from "../../sales/types";
import { ProductCatalog } from "./ProductCatalog";

type ProductCatalogScreenProps = {
  products: Product[];
  openNewProduct?: boolean;
  onBack: () => void;
  onNewProductOpened?: () => void;
  onSaveProduct: (product: Omit<Product, "id">, existingProduct?: Product) => void;
  onTrashProduct: (productId: string) => void;
  onUpdateProductStatus: (productId: string, status: ProductStatus) => void;
};

export function ProductCatalogScreen({
  products,
  openNewProduct = false,
  onBack,
  onNewProductOpened,
  onSaveProduct,
  onTrashProduct,
  onUpdateProductStatus
}: ProductCatalogScreenProps) {
  return (
    <main className="profile-screen product-profile-screen">
      <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span className="screen-icon product-screen-icon" aria-hidden="true">
            <PackageSearch size={22} />
          </span>
          <h1>Productos</h1>
        </div>
      </header>

      <section className="product-profile-body">
        <ProductCatalog
          openNewProduct={openNewProduct}
          products={products}
          onNewProductOpened={onNewProductOpened}
          onSaveProduct={onSaveProduct}
          onTrashProduct={onTrashProduct}
          onUpdateProductStatus={onUpdateProductStatus}
        />
      </section>
    </main>
  );
}
