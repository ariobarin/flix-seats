const state = {
  origin: null,
  destination: null,
  trips: [],
  stations: {},
  currentTrip: null,
  seatLayouts: [],
  activeLeg: 0
};

const elements = {
  form: document.querySelector("#search-form"),
  origin: document.querySelector("#origin"),
  destination: document.querySelector("#destination"),
  originOptions: document.querySelector("#origin-options"),
  destinationOptions: document.querySelector("#destination-options"),
  date: document.querySelector("#date"),
  timeFrom: document.querySelector("#time-from"),
  timeTo: document.querySelector("#time-to"),
  directOnly: document.querySelector("#direct-only"),
  sort: document.querySelector("#sort"),
  formError: document.querySelector("#form-error"),
  empty: document.querySelector("#empty-state"),
  loading: document.querySelector("#loading"),
  results: document.querySelector("#results"),
  backdrop: document.querySelector("#backdrop"),
  panel: document.querySelector("#seat-panel"),
  seatRoute: document.querySelector("#seat-route"),
  legTabs: document.querySelector("#leg-tabs"),
  seatLoading: document.querySelector("#seat-loading"),
  seatError: document.querySelector("#seat-error"),
  seatContent: document.querySelector("#seat-content"),
  legend: document.querySelector("#seat-legend"),
  vehicle: document.querySelector("#vehicle"),
  availableCount: document.querySelector("#available-count")
};

elements.date.value = localDate(new Date());
elements.date.min = elements.date.value;

setupAutocomplete("origin");
setupAutocomplete("destination");

elements.form.addEventListener("submit", searchTrips);
document.querySelector("#swap").addEventListener("click", swapLocations);
document.querySelector("#close-panel").addEventListener("click", closeSeatPanel);
document.querySelector("#refresh-seats").addEventListener("click", loadSeats);
elements.backdrop.addEventListener("click", closeSeatPanel);
document.addEventListener("keydown", event => event.key === "Escape" && closeSeatPanel());

for (const control of [elements.timeFrom, elements.timeTo, elements.directOnly, elements.sort]) {
  control.addEventListener("change", renderTrips);
}

function setupAutocomplete(name) {
  const input = elements[name];
  const options = elements[`${name}Options`];
  let timer;

  input.addEventListener("input", () => {
    state[name] = null;
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) return hideOptions(options);
    timer = setTimeout(() => loadLocations(name, query), 250);
  });

  input.addEventListener("blur", () => setTimeout(() => hideOptions(options), 150));
}

async function loadLocations(name, query) {
  const options = elements[`${name}Options`];
  try {
    const url = new URL("https://global.api.flixbus.com/search/autocomplete/cities");
    url.search = new URLSearchParams({
      q: query,
      lang: "en_CA",
      country: "ca",
      flixbus_cities_only: "false",
      is_train_only: "false",
      stations: "true",
      popular_stations: "true",
      popular_stations_count: "null",
      disabled_countries: ""
    });
    const cities = (await getJson(url)).slice(0, 8).map(city => ({
      id: city.id,
      name: city.name,
      country: city.country?.toUpperCase(),
      stations: city.stations?.length || 0
    }));
    if (elements[name].value.trim() !== query) return;
    options.replaceChildren(...cities.map(city => cityOption(name, city)));
    options.hidden = cities.length === 0;
  } catch {
    hideOptions(options);
  }
}

function cityOption(name, city) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "option");

  const label = document.createElement("span");
  label.textContent = city.name;
  const detail = document.createElement("small");
  detail.textContent = `${city.country || ""} · ${city.stations} stop${city.stations === 1 ? "" : "s"}`;
  button.append(label, detail);

  button.addEventListener("mousedown", event => {
    event.preventDefault();
    state[name] = city;
    elements[name].value = city.name;
    hideOptions(elements[`${name}Options`]);
  });
  return button;
}

function swapLocations() {
  [state.origin, state.destination] = [state.destination, state.origin];
  [elements.origin.value, elements.destination.value] = [elements.destination.value, elements.origin.value];
}

async function searchTrips(event) {
  event.preventDefault();
  hideError();

  if (!state.origin || !state.destination) {
    return showError("Choose an origin and destination from the suggestions.");
  }

  if (state.origin.id === state.destination.id) {
    return showError("Origin and destination must be different.");
  }

  setSearching(true);

  try {
    const [year, month, day] = elements.date.value.split("-");
    const url = new URL("https://global.api.flixbus.com/search/service/v4/search");
    url.search = new URLSearchParams({
      from_city_id: state.origin.id,
      to_city_id: state.destination.id,
      departure_date: `${day}.${month}.${year}`,
      products: JSON.stringify({ adult: 1 }),
      currency: "CAD",
      locale: "en_CA",
      search_by: "cities",
      include_after_midnight_rides: "1",
      disable_distribusion_trips: "0",
      disable_global_trips: "0",
      disable_trips: "[]"
    });
    const data = await getJson(url);
    state.trips = (data.trips || []).flatMap(group => Object.values(group.results || {}));
    state.stations = data.stations || {};
    renderTrips();
  } catch (error) {
    state.trips = [];
    showError(error.message);
    renderTrips();
  } finally {
    setSearching(false);
  }
}

