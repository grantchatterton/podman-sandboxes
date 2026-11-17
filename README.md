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
base/Containerfile          # shared base stage (sbx-base): Node, git, ripgrep, fd
sandboxes/<name>/
  Containerfile             # sandbox image, starts FROM sbx-base
  config                    # optional; sourced by `sbx run` to add podman args
```

`sbx build` concatenates `base/Containerfile` and the sandbox's
`Containerfile` into a single build, so the base is a build stage, not a
separately tagged image. Images are tagged `localhost/sbx-<name>`. The build
context is the sandbox's directory.

## Adding a sandbox

1. Create `sandboxes/<name>/Containerfile`. Start from `sbx-base`, install
   the agent, switch to `USER node`, and set `ENTRYPOINT` to the agent's
   command:

   ```dockerfile
   FROM sbx-base

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
