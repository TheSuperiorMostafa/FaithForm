import Foundation

/**
 * Every user-facing string in FaithForm for iOS.
 *
 * Prompt 4 left these as inline literals, which was a real parity gap against
 * Android's `strings.xml`. They now live in one place, keyed identically to the
 * Android resource names, so `scripts/verify-localization-parity.mjs` can prove
 * neither platform has a string the other lacks.
 *
 * The key is the contract; the English value here is the development default
 * that `Localizable.xcstrings` overrides per locale. Adding Arabic later is a
 * translation task rather than a refactor, and nothing here assumes a text
 * direction.
 */
public enum L {
    /// Looked up through the package bundle so a localized catalog wins, with
    /// the English default as the fallback rather than the raw key leaking
    /// into the UI when a translation is missing.
    static func t(_ key: String, _ fallback: String) -> String {
        let localized = Bundle.module.localizedString(
            forKey: key, value: fallback, table: "Localizable"
        )
        return localized.isEmpty ? fallback : localized
    }

    // MARK: - App
    public static var appName: String { t("app_name", "FaithForm") }

    // MARK: - Onboarding
    public static var welcomeTitle: String { t("welcome_title", "Join your church") }
    public static var welcomeBody: String {
        t(
            "welcome_body",
            "Start with the link your church sent you. Searching is available when a church lists itself."
        )
    }
    public static var findAChurch: String { t("find_a_church", "Find your church") }
    public static var haveInvitation: String { t("have_invitation", "I have a link") }
    public static var haveLinkContinue: String { t("have_link_continue", "Continue") }
    public static var enterInvitationCode: String {
        t("enter_invitation_code", "Paste your invitation link")
    }

    // MARK: - Discovery
    public static var searchPlaceholder: String {
        t("search_placeholder", "Church name, city, or postal code")
    }
    public static var churchesNearMe: String { t("churches_near_me", "Churches Near Me") }
    public static var searchResultsTitle: String { t("search_results_title", "Churches") }
    public static var noResultsTitle: String { t("no_results_title", "No churches found") }
    public static var noResultsBody: String {
        t("no_results_body", "Try a different name, city, or postal code.")
    }
    public static var distanceAway: String { t("distance_away", "%@ km away") }

    // MARK: - Location permission
    public static var locationEducationTitle: String {
        t("location_education_title", "Find churches near you")
    }
    public static var locationEducationBody: String {
        t("location_education_body", "FaithForm uses your location once, right now, to sort nearby churches. It is not stored and not tracked.")
    }
    public static var locationContinue: String { t("location_continue", "Use my location") }
    public static var locationSkip: String { t("location_skip", "Search by name instead") }
    public static var locationDeniedTitle: String {
        t("location_denied_title", "Location is off")
    }
    public static var locationDeniedBody: String {
        t("location_denied_body", "You can still find your church by name, city, or postal code.")
    }

    // MARK: - Relationship
    public static var followChurch: String { t("follow_church", "Add this church") }
    public static var followingChurch: String { t("following_church", "Added") }
    public static var requestToJoin: String { t("request_to_join", "Request to Join") }
    public static var joinChurch: String { t("join_church", "Join") }
    public static var acceptInvitation: String { t("accept_invitation", "Accept Invitation") }
    public static var leaveChurch: String { t("leave_church", "Leave") }
    public static var stateFollowing: String { t("state_following", "Added") }
    public static var statePending: String { t("state_pending", "Request pending") }
    public static var joinPendingHomeTitle: String {
        t("join_pending_home_title", "Waiting for your church")
    }
    public static var joinPendingHomeBody: String {
        t(
            "join_pending_home_body",
            "Your request to join is with the church. Someone on staff needs to accept you before you become a member in the app. You can still see what they publish for people who have added them."
        )
    }
    public static var stateJoined: String { t("state_joined", "Member") }
    public static var stateLeft: String { t("state_left", "Not added") }
    public static var stateBlocked: String { t("state_blocked", "Unavailable") }
    public static var pendingExplainer: String {
        t(
            "pending_explainer",
            "Your request is with the church. Waiting for someone on staff to accept you. You can still see what they publish for people who have added them."
        )
    }
    public static var inviteOnlyExplainer: String {
        t("invite_only_explainer", "This church joins by invitation.")
    }
    public static var addAnotherChurch: String { t("add_another_church", "Add another church") }
    public static var switchChurch: String { t("switch_church", "Switch church") }
    public static var chooseChurchTitle: String { t("choose_church_title", "Choose a church") }

    // MARK: - Home and feed
    public static var homeTitle: String { t("home_title", "Home") }
    public static var pinnedLabel: String { t("pinned_label", "Pinned") }
    public static var upcomingEvents: String { t("upcoming_events", "Upcoming") }
    public static var recentAnnouncements: String { t("recent_announcements", "Latest") }
    public static var emptyFeedTitle: String { t("empty_feed_title", "Nothing yet") }
    public static var emptyFeedBody: String {
        t("empty_feed_body", "When your church posts something, it will appear here.")
    }
    public static var addToCalendar: String { t("add_to_calendar", "Add to calendar") }
    public static var shareItem: String { t("share_item", "Share") }
    public static var itemUnavailableTitle: String {
        t("item_unavailable_title", "No longer available")
    }
    public static var itemUnavailableBody: String {
        t("item_unavailable_body", "This was removed or is no longer shared with you.")
    }