function renderTrips() {
  const from = elements.timeFrom.value || "00:00";
  const to = elements.timeTo.value || "23:59";
  const directOnly = elements.directOnly.checked;

  const trips = state.trips
    .filter(trip => {
      const time = trip.departure.date.slice(11, 16);
      return time >= from && time <= to && (!directOnly || trip.transfer_type_key === "direct");
    })
    .sort(sortTrips(elements.sort.value));

  elements.results.replaceChildren(...trips.map(tripCard));
  elements.empty.hidden = state.trips.length > 0 || !elements.loading.hidden;

  if (!state.trips.length && elements.loading.hidden) {
    elements.empty.querySelector("p").textContent = "No departures found. Try another date or route.";
  }
}

function sortTrips(mode) {
  if (mode === "price") return (a, b) => tripPrice(a) - tripPrice(b);
  if (mode === "duration") return (a, b) => durationMinutes(a) - durationMinutes(b);
  return (a, b) => a.departure.date.localeCompare(b.departure.date);
}

function tripCard(trip) {
  const card = document.createElement("article");
  card.className = "trip-card";
  const departureStation = stationName(trip.departure.station_id);
  const arrivalStation = stationName(trip.arrival.station_id);
  const transfers = Math.max(0, trip.legs.length - 1);
  const capacity = capacityLabel(trip.remaining?.capacity);

  const departure = tripPoint(formatTime(trip.departure.date), departureStation);
  const duration = document.createElement("div");
  duration.className = "trip-duration";
  duration.textContent = `${trip.duration.hours}:${String(trip.duration.minutes).padStart(2, "0")} hrs`;
  const arrival = tripPoint(formatTime(trip.arrival.date), arrivalStation);

  const meta = document.createElement("div");
  meta.className = "trip-meta";
  const price = document.createElement("p");
  price.className = "trip-price";
  price.textContent = money(tripPrice(trip));
  const kind = document.createElement("span");
  kind.className = "trip-kind";
  kind.textContent = transfers ? `${transfers} transfer${transfers === 1 ? "" : "s"}` : "Bus · Direct";
  const fullness = document.createElement("span");
  fullness.className = "trip-capacity";
  fullness.textContent = capacity;
  meta.append(price, kind, fullness);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "seats-button";
  button.textContent = "View seats";
  button.addEventListener("click", () => openSeatPanel(trip));

  card.append(departure, duration, arrival, meta, button);
  return card;
}

function tripPoint(time, place) {
  const container = document.createElement("div");
  const timeLabel = document.createElement("p");
  timeLabel.className = "trip-time";
  timeLabel.textContent = time;
  const placeLabel = document.createElement("p");
  placeLabel.className = "trip-place";
  placeLabel.textContent = place;
  container.append(timeLabel, placeLabel);
  return container;
}

async function openSeatPanel(trip) {
  state.currentTrip = trip;
  state.activeLeg = 0;
  elements.seatRoute.textContent = `${stationName(trip.departure.station_id)} to ${stationName(trip.arrival.station_id)}`;
  elements.backdrop.hidden = false;
  elements.panel.hidden = false;
  document.body.style.overflow = "hidden";
  await loadSeats();
}

async function loadSeats() {
  if (!state.currentTrip) return;
  showSeatLoading();

  state.seatLayouts = await Promise.all(state.currentTrip.legs.map(async leg => {
    try {
      const data = await getJson("/api/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId: leg.ride_id,
          fromId: leg.departure.station_id,
          toId: leg.arrival.station_id,
          adults: 1
        })
      });
      return { leg, data };
    } catch (error) {
      return { leg, error: error.message };
    }
  }));

  renderLegTabs();
  renderActiveLeg();
}

function renderLegTabs() {
  elements.legTabs.replaceChildren(...state.seatLayouts.map((layout, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === state.activeLeg));
    button.textContent = state.seatLayouts.length === 1 ? "Direct trip" : `Leg ${index + 1}: ${stationName(layout.leg.departure.station_id)}`;
    button.addEventListener("click", () => {
      state.activeLeg = index;
      renderLegTabs();
      renderActiveLeg();
    });
    return button;
  }));
}

