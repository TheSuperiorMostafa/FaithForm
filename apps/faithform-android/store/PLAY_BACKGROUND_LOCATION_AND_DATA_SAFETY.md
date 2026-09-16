# Google Play: background location declaration and Data safety

What to enter in Play Console for FaithForm 1.0 on Android, now that automatic
check-in ships. Nothing here has been submitted; these are the answers to give.

## Permissions declaration form — `ACCESS_BACKGROUND_LOCATION`

**Which feature uses background location?**

> Automatic check-in. A churchgoer who turns it on is checked in for a church
> service when they arrive at their own church, even when FaithForm is closed or
> not in use.

**Describe the feature and why it needs location in the background.**

> FaithForm lets a church take attendance without paper or a scan at the door.
> When a member turns on automatic check-in, FaithForm registers a geofence
> around each campus of the churches they belong to (Google Play services
> geofencing, at most 100 regions). Android reports when the phone has stayed
> inside a campus for at least a minute. FaithForm then asks the server whether a
> service at that campus is open for check-in; only if one is does it read the
> phone's location once and send it with the check-in, so the server can confirm
> the person is at the campus. If the church asks for confirmation, the person
> is shown a notification and checks in with one tap.
>
> People arrive at church and put their phone away; they do not open an app at
> the door. With foreground-only location, Android delivers no geofence events
> while the app is closed, so the feature could never work.
>
> FaithForm does not track location: there is no continuous location request,
> no foreground service, and no location history. A pass by the building, or
> any time outside a check-in window, sends nothing. The location is used only
> for the check-in, is not shared with anyone (including the church, which sees
> only that the person attended), and is never used for advertising. The
> feature is off by default, is turned on only from the Check in tab or Account,
> and can be turned off at any time, which removes every geofence and withdraws
> consent on the server.

**Is access to location in the background core to this feature?** Yes.

**Could the feature work with foreground location only?** No — see above.

**Prominent disclosure.** Shown in the app immediately before the request, on
its own screen ("Allow location in the background"), with "Continue" and "No
thanks" of equal weight. It states: FaithForm collects your precise location to
check you in automatically when you arrive at church for a service, even when
the app is closed or not in use; the location is read only after you have
stayed at your church while check-in is open and is never tracked; it is not
shared with anyone, including your church, and never used for advertising; it
can be turned off at any time. On Android 11+ it says which option to choose on
the next screen, using the system's own label for "Allow all the time".

## Demo video — shot list (30–90 s, screen recording on a real Android 13+ device)

Record with a test church and a test account, never real congregation data.
Use a mock-location app or be on site for shots 9–11.

1. **Launch** the app, signed in. Pause on Home: no location prompt appears.
2. **Open the Check in tab.** Show the "Automatic check-in — Off" card above the
   QR scanner.
3. **Tap the card, then "Turn on automatic check-in".** Hold on the introduction
   screen long enough to read "What FaithForm does with your location".
4. **Tap Continue** (consent recorded). The foreground explanation appears; tap
   Continue; the **system dialog** appears; choose *Precise* and *While using the
   app*.
5. **Prominent disclosure screen** — hold 3–4 s so the whole text is readable.
6. **Tap Continue.** Android's Settings page opens; choose **Allow all the
   time**; go back.
7. **Notifications explanation**, tap Allow notifications, grant the system
   dialog.
8. **Status screen**: "Automatic check-in is on", watching for the church, every
   row in "What automatic check-in needs" allowed, next service shown.
9. **Close the app** (swipe it away from Recents) and lock the phone. Show the
   lock screen or home screen for a moment so it is clear the app is not open.
10. **Arrive at the church** (walk in, or move the mock location inside the
    campus) and wait about a minute.
11. **The notification** "You're checked in at <church>" appears (or, for a
    church that asks, "Are you at <church>?" — tap **Check in**, then "You're
    checked in").
12. **Open the app → Check in tab**: "Last check-in" shows the service.
13. **Turn off**: tap the card, "Turn off automatic check-in", confirm. Show the
    status reading "Off".

## Data safety form

| Data type | Collected | Shared | Processing | Required | Purposes | Linked to user |
|---|---|---|---|---|---|---|
| **Precise location** | Yes | No | Not ephemeral on the server's side (a derived attendance record is kept); the coordinates themselves are used for the check-in and then discarded | **Optional** (automatic check-in is off until turned on) | App functionality | Yes — through the attendance record on the account |
| **Approximate location** | Yes | No | Ephemeral: "Churches near me" sorts results and keeps nothing | Optional | App functionality | No |

Also answer:

* **Location collected in the background:** yes, for app functionality
  (automatic check-in), as declared above.
* **Encrypted in transit:** yes (HTTPS only; cleartext is refused).
* **Users can request deletion:** yes (in-app account deletion).
* **Used for advertising or shared with third parties:** no. No advertising ID,
  no analytics SDK.

What leaves the phone for a check-in, and nothing else: the service it is for,
`detected` or `confirm`, the time it was observed, one latitude/longitude with
its accuracy and whether Android flagged it as a mock location, the campus
region id and configuration version the server issued, and the attempt or
detection id. The occurrence lookup that comes first carries only the church
and the campus region id.
