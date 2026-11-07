import SwiftUI
import UIKit
import Testing
import FaithFormKit
@testable import FaithForm

@Suite("Household pickup card width") @MainActor
struct HouseholdPickupLayoutTests {
    @Test("loading, errors and long household details respect narrow screens and accessibility text")
    func constrainedCardWidth() {
        let household = KidsCheckInHousehold(
            id: "family", label: "The Montgomery-Wellington household and extended family",
            pickupCode: "012345",
            children: [.init(id: "child", name: "Alexandria Montgomery-Wellington", roomName: "Preschool and kindergarten classroom", checkedInAt: "2026-11-07T10:00:00Z")],
            alerts: [.init(id: "alert", childName: "Alexandria Montgomery-Wellington", roomName: "Preschool and kindergarten classroom", createdAt: "2026-11-07T10:05:00Z")]
        )
        let states: [(KidsCheckInData?, Bool, String?)] = [
            (nil, true, nil),
            (nil, false, "We couldn’t load your pickup codes. Try again in a moment. If this continues, ask the check-in team for help."),
            (.init(households: []), false, nil),
            (.init(households: [household]), false, nil),
        ]
        // Width after the screen's horizontal gutters, including small iPhones.
        for width: CGFloat in [240, 280, 350] {
            for textSize: DynamicTypeSize in [.large, .accessibility3, .accessibility5] {
                for (data, loading, error) in states {
                    let host = UIHostingController(rootView:
                        HouseholdPickupCard(data: data, isLoading: loading, errorMessage: error, onRefresh: {})
                            .faithformTheme().environment(\.dynamicTypeSize, textSize)
                    )
                    let size = host.sizeThatFits(in: CGSize(width: width, height: 10_000))
                    #expect(size.width <= width + 0.5)
                    #expect(size.height > 0 && size.height.isFinite)
                }
            }
        }
    }
}
