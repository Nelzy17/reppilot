import { clerkMiddleware } from "@clerk/nextjs/server";

// Next 16 renamed the `middleware` file convention to `proxy`. A file named
// middleware.ts would be silently ignored.
//
// This only enables Clerk (it attaches the auth context to every matched
// request). It does NOT block anything — route protection is resource-based and
// lives in the pages themselves, e.g. src/app/dashboard/page.tsx.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets, unless they
    // appear in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
    // Always run for Clerk's own proxy routes.
    "/__clerk(.*)",
  ],
};