    // MARK: - Notifications
    public static var notificationEducationTitle: String {
        t("notification_education_title", "Never miss what matters")
    }
    public static var notificationEducationBody: String {
        t("notification_education_body", "Get a quiet nudge when your church posts something new. You choose what, and you can change it any time.")
    }
    public static var notificationEnable: String { t("notification_enable", "Turn on updates") }
    public static var notificationSkip: String { t("notification_skip", "Not now") }
    public static var notificationDeniedTitle: String {
        t("notification_denied_title", "Notifications are off")
    }
    public static var notificationDeniedBody: String {
        t("notification_denied_body", "You can turn them on in Settings whenever you like.")
    }
    public static var topicAnnouncements: String { t("topic_announcements", "Announcements") }
    public static var topicEvents: String { t("topic_events", "Events") }

    // MARK: - Account
    public static var account: String { t("account", "Account") }
    public static var yourAccount: String { t("your_account", "Your account") }
    public static var accountAddNameHint: String {
        t("account_add_name_hint", "Add the name your church should see.")
    }
    public static var accountSaveName: String { t("account_save_name", "Save name") }
    public static var yourChurches: String { t("your_churches", "Your churches") }
    public static var noChurchesTitle: String { t("no_churches_title", "No churches yet") }
    public static var noChurchesBody: String {
        t("no_churches_body", "When you add or join a church, it will appear here.")
    }
    public static var signOut: String { t("sign_out", "Sign out") }
    public static var deleteAccount: String { t("delete_account", "Delete my account") }
    public static var deleteAccountHint: String {
        t("delete_account_hint", "Removes your FaithForm profile. Your church keeps its own records.")
    }
    public static var deleteAccountConfirmTitle: String {
        t("delete_account_confirm_title", "Delete your FaithForm account?")
    }
    public static var deleteAccountConfirmBody: String {
        t("delete_account_confirm_body", "Your account stops working right away and you'll be signed out. We finish deleting your profile and church connections within 30 days. Churches keep their own records, including your gifts. This can't be undone.")
    }
    public static var deleteAccountWorking: String {
        t("delete_account_working", "Deleting your account…")
    }
    public static var deleteAccountRequestedTitle: String {
        t("delete_account_requested_title", "Your account is being deleted")
    }
    public static var deleteAccountRequestedBody: String {
        t("delete_account_requested_body", "You've been signed out. We'll finish deleting your information within 30 days.")
    }
    public static var deleteAccountFailedTitle: String {
        t("delete_account_failed_title", "Your account wasn't deleted")
    }
    public static var deleteAccountFailedBody: String {
        t("delete_account_failed_body", "FaithForm couldn't reach the server. Check your connection and try again.")
    }
    public static var privacyPolicy: String { t("privacy_policy", "Privacy Policy") }
    public static var termsOfService: String { t("terms_of_service", "Terms of Service") }
    public static var accountDeletionHelp: String {
        t("account_deletion_help", "How account deletion works")
    }
    public static var signInTitle: String { t("sign_in_title", "Sign in to continue") }
    public static var signInBody: String {
        t("sign_in_body", "Your church's app — start with a link, or create an account.")
    }

    // MARK: - Landing
    //
    // The front door's promise and three things a churchgoer can actually do
    // in 1.0. Each names a real surface — nothing here describes a feature the
    // app does not ship.
    public static var landingHeadline: String { t("landing_headline", "Your church, all week long") }
    public static var landingFeedTitle: String { t("landing_feed_title", "Stay in the loop") }
    public static var landingFeedBody: String {
        t("landing_feed_body", "News and events from your church, as soon as they're shared.")
    }
    public static var landingWatchTitle: String { t("landing_watch_title", "Services & messages") }
    public static var landingWatchBody: String {
        t("landing_watch_body", "Join live, catch up, check in, or read the message.")
    }
    public static var landingCheckInTitle: String { t("landing_check_in_title", "Check in with a scan") }
    public static var landingCheckInBody: String {
        t("landing_check_in_body", "Scan the code at church. No cards or clipboards.")
    }
    public static var landingGiveTitle: String { t("landing_give_title", "Give securely") }
    public static var landingGiveBody: String {
        t("landing_give_body", "Support your church from your phone, with a receipt for every gift.")
    }

    // MARK: - Church profile
    public static var whereWeMeet: String { t("where_we_meet", "Where we meet") }
    public static var mainCampus: String { t("main_campus", "Main") }
    public static var getInTouch: String { t("get_in_touch", "Get in touch") }
    public static var websiteLabel: String { t("website_label", "Website") }
    public static var phoneLabel: String { t("phone_label", "Phone") }
    public static var emailLabel: String { t("email_label", "Email") }
    public static var sunday: String { t("day_sunday", "Sunday") }
    public static var monday: String { t("day_monday", "Monday") }
    public static var tuesday: String { t("day_tuesday", "Tuesday") }
    public static var wednesday: String { t("day_wednesday", "Wednesday") }
    public static var thursday: String { t("day_thursday", "Thursday") }
    public static var friday: String { t("day_friday", "Friday") }
    public static var saturday: String { t("day_saturday", "Saturday") }

    // MARK: - Notifications, continued
    public static var notificationSettingsHint: String {
        t("notification_settings_hint", "Open Settings")
    }
    public static var notificationsOn: String { t("notifications_on", "Updates are on") }

