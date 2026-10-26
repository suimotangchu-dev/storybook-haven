# Little Lantern Storybook Library

A family-friendly storybook library for children, teens, and parents, with a searchable catalog, an in-site reader, and a private book-upload dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/storybook-library/` — responsive library, book details, reader, and administrator dashboard
- `artifacts/api-server/src/routes/books.ts` — public catalog, reader assets, and administrator book actions
- `artifacts/api-server/src/lib/bookArchive.ts` — ZIP validation and private asset storage
- `artifacts/api-server/src/routes/auth.ts` and `middlewares/requireAdmin.ts` — sign-in and administrator access checks
- `lib/db/src/schema/storybook-books.ts` — storybook metadata and package manifest
- `lib/api-spec/openapi.yaml` — source of truth for generated client and validation schemas

## Architecture decisions

- The public catalog and readers do not require sign-in; all administration and upload actions are restricted server-side to the configured admin email.
- ZIP uploads are expanded into private object storage. Only published books can serve reader assets, through same-site routes and a sandboxed iframe.
- Sample stories and uploaded HTML5 stories share one book record model, leaving room for a future visual editor without changing the public catalog.
- ZIP imports require a top-level `index.html` and enforce archive, extracted-size, file-count, and path-safety limits.

## Product

- Browse sample storybooks by category, age range, and search.
- Read sample stories with page controls or open uploaded HTML5 books in a full-screen reader.
- Sign in to a private dashboard to import ZIP books, publish or unpublish them, and remove books.

## User preferences

- Keep the experience warm, imaginative, uncluttered, responsive, and easy for children to navigate. Avoid distracting animation.

## Gotchas

- Set `ADMIN_EMAIL` to the verified sign-in email that should administer the library.
- Push development schema changes with `pnpm --filter @workspace/db run push`.
- Uploaded ZIPs must include `index.html` at the archive root; ZIPs are limited to 50 MB and unpacked packages to 120 MB.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
