# Automatic check-in reliability

## Expected behavior

A person opts in once, grants Always and Precise Location, and joins a church with an active People link. The church sets its building, radius, service schedule, and arrival mode. During an open check-in window:

- **Right away:** a verified arrival is submitted without a confirmation tap. Only a server result of counted/already counted establishes success.
- **Confirmation after a wait:** the phone asks the person to confirm. The server enforces the waiting period. A timer or boundary crossing is not consent to answer that question for the person.
- The phone shows the result, posts a notification if authorized, and refreshes the selected church's attendance history.
- The dashboard and Services totals refresh every 15 seconds while visible. An open roster refreshes too. Hidden tabs and offline browsers do not poll.

Neither platform guarantees an instantaneous GPS boundary event. Opening the iPhone app performs an additional fresh, single location check. No continuous location tracking was added.

## Findings from the reported test

A read-only inspection of Faithform Test found a Saturday 4 PM service, a 3:30–6 PM check-in window in America/New_York, confirmation required after 120 seconds, and a 50 m campus radius. No attendance attempts were present in the inspected recent attempt history. This establishes that no attempt reached the attendance record table; it does not establish whether the phone had consent, Always permission, connectivity, or a usable location at the time. Some authorization failures can also occur before that table is written.

The code had several independent gaps:

1. The dashboard described waiting as automatic counting, but saving a nonzero wait enabled mandatory person confirmation.
2. The iPhone imposed an extra one-minute wait even for the explicit Right away setting. That required another execution opportunity after the original arrival callback.
3. Finishing an in-app wait depended on opening the Check in tab. Remaining on Home did not resume it.
4. Region registration is asynchronous. A state check before registration finishes can miss a phone already inside the boundary.
5. Success did not consistently refresh the phone's last-check-in history; dashboards and open rosters did not refresh automatically.
6. A completed one-shot location request left a timeout capable of cancelling the next request.
7. Failed initial attempts could be suppressed for ten minutes, including failures before anything could be persisted for retry.
8. A selected church could show another church's pending arrival.
9. The dashboard chart filtered unified attendance to Sundays, hiding the reported Saturday service even if attendance had been recorded. It now includes every recorded service day, and formats date-only labels without timezone shifts.

## Platform research and decisions

Apple documents that registering a region while already inside does not generate an entry callback. Explicit state requests are needed. Region events offer limited background execution time. The app now requests state after registration, supplements foreground/setup checks with a fresh one-shot fix, and requests a bounded background execution lease for an arrival's network work. Persisted attempts remain the recovery mechanism if execution ends. [Apple: Region Monitoring](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html)

Google recommends roughly 100–150 m minimum geofence radii and describes delayed delivery, indoor accuracy limits, initial entry triggers, and dwell events. The setup screen now explains the risk of a sub-100 m boundary; it does not silently enlarge an administrator's chosen area. [Android: Create and monitor geofences](https://developer.android.com/develop/sensors-and-location/location/geofencing)

FaithForm's decision is to honor the explicit zero-dwell policy on arrival, while preserving positive waits and confirmation policies. This trades protection against a brief drop-off for a truly automatic mode, so the setup screen states that consequence. Existing confirmation policies are not silently changed.

The server remains authoritative for identity, consent, church access, service window, campus geometry, accuracy, idempotency, and the unique attendance fact. Client location is untrusted evidence, not proof against a compromised device. No synthetic attendance was inserted into the reported church.

## Verification and release gate

Automated coverage includes immediate arrival, opening inside a small campus, duplicate callbacks, delayed work while Home stays visible, old location timeout isolation, closed-window retry, consent/authorization revocation, and server-side concurrency and report totals.

Real-device acceptance must still exercise the installed release candidate. A paired device and a successful build do not prove a physical arrival. Use a dedicated future service at Faithform Test and record the results below:

| Scenario | Required observation |
| --- | --- |
| Right away, app open on Home | One server-confirmed check-in; notification if enabled; history updates |
| App opened while already inside | Same result without leaving and re-entering |
| Phone locked before crossing boundary | Background check-in eventually completes; no promise of instant delivery |
| Notifications denied | Attendance still counts; the in-app history shows it |
| Confirmation mode | No attendance before the person's tap and required wait |
| Connection interrupted | No false success; retry returns one counted fact |
| Poor accuracy or outside area | Clear not-counted explanation, no false attendance |
| Repeated entry/relaunch | Still one active fact and one person in totals |
| Dashboard left open | Totals and open roster update within one polling cycle after server commit |
| Consent revoked or signed out | Monitoring and pending evidence stop |

Setup changes continue to apply only to services whose check-in has not opened. Existing open/completed service snapshots remain immutable. Use a new future window for the physical test rather than rewriting the 4 PM service's history.

This change focuses on the reported iPhone flow and shared dashboard. Android's application wiring needs its own release acceptance; its platform-neutral attendance code alone is not evidence that background attendance is integrated in the shipping app.


## Observed verification for this change

- Full iOS library suite: **561 tests passed** across 67 suites, including the new arrival, timeout, foreground, and retry regressions.
- iOS device-target application build: **passed** with signing disabled and cached package resolution. This verifies iOS-only code compilation, not installation or physical movement.
- Disposable PostgreSQL suite: **204 tests passed**, including attendance concurrency, check-in sessions, setup synchronization, and unified attendance totals. Production was not used for these writes.
- Saturday dashboard regression and related people/attendance tests: **16 passed**.
- Focused web attendance run: **363 passed, 2 failed**. Both failures are existing native privacy/permission expectations conflicting with photo/media work elsewhere in the shared workspace, not attendance assertions.
- Broader web run: **1,375 passed, 4 failed**. In addition to those two privacy expectations, the relay playback-auth test and Android video-surface assertion failed.
- Changed web files pass ESLint. Global localization verification is blocked by an unrelated inline string in `MediaStage.swift`.
- The normal TypeScript check initially encountered stale generated types for deleted preview pages; a separate application-source check excluding generated preview and dependency build directories **passed**.

The inspected production configuration was read only. The app has not been installed on the physical iPhone, and the web changes have not been deployed by this task. Keep the release gate open until the scenario table above has been exercised on the deployed candidate.