    // MARK: - Automatic attendance
    public static var autoAttendanceTitle: String {
        t("auto_attendance_title", "Automatic check-in")
    }
    public static var autoAttendanceIntroTitle: String {
        t("auto_attendance_intro_title", "Let your church know you were there")
    }
    public static var autoAttendanceIntroBody: String {
        t("auto_attendance_intro_body", "When you arrive for a service, FaithForm can check you in without you doing anything. Your church sees that you attended — nothing about where else you go.")
    }
    public static var autoAttendancePrivacyTitle: String {
        t("auto_attendance_privacy_title", "What FaithForm does with your location")
    }
    public static var autoAttendancePrivacyPointOne: String {
        t("auto_attendance_privacy_point_one", "Your phone watches for your church, and tells FaithForm only when you arrive.")
    }
    public static var autoAttendancePrivacyPointTwo: String {
        t("auto_attendance_privacy_point_two", "FaithForm never keeps a record of where you have been.")
    }
    public static var autoAttendancePrivacyPointThree: String {
        t("auto_attendance_privacy_point_three", "Your church sees that you attended a service. It never sees your location.")
    }
    public static var autoAttendancePrivacyPointFour: String {
        t("auto_attendance_privacy_point_four", "You can turn this off at any time, and everything stops.")
    }
    public static var autoAttendanceForegroundTitle: String {
        t("auto_attendance_foreground_title", "FaithForm needs to see your location")
    }
    public static var autoAttendanceForegroundBody: String {
        t("auto_attendance_foreground_body", "To know when you have arrived, FaithForm needs permission to read your location. Your phone will ask you next.")
    }
    public static var autoAttendanceBackgroundTitle: String {
        t("auto_attendance_background_title", "And to notice while the app is closed")
    }
    public static var autoAttendanceBackgroundBody: String {
        t("auto_attendance_background_body", "Check-in happens while you are settling into a seat, not staring at your phone. For that, your phone needs to allow location all the time. FaithForm only ever looks at whether you have arrived at your church.")
    }
    public static var autoAttendanceContinue: String {
        t("auto_attendance_continue", "Continue")
    }
    public static var autoAttendanceEnable: String {
        t("auto_attendance_enable", "Turn on automatic check-in")
    }
    public static var autoAttendanceNotNow: String { t("auto_attendance_not_now", "Not now") }
    public static var autoAttendanceDisable: String {
        t("auto_attendance_disable", "Turn off automatic check-in")
    }
    public static var autoAttendanceReadyTitle: String {
        t("auto_attendance_ready_title", "Automatic check-in is on")
    }
    public static var autoAttendanceReadyBody: String {
        t("auto_attendance_ready_body", "You are all set. FaithForm will check you in when you arrive for a service.")
    }
    public static var autoAttendanceWatching: String {
        t("auto_attendance_watching", "Watching %d location")
    }
    public static var autoAttendanceWatchingPlural: String {
        t("auto_attendance_watching_plural", "Watching %d locations")
    }
    public static var autoAttendanceOffTitle: String {
        t("auto_attendance_off_title", "Automatic check-in is off")
    }
    public static var autoAttendanceOffBody: String {
        t("auto_attendance_off_body", "Turn it on and FaithForm will check you in when you arrive.")
    }
    public static var autoAttendanceDeniedTitle: String {
        t("auto_attendance_denied_title", "Location is turned off for FaithForm")
    }
    public static var autoAttendanceDeniedBody: String {
        t("auto_attendance_denied_body", "Automatic check-in needs location. You can turn it back on in Settings.")
    }
    public static var autoAttendanceRestrictedTitle: String {
        t("auto_attendance_restricted_title", "Location is not available")
    }
    public static var autoAttendanceRestrictedBody: String {
        t("auto_attendance_restricted_body", "Location is restricted on this device, so automatic check-in cannot run. You can still be checked in at the service.")
    }
    public static var autoAttendanceServicesOffTitle: String {
        t("auto_attendance_services_off_title", "Location services are off")
    }
    public static var autoAttendanceServicesOffBody: String {
        t("auto_attendance_services_off_body", "Location is switched off for every app on this device. You can turn it on in Settings.")
    }
    public static var autoAttendanceAlwaysTitle: String {
        t("auto_attendance_always_title", "FaithForm needs location all the time")
    }
    public static var autoAttendanceAlwaysBody: String {
        t("auto_attendance_always_body", "Right now FaithForm can only see your location while it is open, so it cannot notice you arriving. You can change this in Settings.")
    }
    public static var autoAttendanceAccuracyTitle: String {
        t("auto_attendance_accuracy_title", "Precise location is off")
    }
    public static var autoAttendanceAccuracyBody: String {
        t("auto_attendance_accuracy_body", "FaithForm is only getting a rough idea of where you are, which is not close enough to tell that you are at your church. You can turn on precise location in Settings.")
    }
    public static var autoAttendanceUnavailableTitle: String {
        t("auto_attendance_unavailable_title", "This device cannot do automatic check-in")
    }
    public static var autoAttendanceUnavailableBody: String {
        t("auto_attendance_unavailable_body", "Automatic check-in is not available on this device. You can still be checked in at the service.")
    }
    public static var autoAttendanceNoLinkTitle: String {
        t("auto_attendance_no_link_title", "Your church needs to confirm who you are")
    }
    public static var autoAttendanceNoLinkBody: String {
        t("auto_attendance_no_link_body", "Once someone at your church confirms your details, you can turn on automatic check-in.")
    }
    public static var autoAttendanceChurchDisabledTitle: String {
        t("auto_attendance_church_disabled_title", "Your church has not set this up")
    }
    public static var autoAttendanceChurchDisabledBody: String {
        t("auto_attendance_church_disabled_body", "Automatic check-in is not switched on for your church.")
    }
    public static var autoAttendanceNoCampusTitle: String {
        t("auto_attendance_no_campus_title", "Your church has not added a location")
    }
    public static var autoAttendanceNoCampusBody: String {
        t("auto_attendance_no_campus_body", "Automatic check-in needs your church to add where it meets.")
    }
    public static var autoAttendanceConsentMissingTitle: String {
        t("auto_attendance_consent_missing_title", "Automatic check-in is not turned on")
    }
    public static var autoAttendanceConsentMissingBody: String {
        t("auto_attendance_consent_missing_body", "Turn it on to be checked in when you arrive.")
    }
    public static var autoAttendanceOfflineTitle: String {
        t("auto_attendance_offline_title", "FaithForm could not check")
    }
    public static var autoAttendanceOfflineBody: String {
        t("auto_attendance_offline_body", "FaithForm will try again when you are back on a network.")
    }
    public static var autoAttendanceOpenSettings: String {
        t("auto_attendance_open_settings", "Open Settings")
    }
    public static var autoAttendanceRecentTitle: String {
        t("auto_attendance_recent_title", "Last check-in")
    }
    public static var autoAttendanceRecentCounted: String {
        t("auto_attendance_recent_counted", "Checked in at %@")
    }
    public static var autoAttendanceRecentAlready: String {
        t("auto_attendance_recent_already", "You were already checked in at %@")
    }
    public static var autoAttendanceChecking: String {
        t("auto_attendance_checking", "Checking you in…")
    }
    public static var autoAttendanceStatusLabel: String {
        t("auto_attendance_status_label", "Automatic check-in status")
    }
    public static var autoAttendanceSaving: String {
        t("auto_attendance_saving", "Saving your choice…")
    }
    public static var autoAttendanceNotificationTitle: String {
        t("auto_attendance_notification_title", "Hear when you arrive")
    }
    public static var autoAttendanceNotificationBody: String {
        t("auto_attendance_notification_body", "FaithForm sends one notification when you arrive, so you can check in with a tap, and tells you once you are checked in. Your phone will ask you next.")
    }
    public static var autoAttendancePromptTitle: String {
        t("auto_attendance_prompt_title", "Are you at %@?")
    }
    public static var autoAttendancePromptBody: String {
        t("auto_attendance_prompt_body", "Tap to check in.")
    }
    public static var autoAttendancePromptActionCheckIn: String {
        t("auto_attendance_prompt_action_check_in", "Check in")
    }
    public static var autoAttendanceCheckedInTitle: String {
        t("auto_attendance_checked_in_title", "You're checked in at %@")
    }
    public static var autoAttendanceNotCheckedInTitle: String {
        t("auto_attendance_not_checked_in_title", "FaithForm couldn't check you in at %@")
    }
    public static var autoAttendanceNotCheckedInBody: String {
        t("auto_attendance_not_checked_in_body", "You can still check in with the code on screen.")
    }
    public static var autoAttendanceYourChurch: String {
        t("auto_attendance_your_church", "your church")
    }
    public static var autoAttendancePendingWaitingBody: String {
        t("auto_attendance_pending_waiting_body", "Stay a moment and FaithForm will ask you to confirm.")
    }
    public static var autoAttendancePendingAutomaticBody: String {
        t("auto_attendance_pending_automatic_body", "Stay a moment and FaithForm will check you in.")
    }
    public static var autoAttendanceNextService: String {
        t("auto_attendance_next_service", "Next service: %@")
    }
    public static var autoAttendanceServiceOpen: String {
        t("auto_attendance_service_open", "Check-in is open for %@")
    }
    public static var autoAttendanceWatchingChurches: String {
        t("auto_attendance_watching_churches", "Watching for %@")
    }
    public static var autoAttendanceNotAtThisChurch: String {
        t("auto_attendance_not_at_this_church", "Not available at %@")
    }
    public static var autoAttendanceNotificationsOffTitle: String {
        t("auto_attendance_notifications_off_title", "Notifications are off")
    }
    public static var autoAttendanceNotificationsOffBody: String {
        t("auto_attendance_notifications_off_body", "FaithForm cannot ask you to confirm while the app is closed. Open FaithForm when you arrive to check in, or turn notifications on in Settings.")
    }
    public static var autoAttendanceNeedsPermissionTitle: String {
        t("auto_attendance_needs_permission_title", "Location permission is not set up")
    }
    public static var autoAttendanceNeedsPermissionBody: String {
        t("auto_attendance_needs_permission_body", "Finish setting up so FaithForm can notice when you arrive.")
    }
    public static var autoAttendanceContinueSetup: String {
        t("auto_attendance_continue_setup", "Continue setup")
    }
    public static var autoAttendanceOn: String {
        t("auto_attendance_on", "On")
    }
    public static var autoAttendanceOff: String {
        t("auto_attendance_off", "Off")
    }

