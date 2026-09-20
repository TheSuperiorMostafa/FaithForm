import SwiftUI
import PhotosUI
import ImageIO
import UIKit
import FaithFormKit

// MARK: - Crop geometry

/// The crop maths, kept out of the view so it can be reasoned about — and
/// tested — without a screen.
///
/// The model is the one the Photos app uses and that `benedom/SwiftyCrop`
/// writes down (https://github.com/benedom/SwiftyCrop): the picked photo is
/// laid out **aspect-fit** inside the editor, a fixed mask sits centred on top,
/// and `scale` starts at whatever makes the photo just cover that mask. Pan is
/// measured in **view points** and clamped to the overhang on each axis, so the
/// mask can never see past an edge and one point of finger travel moves the
/// photo by exactly one point.
///
/// The version this replaces stored pan as a fraction (-1…1) of the overhang.
/// At 1× the overhang on the fitting axis is *zero*, so that axis had nothing
/// to be a fraction of: the first pixel of a drag divided by ~0, slammed to the
/// limit, and the photo jumped to a corner. Points have no such axis, which is
/// the whole reason for the rewrite.
struct ProfileCrop: Equatable {
    /// The photo as laid out on screen before zoom: aspect-fit, in view points.
    var imageSize: CGSize
    /// The crop window, centred in the same space.
    var maskSize: CGSize
    /// 1 is not the floor — `minimumScale` is. See `clamped()`.
    var scale: CGFloat
    /// Pan in view points, positive meaning the photo moved right and down.
    var offset: CGSize

    init(imageSize: CGSize = .zero, maskSize: CGSize = .zero, scale: CGFloat = 1, offset: CGSize = .zero) {
        self.imageSize = imageSize
        self.maskSize = maskSize
        self.scale = scale
        self.offset = offset
    }

    /// Lays a photo out aspect-fit inside `container` and centres a mask of
    /// `aspect` in it, leaving room for the controls that float over the edges.
    static func fitting(image: CGSize, in container: CGSize, aspect: CGFloat, inset: CGFloat) -> ProfileCrop {
        guard image.width > 0, image.height > 0, container.width > 0, container.height > 0 else {
            return ProfileCrop()
        }
        let fit = min(container.width / image.width, container.height / image.height)
        let imageSize = CGSize(width: image.width * fit, height: image.height * fit)

        // The mask is as large as the shorter free dimension allows. `inset`
        // is the room the floating toolbars need above and below it.
        let availableWidth = max(80, container.width - inset * 2)
        let availableHeight = max(80, container.height - inset * 2)
        let maskWidth = min(availableWidth, availableHeight * aspect)
        let maskSize = CGSize(width: maskWidth, height: maskWidth / aspect)

        return ProfileCrop(imageSize: imageSize, maskSize: maskSize, scale: 1, offset: .zero).clamped()
    }

    /// The smallest zoom that still covers the mask. Below it the crop would
    /// include pixels the photo does not have, so it is the floor, not 1.
    var minimumScale: CGFloat {
        guard imageSize.width > 0, imageSize.height > 0 else { return 1 }
        return max(maskSize.width / imageSize.width, maskSize.height / imageSize.height)
    }

    /// Relative to the floor, so "6×" means the same amount of detail whatever
    /// shape the photo was.
    var maximumScale: CGFloat { minimumScale * 6 }

    /// How far the photo may travel before an edge would enter the mask.
    var panLimit: CGSize {
        CGSize(
            width: max(0, (imageSize.width * scale - maskSize.width) / 2),
            height: max(0, (imageSize.height * scale - maskSize.height) / 2)
        )
    }

    /// `scale` inside its range, then `offset` inside the overhang that scale
    /// leaves. Order matters: zooming out shrinks the overhang, and the pan has
    /// to follow it in or the mask shows a corner.
    func clamped() -> ProfileCrop {
        var copy = self
        copy.scale = min(max(scale, minimumScale), maximumScale)
        let limit = copy.panLimit
        copy.offset = CGSize(
            width: min(max(offset.width, -limit.width), limit.width),
            height: min(max(offset.height, -limit.height), limit.height)
        )
        return copy
    }

    /// Where `0` is fully zoomed out and `1` fully in — what the slider rides on.
    var zoomFraction: CGFloat {
        get {
            let span = maximumScale - minimumScale
            guard span > 0 else { return 0 }
            return min(max((scale - minimumScale) / span, 0), 1)
        }
        set { scale = minimumScale + (maximumScale - minimumScale) * min(max(newValue, 0), 1) }
    }

