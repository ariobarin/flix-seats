const $ = id => document.getElementById(id);
const ui = Object.fromEntries("form origin destination originOptions destinationOptions date timeFrom timeTo direct sort error empty loading results backdrop panel route tabs seatLoading seatError seatContent legend vehicle count close refresh swap".split(" ").map(id => [id, $(id)]));
const state = { origin:null, destination:null, places:{}, trips:[], shown:[], stations:{}, current:null, layouts:[], leg:0 };
const money = new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" });
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const station = id => state.stations[id]?.name || "FlixBus stop";
const time = value => new Date(value).toLocaleTimeString("en-CA", { hour:"numeric", minute:"2-digit" });
const price = trip => Number(trip.price.total_with_platform_fee ?? trip.price.total);
const duration = trip => trip.duration.hours * 60 + trip.duration.minutes;

ui.date.value = new Date().toLocaleDateString("en-CA");
ui.date.min = ui.date.value;

for (const name of ["origin", "destination"]) {
  const input = ui[name], list = ui[`${name}Options`];
  let timer;
  input.oninput = () => {
    state[name] = null;
    clearTimeout(timer);
    if (input.value.trim().length < 2) return list.hidden = true;
    timer = setTimeout(() => suggest(name), 250);
  };
  input.onblur = () => setTimeout(() => list.hidden = true, 150);
  list.onclick = event => {
    const button = event.target.closest("button[data-i]");
    if (!button) return;
    state[name] = state.places[name][button.dataset.i];
    input.value = state[name].name;
    list.hidden = true;
  };
}

async function suggest(name) {
  const query = ui[name].value.trim();
  const url = new URL("https://global.api.flixbus.com/search/autocomplete/cities");
  url.search = new URLSearchParams({ q:query, lang:"en_CA", country:"ca", flixbus_cities_only:"false", is_train_only:"false", stations:"true", popular_stations:"true", popular_stations_count:"null", disabled_countries:"" });
  try {
    const cities = (await get(url)).slice(0, 8);
    if (ui[name].value.trim() !== query) return;
    state.places[name] = cities;
    ui[`${name}Options`].innerHTML = cities.map((city, i) => `<button type="button" role="option" data-i="${i}"><span>${esc(city.name)}</span><small>${esc(city.country.toUpperCase())} · ${city.stations?.length || 0} stop${city.stations?.length === 1 ? "" : "s"}</small></button>`).join("");
    ui[`${name}Options`].hidden = !cities.length;
  } catch { ui[`${name}Options`].hidden = true; }
}

ui.swap.onclick = () => {
  [state.origin, state.destination] = [state.destination, state.origin];
  [ui.origin.value, ui.destination.value] = [ui.destination.value, ui.origin.value];
};
ui.form.onsubmit = async event => {
  event.preventDefault();
  if (!state.origin || !state.destination) return fail("Choose both cities from the suggestions.");
  if (state.origin.id === state.destination.id) return fail("Origin and destination must be different.");
  fail();
  busy(true);
  const [year, month, day] = ui.date.value.split("-");
  const url = new URL("https://global.api.flixbus.com/search/service/v4/search");
  url.search = new URLSearchParams({ from_city_id:state.origin.id, to_city_id:state.destination.id, departure_date:`${day}.${month}.${year}`, products:'{"adult":1}', currency:"CAD", locale:"en_CA", search_by:"cities", include_after_midnight_rides:"1", disable_distribusion_trips:"0", disable_global_trips:"0", disable_trips:"[]" });
  try {
    const data = await get(url);
    state.trips = (data.trips || []).flatMap(group => Object.values(group.results || {}));
    state.stations = data.stations || {};
  } catch (error) { state.trips = []; fail(error.message); }
  busy(false);
  renderTrips();
};
for (const control of [ui.timeFrom, ui.timeTo, ui.direct, ui.sort]) control.onchange = renderTrips;

function renderTrips() {
  const compare = ui.sort.value === "price" ? (a,b) => price(a)-price(b) : ui.sort.value === "duration" ? (a,b) => duration(a)-duration(b) : (a,b) => a.departure.date.localeCompare(b.departure.date);
  state.shown = state.trips.filter(trip => {
    const departure = trip.departure.date.slice(11, 16);
    return departure >= ui.timeFrom.value && departure <= ui.timeTo.value && (!ui.direct.checked || trip.transfer_type_key === "direct");
  }).sort(compare);
  ui.empty.hidden = !!state.shown.length;
  ui.empty.textContent = state.trips.length ? "No departures match these filters." : "No departures found. Try another date or route.";
  ui.results.innerHTML = state.shown.map((trip, i) => {
    const transfers = Math.max(0, trip.legs.length - 1);
    const capacity = ({ low:"Almost full", medium:"Seats available", high:"Good availability" })[trip.remaining?.capacity] || "Check seat map";
    return `<article class="trip"><div><p class="time">${esc(time(trip.departure.date))}</p><p class="place">${esc(station(trip.departure.station_id))}</p></div><div class="duration">${trip.duration.hours}:${String(trip.duration.minutes).padStart(2,"0")} hrs</div><div><p class="time">${esc(time(trip.arrival.date))}</p><p class="place">${esc(station(trip.arrival.station_id))}</p></div><div class="meta"><p class="price">${esc(money.format(price(trip)))}</p><span class="kind">${transfers ? `${transfers} transfer${transfers === 1 ? "" : "s"}` : "Bus · Direct"}</span><span class="capacity">${capacity}</span></div><button data-trip="${i}">View seats</button></article>`;
  }).join("");
}
ui.results.onclick = event => {
  const button = event.target.closest("button[data-trip]");
  if (button) openTrip(state.shown[button.dataset.trip]);
};