    // MARK: - States
    public static var loadingAccount: String { t("loading_account", "Loading your account") }
    public static var offlineCached: String {
        t("offline_cached", "Showing what was saved on this device.")
    }
    public static var offlineTitle: String { t("offline_title", "You're offline") }
    public static var offlineBody: String {
        t("offline_body", "FaithForm will load your account as soon as you're back on a network.")
    }
    public static var errorTitle: String { t("error_title", "Something went wrong") }
    public static var errorLoadFailedBody: String {
        t("error_load_failed_body", "You're signed in, but your account couldn't be loaded. This is usually temporary — try again in a moment.")
    }
    public static var tryAgain: String { t("try_again", "Try again") }
    public static var retry: String { t("retry", "Retry") }
    public static var refresh: String { t("refresh", "Refresh") }
    public static var blockedTitle: String { t("blocked_title", "Unavailable") }
    public static var blockedBody: String {
        t("blocked_body", "This church is not available to you right now.")
    }

    // MARK: - Check-in scanner
    public static var checkinScanTitle: String {
        t("checkin_scan_title", "Check in")
    }
    public static var checkinScanIntroTitle: String {
        t("checkin_scan_intro_title", "Scan the code on screen")
    }
    public static var checkinScanIntroBody: String {
        t("checkin_scan_intro_body", "Point your camera at the code your church is showing. FaithForm uses the camera only while this screen is open, and never keeps a picture.")
    }
    public static var checkinScanPrivacyNote: String {
        t("checkin_scan_privacy_note", "FaithForm never saves a photo and never asks for your photo library.")
    }
    public static var checkinScanButton: String {
        t("checkin_scan_button", "Scan the code")
    }
    public static var checkinScanEnterCode: String {
        t("checkin_scan_enter_code", "Enter the code instead")
    }
    public static var checkinScanCodeTitle: String {
        t("checkin_scan_code_title", "Enter the code on screen")
    }
    public static var checkinScanCodeHint: String {
        t("checkin_scan_code_hint", "Seven letters and numbers, shown beside the code.")
    }
    public static var checkinScanCodeLabel: String {
        t("checkin_scan_code_label", "Check-in code")
    }
    /// Must name exactly the letters and numbers `ShortCodeEntry.alphabet`
    /// leaves out — a test holds the two together.
    public static var checkinCodeInvalidCharacters: String {
        t("checkin_code_invalid_characters", "Codes never use the letters A, E, I, O, S, U or Z, or the numbers 0, 1, 2, 5, 6 or 8. Check the code on screen.")
    }
    public static var checkinScanCodeSubmit: String {
        t("checkin_scan_code_submit", "Check me in")
    }
    public static var checkinScanSearching: String {
        t("checkin_scan_searching", "Looking for a code…")
    }
    public static var checkinScanSubmitting: String {
        t("checkin_scan_submitting", "Checking you in…")
    }
    public static var checkinScanCameraDeniedTitle: String {
        t("checkin_scan_camera_denied_title", "FaithForm cannot use the camera")
    }
    public static var checkinScanCameraDeniedBody: String {
        t("checkin_scan_camera_denied_body", "Allow camera access in Settings, or enter the code shown beside the QR.")
    }
    public static var checkinScanCameraRestrictedTitle: String {
        t("checkin_scan_camera_restricted_title", "The camera is not available")
    }
    public static var checkinScanCameraRestrictedBody: String {
        t("checkin_scan_camera_restricted_body", "This device does not allow camera access. Enter the code shown beside the QR instead.")
    }
    public static var checkinScanCameraUnavailableTitle: String {
        t("checkin_scan_camera_unavailable_title", "No camera on this device")
    }
    public static var checkinScanCameraUnavailableBody: String {
        t("checkin_scan_camera_unavailable_body", "Enter the code shown beside the QR instead.")
    }
    public static var checkinScanOfflineTitle: String {
        t("checkin_scan_offline_title", "FaithForm could not check you in")
    }
    public static var checkinScanOfflineBody: String {
        t("checkin_scan_offline_body", "Nothing was recorded. Try again when you are back on a network.")
    }
    public static var checkinScanOpenSettings: String {
        t("checkin_scan_open_settings", "Open Settings")
    }
    public static var checkinScanTryAgain: String {
        t("checkin_scan_try_again", "Try again")
    }
    public static var checkinScanDone: String {
        t("checkin_scan_done", "Done")
    }

