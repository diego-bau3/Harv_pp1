const fetchTimeoutMs = 5500;

const assetValuationReferences = [
  {
    id: "bambu-a1-mini",
    aliases: ["a1 mini", "a1-mini", "a1mini"],
    brand: "Bambu Lab",
    model: "A1 mini",
    currency: "USD",
    replacementValue: 219,
    marketValueFactor: 0.72,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/a1-mini",
    productJsonUrl: "https://us.store.bambulab.com/products/a1-mini.js"
  },
  {
    id: "bambu-a1",
    aliases: ["bambu a1", "a1"],
    brand: "Bambu Lab",
    model: "A1",
    currency: "USD",
    replacementValue: 299,
    marketValueFactor: 0.74,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/a1",
    productJsonUrl: "https://us.store.bambulab.com/products/a1.js"
  },
  {
    id: "bambu-p1s",
    aliases: ["p1s"],
    brand: "Bambu Lab",
    model: "P1S",
    currency: "USD",
    replacementValue: 399,
    marketValueFactor: 0.76,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/p1s",
    productJsonUrl: "https://us.store.bambulab.com/products/p1s.js"
  },
  {
    id: "bambu-p2s",
    aliases: ["p2s"],
    brand: "Bambu Lab",
    model: "P2S",
    currency: "USD",
    replacementValue: 749,
    marketValueFactor: 0.8,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/p2s",
    productJsonUrl: "https://us.store.bambulab.com/products/p2s.js"
  },
  {
    id: "bambu-x1-carbon",
    aliases: ["x1 carbon", "x1-carbon", "x1c"],
    brand: "Bambu Lab",
    model: "X1 Carbon",
    currency: "USD",
    replacementValue: 1199,
    marketValueFactor: 0.68,
    sourceLabel: "Bambu Lab",
    sourceUrl: "https://bambulab.com/en-us/x1"
  },
  {
    id: "bambu-h2d",
    aliases: ["h2d"],
    brand: "Bambu Lab",
    model: "H2D",
    currency: "USD",
    replacementValue: 1749,
    marketValueFactor: 0.82,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/h2d",
    productJsonUrl: "https://us.store.bambulab.com/products/h2d.js"
  },
  {
    id: "bambu-h2s",
    aliases: ["h2s"],
    brand: "Bambu Lab",
    model: "H2S",
    currency: "USD",
    replacementValue: 1399,
    marketValueFactor: 0.82,
    sourceLabel: "Bambu Lab US Store",
    sourceUrl: "https://us.store.bambulab.com/products/h2s",
    productJsonUrl: "https://us.store.bambulab.com/products/h2s.js"
  }
];

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeLookup(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getAssetLookup(asset) {
  return normalizeLookup(
    [
      asset?.name,
      asset?.brand,
      asset?.model,
      asset?.serialNumber,
      asset?.location,
      asset?.type
    ].join(" ")
  );
}

function findAssetReference(asset) {
  const lookup = getAssetLookup(asset);

  return assetValuationReferences.find((reference) =>
    reference.aliases.some((alias) => lookup.includes(normalizeLookup(alias)))
  );
}

function toShopifyPrice(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return numericValue >= 10000 ? numericValue / 100 : numericValue;
}

function isUsablePrice(price) {
  return Number.isFinite(price) && price >= 100 && price <= 10000;
}

function choosePriceCandidate(candidates, reference, assetLookup) {
  const validCandidates = candidates.filter((candidate) => isUsablePrice(candidate.price));

  if (validCandidates.length === 0) {
    return null;
  }

  const wantsCombo = /\b(combo|ams)\b/.test(assetLookup);
  let candidatePool = validCandidates;

  if (wantsCombo) {
    const comboCandidates = validCandidates.filter((candidate) => /\b(combo|ams)\b/.test(normalizeLookup(candidate.title)));

    if (comboCandidates.length > 0) {
      candidatePool = comboCandidates;
    }
  } else {
    const machineOnlyCandidates = validCandidates.filter(
      (candidate) => !/\b(combo|ams)\b/.test(normalizeLookup(candidate.title))
    );

    if (machineOnlyCandidates.length > 0) {
      candidatePool = machineOnlyCandidates;
    }
  }

  return candidatePool.reduce((bestCandidate, candidate) => {
    const bestDistance = Math.abs(bestCandidate.price - reference.replacementValue);
    const candidateDistance = Math.abs(candidate.price - reference.replacementValue);

    return candidateDistance < bestDistance ? candidate : bestCandidate;
  });
}

async function fetchWithTimeout(url) {
  if (typeof fetch !== "function") {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": "Harv-Agent/0.1"
      },
      signal: controller.signal
    });

    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchShopifyProductPrice(reference, assetLookup) {
  if (!reference.productJsonUrl) {
    return null;
  }

  const response = await fetchWithTimeout(reference.productJsonUrl);

  if (!response) {
    return null;
  }

  try {
    const product = await response.json();
    const candidates = Array.isArray(product?.variants)
      ? product.variants.map((variant) => ({
          price: toShopifyPrice(variant?.price),
          title: cleanString(variant?.title)
        }))
      : [];
    const candidate = choosePriceCandidate(candidates, reference, assetLookup);

    return candidate ? candidate.price : null;
  } catch {
    return null;
  }
}

