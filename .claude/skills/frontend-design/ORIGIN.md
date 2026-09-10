# Origin

This skill is vendored verbatim from Anthropic's public skills repository:

- Source: https://github.com/anthropics/skills/tree/main/skills/frontend-design
- License: Apache 2.0 (see `LICENSE.txt`)

It is copied into this repo so it is available automatically to anyone working
here — including Claude Code web sessions, which do not carry your local plugin
installs.

To update, re-copy `skills/frontend-design/` from the upstream repo.

Alternative (machine-wide instead of repo-local), run in Claude Code:

    /plugin marketplace add anthropics/skills
    /plugin install example-skills@anthropic-agent-skills

Note that upstream ships `frontend-design` as part of the `example-skills`
plugin bundle, not as a standalone plugin.