    // MARK: - Media
    public static var mediaTabTitle: String {
        t("media_tab_title", "Live & past")
    }
    public static var mediaLiveNowBadge: String {
        t("media_live_now_badge", "Live now")
    }
    public static var mediaLiveUpcoming: String {
        t("media_live_upcoming", "Starting soon")
    }
    public static var mediaLiveEnded: String {
        t("media_live_ended", "Today's service has ended")
    }
    public static var mediaLiveEndedBody: String {
        t("media_live_ended_body", "The recording will appear here once it is ready.")
    }
    public static var mediaWatchLive: String {
        t("media_watch_live", "Watch live")
    }
    public static var mediaArchiveTitle: String {
        t("media_archive_title", "Past services")
    }
    public static var mediaArchiveEmpty: String {
        t("media_archive_empty", "No services have been published yet.")
    }
    public static var mediaArchiveEmptySearch: String {
        t("media_archive_empty_search", "Nothing matches that.")
    }
    public static var mediaSearchLabel: String {
        t("media_search_label", "Search past services")
    }
    public static var mediaLoading: String {
        t("media_loading", "Loading…")
    }
    public static var mediaRetry: String {
        t("media_retry", "Try again")
    }
    public static var mediaOfflineTitle: String {
        t("media_offline_title", "FaithForm could not reach the server")
    }
    public static var mediaOfflineBody: String {
        t("media_offline_body", "Check your connection and try again.")
    }
    public static var mediaUnavailableTitle: String {
        t("media_unavailable_title", "This is no longer available")
    }
    public static var mediaUnavailableBody: String {
        t("media_unavailable_body", "The church removed it. Nothing you did caused this.")
    }
    public static var mediaBlockedTitle: String {
        t("media_blocked_title", "This church is not available to you")
    }

    // MARK: - Sermon notes