    /// The region of the *original* photo the mask is showing, in its own pixels.
    ///
    /// `factor` converts view points back to source pixels. Because the layout
    /// was aspect-fit, width and height share one factor; taking the smaller of
    /// the two is only defensive against a rounding difference.
    func cropRect(in source: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, scale > 0,
              source.width > 0, source.height > 0 else { return .zero }

        let factor = min(source.width / imageSize.width, source.height / imageSize.height)
        let size = CGSize(
            width: maskSize.width * factor / scale,
            height: maskSize.height * factor / scale
        )
        let origin = CGPoint(
            x: source.width / 2 - size.width / 2 - offset.width * factor / scale,
            y: source.height / 2 - size.height / 2 - offset.height * factor / scale
        )
        // Rounding at the seams can put the rect a hair outside the bitmap,
        // and `CGImage.cropping` answers nil for a rect that is not contained.
        return CGRect(origin: origin, size: size)
            .integral
            .intersection(CGRect(origin: .zero, size: source))
    }
}

// MARK: - Rendering

/// The size a finished profile photo is uploaded at. Square avatars are shown
/// no larger than a header; a 16:9 cover is a banner and needs the width.
private func outputSize(for aspect: CGFloat) -> CGSize {
    aspect == 1 ? CGSize(width: 512, height: 512) : CGSize(width: 1280, height: 1280 / aspect)
}

/// Cuts `crop` out of `image` and encodes it as the JPEG that gets uploaded.
///
/// Not main-actor bound: the cropper runs it on a background task so a large
/// photo does not freeze the Save button while it encodes.
func renderProfilePhoto(_ image: UIImage, crop: ProfileCrop, aspect: CGFloat = 1) -> Data? {
    guard let source = image.upOriented?.cgImage else { return nil }
    let sourceSize = CGSize(width: source.width, height: source.height)
    let rect = crop.cropRect(in: sourceSize)
    guard rect.width >= 1, rect.height >= 1, let cut = source.cropping(to: rect) else { return nil }

    let output = outputSize(for: aspect)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let rendered = UIGraphicsImageRenderer(size: output, format: format).image { context in
        // Opaque output, so a photo with alpha lands on white rather than black.
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: output))
        UIImage(cgImage: cut).draw(in: CGRect(origin: .zero, size: output))
    }
    return rendered.jpegData(compressionQuality: 0.9)
}

extension UIImage {
    /// A copy whose pixels are in reading order, so `CGImage` crop rects mean
    /// what they say. An image already `.up` is returned untouched.
    var upOriented: UIImage? {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

// MARK: - Picking

/// System picker grants access only to the chosen photo. Nothing leaves the
/// phone until Save.
struct ProfilePhotoPicker: ViewModifier {
    @Binding var draft: PhotoDraft?
    @Binding var failed: Bool
    @Binding var loading: Bool
    @Binding var isPresented: Bool
    @State private var selection: PhotosPickerItem?

    func body(content: Content) -> some View {
        content
            .photosPicker(isPresented: $isPresented, selection: $selection, matching: .images, preferredItemEncoding: .compatible)
            .task(id: selection) {
                guard let selection else { return }
                loading = true
                failed = false
                do {
                    guard let data = try await selection.loadTransferable(type: Data.self),
                          data.count <= 40_000_000 else { throw PhotoFailure.unreadable }
                    let image = try await Task.detached(priority: .userInitiated) {
                        try decodeProfilePhoto(data)
                    }.value
                    try Task.checkCancellation()
                    draft = PhotoDraft(image: image)
                } catch {
                    if !Task.isCancelled { failed = true }
                }
                loading = false
                self.selection = nil
            }
    }
}

struct PhotoDraft: Identifiable {
    let id = UUID()
    let image: UIImage
}

private enum PhotoFailure: Error { case unreadable }

private func decodeProfilePhoto(_ data: Data) throws -> UIImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2048,
            kCGImageSourceShouldCacheImmediately: true
          ] as CFDictionary) else { throw PhotoFailure.unreadable }
    return UIImage(cgImage: image)
}

// MARK: - The editor

