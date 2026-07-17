import { redirect } from 'next/navigation'

// The root URL is not a real page in this app — it exists only to route
// people into it. It previously rendered the untouched create-next-app
// scaffold (never replaced after the initial commit), which is what
// showed at sinatif-carousel.vercel.app: the real app has always lived at
// /login, /dashboard and /carousel/*, and middleware.ts (matcher:
// /dashboard, /login, /carousel) never covered '/', so the root just
// served boilerplate.
//
// Redirecting to /dashboard hands off to that same middleware: a
// logged-out visitor is bounced /dashboard -> /login, a logged-in one
// lands on their dashboard. So the bare domain now always resolves to the
// app instead of the scaffold.
export default function RootPage() {
  redirect('/dashboard')
}