    public static var sermonsTitle: String {
        t("sermons_title", "Messages")
    }
    public static var sermonsEmpty: String {
        t("sermons_empty", "No sermon notes have been shared yet.")
    }
    public static var sermonsEmptySearch: String {
        t("sermons_empty_search", "Nothing matches that.")
    }
    public static var sermonsSearchLabel: String {
        t("sermons_search_label", "Search messages")
    }
    public static var presentationsTitle: String {
        t("presentations_title", "Slides")
    }
    public static var presentationsSearchLabel: String {
        t("presentations_search_label", "Search slides")
    }
    public static var presentationsEmpty: String {
        t("presentations_empty", "No slides have been published yet.")
    }
    public static var presentationsEmptySearch: String {
        t("presentations_empty_search", "Nothing matches that.")
    }
    public static var presentationsPageCount: String {
        t("presentations_page_count", "%d slides")
    }
    public static var presentationsRetry: String {
        t("presentations_retry", "Try again")
    }
    public static var presentationsOfflineTitle: String {
        t("presentations_offline_title", "FaithForm could not reach the server")
    }
    public static var presentationsOfflineBody: String {
        t("presentations_offline_body", "Check your connection and try again.")
    }
    public static var presentationsBlockedTitle: String {
        t("presentations_blocked_title", "This church is not available to you")
    }
    public static var presentationsBlockedBody: String {
        t("presentations_blocked_body", "You can't open slides for this church right now.")
    }
    public static var presentationsUnavailableTitle: String {
        t("presentations_unavailable_title", "These slides are no longer available")
    }
    public static var presentationsUnavailableBody: String {
        t("presentations_unavailable_body", "The church removed them. Nothing you did caused this.")
    }
    public static var messagesNotesSegment: String {
        t("messages_notes_segment", "Notes")
    }
    public static var messagesSlidesSegment: String {
        t("messages_slides_segment", "Slides")
    }
    public static var sermonsOfflineTitle: String {
        t("sermons_offline_title", "FaithForm could not reach the server")
    }
    public static var sermonsOfflineBody: String {
        t("sermons_offline_body", "Check your connection and try again.")
    }
    public static var sermonsUnavailableTitle: String {
        t("sermons_unavailable_title", "This is no longer available")
    }
    public static var sermonsUnavailableBody: String {
        t("sermons_unavailable_body", "The church removed it. Nothing you did caused this.")
    }
    public static var sermonsScriptureLabel: String {
        t("sermons_scripture_label", "Scripture")
    }
    public static var sermonsOutlineLabel: String {
        t("sermons_outline_label", "Outline")
    }
    public static var sermonsQuestionsLabel: String {
        t("sermons_questions_label", "Questions for discussion")
    }
    public static var sermonsApplicationLabel: String {
        t("sermons_application_label", "Taking it home")
    }
    public static var sermonsNotesOnly: String {
        t("sermons_notes_only", "This sermon was shared without an outline.")
    }
    public static var sermonsRetry: String {
        t("sermons_retry", "Try again")
    }
    /// The list itself refused (blocked, or a church this account cannot see).
    /// Not "the church removed it": that is only ever true of one sermon.
    public static var sermonsBlockedBody: String {
        t("sermons_blocked_body", "You can't read this church's sermon notes right now.")
    }
    public static var sermonsLoadMoreFailed: String {
        t("sermons_load_more_failed", "More sermon notes couldn't load.")
    }
    public static var sermonsHomeEntryBody: String {
        t("sermons_home_entry_body", "Outlines and discussion questions from past sermons.")
    }
    public static var mediaPlay: String {
        t("media_play", "Play")
    }
    public static var mediaPause: String {
        t("media_pause", "Pause")
    }
    public static var mediaBuffering: String {
        t("media_buffering", "Buffering…")
    }
    public static var mediaResumePrompt: String {
        t("media_resume_prompt", "Resume where you left off")
    }
    public static var mediaStartOver: String {
        t("media_start_over", "Start from the beginning")
    }
    public static var mediaErrorNetwork: String {
        t("media_error_network", "Playback stopped because the connection dropped.")
    }
    public static var mediaErrorUnavailable: String {
        t("media_error_unavailable", "This is no longer available to watch.")
    }
    public static var mediaErrorUnsupported: String {
        t("media_error_unsupported", "This recording cannot be played on this device.")
    }
    public static var mediaErrorUnknown: String {
        t("media_error_unknown", "Playback stopped unexpectedly.")
    }
    public static var mediaDurationLabel: String {
        t("media_duration_label", "Length")
    }
    public static var mediaSpeakerLabel: String {
        t("media_speaker_label", "Speaker")
    }
    public static var mediaSeriesLabel: String {
        t("media_series_label", "Series")
    }
    public static var mediaPlaybackProgress: String {
        t("media_playback_progress", "Playback position")
    }

    // MARK: - Giving (Prompt 11)

