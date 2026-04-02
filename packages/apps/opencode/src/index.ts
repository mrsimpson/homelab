import * as fs from "node:fs";
import * as path from "node:path";
import { homelabConfig } from "@mrsimpson/homelab-config";
import {
  AuthType,
  type ExposedWebApp,
  type HomelabContext,
} from "@mrsimpson/homelab-core-components";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * opencode - AI coding agent deployment
 *
 * Deploys the opencode web interface (https://opencode.ai) as a containerised
 * app protected by GitHub OAuth via the existing oauth2-proxy infrastructure.
 *
 * Features:
 * - GitHub OAuth protection (AuthType.OAUTH2_PROXY)
 * - 5 Gi persistent volume for sessions and config
 * - Optional llama.cpp local-LLM support via injected opencode.json ConfigMap
 * - Optional additional provider credentials via env vars
 *
 * Usage:
 * ```typescript
 * import { createOpencode } from "@mrsimpson/homelab-app-opencode";
 *
 * const opencodeApp = createOpencode(homelab, {
 *   llamaCppBaseUrl: "http://flinker:8080/v1",
 *   llamaCppModels: [{ id: "qwen2.5-coder", name: "Qwen 2.5 Coder (local)" }],
 *   providerEnv: [
 *     { name: "ANTHROPIC_API_KEY", value: config.requireSecret("anthropicApiKey") },
 *   ],
 * });
 * export const opencodeUrl = opencodeApp.url;
 * ```
 */

// ---------------------------------------------------------------------------
// .mcp.json standard format (VS Code / Claude Desktop convention)
// ---------------------------------------------------------------------------

/** A local (stdio) MCP server entry as found in .mcp.json */
export interface McpJsonLocalServer {
  /** Executable to run, e.g. "npx" or "uvx" */
  command: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

/** A remote (HTTP/SSE) MCP server entry as found in .mcp.json */
export interface McpJsonRemoteServer {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

/** Union of all server types supported by .mcp.json */
export type McpJsonServer = McpJsonLocalServer | McpJsonRemoteServer;

/**
 * The standard .mcp.json file format (VS Code / Claude Desktop).
 * Pass this to `OpencodeConfig.mcpJson` and it will be translated
 * into the opencode-native `mcp` config block automatically.
 *
 * Example:
 * ```json
 * {
 *   "servers": {
 *     "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp" },
 *     "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/root/projects"] }
 *   }
 * }
 * ```
 */
export interface McpJson {
  servers: Record<string, McpJsonServer>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Type-guard: is the server entry a remote server? */
function isRemoteServer(s: McpJsonServer): s is McpJsonRemoteServer {
  return "type" in s && (s.type === "http" || s.type === "sse");
}

/**
 * Translate a standard .mcp.json `servers` map into opencode's `mcp` block.
 *
 * VS Code format → opencode format differences:
 *   - local: `command`(string) + `args`(array)  →  `type:"local"`, `command`(array), `environment`
 *   - remote: `type:"http"|"sse"` + `url`        →  `type:"remote"`, `url`, `headers`
 */
function translateMcpJson(mcpJson: McpJson): Record<string, object> {
  const result: Record<string, object> = {};

  for (const [name, server] of Object.entries(mcpJson.servers)) {
    if (isRemoteServer(server)) {
      result[name] = {
        type: "remote",
        url: server.url,
        ...(server.headers ? { headers: server.headers } : {}),
      };
    } else {
      // local stdio server
      const cmd = server.args ? [server.command, ...server.args] : [server.command];
      result[name] = {
        type: "local",
        command: cmd,
        ...(server.env ? { environment: server.env } : {}),
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------

/** A single llama.cpp model exposed through the local llama-server */
export interface LlamaCppModel {
  /** Model identifier sent to the API (must match the loaded model name in llama-server) */
  id: string;
  /** Display name shown in the opencode model selector */
  name: string;
  /** Maximum context window size in tokens (default: 131072 = 128K) */
  contextLimit?: number;
  /** Maximum output tokens (default: 8192) */
  outputLimit?: number;
}

/** Configuration for the opencode deployment */
export interface OpencodeConfig {
  /**
   * Base URL of the llama.cpp server (llama-server --server).
   * Example: "http://flinker:8080/v1"
   * When set, an opencode.json ConfigMap is created and mounted so opencode
   * can discover the local model(s) without any interactive setup.
   */
  llamaCppBaseUrl?: string;

  /**
   * Models served by the llama.cpp server.
   * Only used when `llamaCppBaseUrl` is set.
   * Defaults to a single generic entry if omitted.
   */
  llamaCppModels?: LlamaCppModel[];

  /**
   * Extra environment variables injected into the opencode container.
   * Use this to pass LLM provider API keys as Pulumi secrets, e.g.:
   *   { name: "ANTHROPIC_API_KEY", value: config.requireSecret("anthropicApiKey") }
   *   { name: "OPENAI_API_KEY",    value: config.requireSecret("openaiApiKey") }
   *
   * Keys are stored encrypted in Pulumi state – they are never written to disk
   * as plain text.
   */
  providerEnv?: Array<{ name: string; value: string | pulumi.Output<string> }>;

  /**
   * Mount a directory from the host node into the container at /root/projects.
   * This gives opencode access to existing code on the host filesystem.
   *
   * REQUIRED: Must be an absolute path on the node specified by `hostNode`.
   * Example: "/home/oliver/projects"
   *
   * Set via Pulumi config:
   *   pulumi config set opencode:hostWorkspacePath "/home/oliver/projects"
   */
  hostWorkspacePath: string;

  /**
   * The Kubernetes node hostname to pin the pod to.
   * Required when `hostWorkspacePath` is set — hostPath volumes are node-local.
   * Must match the `kubernetes.io/hostname` label of the target node.
   *
   * Set via Pulumi config:
   *   pulumi config set opencode:hostNode "flinker"
   */
  hostNode: string;

  /**
   * Optional MCP server definitions in the standard .mcp.json format
   * (used by VS Code, Claude Desktop, and others).
   *
   * These are automatically translated into opencode's native `mcp` config
   * block and merged into the generated opencode.json ConfigMap.
   *
   * Local server example (stdio):
   * ```ts
   * mcpJson: {
   *   servers: {
   *     filesystem: {
   *       command: "npx",
   *       args: ["-y", "@modelcontextprotocol/server-filesystem", "/root/projects"],
   *     },
   *   },
   * }
   * ```
   *
   * Remote server example (HTTP):
   * ```ts
   * mcpJson: {
   *   servers: {
   *     github: { type: "http", url: "https://api.githubcopilot.com/mcp" },
   *   },
   * }
   * ```
   *
   * Format differences vs opencode native:
   * - local: `command`(string) + `args`(array) → opencode `command`(array) + `type:"local"`
   * - remote: `type:"http"` → opencode `type:"remote"`
   */
  mcpJson?: McpJson;

  /**
   * Path to a local directory whose contents are mounted verbatim as the
   * opencode global config directory (`~/.config/opencode/`) inside the container.
   *
   * All files (including dotfiles and subdirectories) are read at `pulumi up`
   * time, packed into a ConfigMap, and copied into an emptyDir by an init
   * container so the full directory tree is reproduced inside the container.
   *
   * This is the recommended way to ship a rich opencode config including:
   * - `opencode.json`           — global opencode settings + MCP servers
   * - `.opencode/agents/*.md`   — custom agent definitions
   * - `.opencode/commands/*.md` — custom slash commands
   * - `.agentskills/`           — agent skill packs
   * - any other opencode config files
   *
   * Example (in your Pulumi program):
   * ```ts
   * import * as path from "path";
   * createOpencode(homelab, {
   *   configDir: path.join(__dirname, "../packages/apps/opencode/config"),
   *   hostWorkspacePath: "/home/jaegle/projects",
   *   hostNode: "flinker",
   * });
   * ```
   *
   * Note: when `configDir` is set, `llamaCppBaseUrl` and `mcpJson` still work —
   * the generated `opencode.json` is injected into the same ConfigMap and copied
   * into the config dir by the init container.
   */
  configDir?: string;
}

/** Return type of createOpencode */
export interface OpencodeApp {
  app: ExposedWebApp;
  url: pulumi.Output<string>;
}

// Default opencode config path, used when configDir is not set.
// When configDir IS set, XDG_CONFIG_HOME=/opencode-config is used instead.
const OPENCODE_CONFIG_PATH = "/root/.config/opencode";

// Port the opencode web server listens on inside the container
const OPENCODE_PORT = 4096;

/**
 * Build the opencode.json content for the given configuration.
 * Returns a JSON string suitable for a ConfigMap data entry.
 */
function buildOpencodeJson(baseUrl: string, models: LlamaCppModel[], mcpJson?: McpJson): string {
  const modelEntries: Record<string, object> = {};
  for (const m of models) {
    modelEntries[m.id] = {
      name: m.name,
      limit: {
        context: m.contextLimit ?? 131072,
        output: m.outputLimit ?? 8192,
      },
    };
  }

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "llama.cpp": {
        npm: "@ai-sdk/openai-compatible",
        name: "llama-server (local)",
        options: {
          baseURL: baseUrl,
        },
        models: modelEntries,
      },
    },
  };

  if (mcpJson && Object.keys(mcpJson.servers).length > 0) {
    config.mcp = translateMcpJson(mcpJson);
  }

  return JSON.stringify(config, null, 2);
}

/**
 * Build an opencode.json with only MCP server definitions (no llama.cpp provider).
 * Used when `mcpJson` is set but `llamaCppBaseUrl` is not.
 */
function buildOpencodeJsonMcpOnly(mcpJson: McpJson): string {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
  };

  if (Object.keys(mcpJson.servers).length > 0) {
    config.mcp = translateMcpJson(mcpJson);
  }

  return JSON.stringify(config, null, 2);
}

/**
 * Recursively read all files under `dir` and return a flat map of:
 *   { configMapKey → fileContent }
 *
 * ConfigMap keys cannot contain `/` or start with `.`, so we encode the
 * relative path by replacing `/` with `__` and stripping leading dots:
 *   ".opencode/agents/ade.md"  →  "_opencode__agents__ade.md"
 *   "opencode.json"            →  "opencode.json"
 *
 * The original relative path is preserved separately so we can reconstruct
 * the correct `subPath` and `mountPath` for each volume mount.
 *
 * Returns an array of { key, relativePath, content } tuples.
 */
function readConfigDir(dir: string): Array<{ key: string; relativePath: string; content: string }> {
  const results: Array<{ key: string; relativePath: string; content: string }> = [];

  function walk(current: string, relBase: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        // Encode relative path as a valid ConfigMap key:
        // replace leading dots per path segment, then replace / with __
        const key = relPath
          .split("/")
          .map((seg) => (seg.startsWith(".") ? `_${seg.slice(1)}` : seg))
          .join("__");
        const content = fs.readFileSync(fullPath, "utf-8");
        results.push({ key, relativePath: relPath, content });
      }
    }
  }

  walk(dir, "");
  return results;
}

/**
 * Deploy opencode as a GitHub-OAuth-protected web application.
 *
 * @param homelab  - HomelabContext providing infrastructure dependencies
 * @param cfg      - Deployment configuration (hostWorkspacePath and hostNode are required)
 */
export function createOpencode(homelab: HomelabContext, cfg: OpencodeConfig): OpencodeApp {
  const domain = pulumi.interpolate`opencode.${homelabConfig.domain}`;
  const name = "opencode";

  // --------------------------------------------------------------------------
  // Volumes and mounts
  // --------------------------------------------------------------------------
  const extraVolumes: object[] = [];
  const extraVolumeMounts: object[] = [];

  // hostPath workspace mount — always present (hostWorkspacePath is required)
  extraVolumes.push({
    name: "host-workspace",
    hostPath: {
      path: cfg.hostWorkspacePath,
      type: "DirectoryOrCreate",
    },
  });
  extraVolumeMounts.push({
    name: "host-workspace",
    mountPath: "/root/projects",
  });

  // --------------------------------------------------------------------------
  // ConfigMap: verbatim config directory (optional)
  //
  // Strategy: all files are packed flat into a ConfigMap (keys encode the
  // relative path). An init container copies them — restoring the full directory
  // tree — into an emptyDir that is then mounted at OPENCODE_CONFIG_PATH.
  //
  // This avoids the "subPath parent dir doesn't exist" problem that occurs when
  // using per-file subPath mounts into a path that hasn't been created yet.
  // --------------------------------------------------------------------------
  const initContainers: object[] = [];

  if (cfg.configDir) {
    const configFiles = readConfigDir(cfg.configDir);

    if (configFiles.length > 0) {
      const configDirData: Record<string, string> = {};
      for (const f of configFiles) {
        configDirData[f.key] = f.content;
      }

      // If llama.cpp / mcpJson config is also provided, inject a generated
      // opencode.json into the ConfigMap (keyed as "opencode.json") so it
      // lands at configLivePath/opencode.json and takes effect as the global config.
      if (cfg.llamaCppBaseUrl || cfg.mcpJson) {
        const models: LlamaCppModel[] =
          cfg.llamaCppModels && cfg.llamaCppModels.length > 0
            ? cfg.llamaCppModels
            : [{ id: "local-model", name: "Local Model (llama.cpp)" }];
        configDirData["opencode.json"] = cfg.llamaCppBaseUrl
          ? buildOpencodeJson(cfg.llamaCppBaseUrl, models, cfg.mcpJson)
          : buildOpencodeJsonMcpOnly(cfg.mcpJson!);
      }

      const configDirMap = new k8s.core.v1.ConfigMap(`${name}-config-dir`, {
        metadata: {
          name: `${name}-config-dir`,
          namespace: name,
          labels: { app: name },
        },
        data: configDirData,
      });

      const stagingPath = "/tmp/opencode-config-staging";
      // Mount outside the PVC to avoid conflicts. We override XDG_CONFIG_HOME
      // so opencode resolves its global config at /opencode-config/opencode/.
      const xdgConfigHome = "/opencode-config";
      const configLivePath = `${xdgConfigHome}/opencode`;

      // Volume 1: the ConfigMap staging dir (flat, all keys as files)
      extraVolumes.push({
        name: "opencode-config-staging",
        configMap: { name: configDirMap.metadata.name },
      });

      // Volume 2: emptyDir that becomes the live config dir
      extraVolumes.push({
        name: "opencode-config-dir",
        emptyDir: {},
      });

      // Mount the live config dir into the main container
      extraVolumeMounts.push({
        name: "opencode-config-dir",
        mountPath: xdgConfigHome,
      });

      // Build copy commands: one per file, recreating the directory tree.
      // configFiles entries use their relativePath; generated entries (e.g. opencode.json)
      // use their key directly as the destination filename.
      const fileCopyCommands = configFiles.map((f) => {
        const destDir = path.posix.dirname(`${configLivePath}/${f.relativePath}`);
        return `mkdir -p "${destDir}" && cp "${stagingPath}/${f.key}" "${configLivePath}/${f.relativePath}"`;
      });
      // Add copy command for any generated entries not coming from disk
      const diskKeys = new Set(configFiles.map((f) => f.key));
      for (const key of Object.keys(configDirData)) {
        if (!diskKeys.has(key)) {
          fileCopyCommands.push(
            `mkdir -p "${configLivePath}" && cp "${stagingPath}/${key}" "${configLivePath}/${key}"`
          );
        }
      }
      const copyCommands = fileCopyCommands.join(" && ");

      // Init container: copies staged files into the emptyDir with correct paths.
      // The emptyDir at configLivePath is fresh and writable by UID 1000 via fsGroup.
      initContainers.push({
        name: "opencode-config-init",
        image: "busybox:1.36",
        command: ["sh", "-c", copyCommands],
        securityContext: {
          runAsUser: 1000,
          runAsGroup: 1000,
          runAsNonRoot: true,
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [
          { name: "opencode-config-staging", mountPath: stagingPath },
          { name: "opencode-config-dir", mountPath: xdgConfigHome },
        ],
      });
    }
  }

  // --------------------------------------------------------------------------
  // ConfigMap: generated opencode.json for llama.cpp and/or inline mcpJson
  // Only used when configDir is NOT set (when configDir IS set, the generated
  // opencode.json is injected directly into the configDir ConfigMap above).
  // --------------------------------------------------------------------------
  if ((cfg.llamaCppBaseUrl || cfg.mcpJson) && !cfg.configDir) {
    const models: LlamaCppModel[] =
      cfg.llamaCppModels && cfg.llamaCppModels.length > 0
        ? cfg.llamaCppModels
        : [{ id: "local-model", name: "Local Model (llama.cpp)" }];

    const opencodeJsonContent = cfg.llamaCppBaseUrl
      ? buildOpencodeJson(cfg.llamaCppBaseUrl, models, cfg.mcpJson)
      : buildOpencodeJsonMcpOnly(cfg.mcpJson!);

    const configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
      metadata: {
        name: `${name}-config`,
        namespace: name, // same namespace as the app
        labels: { app: name },
      },
      data: {
        "opencode.json": opencodeJsonContent,
      },
    });

    extraVolumes.push({
      name: "opencode-config",
      configMap: {
        name: configMap.metadata.name,
      },
    });

    extraVolumeMounts.push({
      name: "opencode-config",
      mountPath: OPENCODE_CONFIG_PATH,
      readOnly: true,
    });
  }

  // --------------------------------------------------------------------------
  // Environment variables
  // --------------------------------------------------------------------------
  const env: Array<{ name: string; value: string | pulumi.Output<string> }> = [
    { name: "OPENCODE_PORT", value: String(OPENCODE_PORT) },
    // When configDir is set, override XDG_CONFIG_HOME so opencode finds its
    // global config at /opencode-config/opencode/ (populated by init container).
    ...(cfg.configDir ? [{ name: "XDG_CONFIG_HOME", value: "/opencode-config" }] : []),
    // Spread any caller-supplied provider credentials (API keys etc.)
    ...(cfg.providerEnv ?? []),
  ];

  // --------------------------------------------------------------------------
  // ExposedWebApp
  // --------------------------------------------------------------------------
  const app = homelab.createExposedWebApp(name, {
    // Our hardened wrapper image: non-root (UID 1000) on top of the official image.
    // Build with: ./images/opencode/build.sh --push --token <ghp_PAT>
    image: "ghcr.io/mrsimpson/opencode:1.2.27-homelab.5",
    domain,
    port: OPENCODE_PORT,
    replicas: 1,

    // Start opencode in web server mode, bound to all interfaces
    args: ["web", "--hostname", "0.0.0.0", "--port", String(OPENCODE_PORT)],

    auth: AuthType.OAUTH2_PROXY,
    oauth2Proxy: { group: "users" },

    // Persistent volume: stores opencode sessions, project state, auth tokens.
    // Mounted at /root (the non-root user's HOME, set in the Dockerfile).
    storage: {
      size: "5Gi",
      mountPath: "/root",
      storageClass: "longhorn-uncritical",
    },

    env,

    resources: {
      requests: { cpu: "100m", memory: "256Mi" },
      limits: { cpu: "500m", memory: "512Mi" },
    },

    // Runs as UID 1000 (non-root) — no allowRoot needed.
    securityContext: {
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
    },

    // Pull secret for ghcr.io/mrsimpson — created automatically via ExternalSecrets
    imagePullSecrets: [{ name: "ghcr-pull-secret" }],

    // Pin to the node that hosts the workspace directory (hostPath is node-local)
    nodeSelector: { "kubernetes.io/hostname": cfg.hostNode },

    extraVolumes,
    extraVolumeMounts,
    initContainers: initContainers.length > 0 ? initContainers : undefined,

    tags: ["ai", "opencode", "oauth2-proxy", "llama.cpp"],
  });

  const url = pulumi.interpolate`https://${domain}`;

  return { app, url };
}