/// Full-screen, black, and edge to edge: a photo editor, not a form.
///
/// The photo fills the screen under floating controls, the mask is a hole cut
/// in a scrim rather than a framed thumbnail, and every adjustment is a gesture
/// first — drag to move, pinch to zoom, double tap to fill. The slider and the
/// rotate button exist because a gesture is not reachable for everyone, not as
/// the primary way in.
struct ProfilePhotoCropper: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State var image: UIImage
    let save: (Data) async -> Bool
    var aspect: CGFloat = 1
    var circular = true
    var title = "Your photo"
    var footnote = "Visible to people you meet in FaithForm."

    @State private var crop = ProfileCrop()
    @State private var container: CGSize = .zero
    @State private var gestureStart: ProfileCrop?
    @State private var interacting = false
    @State private var working = false
    @State private var failed = false

    /// Room for the floating bars, so the mask is never under one of them.
    private var maskInset: CGFloat { 34 }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            canvas
            controls
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .interactiveDismissDisabled(working)
    }

    // MARK: Canvas

    private var canvas: some View {
        GeometryReader { geometry in
            ZStack {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: crop.imageSize.width, height: crop.imageSize.height)
                    .scaleEffect(crop.scale)
                    .offset(crop.offset)
                CropMaskOverlay(maskSize: crop.maskSize, circular: circular, showsGuides: interacting)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(drag)
            .simultaneousGesture(magnify)
            .onTapGesture(count: 2) { toggleZoom() }
            .onAppear { layout(in: geometry.size) }
            .onChange(of: geometry.size) { _, size in layout(in: size) }
            .onChange(of: image) { _, _ in layout(in: geometry.size) }
            .accessibilityElement()
            .accessibilityLabel("\(title) crop")
            .accessibilityValue("Zoom \(Int(crop.zoomFraction * 100)) percent")
            .accessibilityHint("Adjustable. Swipe up or down to zoom, then use the move actions.")
            .accessibilityAdjustableAction { direction in
                nudgeZoom(by: direction == .increment ? 0.1 : -0.1)
            }
            .accessibilityAction(named: "Move photo left") { nudge(x: -40) }
            .accessibilityAction(named: "Move photo right") { nudge(x: 40) }
            .accessibilityAction(named: "Move photo up") { nudge(y: -40) }
            .accessibilityAction(named: "Move photo down") { nudge(y: 40) }
            .accessibilityAction(named: "Reset crop") { reset() }
        }
        .ignoresSafeArea()
        .allowsHitTesting(!working)
    }

    // MARK: Floating controls

    private var controls: some View {
        VStack(spacing: 0) {
            topBar
            Spacer(minLength: 0)
            bottomBar
        }
    }

    private var topBar: some View {
        HStack {
            GlassIconButton(symbol: "xmark", label: "Cancel") { dismiss() }
            Spacer()
            VStack(spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text("Drag to move · pinch to zoom")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.62))
            }
            .foregroundStyle(.white)
            .accessibilityHidden(true)
            Spacer()
            GlassIconButton(symbol: "rotate.right", label: "Rotate 90 degrees") { rotate() }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 22)
        .background(
            LinearGradient(colors: [.black.opacity(0.72), .clear], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
        .disabled(working)
    }

    private var bottomBar: some View {
        VStack(spacing: 18) {
            if failed {
                Label("Couldn’t save that photo. Your crop is still here — try again.", systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.red.opacity(0.85), in: Capsule())
                    .accessibilityAddTraits(.updatesFrequently)
            }

            HStack(spacing: 14) {
                Image(systemName: "photo")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityHidden(true)
                Slider(
                    value: Binding(
                        get: { crop.zoomFraction },
                        set: { value in
                            var next = crop
                            next.zoomFraction = value
                            crop = next.clamped()
                        }
                    ),
                    in: 0...1
                ) { Text("Zoom") }
                .tint(theme.palette.brandAccent)
                .accessibilityValue("\(Int(crop.zoomFraction * 100)) percent")
                Image(systemName: "photo.fill")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())

            HStack(spacing: 12) {
                Button("Reset") { reset() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
                    .padding(.horizontal, 20)
                    .background(.white.opacity(0.14), in: Capsule())

                Button {
                    commit()
                } label: {
                    HStack(spacing: 8) {
                        if working { ProgressView().tint(theme.palette.brandPrimary) }
                        Text(working ? "Saving…" : "Use photo")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
                    .foregroundStyle(theme.palette.brandPrimary)
                    .background(theme.palette.brandAccent, in: Capsule())
                }
                .disabled(working)
            }

            Text(footnote)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.55))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 14)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.82)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: Gestures

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                let start = gestureStart ?? crop
                if gestureStart == nil { gestureStart = crop; interacting = true }
                var next = crop
                next.offset = CGSize(
                    width: start.offset.width + value.translation.width,
                    height: start.offset.height + value.translation.height
                )
                crop = next.clamped()
            }
            .onEnded { _ in endGesture() }
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = gestureStart ?? crop
                if gestureStart == nil { gestureStart = crop; interacting = true }
                var next = crop
                next.scale = start.scale * value.magnification
                // Pan rides the zoom, so the point under the fingers stays put
                // instead of sliding towards the centre as the photo grows.
                let ratio = next.clamped().scale / start.scale
                next.offset = CGSize(width: start.offset.width * ratio, height: start.offset.height * ratio)
                crop = next.clamped()
            }
            .onEnded { _ in endGesture() }
    }

    private func endGesture() {
        gestureStart = nil
        withAnimation(theme.animation(FaithFormTokens.Motion.fast)) {
            interacting = false
            crop = crop.clamped()
        }
    }

    // MARK: Actions

    private func layout(in size: CGSize) {
        container = size
        let fresh = ProfileCrop.fitting(image: image.size, in: size, aspect: aspect, inset: maskInset)
        // A rotation or a resize keeps the person's zoom where it can survive;
        // a first layout starts filled.
        guard crop.imageSize != .zero else { crop = fresh; return }
        var next = fresh
        next.scale = crop.scale
        next.offset = crop.offset
        crop = next.clamped()
    }

    private func reset() {
        withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
            crop = ProfileCrop.fitting(image: image.size, in: container, aspect: aspect, inset: maskInset)
        }
    }

    private func toggleZoom() {
        withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
            var next = crop
            next.scale = crop.zoomFraction > 0.05 ? crop.minimumScale : crop.minimumScale * 2
            if next.scale == next.minimumScale { next.offset = .zero }
            crop = next.clamped()
        }
    }

    private func nudgeZoom(by delta: CGFloat) {
        var next = crop
        next.zoomFraction = crop.zoomFraction + delta
        crop = next.clamped()
    }

    private func nudge(x: CGFloat = 0, y: CGFloat = 0) {
        var next = crop
        next.offset = CGSize(width: crop.offset.width + x, height: crop.offset.height + y)
        withAnimation(theme.animation(FaithFormTokens.Motion.fast)) { crop = next.clamped() }
    }

    /// Quarter turns are done to the bitmap rather than carried as an angle, so
    /// the crop maths only ever sees an upright photo.
    private func rotate() {
        let size = CGSize(width: image.size.height, height: image.size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let turned = UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.translateBy(x: size.width / 2, y: size.height / 2)
            context.cgContext.rotate(by: .pi / 2)
            image.draw(in: CGRect(
                x: -image.size.width / 2, y: -image.size.height / 2,
                width: image.size.width, height: image.size.height
            ))
        }
        withAnimation(theme.animation(FaithFormTokens.Motion.fast)) {
            image = turned
            crop = ProfileCrop.fitting(image: turned.size, in: container, aspect: aspect, inset: maskInset)
        }
    }

    private func commit() {
        let snapshot = crop
        let source = image
        let ratio = aspect
        Task {
            working = true
            failed = false
            let data = await Task.detached(priority: .userInitiated) {
                renderProfilePhoto(source, crop: snapshot, aspect: ratio)
            }.value
            if let data, await save(data) {
                working = false
                dismiss()
            } else {
                working = false
                failed = true
            }
        }
    }
}

