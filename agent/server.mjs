import http from "node:http";
import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import { valueAssets } from "./assetValuation.mjs";
import { linkPrinter, listLinkedPrinters, startLinkedPrinterConnections } from "./printerRegistry.mjs";

const host = process.env.HARV_AGENT_HOST ?? "127.0.0.1";
const port = Number(process.env.HARV_AGENT_PORT ?? 8787);
const bambuTcpPorts = [8883, 990, 50000, 50001];
const discoveryPorts = [1900, 1990, 2021];

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);

    if (Buffer.concat(chunks).length > 1024 * 1024) {
      const error = new Error("Request body too large.");
      error.status = 413;
      throw error;
    }
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function isPrivateIPv4(address) {
  return (
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function getLocalNetworks() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === "IPv4" && !address.internal && isPrivateIPv4(address.address))
        .map((address) => ({
          name,
          address: address.address,
          base: address.address.split(".").slice(0, 3).join(".")
        }))
    )
    .filter((network, index, networks) => networks.findIndex((current) => current.base === network.base) === index);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(false), ms);
    })
  ]);
}

function testTcpPort(hostname, targetPort, timeoutMs = 260) {
  return withTimeout(
    new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(targetPort, hostname);
    }),
    timeoutMs + 40
  );
}

async function mapWithLimit(items, limit, worker) {
  const results = [];
  let nextIndex = 0;

  async function runNext() {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function scanTcpCandidates(networks) {
  const addresses = networks.flatMap((network) =>
    Array.from({ length: 254 }, (_, index) => `${network.base}.${index + 1}`).filter(
      (ipAddress) => ipAddress !== network.address
    )
  );

  const results = await mapWithLimit(addresses, 64, async (ipAddress) => {
    const openPorts = [];

    for (const targetPort of bambuTcpPorts) {
      if (await testTcpPort(ipAddress, targetPort)) {
        openPorts.push(targetPort);
      }
    }

    if (openPorts.length === 0) {
      return null;
    }

    return {
      id: `bambu-${ipAddress.replace(/\./g, "-")}`,
      name: openPorts.includes(8883) ? `Bambu ${ipAddress}` : `Dispositivo LAN ${ipAddress}`,
      brand: "Bambu Lab",
      model: "",
      ipAddress,
      serial: "",
      source: "tcp-scan",
      signal: openPorts.includes(8883) ? "MQTT LAN visible" : "Puerto LAN compatible",
      openPorts,
      lastSeenAt: new Date().toISOString()
    };
  });

  return results.filter(Boolean);
}

function parseDiscoveryMessage(text, remoteAddress) {
  const modelMatch = text.match(/DevModel\.bambu\.com:([^\s\r\n]+)/i);
  const nameMatch = text.match(/DevName\.bambu\.com:([^\r\n]+)/i);
  const serialMatch = text.match(/DevId\.bambu\.com:([^\s\r\n]+)/i);

  return {
    id: serialMatch?.[1]?.trim() || `bambu-${remoteAddress.replace(/\./g, "-")}`,
    name: nameMatch?.[1]?.trim() || `Bambu ${remoteAddress}`,
    brand: "Bambu Lab",
    model: modelMatch?.[1]?.trim() || "",
    ipAddress: remoteAddress,
    serial: serialMatch?.[1]?.trim() || "",
    source: "udp-discovery",
    signal: "Anuncio discovery",
    openPorts: [],
    lastSeenAt: new Date().toISOString()
  };
}

async function discoverUdp(timeoutMs = 4500) {
  const discovered = [];

  await Promise.all(
    discoveryPorts.map(
      (queryPort) =>
        new Promise((resolve) => {
          const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
          const timer = setTimeout(() => {
            socket.close();
            resolve();
          }, timeoutMs);

          socket.on("message", (message, remote) => {
            const text = message.toString("utf8");

            if (/bambu|DevModel|DevName|DevId/i.test(text)) {
              discovered.push(parseDiscoveryMessage(text, remote.address));
            }
          });

          socket.on("error", () => {
            clearTimeout(timer);
            socket.close();
            resolve();
          });

          socket.bind(() => {
            try {
              socket.setBroadcast(true);
              socket.setMulticastTTL(2);

              const query = [
                "M-SEARCH * HTTP/1.1",
                `HOST: 239.255.255.250:${queryPort}`,
                'MAN: "ssdp:discover"',
                "MX: 1",
                "ST: ssdp:all",
                "",
                ""
              ].join("\r\n");
              const payload = Buffer.from(query);

              socket.send(payload, queryPort, "239.255.255.250");
            } catch {
              return;
            }
          });
        })
    )
  );

  return discovered;
}

async function listenForUdpAnnouncements(timeoutMs = 4500) {
  const discovered = [];
  const listenPorts = discoveryPorts.filter((currentPort) => currentPort !== 1900);

  await Promise.all(
    listenPorts.map(
      (listenPort) =>
        new Promise((resolve) => {
          const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
          let settled = false;
          const finish = () => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timer);

            try {
              socket.close(() => resolve());
            } catch {
              resolve();
            }
          };
          const timer = setTimeout(finish, timeoutMs);

          socket.on("message", (message, remote) => {
            const text = message.toString("utf8");

            if (/bambu|DevModel|DevName|DevId/i.test(text)) {
              discovered.push({
                ...parseDiscoveryMessage(text, remote.address),
                source: `udp-listen:${listenPort}`
              });
            }
          });

          socket.on("error", finish);

          socket.bind(listenPort, () => {
            try {
              socket.setBroadcast(true);
            } catch {
              finish();
            }
          });
        })
    )
  );

  return discovered;
}