function renderActiveLeg() {
  const layout = state.seatLayouts[state.activeLeg];
  elements.seatLoading.hidden = true;

  if (!layout || layout.error) {
    elements.seatContent.hidden = true;
    elements.seatError.hidden = false;
    elements.seatError.textContent = layout?.error || "No seat map is available for this leg.";
    return;
  }

  const deck = layout.data.vehicleLayout?.result?.vehicles?.[0]?.decks?.[0];
  if (!deck) {
    elements.seatContent.hidden = true;
    elements.seatError.hidden = false;
    elements.seatError.textContent = "FlixBus did not provide a vehicle layout for this leg.";
    return;
  }

  elements.seatError.hidden = true;
  elements.seatContent.hidden = false;
  renderLegend(layout.data.priceGroups || []);
  renderVehicle(deck);
}

function renderLegend(priceGroups) {
  elements.legend.replaceChildren(...priceGroups.map(group => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const icon = document.createElement("span");
    icon.className = "legend-seat";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = categoryName(group.category);
    const price = document.createElement("span");
    price.textContent = `+ ${money(Number(group.addOn.value))}`;
    copy.append(name, price);
    item.append(icon, copy);
    return item;
  }));
}

function renderVehicle(deck) {
  const elementsByType = deck.elements || {};
  const all = [...(elementsByType.seats || []), ...(elementsByType.others || []), ...(elementsByType.rowLabels || [])];
  const width = Math.max(...all.map(item => item.dimensions.x + item.dimensions.w));
  const height = Math.max(...all.map(item => item.dimensions.y + item.dimensions.h));
  const available = (elementsByType.seats || []).filter(seat => seat.availability?.available).length;

  elements.vehicle.style.aspectRatio = `${width} / ${height}`;
  elements.vehicle.replaceChildren(
    ...(elementsByType.others || []).map(item => vehicleFixture(item, width, height)),
    ...(elementsByType.rowLabels || []).map(item => rowLabel(item, width, height)),
    ...(elementsByType.seats || []).map(item => seatElement(item, width, height))
  );
  elements.availableCount.textContent = `${available} seat${available === 1 ? "" : "s"} available`;
}

function vehicleFixture(item, width, height) {
  const element = positioned(item, width, height);
  element.classList.add("fixture", item.type);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function rowLabel(item, width, height) {
  const element = positioned(item, width, height);
  element.classList.add("row-label");
  element.textContent = item.label;
  return element;
}

function seatElement(seat, width, height) {
  const cell = positioned(seat, width, height);
  cell.setAttribute("role", "gridcell");
  const shape = document.createElement("div");
  const available = Boolean(seat.availability?.available);
  shape.className = `seat-shape ${available ? "available" : "unavailable"} ${categoryClass(seat.category)} ${seat.isReverse ? "reverse" : ""}`;
  shape.setAttribute("aria-label", `${seat.label}: ${available ? "available" : "not available"}`);

  if (available) {
    const label = document.createElement("span");
    label.textContent = seat.label;
    shape.append(label);
  } else {
    shape.textContent = "×";
  }

  cell.append(shape);
  return cell;
}

function positioned(item, width, height) {
  const element = document.createElement("div");
  element.className = "vehicle-item";
  element.style.left = `${item.dimensions.x / width * 100}%`;
  element.style.top = `${item.dimensions.y / height * 100}%`;
  element.style.width = `${item.dimensions.w / width * 100}%`;
  element.style.height = `${item.dimensions.h / height * 100}%`;
  return element;
}

function closeSeatPanel() {
  elements.backdrop.hidden = true;
  elements.panel.hidden = true;
  document.body.style.overflow = "";
  state.currentTrip = null;
}

function showSeatLoading() {
  elements.seatLoading.hidden = false;
  elements.seatContent.hidden = true;
  elements.seatError.hidden = true;
}

function setSearching(searching) {
  elements.loading.hidden = !searching;
  elements.empty.hidden = searching || state.trips.length > 0;
  elements.form.querySelector("button[type=submit]").disabled = searching;
}

function stationName(id) {
  return state.stations[id]?.name || "FlixBus stop";
}

function tripPrice(trip) {
  return Number(trip.price.total_with_platform_fee ?? trip.price.total);
}

function durationMinutes(trip) {
  return trip.duration.hours * 60 + trip.duration.minutes;
}

function capacityLabel(capacity) {
  if (capacity === "low") return "Almost full";
  if (capacity === "medium") return "Seats available";
  if (capacity === "high") return "Good availability";
  return "Check seat map";
}

function categoryName(category) {
  return { panorama_seat: "Panorama", front_seat: "Front", premium_seat: "Classic" }[category] || "Seat";
}

function categoryClass(category) {
  return { panorama_seat: "panorama", front_seat: "front", premium_seat: "classic" }[category] || "classic";
}

function formatTime(value) {
  const [hours, minutes] = value.slice(11, 16).split(":").map(Number);
  const period = hours >= 12 ? "p.m." : "a.m.";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function money(value) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function localDate(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date - offset).toISOString().slice(0, 10);
}

function hideOptions(options) {
  options.hidden = true;
  options.replaceChildren();
}

function showError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

function hideError() {
  elements.formError.hidden = true;
  elements.formError.textContent = "";
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request failed");
  return data;
}