    public static var givingTitle: String {
        t("giving_title", "Give")
    }
    public static var givingSubtitle: String {
        t("giving_subtitle", "Choose where your gift goes.")
    }
    public static var givingEmptyTitle: String {
        t("giving_empty_title", "Nothing to give to yet")
    }
    public static var givingEmptyBody: String {
        t("giving_empty_body", "This church has not opened any funds in the app.")
    }
    public static var givingNotAcceptingTitle: String {
        t("giving_not_accepting_title", "Giving is not set up yet")
    }
    public static var givingNotAcceptingBody: String {
        t("giving_not_accepting_body", "This church can't take gifts in the app right now.")
    }
    public static var givingBlockedTitle: String {
        t("giving_blocked_title", "This church is not available to you")
    }
    public static var givingOfflineTitle: String {
        t("giving_offline_title", "FaithForm could not reach the server")
    }
    public static var givingOfflineBody: String {
        t("giving_offline_body", "Check your connection and try again.")
    }
    public static var givingUnavailableBody: String {
        t("giving_unavailable_body", "Giving is unavailable right now. Try again in a few minutes.")
    }
    public static var givingRetry: String {
        t("giving_retry", "Try again")
    }
    public static var givingAmountLabel: String {
        t("giving_amount_label", "Amount")
    }
    public static var givingCustomAmount: String {
        t("giving_custom_amount", "Other amount")
    }
    public static var givingAmountTooLow: String {
        t("giving_amount_too_low", "That's below this fund's minimum.")
    }
    public static var givingAmountTooHigh: String {
        t("giving_amount_too_high", "That's above this fund's maximum.")
    }
    public static var givingAmountInvalid: String {
        t("giving_amount_invalid", "Enter an amount.")
    }
    public static var givingContinue: String {
        t("giving_continue", "Continue")
    }
    public static var givingConfirmTitle: String {
        t("giving_confirm_title", "Check this over")
    }
    public static var givingConfirmChurch: String {
        t("giving_confirm_church", "Church")
    }
    public static var givingConfirmFund: String {
        t("giving_confirm_fund", "Fund")
    }
    public static var givingConfirmAmount: String {
        t("giving_confirm_amount", "Amount")
    }
    public static var givingGiveNow: String {
        t("giving_give_now", "Give")
    }
    public static var givingProcessingTitle: String {
        t("giving_processing_title", "Finishing your gift")
    }
    public static var givingProcessingBody: String {
        t("giving_processing_body", "Stay here for a moment. We'll tell you as soon as it's done.")
    }
    public static var givingStillProcessingBody: String {
        t("giving_still_processing_body", "This is taking longer than usual. Your gift is still going through, and your receipt will arrive when it's done.")
    }
    public static var givingSucceededTitle: String {
        t("giving_succeeded_title", "Thank you")
    }
    public static var givingReceiptTitle: String {
        t("giving_receipt_title", "Receipt")
    }
    public static var givingFailedTitle: String {
        t("giving_failed_title", "That gift didn't go through")
    }
    public static var givingFailedDeclined: String {
        t("giving_failed_declined", "The payment was declined. Nothing was charged.")
    }
    public static var givingFailedNetwork: String {
        t("giving_failed_network", "We couldn't reach the server. Nothing was charged — try again.")
    }
    public static var givingFailedNotAccepting: String {
        t("giving_failed_not_accepting", "This church can't take gifts right now.")
    }
    public static var givingFailedNotAllowed: String {
        t("giving_failed_not_allowed", "That fund or amount is no longer available.")
    }
    public static var givingCancelledTitle: String {
        t("giving_cancelled_title", "Nothing was charged")
    }
    public static var givingHistoryTitle: String {
        t("giving_history_title", "Your giving")
    }
    public static var givingHistoryEmpty: String {
        t("giving_history_empty", "You haven't given here yet.")
    }
    public static var givingHistoryOnlyYours: String {
        t("giving_history_only_yours", "Only your own giving at this church.")
    }
    public static var givingStatusProcessing: String {
        t("giving_status_processing", "Processing")
    }
    public static var givingStatusSucceeded: String {
        t("giving_status_succeeded", "Given")
    }
    public static var givingStatusFailed: String {
        t("giving_status_failed", "Didn't go through")
    }
    public static var givingStatusCancelled: String {
        t("giving_status_cancelled", "Cancelled")
    }
    public static var givingStatusRefunded: String {
        t("giving_status_refunded", "Refunded")
    }
    public static var givingStatusDisputed: String {
        t("giving_status_disputed", "Under review")
    }
    public static var givingRecurringElsewhere: String {
        t("giving_recurring_elsewhere", "Giving every week or month is set up on this church's giving page.")
    }
    public static var givingLoading: String {
        t("giving_loading", "Loading…")
    }
    public static var givingGiveOnline: String {
        t("giving_give_online", "Give online")
    }
    public static var givingWebBody: String {
        t("giving_web_body", "Gifts to this church are made on its giving page, which opens in Safari.")
    }

    // MARK: - App host (Prompt 12)

    public static var tabHome: String {
        t("tab_home", "Home")
    }
    public static var tabChurch: String {
        t("tab_church", "Church")
    }
    public static var tabCheckIn: String {
        t("tab_check_in", "Check in")
    }
    public static var tabWatch: String {
        t("tab_watch", "Services")
    }
    public static var tabGive: String {
        t("tab_give", "Give")
    }
    public static var tabAccount: String {
        t("tab_account", "Account")
    }
    public static var preferencesSection: String {
        t("preferences_section", "Preferences")
    }
    public static var legalSection: String {
        t("legal_section", "Legal")
    }
    public static var homeSubtitle: String {
        t("home_subtitle", "Everything your church has shared with you.")
    }
    public static var noChurchTitle: String {
        t("no_church_title", "No church yet")
    }
    public static var noChurchBody: String {
        t("no_church_body", "Add your church to see what they have shared.")
    }
    public static var churchNoAccess: String {
        t("church_no_access", "You can't see this church's posts right now.")
    }
    public static var checkInEntryBody: String {
        t("check_in_entry_body", "Scan the code your church puts on the screen, or type the short code.")
    }
    public static var mediaEntryBody: String {
        t("media_entry_body", "Join live, catch up on a past service, or open the message.")
    }
    public static var notConfiguredTitle: String {
        t("not_configured_title", "FaithForm isn't set up")
    }
    public static var notConfiguredBody: String {
        t("not_configured_body", "This copy of the app hasn't been pointed at a server yet. Nothing you did caused this.")
    }

    // MARK: - Authentication

