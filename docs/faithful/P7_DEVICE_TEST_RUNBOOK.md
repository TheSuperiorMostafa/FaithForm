# Prompt 7 — Device test runbook

**None of this has been performed.** Every scenario below is written to be run
by a person with a real phone at a real building, and every one is currently
**pending**. Automatic attendance has never fired on a physical device.

## Before starting

| Requirement | Why |
|---|---|
| A non-production Faithful deployment | Never test against a congregation's real attendance |
| A test church with a positioned campus | `latitude`, `longitude`, `geofence_radius_m` set |
| `geofence_enabled = true` in `attendance_policies` | Off by default |
| A test account with a **verified** `visitor_people_links` row | No link, no attendance |
| An occurrence with an open check-in window | Or nothing is eligible |
| Two devices: one iOS 17+, one Android 11+ | The API-30+ background flow only exists there |
| Ideally also an Android 10 device | The runtime-dialog branch is genuinely different |
| Physical access to the campus, or a mock-location tool | A geofence cannot be triggered from a desk |

**Never use production congregation data.** Seed a test church.

## Recording results

Each scenario: **PASS / FAIL / BLOCKED**, the device and OS version, and what
the admin dashboard showed. A scenario with no dashboard check is incomplete —
the point is convergence, not a green screen on the phone.

---

## 1. Permission grant

| | |
|---|---|
| **Steps** | Fresh install → open app → browse discovery and a feed → confirm **no** location prompt appears → open automatic attendance → tap through introduction, foreground education, background education |
| **Expect** | Exactly two OS prompts on iOS (When In Use, then Always). On Android 11+: one runtime dialog, then a Settings hand-off. Status reads "on" only after consent is recorded |
| **Also check** | The app never prompted during launch, discovery, login, or feed browsing |
| **Status** | ⛔ Pending |

## 2. Permission denial, each kind

| Case | Expect |
|---|---|
| Decline foreground | Blocked state, Settings link, **no** Always prompt follows |
| Grant When In Use / foreground only, decline Always / background | Blocked with copy explaining it cannot work, Settings link |
| Choose "Approximate" (Android 12+) / reduced accuracy (iOS) | Its own state and copy, not "denied" |
| Turn location off device-wide | Different copy again — this is not the app being denied |
| Restricted device (MDM/parental) | **No Settings link** — it would be a dead end |

**Status** ⛔ Pending

## 3. Background entry with the screen locked

| | |
|---|---|
| **Steps** | Enable, walk out of range, lock the screen, put the phone in a pocket, walk into the building, wait through the dwell |
| **Expect** | Attendance appears on the admin dashboard without the app being opened |
| **Record** | Time from crossing to the fact appearing |
| **Status** | ⛔ Pending |

## 4. App terminated normally

| | |
|---|---|
| **Steps** | Enable, swipe the app away from the recents list *without* force-stopping, leave and re-enter the region |
| **Expect** | iOS: relaunched into the background (Apple documents this). Android: the receiver fires |
| **Status** | ⛔ Pending |

## 5. Force-quit / force-stop — **an open question**

| | |
|---|---|
| **iOS** | Apple's documentation does **not** state what happens after a force-quit from the app switcher. This scenario exists to find out, not to confirm an assumption |
| **Android** | Force-stop from Settings clears geofences and delivers no broadcast. Nothing should fire until the app is opened. **Confirm** the app recovers on next open |
| **Expect** | Whatever is observed is recorded honestly. Do not report a PASS for behaviour that is merely hoped for |
| **Status** | ⛔ Pending |

## 6. Device reboot

| | |
|---|---|
| **Steps** | Enable, reboot, **do not open the app**, enter the region |
| **iOS** | Regions are expected to persist |
| **Android** | Geofences are cleared. `BOOT_COMPLETED` should re-register — confirm it does, and that it re-fetched configuration rather than using the cache |
| **Also** | Reboot, revoke consent from another device, *then* enter the region. Must fail closed |
| **Status** | ⛔ Pending |

## 7. Network loss during entry

| | |
|---|---|
| **Steps** | Enable airplane mode, enter the region, wait, leave airplane mode |
| **Expect** | The attempt is queued encrypted, retried with **the same idempotency key**, and counted once |
| **Then** | Repeat, but stay offline past two hours. The queue must purge unsent and the dashboard must show nothing |
| **Status** | ⛔ Pending |

## 8. Approximate / reduced accuracy

| | |
|---|---|
| **Steps** | Grant approximate (Android) or reduced (iOS), enter the region |
| **Expect** | No attempt submitted, or one refused. **Never counted.** The screen explains precise location is needed |
| **Status** | ⛔ Pending |

## 9. Two nearby churches, overlapping regions

| | |
|---|---|
| **Setup** | Two test churches with campuses close enough to overlap |
| **Steps** | Be a member of both, select one, enter the overlap |
| **Expect** | Only the selected church's regions are monitored. Attendance lands at the selected church, or nowhere |
| **Then** | Switch churches. Confirm the previous church's regions are removed *before* the new ones register |
| **Status** | ⛔ Pending |

## 10. Multiple services on one day

