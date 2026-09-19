# Sermon presentations and services

Church admins can manage the same association from **Live Streaming** or a
sermon's detail page in **Sermon Builder**, under **Sermon presentation &
livestream**. Share a presentation in the member app, select a service and the
published presentation version, then choose **Link presentation**. The link can
be replaced or removed from either page.

## Member experience

- A live service and its published recording offer **Open sermon presentation**.
  The slides open over the player, which continues playing. **Back to service**
  returns to the video.
- The sermon notes and the selected presentation offer **Watch live** while the
  linked service is live, then **Watch recording** when a verified, accessible
  replay has been published. No replay link appears while processing is pending.
- A sermon can be used for several services. Each service keeps one exact
  published slide version, so publishing revised slides does not silently alter
  the slides attached to an earlier recording.
- Open sermon and presentation screens refresh their related services every
  30 seconds. Links respect the viewer's church, membership, publication access,
  and feature availability. A destination checks access again when opened.

## Deployment

Apply `supabase/migrations/0097_service_presentations.sql` before deploying the
updated mobile API. It adds the association table, tenant validation, and two
service-role-only projection functions. No existing content is automatically
linked. The dashboard requires Live Streaming, Sermon Builder, and Member App
features and a church administrator.

The shared contract adds optional `presentation` and `linkedServices` fields.
Older payloads still decode; existing clients can ignore the additional fields.
Deploy the server changes and then distribute the updated iOS and Android apps.

## Verification

The database test harness creates and removes a separate database using all
repository migrations; point it only at a disposable PostgreSQL server:

```sh
FAITHFORM_TEST_DATABASE_URL=postgres://localhost/postgres \
  node scripts/run-service-links-database-tests.mjs
node --import tsx --test tests/unit/sermon-etag.test.ts \
  tests/unit/sermon-presentation.test.ts tests/unit/mobile-contract.test.ts \
  tests/security/media-privacy.test.ts
```

The database suite covers exact-version links, live priority, verified replay
fallback, unpublishing, audience restrictions, tenant isolation, denied direct
client access, and unlinking. ETag tests cover transitions between no video,
live video, and a recording even when the published slides remain immutable.

`scripts/verify-android-live-playback.sh` exercises a real HLS stream and verifies
that opening and dismissing the presentation keeps the same player advancing.
`MediaStageTest` also checks that the sermon recording control selects the
correct service.
