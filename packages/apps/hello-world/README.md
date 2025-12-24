# @mrsimpson/homelab-app-hello-world

Demo application showing how to deploy containerized apps via the homelab infrastructure.

## What Goes Here

Template for deploying web applications:
- Stateless web service (nginx)
- Exposed via Kubernetes Ingress + TLS
- Simple, clean pattern for other apps to follow

## Usage

```typescript
import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";

const { app, url } = createHelloWorld(homelab);

export const helloWorldUrl = url;
```

## Customization

Modify `src/index.ts` to:
- Change Docker image
- Adjust resource requests/limits
- Add storage
- Enable OAuth protection
- Modify domain

## Creating New Apps

Copy this pattern to create new applications:

```bash
mkdir -p packages/apps/my-app/src
# Copy files from hello-world and customize
# Update package.json with new name
npm install
```

Each app should:
1. Export a `create*App()` function
2. Accept `HomelabContext` as parameter
3. Use `homelab.createExposedWebApp()`
4. Return app details and URL

## Publishing

Apps can be:
- Deployed directly from this monorepo (current pattern)
- Published as separate npm packages
- Moved to separate git repositories
