import SwiftUI

/// The FaithForm mark: the F with the gold fold.
///
/// ## Why drawn, not an image
///
/// The only raster of the logo (`public/faithform-logo.png`, and the app icon
/// made from it) is a flattened square on an off-white ground. Placed on the
/// app's own background it shows as a pale box, and in dark mode as a bright
/// one. Drawing the two shapes instead gives a mark with no box at all, sharp
/// at any size, and one whose F can follow the palette.
///
/// The outlines are the ones the Android adaptive icon already uses
/// (`ic_launcher_foreground.xml`), traced from the icon artwork in its own
/// 1024-pixel square, so both platforms draw the identical mark.
///
/// ## Why the F follows `contentPrimary`
///
/// Navy on the dark theme's navy background would disappear. `contentPrimary`
/// is the brand navy in light mode and the warm off-white in dark mode, which
/// keeps the F legible in both while the gold fold — the part people remember —
/// stays gold everywhere.
public struct FaithFormMark: View {
    @Environment(\.faithformTheme) private var theme

    public init() {}

    public var body: some View {
        ZStack {
            MarkShape(part: .letter)
                .fill(theme.palette.contentPrimary)
            MarkShape(part: .fold)
                .fill(
                    LinearGradient(
                        colors: [Self.foldTop, Self.foldPoint],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        }
        .aspectRatio(MarkShape.bounds.width / MarkShape.bounds.height, contentMode: .fit)
    }

    /// Sampled from the icon artwork: the fold's top edge and its point.
    static let foldTop = Color(red: 0xEE / 255, green: 0xC6 / 255, blue: 0x83 / 255)
    static let foldPoint = Color(red: 0xB8 / 255, green: 0x8A / 255, blue: 0x46 / 255)
}

/// One of the mark's two outlines, scaled from the artwork's pixel square into
/// whatever rectangle SwiftUI offers, without distortion.
private struct MarkShape: Shape {
    enum Part { case letter, fold }
    let part: Part

    /// The mark's extent inside the 1024-pixel artwork. Everything outside it
    /// is the icon's padding, which a mark set in a layout should not carry.
    static let bounds = CGRect(x: 321, y: 277, width: 367, height: 425)

    private static let letter: [CGPoint] = [
        (409, 277), (688, 277), (688, 373), (465, 373), (418, 420), (418, 440),
        (595, 440), (498, 537), (418, 537), (418, 702), (321, 702), (321, 365),
    ].map { CGPoint(x: $0.0, y: $0.1) }

    private static let fold: [CGPoint] = [
        (465, 373), (688, 373), (688, 431), (421, 698), (418, 698), (418, 537),
        (498, 537), (595, 440), (418, 440), (418, 420),
    ].map { CGPoint(x: $0.0, y: $0.1) }

    func path(in rect: CGRect) -> Path {
        let bounds = Self.bounds
        let scale = min(rect.width / bounds.width, rect.height / bounds.height)
        // Centred in the offered rectangle, so a frame wider or taller than the
        // mark's proportions pads evenly instead of pinning it to a corner.
        let origin = CGPoint(
            x: rect.midX - bounds.width * scale / 2,
            y: rect.midY - bounds.height * scale / 2
        )
        let points = (part == .letter ? Self.letter : Self.fold).map {
            CGPoint(
                x: origin.x + ($0.x - bounds.minX) * scale,
                y: origin.y + ($0.y - bounds.minY) * scale
            )
        }

        var path = Path()
        path.addLines(points)
        path.closeSubpath()
        return path
    }
}