function dedupePrinters(printers) {
  const byAddress = new Map();

  for (const printer of printers) {
    const current = byAddress.get(printer.ipAddress);

    if (!current) {
      byAddress.set(printer.ipAddress, printer);
      continue;
    }

    byAddress.set(printer.ipAddress, {
      ...current,
      ...printer,
      openPorts: Array.from(new Set([...(current.openPorts ?? []), ...(printer.openPorts ?? [])])).sort(
        (first, second) => first - second
      ),
      source: Array.from(new Set([current.source, printer.source])).join("+")
    });
  }

  return Array.from(byAddress.values()).sort((first, second) => first.ipAddress.localeCompare(second.ipAddress));
}

async function discoverBambuPrinters() {
  const networks = getLocalNetworks();
  const [udpPrinters, udpAnnouncementPrinters, tcpPrinters] = await Promise.all([
    discoverUdp(),
    listenForUdpAnnouncements(),
    scanTcpCandidates(networks)
  ]);
  const printers = dedupePrinters([...udpPrinters, ...udpAnnouncementPrinters, ...tcpPrinters]);

  return {
    diagnostics: {
      interfaces: networks,
      scannedPorts: bambuTcpPorts,
      discoveryPorts
    },
    message:
      printers.length > 0
        ? `${printers.length} impresora(s) o candidata(s) detectada(s).`
        : "No se detectaron impresoras Bambu visibles por LAN.",
    printers
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      name: "harv-agent",
      time: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/printers") {
    try {
      const printers = await listLinkedPrinters();

      sendJson(response, 200, {
        message:
          printers.length > 0
            ? `${printers.length} impresora(s) vinculada(s).`
            : "No hay impresoras vinculadas en Harv Agent.",
        printers
      });
    } catch (error) {
      sendJson(response, error.status ?? 500, {
        message: error instanceof Error ? error.message : "No se pudieron cargar las impresoras."
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/printers/link") {
    try {
      const printer = await linkPrinter(await readJsonBody(request));

      sendJson(response, 200, {
        message: "Impresora vinculada en Harv Agent.",
        printer
      });
    } catch (error) {
      sendJson(response, error.status ?? 500, {
        message: error instanceof Error ? error.message : "No se pudo vincular la impresora."
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/discovery/bambu") {
    try {
      sendJson(response, 200, await discoverBambuPrinters());
    } catch (error) {
      sendJson(response, 500, {
        message: "Discovery failed.",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/finance/asset-valuations") {
    try {
      const body = await readJsonBody(request);
      const valuations = await valueAssets(body.assets);

      sendJson(response, 200, {
        message:
          valuations.length > 0
            ? `${valuations.length} activo(s) financiero(s) actualizado(s).`
            : "No se recibieron activos para valuar.",
        valuations
      });
    } catch (error) {
      sendJson(response, error.status ?? 500, {
        message: error instanceof Error ? error.message : "No se pudieron valuar los activos."
      });
    }
    return;
  }

  sendJson(response, 404, {
    message: "Not found."
  });
});

startLinkedPrinterConnections().catch((error) => {
  console.error(error);
});

server.listen(port, host, () => {
  console.log(`Harv Agent listening on http://${host}:${port}`);
});
