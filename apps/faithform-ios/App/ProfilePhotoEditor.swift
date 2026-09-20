import SwiftUI
import PhotosUI
import ImageIO
import UIKit

/// System picker grants access only to the chosen photo. Nothing leaves the phone until Save.
struct ProfilePhotoControl: View {
    let root: RootModel
    let hasPhoto: Bool
    @State private var selection: PhotosPickerItem?
    @State private var draft: PhotoDraft?
    @State private var loading = false
    @State private var failed = false
    @State private var removing = false
    @State private var confirmRemoval = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                PhotosPicker(selection: $selection, matching: .images, preferredItemEncoding: .compatible) {
                    Label(hasPhoto ? "Change photo" : "Add profile photo", systemImage: "photo")
                        .frame(minHeight: 44)
                }
                .disabled(loading || removing)
                if hasPhoto {
                    Button("Remove", role: .destructive) { confirmRemoval = true }
                        .frame(minHeight: 44).disabled(loading || removing)
                }
                if loading || removing { ProgressView() }
            }
            if failed { Text("Your photo was not changed. Please try again.").foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
        }
        .confirmationDialog("Remove profile photo?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) {
                Task {
                    removing = true
                    failed = !(await root.updateProfilePhoto(nil))
                    removing = false
                }
            }
        }
        .task(id: selection) {
            guard let selection else { return }
            loading = true
            failed = false
            do {
                guard let data = try await selection.loadTransferable(type: Data.self),
                      data.count <= 40_000_000 else { throw PhotoFailure.unreadable }
                let image = try await Task.detached(priority: .userInitiated) { try decodeProfilePhoto(data) }.value
                try Task.checkCancellation()
                draft = PhotoDraft(image: image)
            } catch { if !Task.isCancelled { failed = true } }
            loading = false
            self.selection = nil
        }
        .fullScreenCover(item: $draft) { draft in
            ProfilePhotoCropper(image: draft.image) { data in await root.updateProfilePhoto(data) }
        }
    }
}

private struct PhotoDraft: Identifiable {
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

struct ProfilePhotoCropper: View {
    @Environment(\.dismiss) private var dismiss
    @State var image: UIImage
    let save: (Data) async -> Bool
    var aspect: CGFloat = 1
    var circular = true
    var title = "Edit profile photo"
    @State private var zoom: CGFloat = 1
    @State private var x: CGFloat = 0
    @State private var y: CGFloat = 0
    @State private var dragOrigin: CGSize?
    @State private var zoomOrigin: CGFloat?
    @State private var working = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text("Drag to reposition. Pinch or use the slider to zoom.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    GeometryReader { geometry in
                        let side = geometry.size.width
                        let frameHeight = side / aspect
                        let scale = max(side / image.size.width, frameHeight / image.size.height) * zoom
                        let width = image.size.width * scale
                        let height = image.size.height * scale
                        ZStack {
                            Image(uiImage: image).resizable()
                                .frame(width: width, height: height)
                                .offset(x: x * (width - side) / 2, y: y * (height - frameHeight) / 2)
                            if circular {
                            Path { path in
                                path.addRect(CGRect(x: 0, y: 0, width: side, height: side))
                                path.addEllipse(in: CGRect(x: 0, y: 0, width: side, height: side))
                            }.fill(.black.opacity(0.6), style: FillStyle(eoFill: true))
                            Circle().strokeBorder(.white, lineWidth: 2)
                            } else { Rectangle().strokeBorder(.white, lineWidth: 2) }
                        }
                        .frame(width: side, height: frameHeight).clipped().contentShape(Rectangle())
                        .gesture(DragGesture().onChanged { value in
                            if dragOrigin == nil { dragOrigin = CGSize(width: x, height: y) }
                            x = clamp((dragOrigin?.width ?? 0) + value.translation.width / max(1, (width - side) / 2))
                            y = clamp((dragOrigin?.height ?? 0) + value.translation.height / max(1, (height - frameHeight) / 2))
                        }.onEnded { _ in dragOrigin = nil })
                        .simultaneousGesture(MagnifyGesture().onChanged { value in
                            if zoomOrigin == nil { zoomOrigin = zoom }
                            zoom = min(4, max(1, (zoomOrigin ?? 1) * value.magnification))
                        }.onEnded { _ in zoomOrigin = nil })
                        .accessibilityLabel("Profile photo crop preview")
                        .accessibilityHint("Use the zoom and position controls below to adjust the crop.")
                    }.aspectRatio(aspect, contentMode: .fit)
                    Slider(value: $zoom, in: 1...4) { Text("Zoom") }
                        .accessibilityValue(String(format: "%.0f percent", zoom * 100))
                    DisclosureGroup("Adjust position") {
                        Text("Horizontal position")
                        Slider(value: $x, in: -1...1) { Text("Horizontal position") }
                        Text("Vertical position")
                        Slider(value: $y, in: -1...1) { Text("Vertical position") }
                    }
                    HStack {
                        Button { rotate() } label: { Label("Rotate", systemImage: "rotate.right") }.frame(minHeight: 44)
                        Spacer()
                        Button("Reset") { reset() }.frame(minHeight: 44)
                    }
                    Text(circular ? "Your profile photo is visible to people you interact with in FaithForm." : "This image appears on the group or church profile.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if failed { Text("Could not save your photo. Your crop is ready to try again.").foregroundStyle(.red) }
                    if working { Text("Saving photo…").accessibilityAddTraits(.updatesFrequently) }
                }.padding().frame(maxWidth: 480).frame(maxWidth: .infinity)
                    .disabled(working)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let data = croppedJPEG()
                        Task {
                            working = true
                            failed = false
                            if let data, await save(data) { dismiss() } else { failed = true }
                            working = false
                        }
                    }.disabled(working)
                }
            }
            .interactiveDismissDisabled(working)
        }
    }

    private func clamp(_ value: CGFloat) -> CGFloat { min(1, max(-1, value)) }
    private func reset() { zoom = 1; x = 0; y = 0; dragOrigin = nil; zoomOrigin = nil }
    private func rotate() {
        let size = CGSize(width: image.size.height, height: image.size.width)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.translateBy(x: size.width / 2, y: size.height / 2)
            context.cgContext.rotate(by: .pi / 2)
            image.draw(in: CGRect(x: -image.size.width / 2, y: -image.size.height / 2, width: image.size.width, height: image.size.height))
        }
        reset()
    }
    private func croppedJPEG() -> Data? {
        renderProfilePhoto(image, zoom: zoom, x: x, y: y, aspect: aspect)
    }
}

