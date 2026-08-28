const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join } = require("node:path");

const port = Number(process.env.PORT || 4173);
const publicDir = join(__dirname, "public");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/locations" && request.method === "GET") {
      return json(response, 200, await findLocations(url.searchParams.get("q")));
    }

    if (url.pathname === "/api/trips" && request.method === "GET") {
      return json(response, 200, await findTrips(url.searchParams));
    }

    if (url.pathname === "/api/seats" && request.method === "POST") {
      return json(response, 200, await findSeats(await readJson(request)));
    }

    if (request.method !== "GET") {
      return json(response, 405, { error: "Method not allowed" });
    }

    const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(fileName) || fileName.includes("..")) {
      return json(response, 404, { error: "Not found" });
    }

    const body = await readFile(join(publicDir, fileName));
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(fileName)] || "application/octet-stream"
    });
    response.end(body);
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 500);
    json(response, status, { error: status === 500 ? "The request could not be completed" : error.message });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`FlixBus Seat Finder: http://127.0.0.1:${port}`);
});

async function findLocations(query) {
  const q = String(query || "").trim();
  if (q.length < 2 || q.length > 80) return [];

  const url = new URL("https://global.api.flixbus.com/search/autocomplete/cities");
  url.search = new URLSearchParams({
    q,
    lang: "en_CA",
    country: "ca",
    flixbus_cities_only: "false",
    is_train_only: "false",
    stations: "true",
    popular_stations: "true",
    popular_stations_count: "null",
    disabled_countries: ""
  });

  const data = await upstream(url);
  return data.slice(0, 8).map(city => ({
    id: city.id,
    name: city.name,
    country: city.country?.toUpperCase(),
    stations: city.stations?.length || 0
  }));
}

async function findTrips(params) {
  const fromId = requireUuid(params.get("fromId"), "origin");
  const toId = requireUuid(params.get("toId"), "destination");
  const date = requireDate(params.get("date"));
  const adults = requireCount(params.get("adults"));
  const [year, month, day] = date.split("-");

  const url = new URL("https://global.api.flixbus.com/search/service/v4/search");
  url.search = new URLSearchParams({
    from_city_id: fromId,
    to_city_id: toId,
    departure_date: `${day}.${month}.${year}`,
    products: JSON.stringify({ adult: adults }),
    currency: "CAD",
    locale: "en_CA",
    search_by: "cities",
    include_after_midnight_rides: "1",
    disable_distribusion_trips: "0",
    disable_global_trips: "0",
    disable_trips: "[]"
  });

  return upstream(url);
}

async function findSeats(input) {
  const rideId = requireUuid(input.rideId, "ride");
  const fromId = requireUuid(input.fromId, "origin station");
  const toId = requireUuid(input.toId, "destination station");
  const adults = requireCount(input.adults);
  const passengers = Array.from({ length: adults }, () => ({ type: "adult", gender: "UNKNOWN" }));

  return upstream(`https://shop.flixbus.ca/ancillaries/proxy/seat-map/by-ride/${rideId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      passengersWithoutSeats: passengers,
      passengers,
      companions: [],
      query: { limit: { vehicles: 1 }, sort: { vehicleAvailableCapacity: "DESC" } },
      currency: "CAD",
      isFreeChangeLeg: false,
      legs: [{ fromId, toId, rideId }],
      fromId,
      toId
    })
  });
}

async function upstream(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const error = new Error(response.status === 404 ? "No seat map is available for this trip" : "FlixBus did not return this data");
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }

  return response.json();
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) {
      const error = new Error("Request is too large");
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("Invalid JSON");
    error.status = 400;
    throw error;
  }
}

function requireUuid(value, label) {
  if (!uuidPattern.test(String(value || ""))) {
    const error = new Error(`Choose a valid ${label}`);
    error.status = 400;
    throw error;
  }
  return value;
}

function requireDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    const error = new Error("Choose a valid date");
    error.status = 400;
    throw error;
  }
  return value;
}

function requireCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    const error = new Error("Passengers must be between 1 and 9");
    error.status = 400;
    throw error;
  }
  return count;
}

function json(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
