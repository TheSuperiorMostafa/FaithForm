# Profile photos

Account → Add/Change photo opens the system image picker on iPhone and Android, followed by a circular preview. Drag and pinch, or use zoom and horizontal/vertical sliders; rotate by 90 degrees, reset, cancel, or save. Removal asks for confirmation. A failed upload keeps the crop for retry and preserves the saved profile.

The image stays local until Save. Both apps downsample selected images to a maximum 2048-pixel edge, apply EXIF orientation, and export only the square crop as a 512 × 512 JPEG. The circle is a preview mask, not permanently burned into the image. Android uses Coil's orientation-aware decoding on the full supported API range (26+); iOS uses ImageIO thumbnails. No broad photo-library or camera permission is added.

## Shared storage and synchronization

`PUT /api/mobile/v1/account/photo` accepts `{ "jpegBase64": "…" }`, or explicit `null` to remove. It returns the standard mobile success envelope containing `{ "avatarUrl": "…" }` (nullable). Uses the existing verified bearer-token identity, active-account check, and a limit of 15 changes/hour. No user ID, storage path, or destination URL is accepted from the client.

Requests are bounded while streaming to 1,500,000 bytes. The server validates actual JPEG decoding, square dimensions and a 4,194,304-pixel ceiling, then re-encodes at 512 × 512 in sRGB with metadata removed. Only the normalized rendition is uploaded. Random immutable object names prevent stale cached images. Failed profile writes remove the new object only after confirming it is unreferenced (an uncertain database response must not delete a committed photo); successful writes attempt to retire the previous owned object. Simultaneous uploads may leave an unreferenced object; the last completed profile write wins. Storage cleanup failures do not undo a successful profile save.

`visitor_accounts.avatar_url` is the source of truth for both apps and web member/directory queries. Mobile refreshes bootstrap after saving. Dashboard navigation avatars fetch the signed-in user's record through a cookie-authenticated endpoint on load, on window focus/visibility, and every 30 seconds while visible. It is eventual sync, not a realtime subscription. Failed image loads fall back to initials.

The `profile-photos` bucket serves public avatar renditions, consistent with the existing profile URL model. Original images and EXIF location data are never uploaded. Public avatar URLs are not an authorization mechanism or a place for private documents. Photo selection alone does not publish anything; the crop screen explains visibility before Save.

## Deployment

Apply `supabase/migrations/0098_profile_photos.sql` before releasing this feature. It creates a public JPEG-only bucket with a 1 MiB object limit and no client write policies. Deploy the web/API and ship updated native apps. Existing accounts need no backfill. This change does not apply a production migration or publish app builds automatically.

## Research behind the design

- [Apple PhotosPicker](https://developer.apple.com/documentation/photosui/photospicker): system selection rather than full-library access.
- [Apple ImageIO orientation transform](https://developer.apple.com/documentation/imageio/kcgimagesourcecreatethumbnailwithtransform): normalize orientation while downsampling, rather than decoding full camera-sized bitmaps for display.
- [Android Photo picker](https://developer.android.com/training/data-storage/shared/photo-picker): Activity Result API, single image selection, platform fallback without broad storage permission.
- [Android ImageDecoder](https://developer.android.com/reference/android/graphics/ImageDecoder): bound decoded image dimensions. Coil provides the compatible decoding layer used here.
- [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/) and [metadata handling](https://sharp.pixelplumbing.com/api-output/): independently validate image bytes and remove metadata on the server.

Circular preview, explicit Save, immutable URLs, 512-pixel output, and accessible sliders are product/engineering choices informed by those APIs, rather than platform-mandated cropper specifications.

## Release QA

Automated tests cover server format/size/metadata validation and native crop geometry. Before store release, test physical iPhone and Android devices with HEIC, rotated/mirrored JPEGs, cloud-only photos, portrait and landscape images, limited photo access, picker cancellation, screen rotation, VoiceOver/TalkBack, large text, slow/offline upload and retry. Confirm the same account's already-open dashboard updates after saving, and that removal returns all clients to initials. A production account/storage end-to-end test is still required after deployment.

## Validation from this change

- Seven photo server tests passed, including unauthenticated mutation rejection and request identity/URL override rejection; 47 existing mobile contract tests passed.
- Generated Swift/Kotlin/JSON contracts are current; targeted web lint passed. A web source typecheck passed with stale `.next` route types excluded (the regular check references two removed preview pages).
- The iOS app built with no warnings or errors; Android app compilation succeeded. The broader Android run reported failures in `FeedModelTest` and `LaunchScreenTest`, outside the photo changes, and was stopped.
- Native crop pixel tests were added for both platforms. Their extra simulator/Robolectric runs were stopped under concurrent build contention, so these tests are **not reported as passing**. Physical-device and deployed cross-device verification remain outstanding.
- The migration baseline checker reports existing helper-policy issues in migration 0077. The new migration has not been applied to a database.