@MainActor
func renderProfilePhoto(_ image: UIImage, zoom: CGFloat, x: CGFloat, y: CGFloat, aspect: CGFloat = 1) -> Data? {
    let side: CGFloat = aspect == 1 ? 512 : 1280
    let frameHeight = side / aspect
    let scale = max(side / image.size.width, frameHeight / image.size.height) * zoom
    let width = image.size.width * scale, height = image.size.height * scale
    let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: frameHeight), format: format).image { _ in
        UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: side, height: frameHeight))
        image.draw(in: CGRect(x: (side - width) / 2 + x * (width - side) / 2,
                              y: (frameHeight - height) / 2 + y * (height - frameHeight) / 2,
                              width: width, height: height))
    }.jpegData(compressionQuality: 0.85)
}


/// Shared group/church picker; cropping and compression happen before upload.
struct BrandingPhotoControl: View {
    let title: String
    let aspect: CGFloat
    let hasPhoto: Bool
    let save: (Data?) async -> Bool
    @State private var selection: PhotosPickerItem?
    @State private var draft: PhotoDraft?
    @State private var busy = false
    @State private var failed = false
    @State private var confirmRemoval = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PhotosPicker(selection: $selection, matching: .images, preferredItemEncoding: .compatible) {
                Label(hasPhoto ? "Change \(title)" : "Add \(title)", systemImage: "photo")
            }.disabled(busy)
            if hasPhoto { Button("Remove \(title)", role: .destructive) { confirmRemoval = true }.disabled(busy) }
            if busy { Text("Preparing photo…").font(.footnote) }
            if failed { Text("The photo was not changed. Please try again.").foregroundStyle(.red) }
        }
        .confirmationDialog("Remove \(title)?", isPresented: $confirmRemoval) {
            Button("Remove photo", role: .destructive) { Task { busy = true; failed = !(await save(nil)); busy = false } }
        }
        .task(id: selection) {
            guard let selection else { return }
            busy = true; failed = false
            do {
                guard let data = try await selection.loadTransferable(type: Data.self), data.count <= 40_000_000 else { throw PhotoFailure.unreadable }
                let image = try await Task.detached(priority: .userInitiated) { try decodeProfilePhoto(data) }.value
                try Task.checkCancellation()
                draft = PhotoDraft(image: image)
            } catch { if !Task.isCancelled { failed = true } }
            busy = false; self.selection = nil
        }
        .fullScreenCover(item: $draft) { draft in
            ProfilePhotoCropper(image: draft.image, save: { data in
                guard data.count <= 1_000_000 else { return false }
                return await save(data)
            }, aspect: aspect, circular: false, title: "Edit \(title)")
        }
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