/// The mask: a hole cut in a scrim, a hairline ring, and — only while a finger
/// is down — thirds guides inside it. Nothing frames the photo when it is still.
private struct CropMaskOverlay: View {
    let maskSize: CGSize
    let circular: Bool
    let showsGuides: Bool

    var body: some View {
        GeometryReader { geometry in
            let rect = CGRect(
                x: (geometry.size.width - maskSize.width) / 2,
                y: (geometry.size.height - maskSize.height) / 2,
                width: maskSize.width,
                height: maskSize.height
            )
            ZStack {
                Path { path in
                    path.addRect(CGRect(origin: .zero, size: geometry.size))
                    if circular { path.addEllipse(in: rect) }
                    else { path.addRoundedRect(in: rect, cornerSize: CGSize(width: 14, height: 14)) }
                }
                .fill(.black.opacity(0.66), style: FillStyle(eoFill: true))

                maskOutline
                    .stroke(.white.opacity(0.9), lineWidth: 1.5)
                    .frame(width: rect.width, height: rect.height)
                    .position(x: rect.midX, y: rect.midY)

                if showsGuides {
                    Guides()
                        .stroke(.white.opacity(0.4), lineWidth: 0.6)
                        .frame(width: rect.width, height: rect.height)
                        // Clipped to the mask so the lines stop at the circle
                        // rather than running out across the dimmed photo.
                        .clipShape(maskOutline)
                        .position(x: rect.midX, y: rect.midY)
                        .transition(.opacity)
                }
            }
            .allowsHitTesting(false)
        }
        .accessibilityHidden(true)
    }