function extractPriceCandidatesFromHtml(html) {
  return Array.from(html.matchAll(/(?:US\$|\$)\s*([0-9][0-9,]*(?:\.\d{2})?)\s*(?:USD)?/gi))
    .map((match) => ({
      price: Number(match[1].replace(/,/g, "")),
      title: "Pagina"
    }))
    .filter((candidate) => isUsablePrice(candidate.price));
}

async function fetchHtmlProductPrice(reference, assetLookup) {
  const response = await fetchWithTimeout(reference.sourceUrl);

  if (!response) {
    return null;
  }

  try {
    const html = await response.text();
    const candidate = choosePriceCandidate(extractPriceCandidatesFromHtml(html), reference, assetLookup);

    return candidate ? candidate.price : null;
  } catch {
    return null;
  }
}

async function fetchReferencePrice(reference, assetLookup) {
  const shopifyPrice = await fetchShopifyProductPrice(reference, assetLookup);

  if (shopifyPrice) {
    return shopifyPrice;
  }

  return fetchHtmlProductPrice(reference, assetLookup);
}

function createUnavailableValuation(asset, index) {
  const assetId = cleanString(asset?.id) || `asset-${index + 1}`;

  return {
    assetId,
    marketValue: 0,
    replacementValue: 0,
    currency: "USD",
    confidence: 0,
    sourceLabel: "",
    sourceUrl: "",
    lastValuedAt: new Date().toISOString(),
    method: "unavailable",
    message: "Sin referencia de mercado para este modelo."
  };
}

async function valueAsset(asset, index) {
  const reference = findAssetReference(asset);

  if (!reference) {
    return createUnavailableValuation(asset, index);
  }

  const assetLookup = getAssetLookup(asset);
  const onlinePrice = await fetchReferencePrice(reference, assetLookup);
  const replacementValue = roundMoney(onlinePrice || reference.replacementValue);
  const method = onlinePrice ? "internet" : "reference";
  const confidence = onlinePrice ? 0.86 : 0.66;
  const message = onlinePrice
    ? "Precio consultado desde referencia online."
    : "Se uso referencia local porque la consulta online no respondio.";

  return {
    assetId: cleanString(asset?.id) || `asset-${index + 1}`,
    marketValue: roundMoney(replacementValue * reference.marketValueFactor),
    replacementValue,
    currency: reference.currency,
    confidence,
    sourceLabel: reference.sourceLabel,
    sourceUrl: reference.sourceUrl,
    lastValuedAt: new Date().toISOString(),
    method,
    message
  };
}

export async function valueAssets(assets) {
  const normalizedAssets = Array.isArray(assets) ? assets : [];

  return Promise.all(normalizedAssets.map(valueAsset));
}
