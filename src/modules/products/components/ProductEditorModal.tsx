import { Edit3, FileUp, Plus, Trash2, X } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import type {
  Product,
  ProductComponent,
  ProductComponentOrigin,
  ProductComponentProcess,
  ProductComponentType,
  ProductCurrency,
  ProductPrintDesign,
  ProductStatus,
  ProductSupplierContactMethod,
  ProductUnit
} from "../../sales/types";
import {
  colorOptions,
  componentOriginLabels,
  componentProcessLabels,
  componentTypeLabels,
  createId,
  currencyLabels,
  formatCurrency,
  generateProductSku,
  getDefaultProductComponentProcess,
  getProductComponentOrigin,
  getProductComponentSpecFields,
  isExternalProductComponent,
  isPrintableProductComponent,
  materialOptions,
  normalizeProductComponentProcess,
  normalizeProductComponentSpecs,
  productCategoryOptions,
  productStatusLabels,
  productUnitLabels,
  supplierContactMethodLabels,
  supplierExternalPlatformOptions
} from "../../sales/utils";

type ProductDraft = Omit<Product, "id">;

type ProductEditorModalProps = {
  product?: Product;
  products: Product[];
  onClose: () => void;
  onSave: (product: ProductDraft, existingProduct?: Product) => void;
};

const printerOptions = ["P1S", "OTRA"] as const;
const customCategoryValue = "OTRO";
const materialColorComponentTypes = new Set<ProductComponentType>(["pieza-impresa-3d", "pieza-fabricada", "empaque", "otro"]);

const emptyPrintDesign = (printer = "P1S"): ProductPrintDesign => ({
  id: createId("print-design"),
  printer,
  fileName: "",
  notes: ""
});

function optionValue(value: string, options: readonly string[]) {
  if (value === "OTRO") {
    return "OTRO";
  }

  if (!value) {
    return "";
  }

  return options.includes(value) ? value : "OTRO";
}

function customOptionValue(value: string, options: readonly string[]) {
  return value && value !== "OTRO" && !options.includes(value) ? value : "";
}

function getCategoryOptions(products: Product[], currentCategory: string) {
  const baseOptions = Array.from(productCategoryOptions);
  const existingCategories = products
    .map((currentProduct) => currentProduct.category.trim())
    .filter((category) => category.length > 0 && category !== customCategoryValue);
  const currentCategoryOption =
    currentCategory.trim() && currentCategory.trim() !== customCategoryValue ? [currentCategory.trim()] : [];

  return Array.from(new Set([...baseOptions, ...existingCategories, ...currentCategoryOption]));
}

function formatEditableNumber(value: number) {
  return value === 0 ? "" : String(value);
}

