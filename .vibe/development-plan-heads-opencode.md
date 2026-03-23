# Development Plan: homelab (heads/opencode branch)

*Generated on 2026-03-21 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
Deploy a containerized version of opencode as a GitHub OAuth-protected app in the homelab k3s cluster, following the existing patterns (`ExposedWebApp`, `AuthType.OAUTH2_PROXY`) used by other apps in this repo.

## Explore
<!-- beads-phase-id: homelab-2.1 -->
### Findings

**opencode Container:**
- Official Docker image: `ghcr.io/anomalyco/opencode` (public, no pull secret needed)
- Command to start web mode: `opencode web --hostname 0.0.0.0 --port 4096`
- Default port: `4096`
- Must bind to `0.0.0.0` for container access
- Config via env vars: `OPENCODE_SERVER_PASSWORD` (basic auth), `OPENCODE_SERVER_USERNAME`
- AI provider API keys passed via env vars (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

**llama.cpp provider:**
- opencode has **native llama.cpp support** via `opencode.json` config
- Provider config: `"npm": "@ai-sdk/openai-compatible"`, `"options": { "baseURL": "http://<host>:8080/v1" }`
- This is configured in opencode's `opencode.json`, not via env vars
- The `opencode.json` must be baked into the container image OR mounted via ConfigMap

**GitHub OAuth Protection:**
- Existing `AuthType.OAUTH2_PROXY` provides GitHub OAuth via the existing oauth2-proxy infrastructure
- This is the correct approach - no need for opencode's built-in basic auth in production

**Multi-provider credentials design:**
- opencode reads provider API keys from env vars (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- The `ExposedWebApp` already accepts `env: Array<{ name: string; value: string | pulumi.Output<string> }>`
- Pulumi secrets can be passed as `pulumi.Output<string>` values directly in the env array
- Pattern: `pulumi config set opencode:anthropicApiKey <value> --secret` then read as `config.getSecret("anthropicApiKey")`
- This is the cleanest approach: no ExternalSecrets needed for provider keys, use Pulumi secrets directly
- The opencode app package will accept an optional `providerCredentials` array

**App Package Pattern:**
- Create `packages/apps/opencode/` with `package.json`, `tsconfig.json`, `src/index.ts`
- `package.json` name: `@mrsimpson/homelab-app-opencode`
- `src/index.ts` exports `createOpencode()` function
- Uses `homelab.createExposedWebApp("opencode", { ... auth: AuthType.OAUTH2_PROXY })`
- Domain: `opencode.${homelabConfig.domain}` → `opencode.no-panic.org`
- Register in `src/index.ts` root

**ExposedWebApp extension needed:**
- Add optional `command?: string[]` and `args?: string[]` to `ExposedWebAppArgs`
- These map directly to Kubernetes container `command` (entrypoint) and `args`
- opencode web needs: `args: ["web", "--hostname", "0.0.0.0", "--port", "4096"]`

**opencode.json ConfigMap:**
- For llama.cpp provider config, mount a ConfigMap as `/root/.config/opencode/opencode.json` (or wherever opencode reads config)
- The app package will create the ConfigMap with provider config and mount it
- This avoids baking config into the image

**Security context:**
- opencode image user unknown - start with `runAsUser: 1000` (standard non-root)
- If it fails, user can adjust; we'll note this in docs/comments

## Plan
<!-- beads-phase-id: homelab-2.2 -->
### Phase Entrance Criteria:
- [x] opencode container image identified: `ghcr.io/anomalyco/opencode`, port `4096`
- [x] Special configuration requirements of opencode understood
- [x] Existing app package structure understood
- [x] Domain naming convention understood: `opencode.no-panic.org`
- [x] Multi-provider credentials approach decided: Pulumi secrets → env vars
- [x] llama.cpp config approach decided: ConfigMap mounted as opencode.json

### Implementation Plan

#### 1. Extend `ExposedWebApp` (`packages/core/components/src/ExposedWebApp.ts`)
Add to `ExposedWebAppArgs`:
```typescript
/** Override container entrypoint */
command?: string[];
/** Container arguments */
args?: string[];
/** Environment variables from Kubernetes Secrets (envFrom or secretRef) */
envFromSecrets?: Array<{ name: string }>;
```
Apply in `appContainer` construction.

#### 2. Create `packages/apps/opencode/`
Structure:
```
packages/apps/opencode/
├── package.json        (@mrsimpson/homelab-app-opencode)
├── tsconfig.json
└── src/
    └── index.ts        (createOpencode function)
```

The `createOpencode()` function:
```typescript
export interface OpenCodeConfig {
  /** LLM provider credentials as env vars, e.g. { name: "ANTHROPIC_API_KEY", value: config.requireSecret(...) } */
  providerEnv?: Array<{ name: string; value: string | pulumi.Output<string> }>;
  /** llama.cpp server URL, e.g. "http://flinker.local:8080/v1" */
  llamaCppBaseUrl?: string;
  /** llama.cpp model name(s) to configure */
  llamaCppModels?: Array<{ id: string; name: string; contextLimit?: number }>;
}
```

Key aspects:
- Image: `ghcr.io/anomalyco/opencode`
- Domain: `opencode.${homelabConfig.domain}`
- Port: `4096`
- Args: `["web", "--hostname", "0.0.0.0", "--port", "4096"]`
- Auth: `AuthType.OAUTH2_PROXY` with `oauth2Proxy: { group: "users" }`
- Storage: 5Gi PVC mounted at `/root` (opencode stores sessions/config there)
- Security context: `runAsUser: 1000` (may need adjustment)
- Env: merge `providerEnv` with fixed env vars
- ConfigMap: create with `opencode.json` content if `llamaCppBaseUrl` provided, mount at config path
- Resources: `requests: { cpu: "100m", memory: "256Mi" }`, `limits: { cpu: "500m", memory: "512Mi" }`

#### 3. Register in `src/index.ts`
```typescript
import { createOpencode } from "@mrsimpson/homelab-app-opencode";
const opencodeApp = createOpencode(homelab, {
  llamaCppBaseUrl: "http://flinker:8080/v1",
  llamaCppModels: [{ id: "local-model", name: "Local Model (llama.cpp)" }],
  // providerEnv: [{ name: "ANTHROPIC_API_KEY", value: config.requireSecret("anthropicApiKey") }]
});
export const opencodeUrl = opencodeApp.url;
```

#### 4. Add workspace dependency to root `package.json`

### Tasks
*Tasks managed via `bd` CLI*

## Code
<!-- beads-phase-id: homelab-2.3 -->
### Phase Entrance Criteria:
- [x] Plan reviewed and approved
- [x] All required secrets/config keys identified
- [x] Implementation approach agreed upon

### Tasks
*Tasks managed via `bd` CLI*

## Commit
<!-- beads-phase-id: homelab-2.4 -->
### Phase Entrance Criteria:
- [ ] opencode app package created following the hello-world pattern
- [ ] ExposedWebApp extended with command/args support
- [ ] App registered in src/index.ts
- [ ] TypeScript type-check passes
- [ ] Linting passes

### Tasks
- [ ] Squash WIP commits: `git reset --soft <first commit of this branch>`. Then, create a conventional commit. In the message, first summarize the intentions and key decisions from the development plan. Then, add a brief summary of the key changes and their side effects and dependencies.

*Tasks managed via `bd` CLI*

## Key Decisions
1. **Auth**: Use `AuthType.OAUTH2_PROXY` (GitHub OAuth via existing infrastructure)
2. **Domain**: `opencode.no-panic.org` following `<appname>.${domain}` convention
3. **Port**: `4096` (opencode web default)
4. **Image**: `ghcr.io/anomalyco/opencode` (public GHCR, no pull secret needed)
5. **Container startup**: Add `command`/`args` to `ExposedWebApp`, use `args: ["web", "--hostname", "0.0.0.0", "--port", "4096"]`
6. **Multi-provider credentials**: Pass as `env` array with `pulumi.Output<string>` secret values — no ExternalSecrets overhead needed
7. **llama.cpp config**: Mount ConfigMap as `opencode.json` at the opencode config directory — avoids baking config into image
8. **Storage**: 5Gi PVC mounted at `/root` for session/config persistence
9. **Security context**: `runAsUser: 1000` (non-root, may need adjustment based on image)
10. **ConfigMap mounting**: The `createOpencode()` function creates a K8s ConfigMap with the opencode.json and adds a volume + volumeMount — this is done *inside* the app package, not via `ExposedWebApp` (which is kept generic)

## Notes
- opencode stores config in `~/.config/opencode/opencode.json` (Linux) or `~/.local/share/opencode/`
- The ConfigMap approach means the llama.cpp URL is set at deploy time (Pulumi config)
- Additional providers can be added by passing their API keys via `providerEnv`
- The flinker host llama.cpp URL will be something like `http://<flinker-node-ip>:8080/v1` — user must configure this
- opencode model ID for llama.cpp models should be configured to match the loaded model name

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
