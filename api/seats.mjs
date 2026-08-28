const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const error = validate(input);
  if (error) return Response.json({ error }, { status: 400 });

  const passengers = Array.from({ length: input.adults }, () => ({ type: "adult", gender: "UNKNOWN" }));
  const response = await fetch(`https://shop.flixbus.ca/ancillaries/proxy/seat-map/by-ride/${input.rideId}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      passengersWithoutSeats: passengers,
      passengers,
      companions: [],
      query: { limit: { vehicles: 1 }, sort: { vehicleAvailableCapacity: "DESC" } },
      currency: "CAD",
      isFreeChangeLeg: false,
      legs: [{ fromId: input.fromId, toId: input.toId, rideId: input.rideId }],
      fromId: input.fromId,
      toId: input.toId
    })
  });

  if (!response.ok) {
    const message = response.status === 404 ? "No seat map is available for this trip" : "FlixBus did not return this data";
    return Response.json({ error: message }, { status: response.status === 404 ? 404 : 502 });
  }

  return Response.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
}

function validate(input) {
  if (!uuidPattern.test(String(input.rideId || ""))) return "Choose a valid ride";
  if (!uuidPattern.test(String(input.fromId || ""))) return "Choose a valid origin station";
  if (!uuidPattern.test(String(input.toId || ""))) return "Choose a valid destination station";
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 9) return "Passengers must be between 1 and 9";
  return "";
}
