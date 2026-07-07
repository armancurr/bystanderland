Install dependencies and run the Vite dev server with Bun:

```bash
bun install
bun run dev
```

The frontend requires `VITE_CONVEX_URL`. Run Convex separately with `bunx convex dev` or provide an existing Convex deployment URL.

## Docker

Run the frontend dev server in Docker Compose:

```bash
VITE_CONVEX_URL=https://your-deployment.convex.cloud docker compose up
```

Build the production image:

```bash
docker build \
  --build-arg VITE_CONVEX_URL=https://your-deployment.convex.cloud \
  -t townbase .
```

Run the production image:

```bash
docker run --rm -p 8080:80 townbase
```

## Vercel

Vercel auto-detects `Dockerfile.vercel` at the repo root and deploys the app as a container image.

Deploy from the CLI:

```bash
vercel deploy
```

Or connect the Git repo in Vercel and push to trigger a new deployment.

The container serves the Vite `dist/` output over HTTP on `$PORT`.

## CLI

The package exposes a `townbase` binary that serves the built `dist` app:

```bash
bun run build
bunx --bun ./bin/townbase.js --port 3000
```

After publishing the package to npm, users can run:

```bash
bunx townbase --port 3000
npx townbase --port 3000
```
