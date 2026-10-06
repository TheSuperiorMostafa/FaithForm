import Foundation

/// Display-only verse pagination, leaving the published manifest authoritative.
public enum PresentationReadingPages {
    public static func expand(_ pages: [PresentationPage]) -> [PresentationPage] {
        pages.flatMap { page in
            guard page.kind == "scripture", let body = page.body else { return [page] }
            let source = body as NSString
            let marked = matches(#"[\[(]\d+[\])]"#, in: body)
            let starts: [Int]
            if marked.count > 1, source.substring(to: marked[0].range.location).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                starts = marked.map { $0.range.location }
            } else {
                starts = plainVerseStarts(body: body, reference: page.scripture ?? "")
            }
            guard starts.count > 1 else { return [page] }
            return starts.enumerated().map { index, start in
                let end = index + 1 < starts.count ? starts[index + 1] : source.length
                let verse = source.substring(with: NSRange(location: start, length: end - start)).trimmingCharacters(in: .whitespacesAndNewlines)
                return PresentationPage(id: "\(page.id):verse:\(index)", kind: page.kind, title: page.title,
                                        body: verse, scripture: page.scripture, readingOrder: page.readingOrder)
            }
        }
    }

    // Simple manifests use plain sequential verse numbers. The reference must
    // name a range, and each expected marker must occur exactly once, in order.
    // An ambiguous prose number leaves the original page whole.
    private static func plainVerseStarts(body: String, reference: String) -> [Int] {
        let ranges = matches(#":(\d+)[–-](\d+)\s*$"#, in: reference)
        guard let range = ranges.first else { return [] }
        let ref = reference as NSString
        guard let from = Int(ref.substring(with: range.range(at: 1))),
              let to = Int(ref.substring(with: range.range(at: 2))), to > from, to - from < 64 else { return [] }
        var starts = [0]
        var previous = 0
        if from > 1 && !body.hasPrefix("\(from) ") { return [] }
        for number in (from + 1)...to {
            let found = matches("(?<=\\s)\(number)\\s+", in: body)
            guard found.count == 1, found[0].range.location > previous else { return [] }
            previous = found[0].range.location
            starts.append(previous)
        }
        return starts
    }

    private static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        return expression.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }
}
