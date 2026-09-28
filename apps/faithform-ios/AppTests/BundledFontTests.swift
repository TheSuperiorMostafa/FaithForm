import FaithFormKit
import Testing

@Suite("Bundled type in the iPhone app")
struct BundledFontTests {
    @Test("Montserrat and Nunito register for the running app")
    func fontsResolve() {
        #expect(FaithFormFonts.isAvailable)
    }
}
