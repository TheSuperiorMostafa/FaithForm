import Foundation
import Testing
import UserNotifications
import FaithFormKit
@testable import FaithForm

@MainActor
private final class NotificationResponseTrace {
    var steps: [String] = []
}

@Suite("Notification response completion")
struct NotificationResponseTests {
    @Test("push taps and ignored payloads complete once on the main actor",
          arguments: ["live", "chat", "malformed", "dismissed"])
    @MainActor
    func pushCompletion(kind: String) async {
        let trace = NotificationResponseTrace()
        let responder = AttendanceNotificationResponder(
            handleAttendance: { _ in Issue.record("Push must not perform attendance work") },
            openURL: { trace.steps.append($0.absoluteString) }
        )

        // Reproduce the notification service entering from a worker executor.
        let responseTask = await Task.detached {
            let payload: [AnyHashable: Any]
            switch kind {
            case "chat": payload = ["stream": ["cid": "ff_group:example"]]
            case "malformed": payload = ["faithform": ["deepLink": 42]]
            default: payload = ["faithform": ["deepLink": "faithform://church/grace/watch"]]
            }
            return responder.receive(
                actionIdentifier: kind == "dismissed"
                    ? UNNotificationDismissActionIdentifier : UNNotificationDefaultActionIdentifier,
                categoryIdentifier: "",
                userInfo: payload
            ) {
                // This traps if completion regresses to the worker executor,
                // just like UIKit's snapshot completion in the real crash.
                MainActor.assumeIsolated { trace.steps.append("completed") }
            }
        }.value
        await responseTask.value

        switch kind {
        case "live": #expect(trace.steps == ["faithform://church/grace/watch", "completed"])
        case "chat":
            #expect(trace.steps.count == 2)
            #expect(URL(string: trace.steps[0])?.host == "messages")
            #expect(trace.steps.last == "completed")
        default: #expect(trace.steps == ["completed"])
        }
    }

    @Test("attendance finishes its asynchronous work before completing",
          arguments: [AttendanceNotificationContent.systemDefaultAction,
                      AttendanceNotificationContent.checkInAction,
                      AttendanceNotificationContent.notNowAction])
    @MainActor
    func attendanceCompletion(action: String) async {
        let trace = NotificationResponseTrace()
        let responder = AttendanceNotificationResponder(
            handleAttendance: { _ in
                await Task.yield()
                await MainActor.run { trace.steps.append("handled") }
            },
            openURL: { trace.steps.append($0.absoluteString) }
        )
        let responseTask = await Task.detached {
            responder.receive(
                actionIdentifier: action,
                categoryIdentifier: AttendanceNotificationContent.arrivalCategory,
                userInfo: AttendanceNotificationContent.userInfo(churchSlug: "grace")
            ) {
                MainActor.assumeIsolated { trace.steps.append("completed") }
            }
        }.value
        await responseTask.value
        let expected = action == AttendanceNotificationContent.systemDefaultAction
            ? ["handled", "faithform://church/grace/check-in", "completed"]
            : ["handled", "completed"]
        #expect(trace.steps == expected)
    }
}
