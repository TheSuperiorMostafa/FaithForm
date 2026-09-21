import SwiftUI
import Testing
@testable import FaithForm

@Suite("Window content isolation")
struct WindowContentTests {
    @Test("the lazy window factory can run on SwiftUI's background renderer")
    @MainActor
    func backgroundFactory() async {
        let factory = windowContentFactory(Text("FaithForm"))
        let rendered = await Task.detached {
            _ = factory()
            return true
        }.value
        #expect(rendered)
    }
}
