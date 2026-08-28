const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers:{ "Cache-Control":"no-store" } });

export async function POST(request) {
  let input;
  try { input = await request.json(); }
  catch { return reply({ error:"Invalid JSON" }, 400); }
  if (![input.rideId, input.fromId, input.toId].every(value => uuid.test(String(value))) || input.adults !== 1) return reply({ error:"Invalid seat request" }, 400);
  const passengers = [{ type:"adult", gender:"UNKNOWN" }];
  const response = await fetch(`https://shop.flixbus.ca/ancillaries/proxy/seat-map/by-ride/${input.rideId}`, {
    method:"POST",
    headers:{ Accept:"application/json", "Content-Type":"application/json" },
    body:JSON.stringify({
      passengersWithoutSeats:passengers,
      passengers,
      companions:[],
      query:{ limit:{ vehicles:1 }, sort:{ vehicleAvailableCapacity:"DESC" } },
      currency:"CAD",
      isFreeChangeLeg:false,
      legs:[{ fromId:input.fromId, toId:input.toId, rideId:input.rideId }],
      fromId:input.fromId,
      toId:input.toId
    })
  });
  if (!response.ok) return reply({ error:response.status === 404 ? "No seat map is available for this trip" : "FlixBus did not return this data" }, response.status === 404 ? 404 : 502);
  return reply(await response.json());
}
