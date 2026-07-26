import type { PDFForm } from "pdf-lib";
import type { Client, OrderLine, SalesQuote } from "./types";
import { formatCurrency, formatDateTime, formatShippingAddress, lineSubtotal, orderTotals, productUnitLabels } from "./utils";

const quoteTemplatePath = "/templates/cotizaciones.pdf";
const quoteLineFields = [
  { article: "Articulo", quantity: "Cantidad", price: "Precio", total: "Total" },
  { article: "Articulo_1", quantity: "Cantidad_1", price: "Precio_1", total: "Total_1" }
] as const;

type QuoteTextFieldOptions = {
  fontSize?: number;
  multiline?: boolean;
};

const quoteFieldFontSizes = {
  folio: 7.5,
  date: 7,
  client: 9.5,
  article: 6.8,
  quantity: 20,
  lineMoney: 7.8,
  summary: 12.5,
  finalTotal: 13.5
} as const;

function setTextField(form: PDFForm, fieldName: string, value: string, options: QuoteTextFieldOptions = {}) {
  try {
    const field = form.getTextField(fieldName);

    if (options.multiline) {
      field.enableMultiline();
    }

    if (options.fontSize) {
      field.setFontSize(options.fontSize);
    }

    field.setText(value);
    return true;
  } catch (error) {
    console.warn(`No se pudo llenar el campo "${fieldName}" de la cotizacion.`, error);
    return false;
  }
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function limitText(value: string, maxLength: number) {
  const normalizedValue = compactText(value);

  return normalizedValue.length > maxLength ? `${normalizedValue.slice(0, Math.max(maxLength - 3, 0))}...` : normalizedValue;
}

function formatLineMoney(value: number, currency: OrderLine["product"]["currency"]) {
  const formattedValue = formatCurrency(value, currency);

  return currency === "MXN" ? formattedValue.replace(" MXN", "") : formattedValue;
}

function buildClientText(client?: Client) {
  if (!client) {
    return "Cliente sin registrar";
  }

  return [
    client.commercialName,
    client.legalName ? `Razon social: ${client.legalName}` : "",
    client.taxId ? `RFC: ${client.taxId}` : "",
    client.contactName ? `Contacto: ${client.contactName}` : "",
    client.email ? `Email: ${client.email}` : "",
    client.phone ? `Telefono: ${client.phone}` : "",
    `Entrega: ${formatShippingAddress(client.shippingAddress)}`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLineArticleText(line: OrderLine, index: number, overflowCount = 0) {
  return [
    `${index + 1}. ${line.product.sku} - ${line.product.name}`,
    limitText(line.product.shortDescription, 92),
    line.notes ? `Nota: ${limitText(line.notes, 58)}` : "",
    overflowCount > 0 ? `+ ${overflowCount} partida(s) adicional(es) incluidas en el total.` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLineQuantityText(line: OrderLine) {
  const unitLabel = productUnitLabels[line.product.unit] ?? line.product.unit;

  return `${line.quantity} ${unitLabel.toLowerCase()}`;
}

function clearQuoteLineFields(form: PDFForm, fields: (typeof quoteLineFields)[number]) {
  return [
    setTextField(form, fields.article, "", { fontSize: quoteFieldFontSizes.article, multiline: true }),
    setTextField(form, fields.quantity, "", { fontSize: quoteFieldFontSizes.quantity }),
    setTextField(form, fields.price, "", { fontSize: quoteFieldFontSizes.lineMoney }),
    setTextField(form, fields.total, "", { fontSize: quoteFieldFontSizes.lineMoney })
  ];
}

function setQuoteLineFields(
  form: PDFForm,
  fields: (typeof quoteLineFields)[number],
  line: OrderLine,
  index: number,
  overflowCount = 0
) {
  return [
    setTextField(form, fields.article, buildLineArticleText(line, index, overflowCount), {
      fontSize: quoteFieldFontSizes.article,
      multiline: true
    }),
    setTextField(form, fields.quantity, buildLineQuantityText(line), { fontSize: quoteFieldFontSizes.quantity }),
    setTextField(form, fields.price, formatLineMoney(line.unitPrice, line.product.currency), {
      fontSize: quoteFieldFontSizes.lineMoney
    }),
    setTextField(form, fields.total, formatLineMoney(lineSubtotal(line), line.product.currency), {
      fontSize: quoteFieldFontSizes.lineMoney
    })
  ];
}

function downloadPdf(pdfBytes: Uint8Array, fileName: string) {
  const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfBuffer).set(pdfBytes);

  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSalesQuotePdf(quote: SalesQuote, client?: Client) {
  const response = await fetch(quoteTemplatePath);

  if (!response.ok) {
    throw new Error("No se pudo cargar la plantilla de cotizacion.");
  }

  const quoteCurrency = quote.lines[0]?.product.currency ?? "MXN";
  const totals = orderTotals(quote.lines);
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(await response.arrayBuffer());
  const formFont = pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const form = pdfDoc.getForm();
  const lineFields = quoteLineFields.flatMap((fields, index) => {
    const line = quote.lines[index];
    const overflowCount = index === quoteLineFields.length - 1 ? Math.max(quote.lines.length - quoteLineFields.length, 0) : 0;

    return line ? setQuoteLineFields(form, fields, line, index, overflowCount) : clearQuoteLineFields(form, fields);
  });
  const filledFields = [
    setTextField(form, "Cotizacion", quote.folio, { fontSize: quoteFieldFontSizes.folio }),
    setTextField(form, "Fecha", formatDateTime(quote.sentAt), { fontSize: quoteFieldFontSizes.date }),
    setTextField(form, "Datos del cliente", buildClientText(client), {
      fontSize: quoteFieldFontSizes.client,
      multiline: true
    }),
    ...lineFields,
    setTextField(form, "Subtotal", formatCurrency(totals.subtotal, quoteCurrency), {
      fontSize: quoteFieldFontSizes.summary
    }),
    setTextField(form, "iva", formatCurrency(totals.taxes, quoteCurrency), { fontSize: quoteFieldFontSizes.summary }),
    setTextField(form, "TotalOrden", formatCurrency(totals.total, quoteCurrency), {
      fontSize: quoteFieldFontSizes.finalTotal
    })
  ];

  if (!filledFields.some(Boolean)) {
    throw new Error("La plantilla no tiene campos compatibles para llenar la cotizacion.");
  }

  form.updateFieldAppearances(formFont);
  form.flatten();
  const pdfBytes = await pdfDoc.save();

  downloadPdf(pdfBytes, `Cotizacion-${quote.folio}.pdf`);
}
