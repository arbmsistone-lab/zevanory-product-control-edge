# Render production deployment policy

For merges to `main` that can affect the production Render services:

- Include `[skip render]` (or `[render skip]`) in the merge commit message so Render does not auto-deploy that commit.
- Deploy manually in sequence: HA first, wait for LIVE, run smoke checks, then deploy the primary.
- Compare `zpc_worker_*` request volume with the baseline before proceeding from HA to primary.
- If the HA smoke fails or worker traffic spikes abnormally, do not deploy the primary. Revert only the merge commit, also using `[skip render]`, and restore the prior known-good deployment.
- Do not call `/portable-health` while the Supabase production freeze is active.
