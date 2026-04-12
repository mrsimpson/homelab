# @mrsimpson/homelab-app-opencode

⚠️ **DEPRECATED** — This app has been consolidated into [`@mrsimpson/homelab-app-opencode-router`](../opencode-router/README.md). The router provides per-user isolated instances which is the preferred approach. This simple deployment is no longer used in the homelab.

For the current opencode deployment, see: [`@mrsimpson/homelab-app-opencode-router`](../opencode-router/README.md)

---

**Legacy Documentation** (preserved for reference):

[opencode](https://opencode.ai) AI coding agent deployed as a GitHub-OAuth-protected web app.

## Access

**https://opencode.no-panic.org** — GitHub OAuth required (oauth2-proxy, `users` group).

## Image

The upstream image (`ghcr.io/anomalyco/opencode`) runs as root. We build a thin wrapper
that adds a non-root user (UID 1000) and installs extra tools on top:

```
images/opencode/Dockerfile   — adds CLI tools
images/opencode/build.sh     — build + push script
```

Image published to: `ghcr.io/mrsimpson/opencode:<upstream-version>-homelab.<revision>`

### Updating to a new upstream version

```bash
# 1. Build & push — upstream version is read automatically from the image
./images/opencode/build.sh --push --token <ghp_PAT_with_write:packages>

# 2. Update the image tag in the app
#    packages/apps/opencode/src/index.ts → image: "ghcr.io/mrsimpson/opencode:X.Y.Z-homelab.N"

# 3. Deploy
pulumi up
```

Bump `--revision` (default: 3) when rebuilding the same upstream version (e.g. Dockerfile change):

```bash
./images/opencode/build.sh --push --revision 3 --token <pat>
# → ghcr.io/mrsimpson/opencode:1.2.27-homelab.3
```

The GHCR package is **private** — the cluster pulls it using the `ghcr-pull-secret`
automatically created per-namespace by `ExposedWebApp`.

## Configuration

All settings live in Pulumi config under the `opencode` namespace:

```bash
# Required — host workspace mount and node pinning
pulumi config set opencode:hostWorkspacePath "/home/oliver/projects"
pulumi config set opencode:hostNode          "flinker"

# LLM provider credentials (encrypted secrets)
pulumi config set opencode:anthropicApiKey  <key> --secret
pulumi config set opencode:openaiApiKey     <key> --secret

# Local llama.cpp server (plain values, all optional)
pulumi config set opencode:llamaCppBaseUrl      "http://flinker:8080/v1"
pulumi config set opencode:llamaCppModelId      "Qwen3-Coder-Next-UD-Q8_K_XL-00001-of-00003.gguf"
pulumi config set opencode:llamaCppModelName    "Qwen3 Coder (llama.cpp on flinker)"
pulumi config set opencode:llamaCppContextLimit 262144   # optional, default 131072
```

`hostWorkspacePath` and `hostNode` are **required** — `pulumi up` will fail without them.

To add a new provider credential, add it to `providerEnv` in `src/index.ts`:

```typescript
{ name: "OPENAI_API_KEY", value: opencodeConfig.requireSecret("openaiApiKey") },
```

Omit `llamaCppBaseUrl` entirely to disable the local provider.

## Working with projects

opencode runs in a single working directory per instance. The host workspace is
mounted at `/root/projects` inside the container. Any directory under that path
is a project opencode can open.

### Workflow

1. Navigate to `/root/projects` in opencode's file browser or ask it via chat
2. Use the `bash` tool (or ask opencode) to clone repos or create new folders:
   ```
   clone https://github.com/me/myrepo into ./myrepo
   ```
3. The cloned/created directories persist on the host filesystem between pod restarts

### Node pinning

The pod is pinned to the node specified by `opencode:hostNode` via `nodeSelector`.
This is required because `hostPath` volumes are node-local — the directory only
exists on that specific machine.

## Storage

| Mount | Type | Purpose |
|---|---|---|
| `/root` | 5 Gi Longhorn PVC (`longhorn-uncritical`) | opencode sessions, config, auth tokens, Bun cache |
| `/root/projects` | hostPath from `opencode:hostWorkspacePath` | Host code directories accessible to opencode |

## Installed tools

| Tool | Purpose |
|---|---|
| `git` | Version control |
| `curl` | HTTP client |
| `node` / `npm` | Node.js LTS + npm (for MCP servers, scripts) |
| `pnpm` | Fast Node package manager |
| `python3` | Python interpreter (for MCP servers, scripts) |
| `gh` | GitHub CLI — clone repos, manage PRs, auth to GitHub |
| `bd` / `beads` | Beads task-management CLI |

## Deployment

```bash
pulumi up          # deploy / update
pulumi up --diff   # preview changes first
```
