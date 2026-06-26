# Phase 8 — Docker clean-machine harness base image.
#
# Alpine + node 20 + bun + Claude Code CLI. Layer-cache friendly:
# system layers first, then bun install, then package.json + tarball last
# so iteration on the plugin tarball doesn't bust earlier layers.
#
# Built by test/docker/run-harness.sh; consumed by test/plugin-install-e2e.test.ts
# and test/worktree-init.test.ts.

FROM alpine:3.20

# --- system deps (cache-stable) -------------------------------------------
RUN apk add --no-cache \
    bash \
    coreutils \
    findutils \
    git \
    curl \
    ca-certificates \
    libstdc++ \
    libgcc \
    nodejs=~20 \
    npm

# --- bun (latest; the old pin to bun-v1.1.30 lacked a linux-aarch64-musl
# build, breaking the harness on Apple Silicon under OrbStack. Drop the pin
# so the installer picks whatever the latest release ships for this arch.)
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# --- Claude Code CLI (cache-stable; the harness needs `claude` on PATH) ---
# The CLI ships as @anthropic-ai/claude-code on npm.
RUN npm install -g @anthropic-ai/claude-code || \
    echo "claude-code install deferred to runtime (network-restricted build)"

# --- workdir + late-binding plugin tarball --------------------------------
WORKDIR /harness

# Copy package.json LAST so cache invalidation cascades correctly.
COPY package.json /harness/package.json

# The plugin tarball gets mounted at runtime under /harness/dist/.
# The harness driver copies it in if a bind mount is not used.
RUN mkdir -p /harness/dist /harness/fixtures /harness/results

# Default to a no-op shell so the harness driver can `docker run` and
# exec specific verification commands. This keeps the image generic
# across S-01, S-02, S-03 scenarios.
CMD ["/bin/bash", "-l"]
