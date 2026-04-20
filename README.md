# dalisipedal
A website for P.E.D.A.L. app

## Public manifest refresh

The website repo does not contain the app's Amplify backend files, so GitHub Actions must be configured with repository secrets before the manifest workflow can run.

Required repository secrets:

- `PEDAL_APPSYNC_ENDPOINT`
- `PEDAL_APPSYNC_API_KEY`
- `PEDAL_COGNITO_IDENTITY_POOL_ID`
- `PEDAL_S3_BUCKET`

The scheduled workflow lives at `.github/workflows/refresh-public-manifests.yml` and currently runs once per day. You can also trigger it manually from the GitHub Actions tab.

Generated public data now includes:

- `data/gallery-manifest.json`
- `data/ninja-manifest.json`
- `data/media-reaction-summaries.json`

`media-reaction-summaries.json` is used by the website for public like/dislike counts, so anonymous visitors do not need live AppSync reads for reactions.

## Black map snapshot refresh

`Черна Карта` uses `data/black-map-snapshot.json`, which is generated from the public CloudFront file at `public/statistics.json`.

- The generator script is `scripts/generate_black_map_snapshot.mjs`
- The scheduled workflow is `.github/workflows/refresh-black-map-snapshot.yml`
- It runs once per month and does not require any repository secrets

This keeps the website on a lightweight cached snapshot instead of downloading the larger statistics source file on every page view.
