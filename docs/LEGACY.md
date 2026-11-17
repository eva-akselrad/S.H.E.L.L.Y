# The old SHELLY site (v1)

Kept in case you ever want to go back.

- **Tag:** `legacy-v1` (the last commit of the old app, before the v2 rebuild)
- **Branch:** `legacy` (same commit, easier to browse and deploy from)

Look at it: `git show legacy-v1:<path>`, or browse the `legacy` branch on GitHub.

Go back to it (as a new commit, keeping v2 history):

```bash
git checkout main
git checkout legacy-v1 -- .
git commit -m "Restore the legacy v1 site"
```

Or run it separately without touching main: `git worktree add ../shelly-legacy legacy`.
The old site is a Cloudflare Pages app with its own password; v2 is a single Cloudflare Worker, so they deploy differently.
