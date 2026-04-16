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
