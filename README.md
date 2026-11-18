# podman-sandboxes

Run AI coding agents in locked-down, rootless Podman containers that can
only see the project you're working on.

`sbx` builds a sandbox image and runs it with your current directory
bind-mounted read-write at the same path. Nothing else from your host
(home directory, SSH keys, credentials, dotfiles) goes into the container.

## Requirements

- [Podman](https://podman.io/), running rootless
- Bash 4+
- Optional: [krun](https://github.com/containers/crun/blob/main/krun.1.md)
  (`crun` built with libkrun). When `krun` is on your `PATH`, sandboxes run
  inside a lightweight microVM instead of a plain container.

## Usage

```sh
sbx help                          # show usage
sbx build <name>                  # build (or rebuild) a sandbox image
sbx run <name> [-- <agent args>]  # run a sandbox in the current directory
```

Examples:

```sh
cd ~/Projects/my-app
sbx run claude                 # start Claude Code in ./my-app
sbx run claude -- --help       # pass --help to the claude CLI
sbx run pi                     # start the pi coding agent
```

`sbx run` builds the image first if it doesn't exist yet. To pick up a newer
agent version, run `sbx build <name>` again. Layers are cached, so you may
need `podman build --no-cache` or `podman image prune` to force a fresh
install.

To call `sbx` from anywhere, symlink it onto your `PATH`. The script resolves
its own location through symlinks.

```sh
ln -s "$PWD/sbx" ~/.local/bin/sbx
```

## Available sandboxes

| Name     | Agent                                                       | Persistent state volume                    |
| -------- | ----------------------------------------------------------- | ------------------------------------------ |
| `claude` | [Claude Code](https://claude.com/claude-code)               | `claude-agent-home` → `/home/node/.claude` |
| `pi`     | `@earendil-works/pi-coding-agent` (npm)                     | `pi-agent-home` → `/home/node/.pi/agent`   |

Each agent keeps its login and settings in a named Podman volume, so they
persist between runs without touching your host home directory. Agent
self-updates, version checks and telemetry are turned off where the agent
supports it.

The `claude` sandbox also bind-mounts your host `~/.claude/skills`
directory read-only at `/home/node/.claude/skills`, if that directory exists.
Skills you add on the host are available inside the container without
copying them into the state volume.

## Security model

Every sandbox runs with:

- **Only the project directory mounted.** `sbx run` refuses to start from
  `/`, your home directory, or any parent of your home directory.
- **No Linux capabilities** (`--cap-drop ALL`) and `no-new-privileges`.
- **A read-only root filesystem.** Writable paths are the project mount, a
  `tmpfs` at `/tmp`, and the sandbox's own state volume.
- **User namespace mapping** (`keep-id`), so files created in the project
  are owned by your host user. Inside the container you are the unprivileged
  `node` user (uid 1000).
- **Resource limits:** 4 CPUs, 8 GiB memory, 1024 processes. These are set by
  `SANDBOX_NUM_CPUS` and `SANDBOX_MEMORY_MB` in `sbx`.
- **microVM isolation** through `krun`, when it's installed.

Your global git `user.name` and `user.email` are passed in as
`GIT_AUTHOR_*` / `GIT_COMMITTER_*` environment variables so commits are
attributed to you. No git credentials or SSH keys are shared, so the agent
can commit but can't push.

The container has normal network access. That's required, since the agents
call their model APIs.

## Project layout

```
sbx                         # the CLI
sandboxes/<name>/
  Containerfile             # standalone sandbox image definition
  config                    # optional; sourced by `sbx run` to add podman args
```

Each sandbox is standalone: its `Containerfile` is a complete image
definition with no shared base. `sbx build` builds it with the sandbox's
directory as the build context. Images are tagged `localhost/sbx-<name>`.

## Adding a sandbox

1. Create `sandboxes/<name>/Containerfile`. Start from the Node base image,
   install the tools you need, install the agent, switch to `USER node`, and
   set `ENTRYPOINT` to the agent's command:

   ```dockerfile
   FROM docker.io/library/node:26.13.0-trixie-slim

   RUN apt-get update \
     && apt-get install -y --no-install-recommends bash ca-certificates git jq ripgrep \
     && rm -rf /var/lib/apt/lists/*

   ENV NPM_CONFIG_CACHE=/tmp/.npm-cache

   RUN mkdir -p /home/node/.myagent \
     && chown -R node:node /home/node/.myagent

   RUN npm install -g --ignore-scripts my-agent \
     && npm cache clean --force

   USER node
   ENTRYPOINT ["my-agent"]
   ```

2. Optionally add `sandboxes/<name>/config`. It's a Bash snippet sourced
   inside `sbx run` that can append to `podman_extra_run_args` (or change
   `podman_run_args`). Because the root filesystem is read-only, any
   directory the agent writes outside the project or `/tmp` needs a volume:

   ```bash
   # shellcheck shell=bash
   podman_extra_run_args+=(
     --volume "myagent-home:/home/node/.myagent"
   )
   ```

3. Run `sbx run <name>`.
