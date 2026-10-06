import Testing
@testable import FaithFormKit

struct PresentationReadingPagesTests {
    @Test func versePaginationPreservesSourceAndNonScripture() {
        let scripture = PresentationPage(id: "source", kind: "scripture", body: "[1] First verse. [2] Second verse.", scripture: "John 1:1–2", readingOrder: ["scripture", "body"])
        let result = PresentationReadingPages.expand([scripture])
        #expect(result.map(\.body) == ["[1] First verse.", "[2] Second verse."])
        #expect(result.map(\.id) == ["source:verse:0", "source:verse:1"])
        #expect(result.allSatisfy { $0.scripture == scripture.scripture })
        let note = PresentationPage(id: "note", kind: "content", body: "(1) First point (2) Second point", readingOrder: ["body"])
        #expect(PresentationReadingPages.expand([note]) == [note])
    }
    @Test func simpleManifestUsesReferenceBoundedPlainMarkers() {
        let source = PresentationPage(id: "simple", kind: "scripture", body: "In the beginning. 2 The earth was without form. 3 God said, Let there be light.", scripture: "Genesis 1:1–3", readingOrder: ["scripture", "body"])
        #expect(PresentationReadingPages.expand([source]).map(\.body) == ["In the beginning.", "2 The earth was without form.", "3 God said, Let there be light."])
        let prose = PresentationPage(id: "prose", kind: "scripture", body: "He fasted 40 days. 2 Then he returned.", scripture: "Luke 4:1–2", readingOrder: ["body"])
        #expect(PresentationReadingPages.expand([prose]).count == 2)
        let ambiguous = PresentationPage(id: "ambiguous", kind: "scripture", body: "He had 2 sons. 2 Then he returned.", scripture: "Luke 4:1–2", readingOrder: ["body"])
        #expect(PresentationReadingPages.expand([ambiguous]) == [ambiguous])
    }

}
