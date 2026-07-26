import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Factory,
  Gauge,
  Lightbulb,
  MapPinned,
  MoveRight,
  PackageCheck,
  PackageSearch,
  Play,
  Route,
  UsersRound
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Product } from "../../sales/types";
import { priorityLabels } from "../../sales/utils";
import type { ProductionGeneratedPlan, ProductionShiftSettings } from "../types";
import {
  createProductionPendingQueue,
  createDefaultShiftSettings,
  formatPlanTime,
  formatProductionMinutes,
  generateProductionPlan,
  loadProductionPlanningContext,
  productionIssueSeverityLabels,
  productionLatestPlanStorageKey,
  productionPendingOrderStatusLabels,
  productionPlanStrategyLabels,
  summarizePlannerQueue
} from "../utils";

type ProductionScreenProps = {
  products: Product[];
  onBack: () => void;
};

function formatDate(value: string) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function ProductionScreen({ products, onBack }: ProductionScreenProps) {
  const [shiftSettings, setShiftSettings] = useState<ProductionShiftSettings>(() => createDefaultShiftSettings());
  const basePlanningContext = useMemo(() => loadProductionPlanningContext(), [products]);
  const planningContext = basePlanningContext;
  const pendingQueue = useMemo(
    () => createProductionPendingQueue(products, shiftSettings.planDate),
    [products, shiftSettings.planDate]
  );
  const [generatedPlan, setGeneratedPlan] = useState<ProductionGeneratedPlan | null>(null);
  const visiblePlan =
    generatedPlan ??
    generateProductionPlan(pendingQueue.orders, products, shiftSettings, planningContext, pendingQueue.sourceLabel);
  const summary = useMemo(
    () => summarizePlannerQueue(pendingQueue.orders, products, shiftSettings, planningContext),
    [pendingQueue.orders, products, shiftSettings, planningContext]
  );

  function updateShift<Key extends keyof ProductionShiftSettings>(key: Key, value: ProductionShiftSettings[Key]) {
    setGeneratedPlan(null);
    setShiftSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value
    }));
  }

  function handleGeneratePlan() {
    const nextPlan = generateProductionPlan(pendingQueue.orders, products, shiftSettings, planningContext, pendingQueue.sourceLabel);

    setGeneratedPlan(nextPlan);

    try {
      window.localStorage.setItem(productionLatestPlanStorageKey, JSON.stringify(nextPlan));
    } catch {
      return;
    }
  }

  return (
    <main className="production-profile-screen">
      <header className="screen-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Regresar a perfiles">
          <ArrowLeft size={22} />
        </button>
        <div className="screen-title">
          <span className="screen-icon production-screen-icon" aria-hidden="true">
            <ClipboardList size={22} />
          </span>
          <h1>Producción</h1>
        </div>
      </header>

      <section className="production-profile-body">
        <section className="production-command-panel">
          <div>
            <span className="section-kicker">Planner operativo</span>
            <h2>Generar plan de producción</h2>
            <p>
              Producción analiza {pendingQueue.sourceLabel.toLowerCase()}, agrupa recolecciones y propone el orden del
              turno sin capturar trabajo manualmente.
            </p>
          </div>
          <div className="production-command-summary">
            <article>
              <CalendarClock size={18} />
              <span>Órdenes</span>
              <strong>{summary.pendingOrders}</strong>
            </article>
            <article>
              <PackageSearch size={18} />
              <span>Equipos</span>
              <strong>{summary.totalUnits}</strong>
            </article>
            <article>
              <AlertTriangle size={18} />
              <span>Riesgo</span>
              <strong>{summary.atRisk}</strong>
            </article>
            <article>
              <Clock3 size={18} />
              <span>Estimado</span>
              <strong>{formatProductionMinutes(summary.estimatedMinutes)}</strong>
            </article>
          </div>
        </section>

        <section className="production-layout">
          <aside className="production-create-panel">
            <div className="clean-section-heading">
              <div>
                <span className="section-kicker">Turno</span>
                <h2>Parámetros del plan</h2>
                <p>Estos datos guían cómo Harv acomoda las órdenes en el día.</p>
              </div>
            </div>

            <label className="field">
              <span>Fecha del plan</span>
              <input
                type="date"
                value={shiftSettings.planDate}
                onChange={(event) => updateShift("planDate", event.target.value)}
              />
            </label>

            <div className="two-columns">
              <label className="field">
                <span>Inicio</span>
                <input
                  type="time"
                  value={shiftSettings.shiftStart}
                  onChange={(event) => updateShift("shiftStart", event.target.value)}
                />
              </label>

              <label className="field">
                <span>Fin</span>
                <input
                  type="time"
                  value={shiftSettings.shiftEnd}
                  onChange={(event) => updateShift("shiftEnd", event.target.value)}
                />
              </label>
            </div>

            <div className="two-columns">
              <label className="field">
                <span>Personas</span>
                <input
                  min="1"
                  type="number"
                  value={shiftSettings.peopleAvailable}
                  onChange={(event) => updateShift("peopleAvailable", Number(event.target.value))}
                />
              </label>

              <label className="field">
                <span>Ensamble</span>
                <input
                  min="1"
                  type="number"
                  value={shiftSettings.assemblyStations}
                  onChange={(event) => updateShift("assemblyStations", Number(event.target.value))}
                />
              </label>
            </div>

            <div className="two-columns">
              <label className="field">
                <span>Calidad</span>
                <input
                  min="1"
                  type="number"
                  value={shiftSettings.qualityStations}
                  onChange={(event) => updateShift("qualityStations", Number(event.target.value))}
                />
              </label>

              <label className="field">
                <span>Estrategia</span>
                <select
                  value={shiftSettings.strategy}
                  onChange={(event) => updateShift("strategy", event.target.value as ProductionShiftSettings["strategy"])}
                >
                  {Object.entries(productionPlanStrategyLabels).map(([strategy, label]) => (
                    <option key={strategy} value={strategy}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="production-route-preview" aria-label="Flujo del plan">
              <div>
                <PackageSearch size={18} />
                <span>Recolección agrupada</span>
              </div>
              <div>
                <PackageCheck size={18} />
                <span>Ensamble por lote</span>
              </div>
              <div>
                <CheckCircle2 size={18} />
                <span>Calidad por lote</span>
              </div>
            </div>

            <button className="primary-button" type="button" onClick={handleGeneratePlan}>
              <Play size={18} />
              Generar plan del día
            </button>
          </aside>

          <section className="production-board-panel">
            <div className="clean-section-heading">
              <div>
                <span className="section-kicker">Cola automática</span>
                <h2>Órdenes pendientes por planear</h2>
                <p>
                  Fuente actual: {pendingQueue.sourceLabel}. Genera una orden aprobada en Ventas para alimentar esta cola.
                </p>
              </div>
            </div>

            <div className="production-pending-list">
              {pendingQueue.orders.map((order) => (
                <article className={`production-pending-row status-${order.status}`} key={order.id}>
                  <div>
                    <span>{order.sourceOrder}</span>
                    <strong>
                      {order.productSku} · {order.productName}
                    </strong>
                    <p>{order.clientName}</p>
                  </div>
                  <div className="production-pending-meta">
                    <span>Ventas</span>
                    <span>{order.quantity} equipos</span>
                    <span>{formatDate(order.dueDate)}</span>
                    <span>{priorityLabels[order.priority]}</span>
                  </div>
                  <span className={`status-pill status-${order.status}`}>
                    {productionPendingOrderStatusLabels[order.status]}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </section>

        <section className="production-plan-layout">
          <section className="production-board-panel">
            <div className="clean-section-heading">
              <div>
                <span className="section-kicker">Plan generado</span>
                <h2>Secuencia recomendada del turno</h2>
                <p>
                  Generado a las{" "}
                  {new Intl.DateTimeFormat("es-MX", {
                    hour: "2-digit",
                    minute: "2-digit"
                  }).format(new Date(visiblePlan.generatedAt))}
                  .
                </p>
              </div>
              <div className="production-plan-score">
                <span>{visiblePlan.scheduledUnits}/{visiblePlan.totalUnits} equipos</span>
                <span>{visiblePlan.optimization.utilizationPercent}% uso turno</span>
                <strong>{formatProductionMinutes(visiblePlan.scheduledMinutes)}</strong>
              </div>
            </div>

            <div className="production-timeline">
              {visiblePlan.scheduledBlocks.length === 0 ? (
                <div className="empty-state">No hay bloques dentro de la capacidad del turno.</div>
              ) : (
                visiblePlan.scheduledBlocks.map((block) => (
                  <article className={`production-plan-block block-${block.type}`} key={block.id}>
                    <div className="production-plan-time">
                      <strong>{formatPlanTime(block.startTime)}</strong>
                      <span>{formatPlanTime(block.endTime)}</span>
                    </div>

                    <div className="production-plan-content">
                      <header>
                        <span className={`production-block-type block-${block.type}`}>
                          {block.type === "recoleccion" ? "Recolección" : block.type === "ensamble" ? "Ensamble" : "Calidad"}
                        </span>
                        <h3>{block.title}</h3>
                      </header>

                      <p>{block.reason}</p>

                      <div className="production-order-meta">
                        <div>
                          <Factory size={15} />
                          <span>{block.owner}</span>
                        </div>
                        <div>
                          <PackageSearch size={15} />
                          <span>{block.quantity} equipos</span>
                        </div>
                        <div>
                          <Clock3 size={15} />
                          <span>{formatProductionMinutes(block.estimatedMinutes)}</span>
                        </div>
                        <div>
                          <Route size={15} />
                          <span>{block.sourceOrders.join(", ")}</span>
                        </div>
                      </div>

                      <ul className="production-detail-list">
                        {block.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <aside className="production-board-panel production-issues-panel">
            <div className="production-side-section">
              <div className="clean-section-heading">
                <div>
                  <span className="section-kicker">Recomendaciones</span>
                  <h2>Acciones sugeridas</h2>
                  <p>Harv recomienda ajustes antes de liberar el plan.</p>
                </div>
              </div>

              <div className="production-recommendation-list">
                {visiblePlan.recommendations.map((recommendation) => (
                  <article className={`production-recommendation type-${recommendation.type}`} key={recommendation.id}>
                    <Lightbulb size={16} />
                    <div>
                      <strong>{recommendation.title}</strong>
                      <p>{recommendation.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="production-side-section">
              <div className="clean-section-heading">
                <div>
                  <span className="section-kicker">Pickup</span>
                  <h2>Recolección optimizada</h2>
                  <p>Agrupada por ubicación o zona detectada en Almacén.</p>
                </div>
              </div>

              <div className="production-pickup-list">
                {visiblePlan.pickupGroups.length === 0 ? (
                  <div className="empty-state">Sin grupos de recolección detectados.</div>
                ) : (
                  visiblePlan.pickupGroups.map((group) => (
                    <article className={`production-pickup-card status-${group.status}`} key={group.id}>
                      <header>
                        <MapPinned size={16} />
                        <div>
                          <span>{group.status === "lista" ? "Lista" : "Con faltantes"}</span>
                          <strong>{group.locationLabel}</strong>
                        </div>
                      </header>
                      <p>
                        {group.itemCount} partida(s) · {group.sourceOrders.join(", ")}
                      </p>
                      <ul>
                        {group.details.slice(0, 3).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="clean-section-heading">
              <div>
                <span className="section-kicker">Alertas</span>
                <h2>Problemas detectados</h2>
                <p>Son señales que Producción debe resolver o escalar antes de liberar el plan.</p>
              </div>
            </div>

            <div className="production-issue-list">
              {visiblePlan.issues.length === 0 ? (
                <div className="empty-state">Sin problemas detectados.</div>
              ) : (
                visiblePlan.issues.map((issue) => (
                  <article className={`production-issue severity-${issue.severity}`} key={issue.id}>
                    <div>
                      <span>{productionIssueSeverityLabels[issue.severity]}</span>
                      <strong>{issue.title}</strong>
                    </div>
                    <p>{issue.detail}</p>
                    <small>{issue.sourceOrder}</small>
                  </article>
                ))
              )}
            </div>

            {visiblePlan.overflowOrders.length > 0 ? (
              <div className="production-overflow-box">
                <span>Fuera del turno</span>
                <strong>{visiblePlan.overflowOrders.length} orden(es)</strong>
                <p>Harv recomienda moverlas al siguiente turno o aumentar capacidad.</p>
              </div>
            ) : null}

            {visiblePlan.nextShiftBlocks.length > 0 ? (
              <div className="production-side-section">
                <div className="clean-section-heading">
                  <div>
                    <span className="section-kicker">Siguiente turno</span>
                    <h2>{visiblePlan.optimization.nextShiftDate}</h2>
                    <p>Preview automático con lo que quedó fuera.</p>
                  </div>
                </div>

                <div className="production-next-shift-list">
                  {visiblePlan.nextShiftBlocks.slice(0, 4).map((block) => (
                    <article key={block.id}>
                      <span>
                        {block.startTime} <MoveRight size={13} /> {block.endTime}
                      </span>
                      <strong>{block.title}</strong>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </section>

        <section className="production-optimization-grid" aria-label="Optimización del plan">
          <article>
            <Gauge size={18} />
            <span>Uso del turno</span>
            <strong>{visiblePlan.optimization.utilizationPercent}%</strong>
          </article>
          <article>
            <Clock3 size={18} />
            <span>Ahorro estimado</span>
            <strong>{formatProductionMinutes(visiblePlan.optimization.savedPickupMinutes)}</strong>
          </article>
          <article>
            <MapPinned size={18} />
            <span>Grupos pickup</span>
            <strong>{visiblePlan.optimization.groupedPickupCount}</strong>
          </article>
          <article>
            <AlertTriangle size={18} />
            <span>Bloqueos</span>
            <strong>{visiblePlan.optimization.blockedIssueCount}</strong>
          </article>
        </section>

        <section className="production-logic-strip" aria-label="Criterios del planner">
          <article>
            <UsersRound size={18} />
            <span>Capacidad</span>
            <strong>
              {shiftSettings.peopleAvailable} personas · {shiftSettings.assemblyStations} ensamble ·{" "}
              {shiftSettings.qualityStations} calidad
            </strong>
          </article>
          <article>
            <PackageSearch size={18} />
            <span>Datos conectados</span>
            <strong>
              {planningContext.routes.length} rutas · {planningContext.warehouseEntries.length} entradas almacén
            </strong>
          </article>
          <article>
            <PackageSearch size={18} />
            <span>Optimización</span>
            <strong>{productionPlanStrategyLabels[shiftSettings.strategy]}</strong>
          </article>
          <article>
            <Clock3 size={18} />
            <span>Turno</span>
            <strong>
              {shiftSettings.shiftStart} - {shiftSettings.shiftEnd}
            </strong>
          </article>
        </section>
      </section>
    </main>
  );
}
