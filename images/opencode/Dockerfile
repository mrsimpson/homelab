FROM ghcr.io/anomalyco/opencode

# Install tools as root before switching to the non-root user:
#   git, curl, bash  — essential dev tools
#   nodejs, npm      — Node.js LTS + npm/npx (latest from Alpine apk)
#   pnpm             — fast Node package manager
#   python3          — Python interpreter (for MCP servers, scripts)
#   uv               — fast Python package manager; also ships uvx
#   gh               — GitHub CLI (linux/amd64 tarball from GitHub releases)
#   bd               — beads task-management CLI (https://github.com/steveyegge/beads)
#   ghostty          — An interactive terminal also for the web ui

RUN printf 'https://dl-cdn.alpinelinux.org/alpine/edge/main\nhttps://dl-cdn.alpinelinux.org/alpine/edge/community\nhttps://dl-cdn.alpinelinux.org/alpine/edge/testing\n' \
      >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache git curl bash nodejs npm pnpm python3 uv ghostty && \
    # gh CLI — resolve latest version tag, fetch and extract just the binary
    GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
      | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/') && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_amd64/bin/gh" && \
    # bd (beads) — installs directly to /usr/local/bin/bd
    curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash && \
    # Ensure all installed binaries are owned by root and world-executable
    chown root:root /usr/local/bin/bd /usr/local/bin/beads /usr/local/bin/gh && \
    chmod 755 /usr/local/bin/bd /usr/local/bin/beads /usr/local/bin/gh

# Add a proper non-root user with a conventional home directory.
# opencode writes to ~/.local, ~/.cache, ~/.config and ~/.opencode — all under $HOME.
# Using /home/opencode makes it clear this is a non-root user's home, not the root account.
RUN addgroup -S opencode && \
    adduser  -S -u 1000 -G opencode -h /home/opencode -s /bin/sh opencode && \
    mkdir -p /home/opencode && \
    chown -R opencode:opencode /home/opencode

USER opencode
ENV HOME=/home/opencode
