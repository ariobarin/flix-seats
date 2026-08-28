# FlixBus Seat Finder

Search FlixBus trips by origin, destination, date, time, and passengers. Open any result to see the live vehicle layout and available seats.

Live at [flix.ariobarin.com](https://flix.ariobarin.com).

## Develop

1. Install Node.js 24 and the Vercel CLI.
2. Run `vercel link` once.
3. Run `npm run dev`.

## Deploy

GitHub Actions runs `npm run check` for pushes to `main` and for pull requests. Vercel creates previews for branches and deploys `main` to production automatically.

For a new Vercel project, run `vercel --prod` once. Add a custom subdomain with `vercel domains add flix.ariobarin.com flixbus-seat-finder`, then create the DNS record reported by `vercel domains inspect flix.ariobarin.com`.

The UI is entirely static. City autocomplete and trip search run directly from the browser. A single stateless Vercel Function proxies seat maps because that FlixBus endpoint does not permit cross-origin browser requests.

The app is read-only. It queries FlixBus search and seat-map endpoints but does not select seats, create a cart, or submit a booking. Availability can change at any time.

This is an unofficial experiment and is not affiliated with FlixBus. It relies on public website endpoints that may change without notice.