async function openTrip(trip) {
  state.current = trip;
  state.leg = 0;
  ui.route.textContent = `${station(trip.departure.station_id)} to ${station(trip.arrival.station_id)}`;
  ui.backdrop.hidden = ui.panel.hidden = false;
  document.body.style.overflow = "hidden";
  await loadSeats();
}
async function loadSeats() {
  ui.seatLoading.hidden = false;
  ui.seatError.hidden = ui.seatContent.hidden = true;
  state.layouts = await Promise.all(state.current.legs.map(async leg => {
    try { return { leg, data:await get("/api/seats", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ rideId:leg.ride_id, fromId:leg.departure.station_id, toId:leg.arrival.station_id, adults:1 }) }) }; }
    catch (error) { return { leg, error:error.message }; }
  }));
  ui.tabs.innerHTML = state.layouts.map((layout, i) => `<button role="tab" data-leg="${i}" aria-selected="${i === state.leg}">${state.layouts.length === 1 ? "Direct trip" : `Leg ${i + 1}: ${esc(station(layout.leg.departure.station_id))}`}</button>`).join("");
  renderDeck();
}
ui.tabs.onclick = event => {
  const button = event.target.closest("button[data-leg]");
  if (!button) return;
  state.leg = Number(button.dataset.leg);
  renderDeck();
};

function renderDeck() {
  [...ui.tabs.children].forEach((tab, i) => tab.setAttribute("aria-selected", i === state.leg));
  const layout = state.layouts[state.leg];
  const deck = layout?.data?.vehicleLayout?.result?.vehicles?.[0]?.decks?.[0];
  ui.seatLoading.hidden = true;
  if (!deck) {
    ui.seatContent.hidden = true;
    ui.seatError.hidden = false;
    ui.seatError.textContent = layout?.error || "No vehicle layout is available for this leg.";
    return;
  }
  ui.seatError.hidden = true;
  ui.seatContent.hidden = false;
  ui.legend.innerHTML = (layout.data.priceGroups || []).map(group => `<span><strong>${esc(({ panorama_seat:"Panorama", front_seat:"Front", premium_seat:"Classic" })[group.category] || "Seat")}</strong><small>+ ${esc(money.format(Number(group.addOn.value)))}</small></span>`).join("");
  const parts = deck.elements || {}, all = [...(parts.seats || []), ...(parts.others || []), ...(parts.rowLabels || [])];
  const width = Math.max(1, ...all.map(item => item.dimensions.x + item.dimensions.w)), height = Math.max(1, ...all.map(item => item.dimensions.y + item.dimensions.h));
  const pos = item => `left:${item.dimensions.x/width*100}%;top:${item.dimensions.y/height*100}%;width:${item.dimensions.w/width*100}%;height:${item.dimensions.h/height*100}%`;
  const fixture = item => `<div class="item fixture ${esc(String(item.type).replace(/[^a-z-]/g,""))}" style="${pos(item)}">${({ driver:"◉", "small-toilet":"WC", "normal-seat":"×" })[item.type] || ""}</div>`;
  const row = item => `<div class="item row" style="${pos(item)}">${esc(item.label)}</div>`;
  const seat = item => { const open = item.availability?.available; return `<div class="item" role="gridcell" style="${pos(item)}"><div class="seat ${open ? "" : "taken"} ${item.isReverse ? "reverse" : ""}" aria-label="${esc(item.label)}: ${open ? "available" : "not available"}">${open ? `<span>${esc(item.label)}</span>` : "×"}</div></div>`; };
  ui.vehicle.style.aspectRatio = `${width}/${height}`;
  ui.vehicle.innerHTML = [...(parts.others || []).map(fixture), ...(parts.rowLabels || []).map(row), ...(parts.seats || []).map(seat)].join("");
  const available = (parts.seats || []).filter(item => item.availability?.available).length;
  ui.count.textContent = `${available} seat${available === 1 ? "" : "s"} available`;
}

function closePanel() { ui.backdrop.hidden = ui.panel.hidden = true; document.body.style.overflow = ""; }
function busy(value) { ui.loading.hidden = !value; ui.empty.hidden = value; ui.form.querySelector("button[type=submit]").disabled = value; }
function fail(message) { ui.error.hidden = !message; ui.error.textContent = message || ""; }
async function get(url, options) { const response = await fetch(url, options), data = await response.json(); if (!response.ok) throw new Error(data.error || "FlixBus did not return this data."); return data; }
ui.close.onclick = ui.backdrop.onclick = closePanel;
ui.refresh.onclick = loadSeats;
document.onkeydown = event => { if (event.key === "Escape") closePanel(); };