    public static var createAccount: String { t("create_account", "Create Account") }
    public static var signIn: String { t("sign_in", "Sign In") }
    public static var authCreateTitle: String {
        t("auth_create_title", "Create your account")
    }
    public static var authCreateBody: String {
        t("auth_create_body", "A few details and you're in with your church.")
    }
    public static var authSignInTitle: String { t("auth_sign_in_title", "Sign in") }
    public static var authSignInBody: String {
        t("auth_sign_in_body", "Welcome back to your church.")
    }
    public static var authNameLabel: String { t("auth_name_label", "Your name") }
    public static var authNameHint: String {
        t("auth_name_hint", "Shown to your church when you join.")
    }
    public static var authEmailLabel: String { t("auth_email_label", "Email") }
    public static var authPasswordLabel: String { t("auth_password_label", "Password") }
    public static var authPasswordHint: String {
        t("auth_password_hint", "At least 8 characters")
    }
    public static var authTermsNotice: String {
        t("auth_terms_notice", "By continuing, you agree to FaithForm's Terms of Service and Privacy Policy.")
    }
    /// The same sentence with the two document names as placeholders, so each
    /// can be a link in any language without guessing where the words fall.
    /// `%1$@` is `terms_of_service`, `%2$@` is `privacy_policy`.
    public static var authTermsNoticeLinked: String {
        t("auth_terms_notice_linked", "By continuing, you agree to FaithForm's %1$@ and %2$@.")
    }
    public static var authForgotPassword: String {
        t("auth_forgot_password", "Forgot password?")
    }
    public static var authResetTitle: String {
        t("auth_reset_title", "Reset your password")
    }
    public static var authResetBody: String {
        t("auth_reset_body", "We'll email a link so you can choose a new password.")
    }
    public static var authResetSend: String {
        t("auth_reset_send", "Email me a reset link")
    }
    public static var authResetSent: String {
        t("auth_reset_sent", "If that email has an account, a reset link is on its way.")
    }
    public static var authCheckEmailTitle: String {
        t("auth_check_email_title", "Check your email")
    }
    public static var authCheckEmailBody: String {
        t("auth_check_email_body", "Confirm your address using the link we sent, then sign in here.")
    }
    public static var authCheckEmailSentTo: String {
        t("auth_check_email_sent_to", "We sent a confirmation link to %@")
    }
    public static var authCheckEmailHint: String {
        t("auth_check_email_hint", "It can take a minute to arrive. Check your spam folder if you don't see it.")
    }
    public static var authCheckEmailOpenMail: String {
        t("auth_check_email_open_mail", "Open Mail")
    }
    public static var authCheckEmailResend: String {
        t("auth_check_email_resend", "Send it again")
    }
    public static var authCheckEmailResent: String {
        t("auth_check_email_resent", "Sent. Check your inbox again.")
    }
    public static var authCheckEmailChangeAddress: String {
        t("auth_check_email_change_address", "Use a different address")
    }
    public static var authErrorEmailInvalid: String {
        t("auth_error_email_invalid", "Enter a valid email address.")
    }
    public static var authErrorNameMissing: String {
        t("auth_error_name_missing", "Enter your name.")
    }
    public static var authErrorPasswordMissing: String {
        t("auth_error_password_missing", "Enter your password.")
    }
    public static var authErrorInvalidCredentials: String {
        t("auth_error_invalid_credentials", "Email or password is incorrect.")
    }
    public static var authErrorAccountExists: String {
        t("auth_error_account_exists", "That email already has an account. Sign in instead.")
    }
    public static var authErrorWeakPassword: String {
        t("auth_error_weak_password", "Choose a longer password — at least 8 characters.")
    }
    public static var authErrorEmailUnconfirmed: String {
        t("auth_error_email_unconfirmed", "Confirm your email first — check your inbox for the link.")
    }
    public static var authErrorRateLimited: String {
        t("auth_error_rate_limited", "Too many attempts. Wait a moment and try again.")
    }
    public static var authErrorOffline: String {
        t("auth_error_offline", "Could not reach FaithForm. Check your connection and try again.")
    }
    public static var authErrorUnconfigured: String {
        t("auth_error_unconfigured", "Sign-in isn't configured for this build.")
    }
    public static var authErrorGeneric: String {
        t("auth_error_generic", "Something went wrong. Try again.")
    }
    public static var authConfirmingEmail: String {
        t("auth_confirming_email", "Confirming your email…")
    }
    public static var authErrorLinkExpired: String {
        t("auth_error_link_expired", "That confirmation link has expired or was already used. Sign in with your email and password.")
    }
    public static var authErrorLinkInvalid: String {
        t("auth_error_link_invalid", "That confirmation link isn't valid. Sign in with your email and password, or create your account again for a fresh link.")
    }

    // MARK: - Invitations

    public static var invitationTitle: String {
        t("invitation_title", "I have a link")
    }
    public static var invitationBody: String {
        t("invitation_body", "Paste the invitation your church sent you.")
    }
    public static var invitationHint: String {
        t("invitation_hint", "From your church's email or bulletin.")
    }
    public static var invitationFieldLabel: String {
        t("invitation_field_label", "Invitation link or code")
    }
    public static var invitationJoining: String {
        t("invitation_joining", "Joining…")
    }
    public static var invitationPendingBanner: String {
        t("invitation_pending_banner", "You have an invitation waiting. Create an account or sign in to use it.")
    }
    public static var invitationErrorInvalid: String {
        t("invitation_error_invalid", "That invitation isn't valid. Check the link and try again.")
    }
    public static var invitationErrorExpired: String {
        t("invitation_error_expired", "This invitation has expired. Ask your church for a new one.")
    }

    // MARK: - Church context

    public static var churchContextInvited: String {
        t("church_context_invited", "You've been invited to join")
    }
    public static var churchContextContinue: String {
        t("church_context_continue", "Continue to")
    }
    public static var churchContextInvitedBody: String {
        t("church_context_invited_body", "Create your account and you'll be in. Already have one? Sign in and the invitation still applies.")
    }
    public static var churchContextContinueBody: String {
        t("church_context_continue_body", "Create your account or sign in, and we'll take you straight there.")
    }
    public static var churchContextJoinTitle: String {
        t("church_context_join_title", "Join %@")
    }
    public static var churchContextNotYours: String {
        t("church_context_not_yours", "Not your church?")
    }
}