    private var maskOutline: AnyShape {
        circular ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    /// Rule-of-thirds lines, the cue every camera app uses for "this is where
    /// the crop lands".
    private struct Guides: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            for step in 1...2 {
                let fraction = CGFloat(step) / 3
                path.move(to: CGPoint(x: rect.minX, y: rect.minY + rect.height * fraction))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * fraction))
                path.move(to: CGPoint(x: rect.minX + rect.width * fraction, y: rect.minY))
                path.addLine(to: CGPoint(x: rect.minX + rect.width * fraction, y: rect.maxY))
            }
            return path
        }
    }
}

/// A round, frosted button — legible over any photo without a solid plate.
private struct GlassIconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: FaithFormTokens.TouchTarget.minimum, height: FaithFormTokens.TouchTarget.minimum)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
        }
        .accessibilityLabel(label)
    }
}

// MARK: - Branding photos

/// Group and church artwork: same editor, a rectangular mask where the image is
/// a banner, and a tighter upload budget than an avatar.
struct BrandingPhotoControl: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    let aspect: CGFloat
    let hasPhoto: Bool
    let save: (Data?) async -> Bool

    @State private var draft: PhotoDraft?
    @State private var picking = false
    @State private var loading = false
    @State private var busy = false
    @State private var failed = false
    @State private var confirmRemoval = false

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            HStack(spacing: FaithFormTokens.Spacing.md) {
                Button { picking = true } label: {
                    Label(hasPhoto ? "Change \(title)" : "Add \(title)", systemImage: "photo.badge.plus")
                }
                .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                .disabled(busy || loading)

                if hasPhoto {
                    Button("Remove", role: .destructive) { confirmRemoval = true }
                        .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                        .disabled(busy || loading)
                }
            }
            if loading || busy {
                Text(loading ? "Preparing photo…" : "Saving…")
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
            if failed {
                Text("The photo was not changed. Please try again.")
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.destructive)
            }
        }
        .modifier(ProfilePhotoPicker(draft: $draft, failed: $failed, loading: $loading, isPresented: $picking))
        .confirmationDialog("Remove \(title)?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) {
                Task { busy = true; failed = !(await save(nil)); busy = false }
            }
        }
        .fullScreenCover(item: $draft) { draft in
            ProfilePhotoCropper(
                image: draft.image,
                save: { data in
                    // A banner at 1280 wide still has to fit the upload budget.
                    guard data.count <= 1_000_000 else { return false }
                    return await save(data)
                },
                aspect: aspect,
                circular: false,
                title: title.capitalizedFirst,
                footnote: "This image appears on the group or church profile."
            )
        }
    }
}

private extension String {
    var capitalizedFirst: String {
        guard let first else { return self }
        return String(first).uppercased() + dropFirst()
    }
}

/// The church cover is the one branding image that is genuinely a banner, so
/// it keeps a wide preview. Logos — church and group alike — are square.
struct BrandingCoverPreview: View {
    @Environment(\.faithformTheme) private var theme
    let url: String?

    var body: some View {
        ZStack {
            theme.palette.surfaceSunken
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { image in image.resizable().scaledToFill() } placeholder: { Color.clear }
            } else {
                Image(systemName: "photo")
                    .font(.system(size: 28, weight: .ultraLight))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
        )
        .accessibilityHidden(true)
    }
}

struct BrandingPhotoBody: Encodable, Sendable {
    let imageBase64: String?
    enum CodingKeys: String, CodingKey { case imageBase64 }
    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let imageBase64 { try container.encode(imageBase64, forKey: .imageBase64) }
        else { try container.encodeNil(forKey: .imageBase64) }
    }
}