function parseEditableNumber(value: string) {
  const parsedValue = Number(value || 0);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function createComponentNumberInputs(components: ProductComponent[], key: "quantity" | "unitCost") {
  return Object.fromEntries(components.map((component) => [component.id, formatEditableNumber(component[key])]));
}

function componentUsesMaterialAndColor(type: ProductComponentType) {
  return materialColorComponentTypes.has(type);
}

const emptyComponent = (): ProductComponent => ({
  id: createId("component"),
  name: "",
  type: "comprado",
  quantity: 1,
  unit: "pieza",
  origin: "comprado",
  process: "pendiente",
  specs: {},
  material: "",
  color: "",
  supplierContactMethod: "whatsapp",
  supplierExternalPlatform: "",
  supplierCompany: "",
  supplierContact: "",
  supplierEmail: "",
  supplierPhone: "",
  supplierPartNumber: "",
  unitCost: 0,
  leadTime: "",
  minimumPurchaseQuantity: "",
  referenceLink: "",
  needsSupplierResearch: false,
  supplierResearchNotes: "",
  printDesigns: [],
  notes: ""
});

const emptyProduct: ProductDraft = {
  sku: "",
  name: "",
  shortDescription: "",
  category: "",
  basePrice: 0,
  currency: "MXN",
  unit: "pieza",
  status: "borrador",
  commercialNotes: "",
  technicalNotes: "",
  components: []
};

export function ProductEditorModal({ product, products, onClose, onSave }: ProductEditorModalProps) {
  const [draft, setDraft] = useState<ProductDraft>(
    product
      ? {
          sku: product.sku,
          name: product.name,
          shortDescription: product.shortDescription,
          category: product.category,
          basePrice: product.basePrice,
          currency: product.currency ?? "MXN",
          unit: product.unit,
          status: product.status,
          commercialNotes: product.commercialNotes,
          technicalNotes: product.technicalNotes,
          components: product.components.map((component) => {
            const origin = getProductComponentOrigin(component);
            const process = normalizeProductComponentProcess(component.type, origin, component.process);

            return {
              ...component,
              origin,
              process,
              specs: normalizeProductComponentSpecs(component.type, component.specs ?? {}),
              supplierContactMethod: component.supplierContactMethod ?? "whatsapp",
              supplierExternalPlatform: component.supplierExternalPlatform ?? "",
              needsSupplierResearch: component.needsSupplierResearch ?? false,
              supplierResearchNotes: component.supplierResearchNotes ?? "",
              printDesigns: component.printDesigns ?? []
            };
          })
        }
      : emptyProduct
  );
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [expandedComponentId, setExpandedComponentId] = useState<string | null>(() => product?.components[0]?.id ?? null);
  const [basePriceInput, setBasePriceInput] = useState(() => (product?.basePrice ? String(product.basePrice) : ""));
  const [componentQuantityInputs, setComponentQuantityInputs] = useState<Record<string, string>>(() =>
    createComponentNumberInputs(draft.components, "quantity")
  );
  const [componentUnitCostInputs, setComponentUnitCostInputs] = useState<Record<string, string>>(() =>
    createComponentNumberInputs(draft.components, "unitCost")
  );
  const categoryOptions = getCategoryOptions(products, draft.category);
  const [isCustomCategory, setIsCustomCategory] = useState(
    () => Boolean(product?.category.trim()) && !categoryOptions.includes(product?.category.trim() ?? "")
  );
  const previewBasePrice = Number(basePriceInput || 0);

  function updateField<Key extends keyof ProductDraft>(key: Key, value: ProductDraft[Key]) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  function createAutomaticSku(productName: string) {
    return productName.trim() ? generateProductSku(productName, products, product?.id) : "";
  }

  function updateProductName(name: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      name,
      sku: product?.sku.trim() ? currentDraft.sku : createAutomaticSku(name)
    }));
  }

  function updateProductCategory(category: string) {
    if (category === customCategoryValue) {
      setIsCustomCategory(true);
      setDraft((currentDraft) => ({
        ...currentDraft,
        category: productCategoryOptions.includes(currentDraft.category as (typeof productCategoryOptions)[number])
          ? ""
          : currentDraft.category
      }));
      return;
    }

    setIsCustomCategory(false);
    updateField("category", category);
  }

  function updateBasePriceInput(value: string) {
    const normalizedValue = value.replace(",", ".");

    if (!/^\d*\.?\d*$/.test(normalizedValue)) {
      return;
    }

    setBasePriceInput(normalizedValue);
  }

  function updateComponentNumberInput(componentId: string, key: "quantity" | "unitCost", value: string) {
    const normalizedValue = value.replace(",", ".");

    if (!/^\d*\.?\d*$/.test(normalizedValue)) {
      return;
    }

    if (key === "quantity") {
      setComponentQuantityInputs((currentInputs) => ({ ...currentInputs, [componentId]: normalizedValue }));
      updateComponent(componentId, "quantity", parseEditableNumber(normalizedValue));
      return;
    }

    setComponentUnitCostInputs((currentInputs) => ({ ...currentInputs, [componentId]: normalizedValue }));
    updateComponent(componentId, "unitCost", parseEditableNumber(normalizedValue));
  }

  function updateComponentType(componentId: string, type: ProductComponentType) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) => {
        if (component.id !== componentId) {
          return component;
        }

        const origin = getProductComponentOrigin(component);
        const process = normalizeProductComponentProcess(type, origin, component.process);

        return {
          ...component,
          type,
          origin,
          process,
          specs: normalizeProductComponentSpecs(type, component.specs ?? {}),
          material: componentUsesMaterialAndColor(type) ? component.material : "",
          color: componentUsesMaterialAndColor(type) ? component.color : "",
          printDesigns:
            origin === "fabricado-en-planta" && process === "impresion-3d" && component.printDesigns.length === 0
              ? [emptyPrintDesign("P1S")]
              : component.printDesigns
        };
      })
    }));
  }

  function updateComponent<Key extends keyof ProductComponent>(
    componentId: string,
    key: Key,
    value: ProductComponent[Key]
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId ? { ...component, [key]: value } : component
      )
    }));
  }

  function updateComponentSpec(componentId: string, key: string, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              specs: {
                ...(component.specs ?? {}),
                [key]: value
              }
            }
          : component
      )
    }));
  }

  function updateSupplierResearch(componentId: string, needsSupplierResearch: boolean) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) => {
        if (component.id !== componentId) {
          return component;
        }

        if (!needsSupplierResearch) {
          return { ...component, needsSupplierResearch };
        }

        return {
          ...component,
          needsSupplierResearch,
          supplierContactMethod: "whatsapp",
          supplierExternalPlatform: "",
          supplierCompany: "",
          supplierContact: "",
          supplierEmail: "",
          supplierPhone: "",
          supplierPartNumber: "",
          unitCost: 0,
          leadTime: "",
          minimumPurchaseQuantity: "",
          referenceLink: ""
        };
      })
    }));
  }

  function updateSupplierContactMethod(componentId: string, supplierContactMethod: ProductSupplierContactMethod) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              supplierContactMethod,
              supplierExternalPlatform: supplierContactMethod === "externa" ? component.supplierExternalPlatform : ""
            }
          : component
      )
    }));
  }

  function updateComponentOrigin(componentId: string, origin: ProductComponentOrigin) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) => {
        if (component.id !== componentId) {
          return component;
        }

        const process = getDefaultProductComponentProcess(component.type, origin);

        return {
          ...component,
          origin,
          process,
          printDesigns:
            origin === "fabricado-en-planta" && process === "impresion-3d"
              ? component.printDesigns.length > 0
                ? component.printDesigns
                : [emptyPrintDesign("P1S")]
              : component.printDesigns
        };
      })
    }));
  }

  function updateComponentProcess(componentId: string, process: ProductComponentProcess) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) => {
        if (component.id !== componentId) {
          return component;
        }

        return {
          ...component,
          process,
          printDesigns:
            getProductComponentOrigin(component) === "fabricado-en-planta" && process === "impresion-3d" && component.printDesigns.length === 0
              ? [emptyPrintDesign("P1S")]
              : component.printDesigns
        };
      })
    }));
  }

  function updatePrintDesign<Key extends keyof ProductPrintDesign>(
    componentId: string,
    designId: string,
    key: Key,
    value: ProductPrintDesign[Key]
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              printDesigns: component.printDesigns.map((design) =>
                design.id === designId ? { ...design, [key]: value } : design
              )
            }
          : component
      )
    }));
  }

  function addPrintDesign(componentId: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? { ...component, printDesigns: [...component.printDesigns, emptyPrintDesign("")] }
          : component
      )
    }));
  }

  function removePrintDesign(componentId: string, designId: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? { ...component, printDesigns: component.printDesigns.filter((design) => design.id !== designId) }
          : component
      )
    }));
  }

  function addComponent() {
    const component = emptyComponent();

    setDraft((currentDraft) => ({
      ...currentDraft,
      components: [...currentDraft.components, component]
    }));
    setComponentQuantityInputs((currentInputs) => ({ ...currentInputs, [component.id]: formatEditableNumber(component.quantity) }));
    setComponentUnitCostInputs((currentInputs) => ({ ...currentInputs, [component.id]: formatEditableNumber(component.unitCost) }));
    setExpandedComponentId(component.id);
  }

  function removeComponent(componentId: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.filter((component) => component.id !== componentId)
    }));
    setComponentQuantityInputs((currentInputs) => {
      const nextInputs = { ...currentInputs };
      delete nextInputs[componentId];

      return nextInputs;
    });
    setComponentUnitCostInputs((currentInputs) => {
      const nextInputs = { ...currentInputs };
      delete nextInputs[componentId];

      return nextInputs;
    });
    setExpandedComponentId((currentExpandedComponentId) =>
      currentExpandedComponentId === componentId ? null : currentExpandedComponentId
    );
  }

  function attachPrintDesignFile(componentId: string, designId: string, event: ChangeEvent<HTMLInputElement>) {
    const fileName = Array.from(event.target.files ?? [])
      .map((file) => file.name)
      .find((selectedFileName) => selectedFileName.toLowerCase().endsWith(".3mf"));

    if (!fileName) {
      return;
    }

    setDraft((currentDraft) => ({
      ...currentDraft,
      components: currentDraft.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              printDesigns: component.printDesigns.map((design) =>
                design.id === designId ? { ...design, fileName } : design
              )
            }
          : component
      )
    }));

    event.target.value = "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const resolvedSku = (draft.sku.trim() || generateProductSku(draft.name, products, product?.id)).toUpperCase();
    const generalErrors: string[] = [];
    const skuIsDuplicated = Boolean(
      resolvedSku &&
        products.some((currentProduct) => currentProduct.id !== product?.id && currentProduct.sku.trim().toUpperCase() === resolvedSku)
    );

    if (skuIsDuplicated) {
      generalErrors.push(`El SKU ${resolvedSku} ya existe en otro producto.`);
    }

    if (isCustomCategory && !draft.category.trim()) {
      generalErrors.push("Especifica la categoría del producto.");
    }

    const optionErrors = draft.components.flatMap((component) => {
      const errors: string[] = [];

      if (!componentUsesMaterialAndColor(component.type)) {
        return errors;
      }

      if (component.material === "OTRO") {
        errors.push(`Especifica el material de la pieza "${component.name || "sin nombre"}".`);
      }

      if (component.color === "OTRO") {
        errors.push(`Especifica el color de la pieza "${component.name || "sin nombre"}".`);
      }

      return errors;
    });

    const printErrors = draft.components.flatMap((component) => {
      if (!isPrintableProductComponent(component)) {
        return [];
      }

      if (component.printDesigns.length === 0) {
        return [`La pieza "${component.name || "sin nombre"}" requiere al menos un diseño .3mf.`];
      }

      return component.printDesigns.flatMap((design, designIndex) => {
        const errors: string[] = [];
        const designName = design.printer.trim() || `diseño ${designIndex + 1}`;

        if (!design.printer.trim()) {
          errors.push(`La pieza "${component.name || "sin nombre"}" necesita impresora en el diseño ${designIndex + 1}.`);
        }

        if (!design.fileName.toLowerCase().endsWith(".3mf")) {
          errors.push(`La pieza "${component.name || "sin nombre"}" necesita archivo .3mf para ${designName}.`);
        }

        return errors;
      });
    });

    const supplierErrors = draft.components.flatMap((component) => {
      if (
        component.needsSupplierResearch ||
        !isExternalProductComponent(component) ||
        component.supplierContactMethod !== "externa"
      ) {
        return [];
      }

      if (!component.supplierExternalPlatform.trim() || component.supplierExternalPlatform === "OTRO") {
        return [`Especifica la plataforma externa de la pieza "${component.name || "sin nombre"}".`];
      }

      return [];
    });

    const specErrors = draft.components.flatMap((component) =>
      getProductComponentSpecFields(component.type)
        .filter((field) => field.required && !(component.specs?.[field.key] ?? "").trim())
        .map((field) => `${component.name || "Componente sin nombre"}: especifica ${field.label.toLowerCase()}.`)
    );

    const errors = [...generalErrors, ...optionErrors, ...specErrors, ...printErrors, ...supplierErrors];

    if (errors.length > 0) {
      const firstInvalidComponent = draft.components.find((component) => {
        if (
          getProductComponentSpecFields(component.type).some(
            (field) => field.required && !(component.specs?.[field.key] ?? "").trim()
          )
        ) {
          return true;
        }

        if (componentUsesMaterialAndColor(component.type) && (component.material === "OTRO" || component.color === "OTRO")) {
          return true;
        }

        if (
          !component.needsSupplierResearch &&
          isExternalProductComponent(component) &&
          component.supplierContactMethod === "externa" &&
          (!component.supplierExternalPlatform.trim() || component.supplierExternalPlatform === "OTRO")
        ) {
          return true;
        }

        if (!isPrintableProductComponent(component)) {
          return false;
        }

        return (
          component.printDesigns.length === 0 ||
          component.printDesigns.some(
            (design) => !design.printer.trim() || !design.fileName.toLowerCase().endsWith(".3mf")
          )
        );
      });

      if (firstInvalidComponent) {
        setExpandedComponentId(firstInvalidComponent.id);
      }

      setValidationErrors(errors);
      return;
    }

    const normalizedDraft: ProductDraft = {
      ...draft,
      sku: resolvedSku,
      category: draft.category.trim(),
      basePrice: Number(basePriceInput || 0),
      components: draft.components.map((component) => {
        const usesMaterialAndColor = componentUsesMaterialAndColor(component.type);
        const origin = getProductComponentOrigin(component);
        const process = normalizeProductComponentProcess(component.type, origin, component.process);
        const isPrintable = origin === "fabricado-en-planta" && process === "impresion-3d";

        return {
          ...component,
          origin,
          process,
          quantity: parseEditableNumber(componentQuantityInputs[component.id] ?? String(component.quantity)),
          unitCost: parseEditableNumber(componentUnitCostInputs[component.id] ?? String(component.unitCost)),
          specs: normalizeProductComponentSpecs(component.type, component.specs ?? {}),
          material: usesMaterialAndColor ? component.material.toUpperCase() : "",
          color: usesMaterialAndColor ? component.color.toUpperCase() : "",
          supplierExternalPlatform: component.supplierExternalPlatform.toUpperCase(),
          printDesigns:
            isPrintable
              ? component.printDesigns.map((design) => ({
                  ...design,
                  printer: design.printer.toUpperCase()
                }))
              : []
        };
      })
    };

    setValidationErrors([]);
    onSave(normalizedDraft, product);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-shell product-editor-modal" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <header className="modal-header">
          <h2 id="product-editor-title">{product ? "Editar producto" : "Agregar producto"}</h2>
          <button className="icon-button ghost" onClick={onClose} type="button" aria-label="Cerrar modal">
            <X size={20} />
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSubmit}>
          <section className="product-editor-section">
            <h3>Datos del producto</h3>
            <div className="form-grid three-columns">
              <label className="field">
                <span>Nombre del producto</span>
                <input value={draft.name} onChange={(event) => updateProductName(event.target.value)} autoFocus />
              </label>

              <label className="field">
                <span>SKU</span>
                <input className="locked-sku-input" value={draft.sku} disabled title="SKU generado automaticamente" />
              </label>

              <label className="field">
                <span>Categoría</span>
                <select
                  value={isCustomCategory ? customCategoryValue : draft.category}
                  onChange={(event) => updateProductCategory(event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value={customCategoryValue}>Otro</option>
                </select>
              </label>

              {isCustomCategory ? (
                <label className="field">
                  <span>Especificar categoría</span>
                  <input value={draft.category} onChange={(event) => updateField("category", event.target.value)} />
                </label>
              ) : null}

              <label className="field">
                <span>Precio de venta</span>
                <input
                  inputMode="decimal"
                  type="text"
                  value={basePriceInput}
                  onChange={(event) => updateBasePriceInput(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Moneda</span>
                <select value={draft.currency} onChange={(event) => updateField("currency", event.target.value as ProductCurrency)}>
                  {Object.entries(currencyLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="price-preview">
                <span>Vista previa</span>
                <strong>{formatCurrency(previewBasePrice, draft.currency)}</strong>
              </div>

              <label className="field">
                <span>Unidad de venta</span>
                <select value={draft.unit} onChange={(event) => updateField("unit", event.target.value as ProductUnit)}>
                  {Object.entries(productUnitLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Estado</span>
                <select value={draft.status} onChange={(event) => updateField("status", event.target.value as ProductStatus)}>
                  {Object.entries(productStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field wide-field">
                <span>Descripción</span>
                <textarea
                  value={draft.shortDescription}
                  onChange={(event) => updateField("shortDescription", event.target.value)}
                />
              </label>
            </div>

            <div className="form-grid two-columns">
              <label className="field">
                <span>Notas comerciales</span>
                <textarea
                  value={draft.commercialNotes}
                  onChange={(event) => updateField("commercialNotes", event.target.value)}
                />
              </label>

              <label className="field">
                <span>Notas técnicas</span>
                <textarea value={draft.technicalNotes} onChange={(event) => updateField("technicalNotes", event.target.value)} />
              </label>
            </div>
          </section>

          <section className="product-editor-section">
            <div className="component-heading">
              <div>
                <h3>Componentes / piezas</h3>
                <p>Agrega tornillería, motores, cableado, piezas impresas, compradas o fabricadas.</p>
              </div>
            </div>

            <div className="component-editor-list">
              {draft.components.map((component, index) => {
                const isExpanded = expandedComponentId === component.id;
                const componentName = component.name.trim() || "Componente sin nombre";
                const quantityLabel = `${component.quantity} ${productUnitLabels[component.unit].toLowerCase()}`;
                const showMaterialAndColor = componentUsesMaterialAndColor(component.type);
                const specFields = getProductComponentSpecFields(component.type);
                const componentOrigin = getProductComponentOrigin(component);
                const componentProcess = normalizeProductComponentProcess(component.type, componentOrigin, component.process);
                const showInternalProcess = componentOrigin === "fabricado-en-planta";

                return (
                <article className={`component-editor-card ${isExpanded ? "expanded" : "collapsed"}`} key={component.id}>
                  <div className="component-card-header">
                    {isExpanded ? (
                      <>
                        <strong>Componente {index + 1}</strong>
                        <button
                          className="icon-button ghost"
                          onClick={() => removeComponent(component.id)}
                          type="button"
                          aria-label="Eliminar componente"
                        >
                          <Trash2 size={17} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="component-collapsed-main">
                          <span>Componente {index + 1}</span>
                          <strong>{componentName}</strong>
                        </div>
                        <div className="component-collapsed-count">
                          <span>Cantidad</span>
                          <strong>{quantityLabel}</strong>
                        </div>
                        <button
                          className="secondary-button compact-button"
                          onClick={() => setExpandedComponentId(component.id)}
                          type="button"
                        >
                          <Edit3 size={15} />
                          Editar
                        </button>
                      </>
                    )}
                  </div>

                  {isExpanded ? (
                    <>
                  <div className="form-grid four-columns">
                    <label className="field">
                      <span>Nombre</span>
                      <input value={component.name} onChange={(event) => updateComponent(component.id, "name", event.target.value)} />
                    </label>

                    <label className="field">
                      <span>Tipo</span>
                      <select
                        value={component.type}
                        onChange={(event) => updateComponentType(component.id, event.target.value as ProductComponentType)}
                      >
                        {Object.entries(componentTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Cantidad</span>
                      <input
                        inputMode="decimal"
                        type="text"
                        value={componentQuantityInputs[component.id] ?? formatEditableNumber(component.quantity)}
                        onChange={(event) => updateComponentNumberInput(component.id, "quantity", event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>Unidad</span>
                      <select
                        value={component.unit}
                        onChange={(event) => updateComponent(component.id, "unit", event.target.value as ProductUnit)}
                      >
                        {Object.entries(productUnitLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Origen</span>
                      <select
                        value={componentOrigin}
                        onChange={(event) => updateComponentOrigin(component.id, event.target.value as ProductComponentOrigin)}
                      >
                        {Object.entries(componentOriginLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {showInternalProcess ? (
                      <label className="field">
                        <span>Proceso interno</span>
                        <select
                          value={componentProcess}
                          onChange={(event) => updateComponentProcess(component.id, event.target.value as ProductComponentProcess)}
                        >
                          {Object.entries(componentProcessLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {showMaterialAndColor ? (
                      <>
                    <label className="field">
                      <span>MATERIAL</span>
                      <select
                        value={optionValue(component.material, materialOptions)}
                        onChange={(event) =>
                          updateComponent(component.id, "material", event.target.value)
                        }
                      >
                        <option value="">SELECCIONA</option>
                        {materialOptions.map((material) => (
                          <option key={material} value={material}>
                            {material}
                          </option>
                        ))}
                      </select>
                    </label>

                    {optionValue(component.material, materialOptions) === "OTRO" && (
                      <label className="field">
                        <span>ESPECIFICAR MATERIAL</span>
                        <input
                          value={customOptionValue(component.material, materialOptions)}
                          onChange={(event) => updateComponent(component.id, "material", event.target.value.toUpperCase())}
                        />
                      </label>
                    )}

                    <label className="field">
                      <span>COLOR</span>
                      <select
                        value={optionValue(component.color, colorOptions)}
                        onChange={(event) =>
                          updateComponent(component.id, "color", event.target.value)
                        }
                      >
                        <option value="">SELECCIONA</option>
                        {colorOptions.map((color) => (
                          <option key={color} value={color}>
                            {color}
                          </option>
                        ))}
                      </select>
                    </label>

                    {optionValue(component.color, colorOptions) === "OTRO" && (
                      <label className="field">
                        <span>ESPECIFICAR COLOR</span>
                        <input
                          value={customOptionValue(component.color, colorOptions)}
                          onChange={(event) => updateComponent(component.id, "color", event.target.value.toUpperCase())}
                        />
                      </label>
                    )}
                      </>
                    ) : null}
                  </div>

                  {specFields.length > 0 ? (
                    <section className="component-spec-panel">
                      <div className="component-spec-heading">
                        <span>Especificaciones tecnicas</span>
                        <small>Campos segun tipo de componente.</small>
                      </div>

                      <div className="form-grid four-columns">
                        {specFields.map((field) => (
                          <label className="field" key={field.key}>
                            <span>{field.required ? `${field.label} *` : field.label}</span>
                            <input
                              value={component.specs?.[field.key] ?? ""}
                              placeholder={field.placeholder}
                              onChange={(event) => updateComponentSpec(component.id, field.key, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {isExternalProductComponent(component) && (
                    <div className="supplier-block">
                      <h4>Proveedor / compra</h4>
                      <div className="supplier-mode-row">
                        <label className="checkbox-field supplier-checkbox">
                          <input
                            type="checkbox"
                            checked={component.needsSupplierResearch}
                            onChange={(event) => updateSupplierResearch(component.id, event.target.checked)}
                          />
                          <span>
                            <strong>Sin proveedor</strong>
                            <small>Compras investigará con quién comprar esta pieza.</small>
                          </span>
                        </label>

                        {component.needsSupplierResearch ? (
                          <span className="supplier-pending-pill">Pendiente de compras</span>
                        ) : null}
                      </div>

                      {component.needsSupplierResearch ? (
                        <label className="field supplier-notes-field">
                          <span>Notas para compras</span>
                          <textarea
                            value={component.supplierResearchNotes}
                            onChange={(event) => updateComponent(component.id, "supplierResearchNotes", event.target.value)}
                            placeholder="Ej. buscar proveedor nacional, revisar material, pedir cotización por volumen..."
                          />
                        </label>
                      ) : (
                        <div className="form-grid four-columns">
                        <label className="field">
                          <span>Método de contacto</span>
                          <select
                            value={component.supplierContactMethod}
                            onChange={(event) =>
                              updateSupplierContactMethod(component.id, event.target.value as ProductSupplierContactMethod)
                            }
                          >
                            {Object.entries(supplierContactMethodLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {component.supplierContactMethod === "externa" && (
                          <label className="field">
                            <span>Plataforma externa</span>
                            <select
                              value={optionValue(component.supplierExternalPlatform, supplierExternalPlatformOptions)}
                              onChange={(event) =>
                                updateComponent(component.id, "supplierExternalPlatform", event.target.value)
                              }
                            >
                              <option value="">SELECCIONA</option>
                              {supplierExternalPlatformOptions.map((platform) => (
                                <option key={platform} value={platform}>
                                  {platform}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {component.supplierContactMethod === "externa" &&
                          optionValue(component.supplierExternalPlatform, supplierExternalPlatformOptions) === "OTRO" && (
                            <label className="field">
                              <span>Especificar plataforma</span>
                              <input
                                value={customOptionValue(component.supplierExternalPlatform, supplierExternalPlatformOptions)}
                                onChange={(event) =>
                                  updateComponent(component.id, "supplierExternalPlatform", event.target.value.toUpperCase())
                                }
                              />
                            </label>
                          )}

                        <label className="field">
                          <span>Empresa</span>
                          <input
                            value={component.supplierCompany}
                            onChange={(event) => updateComponent(component.id, "supplierCompany", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>Contacto</span>
                          <input
                            value={component.supplierContact}
                            onChange={(event) => updateComponent(component.id, "supplierContact", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>Correo</span>
                          <input
                            value={component.supplierEmail}
                            onChange={(event) => updateComponent(component.id, "supplierEmail", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>Teléfono</span>
                          <input
                            value={component.supplierPhone}
                            onChange={(event) => updateComponent(component.id, "supplierPhone", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>No. parte proveedor</span>
                          <input
                            value={component.supplierPartNumber}
                            onChange={(event) => updateComponent(component.id, "supplierPartNumber", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>Costo unitario</span>
                          <input
                            inputMode="decimal"
                            type="text"
                            value={componentUnitCostInputs[component.id] ?? formatEditableNumber(component.unitCost)}
                            onChange={(event) => updateComponentNumberInput(component.id, "unitCost", event.target.value)}
                          />
                        </label>

                        <label className="field">
                          <span>Tiempo entrega</span>
                          <input value={component.leadTime} onChange={(event) => updateComponent(component.id, "leadTime", event.target.value)} />
                        </label>

                        <label className="field">
                          <span>Mínimo compra</span>
                          <input
                            value={component.minimumPurchaseQuantity}
                            onChange={(event) => updateComponent(component.id, "minimumPurchaseQuantity", event.target.value)}
                          />
                        </label>

                        <label className="field wide-field">
                          <span>Link o referencia</span>
                          <input
                            value={component.referenceLink}
                            onChange={(event) => updateComponent(component.id, "referenceLink", event.target.value)}
                          />
                        </label>
                      </div>
                      )}
                    </div>
                  )}

                  {isPrintableProductComponent(component) && (
                    <div className="print-design-block">
                      <div className="component-heading compact-heading">
                        <div>
                          <h4>Diseños 3MF por impresora</h4>
                          <p>Cada diseño debe indicar impresora y archivo .3MF.</p>
                        </div>
                        <button className="secondary-button compact-button" onClick={() => addPrintDesign(component.id)} type="button">
                          <Plus size={15} />
                          Agregar diseño para otra impresora
                        </button>
                      </div>

                      <div className="print-design-list">
                        {component.printDesigns.map((design) => (
                          <article className="print-design-row" key={design.id}>
                            <label className="field">
                              <span>IMPRESORA</span>
                              <select
                                value={printerOptions.includes(design.printer as (typeof printerOptions)[number]) ? design.printer : "OTRA"}
                                onChange={(event) =>
                                  updatePrintDesign(
                                    component.id,
                                    design.id,
                                    "printer",
                                    event.target.value === "OTRA" ? "" : event.target.value
                                  )
                                }
                              >
                                {printerOptions.map((printer) => (
                                  <option key={printer} value={printer}>
                                    {printer}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {design.printer !== "P1S" && (
                              <label className="field">
                                <span>ESPECIFICAR IMPRESORA</span>
                                <input
                                  value={design.printer === "OTRA" ? "" : design.printer}
                                  onChange={(event) =>
                                    updatePrintDesign(component.id, design.id, "printer", event.target.value.toUpperCase())
                                  }
                                />
                              </label>
                            )}

                            <div className="field">
                              <span>ARCHIVO 3MF</span>
                              <label className="secondary-button input-height-button file-button">
                                <FileUp size={16} />
                                {design.fileName || "Subir archivo .3mf"}
                                <input
                                  hidden
                                  type="file"
                                  accept=".3mf"
                                  onChange={(event) => attachPrintDesignFile(component.id, design.id, event)}
                                />
                              </label>
                            </div>

                            <label className="field">
                              <span>Notas</span>
                              <input
                                value={design.notes}
                                onChange={(event) => updatePrintDesign(component.id, design.id, "notes", event.target.value)}
                              />
                            </label>

                            <button
                              className="icon-button ghost"
                              onClick={() => removePrintDesign(component.id, design.id)}
                              type="button"
                              aria-label="Eliminar diseño"
                            >
                              <Trash2 size={17} />
                            </button>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="field">
                    <span>Notas del componente</span>
                    <textarea value={component.notes} onChange={(event) => updateComponent(component.id, "notes", event.target.value)} />
                  </label>
                    </>
                  ) : null}
                </article>
                );
              })}

              {draft.components.length === 0 ? <p className="empty-state">Sin componentes definidos.</p> : null}
            </div>

            <div className="component-editor-actions">
              <button className="secondary-button" onClick={addComponent} type="button">
                <Plus size={16} />
                {draft.components.length > 0 ? "Agregar otro componente" : "Agregar componente"}
              </button>
            </div>
          </section>

          {validationErrors.length > 0 ? (
            <div className="form-error-list" role="alert">
              {validationErrors.map((error) => (
                <span key={error}>{error}</span>
              ))}
            </div>
          ) : null}

          <footer className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <button className="primary-button" type="submit">
              Guardar producto
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