| | |
|---|---|
| **Steps** | Two occurrences the same day. Attend the morning one, leave, return for the evening one |
| **Expect** | **Two** facts, one per occurrence. The sequential-duplicate suppression must not swallow the second — it is keyed per occurrence, and a unit test covers it, but this is the real check |
| **Status** | ⛔ Pending |

## 11. DST / timezone change

| | |
|---|---|
| **Steps** | Set the device to a different timezone from the church, then attend. Separately, test across a DST transition if the calendar allows |
| **Expect** | The window is resolved from the church's zone, not the device's. A device in the wrong timezone must not shift eligibility |
| **Status** | ⛔ Pending |

## 12. Consent revoked before submission

| | |
|---|---|
| **Steps** | Enter the region, and while dwell is running revoke consent from another device |
| **Expect** | The attempt is refused, nothing is counted, **and the device stops monitoring entirely** |
| **Also** | Have staff remove the People link mid-flow. Same outcome |
| **Status** | ⛔ Pending |

## 12b. Bad fix, then good fix — **the regression scenario**

| | |
|---|---|
| **Why** | This is the sequence that used to be unrecoverable: an early refusal was replayed for the rest of the service under the same idempotency key |
| **Steps** | Approach from outside the boundary with the phone cold — indoors first, or straight from a pocket. Let the first entry be refused. Then walk well inside, wait, and let a second entry fire |
| **Expect** | The second entry is a **new logical attempt** with a different key, is validated afresh, and **counts**. The dashboard shows exactly one fact |
| **Also check** | Server-side, two attempt rows exist — the first with `outside_region` — and one fact. "Why was I not counted the first time" stays answerable |
| **Then** | Repeat while staying outside the whole time. The device should **back off** — progressively longer gaps, capped at **ten minutes** — and must **never** stop permanently. Walking in with a good fix at any point should still count. Time the longest gap and confirm it does not exceed ten minutes |
| **Watch** | Network activity: the gaps should widen, not the attempts stop |
| **Status** | ⛔ Pending |

## 12d. Dwell confirmation, per platform

| | |
|---|---|
| **Setup** | A church policy with `requiresConfirmation` and a two-minute dwell |
| **Android** | Enter and stay. The **OS dwell transition** should fire after the configured delay and the check-in should count without the app being opened. Then change `minDwellSeconds` on the server and confirm the device **re-registers** with the new delay |
| **iOS** | Enter and stay with the app closed. Confirmation needs a later execution opportunity — another region event, a background refresh, or opening the app. Record which one actually delivered it, and how long it took |
| **Both** | Confirm no `confirm` is submitted before the server's `confirmationNotBefore` |
| **Clock test** | Set the device clock **one hour behind**, then attend. The check-in must still take exactly the church's dwell — the server measures it, so a wrong device clock changes nothing. Repeat one hour **ahead**: it must not count early |
| **Status** | ⛔ Pending |

## 12c. Dwell that never completes

| | |
|---|---|
| **Why** | Neither platform guarantees a confirmation, and the honest outcome is "not counted" |
| **Steps** | Enter the region with a church policy requiring dwell, then leave the area within a few seconds and do not open the app for two hours |
| **Expect** | Nothing is counted. The attempt expires and is purged. The app never showed a success state |
| **iOS** | Confirm no background execution was requested for the wait |
| **Android** | Confirm the receiver did not hold `goAsync` open beyond its window |
| **Status** | ⛔ Pending |

## 13. Duplicate callbacks

| | |
|---|---|
| **Steps** | Stand at the boundary and walk in and out repeatedly for several minutes |
| **Expect** | **One** fact. After the first count, later entries submit nothing at all |
| **Watch** | Network activity — repeated entries should cost zero requests |
| **Status** | ⛔ Pending |

## 14. Battery observation

| | |
|---|---|
| **Steps** | Two matched devices, one with the feature on and one off, over 24 h of ordinary use including one service |
| **Record** | iOS Settings → Battery per-app; Android Settings → Battery usage |
| **Expect** | No measurable difference attributable to Faithful. **No figure is claimed until this runs** |
| **Status** | ⛔ Pending |

## 15. Admin dashboard verification — **the one that matters**

Every scenario above ends here.

| | |
|---|---|
| **Steps** | After each scenario, open the dashboard Services page for the occurrence |
| **Expect** | The person appears once, sourced "Automatic". The occurrence total is correct |
| **Then** | Have a greeter also mark them manually. Total must **not** increase |
| **Then** | Run a bulk "mark everyone" including that person. Total must **not** increase |
| **Then** | Check the date-range report. The total must equal the number of people, not the number of sources — this is migration `0057`'s fix, verified in the database suite but not yet on a real deployment |
| **Status** | ⛔ Pending |

---

## Completion levels

| Level | Status |
|---|---|
| **Source complete** | ✅ Both platforms, integration paths, documentation |
| **Local automated verification** | ✅ Web, database, Swift, Kotlin **including 36 real Android framework tests**, Android build — all green here |
| **Simulator / emulator** | ⛔ **Not performed.** No simulator or emulator was launched |
| **Physical device** | ⛔ **Not performed.** No geofence has fired on real hardware |
| **Deployed staging** | ⛔ Nothing deployed |
| **Production** | ⛔ Nothing deployed |

**Until section 15 passes on a physical device, automatic attendance is
implemented and tested but has never been observed to work.** That sentence is
the honest state of this feature.
