# Public manifest generation

Run `node scripts/generate_public_manifests.mjs` from this repository. Configuration comes from the repository secrets documented in the root README, or the sibling app's local Amplify configuration. Running the generator replaces the generated `data/` snapshots and `share/` pages.

Reaction counts use the existing public `syncMediaReactionSummaries` query, with a full read (no `lastSync`) and pagination. This reads summary records directly instead of calling the per-media Lambda-backed query for every gallery item. At the September 19 dataset size, 56 stored summaries fit in one response and populate the same 652-item public snapshot that previously required 652 requests.

The output retains manifest order, unique media keys, zero counts for media with no summary, and the existing JSON shape. Deleted summaries are ignored. Only keys selected by the gallery, featured entries and Ninja manifest are published, with just `mediaKey`, `likes`, `dislikes`, and `updatedAt`. Interactive signed-in reactions are unchanged.

Throttled pages are retried with bounded exponential backoff. GraphQL errors, malformed pages and repeated pagination tokens fail generation; they do not publish an apparently successful all-zero snapshot or fall back to hundreds of individual requests. The scheduled workflow tests this logic before generating and publishing data.

Run the offline regression tests:

```sh
node --test scripts/tests/*.test.mjs
```

The generator logs its reaction-page count. Use the actual scheduled run's log to verify the request reduction as the dataset grows; larger tables can require more pages.

For a full GitHub-hosted validation, manually run **Refresh Public Manifests** with `publish` set to `false`. Tests and live generation run, while the commit/push and S3 upload steps are skipped. Scheduled runs and manual runs with `publish: true` retain the existing publication behavior, including downstream backend automation.
