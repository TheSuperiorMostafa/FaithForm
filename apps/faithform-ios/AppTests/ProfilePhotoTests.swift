import Testing
import UIKit
@testable import FaithForm

@Suite("Profile photo crop")
@MainActor
struct ProfilePhotoTests {

    // MARK: Geometry

    @Test("A fresh crop covers the mask and starts centred")
    func fittingCoversTheMask() {
        // A wide photo in a tall editor: the fit leaves it shorter than a
        // square mask, so the opening zoom has to be above 1 to cover it.
        let crop = ProfileCrop.fitting(
            image: CGSize(width: 2000, height: 600),
            in: CGSize(width: 390, height: 700),
            aspect: 1,
            inset: 34
        )
        #expect(crop.offset == .zero)
        #expect(crop.scale == crop.minimumScale)
        #expect(crop.imageSize.width * crop.scale >= crop.maskSize.width - 0.01)
        #expect(crop.imageSize.height * crop.scale >= crop.maskSize.height - 0.01)
    }

    @Test("Pan is clamped to the overhang, never past an edge")
    func panStopsAtTheEdge() {
        var crop = ProfileCrop(
            imageSize: CGSize(width: 400, height: 200),
            maskSize: CGSize(width: 200, height: 200),
            scale: 1,
            offset: CGSize(width: 9_000, height: 9_000)
        )
        crop = crop.clamped()
        // 100pt of slack across, none at all vertically: the photo is exactly
        // as tall as the mask. The old model divided by that zero.
        #expect(crop.offset.width == 100)
        #expect(crop.offset.height == 0)
    }

    @Test("Zooming out pulls an extreme pan back inside the photo")
    func zoomingOutRecoversThePan() {
        // Floor 0.5x, so the ceiling is 3x and a request for 4x lands there:
        // 400 * 3 = 1200 wide against a 200 mask leaves 500 of slack.
        var crop = ProfileCrop(
            imageSize: CGSize(width: 400, height: 400),
            maskSize: CGSize(width: 200, height: 200),
            scale: 4,
            offset: CGSize(width: 900, height: 900)
        ).clamped()
        #expect(crop.scale == 3)
        #expect(crop.offset.width == 500)

        crop.scale = 1
        crop = crop.clamped()
        #expect(crop.offset.width == 100)
        #expect(crop.offset.height == 100)
    }

    @Test("The rubber band gives past the edge but never runs free")
    func rubberBandResists() {
        let base = ProfileCrop(
            imageSize: CGSize(width: 400, height: 200),
            maskSize: CGSize(width: 200, height: 200),
            scale: 1,
            offset: CGSize(width: 300, height: 0)
        )
        let banded = base.rubberBanded()
        // Past the 100pt limit it keeps moving, but nowhere near the 300 asked
        // for, and always further out than the hard clamp would allow.
        #expect(banded.offset.width > 100)
        #expect(banded.offset.width < 200)

        // Twice as far past the edge does not move it twice as far.
        var harder = base
        harder.offset = CGSize(width: 600, height: 0)
        let bandedHarder = harder.rubberBanded()
        #expect(bandedHarder.offset.width > banded.offset.width)
        #expect(bandedHarder.offset.width - 100 < (banded.offset.width - 100) * 2)

        // And letting go puts it back exactly on the edge.
        #expect(banded.clamped().offset.width == 100)
    }

    @Test("A pinch below the floor gives, and springs back to it")
    func rubberBandResistsUnderZoom() {
        let base = ProfileCrop(
            imageSize: CGSize(width: 400, height: 400),
            maskSize: CGSize(width: 200, height: 200),
            scale: 0.2,
            offset: .zero
        )
        let banded = base.rubberBanded()
        #expect(banded.scale < base.minimumScale)
        #expect(banded.scale > base.minimumScale * 0.6)
        #expect(banded.clamped().scale == base.minimumScale)
    }

    // MARK: Rendering

    @Test("Dragging right selects the left side, and output is 512 pixels")
    func panDirection() throws {
        let image = solid(width: 1024, height: 512) { context in
            UIColor.red.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 512, height: 512))
            UIColor.blue.setFill(); UIRectFill(CGRect(x: 512, y: 0, width: 512, height: 512))
            _ = context
        }
        // 400x200 on screen, a 200pt square mask: 100pt of slack each way.
        let base = ProfileCrop(
            imageSize: CGSize(width: 400, height: 200),
            maskSize: CGSize(width: 200, height: 200),
            scale: 1,
            offset: .zero
        )

        for (pan, expectsRed) in [(CGFloat(100), true), (CGFloat(-100), false)] {
            var crop = base
            crop.offset = CGSize(width: pan, height: 0)
            let data = try #require(renderProfilePhoto(image, crop: crop.clamped()))
            let output = try #require(UIImage(data: data)?.cgImage)
            #expect(output.width == 512 && output.height == 512)

            let pixel = try centrePixel(of: output)
            #expect(expectsRed ? (pixel.red > 240 && pixel.blue < 15) : (pixel.blue > 240 && pixel.red < 15))
        }
    }

    @Test("Every clamped extreme stays inside the photo")
    func extremesNeverExposeEmptyPixels() throws {
        let image = solid(width: 300, height: 900) { _ in
            UIColor.green.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 300, height: 900))
        }
        let base = ProfileCrop(
            imageSize: CGSize(width: 120, height: 360),
            maskSize: CGSize(width: 120, height: 120),
            scale: 4,
            offset: .zero
        )
        for x in [CGFloat(-5_000), 5_000] {
            for y in [CGFloat(-5_000), 5_000] {
                var crop = base
                crop.offset = CGSize(width: x, height: y)
                let data = try #require(renderProfilePhoto(image, crop: crop.clamped()))
                let output = try #require(UIImage(data: data)?.cgImage)
                let pixel = try centrePixel(of: output)
                #expect(pixel.green > 240 && pixel.red < 15)
            }
        }
    }

    @Test("Cover crops keep their wide aspect ratio and fit the upload budget")
    func wideCover() throws {
        let image = solid(width: 1200, height: 1600) { _ in
            UIColor.green.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 1200, height: 1600))
        }
        let crop = ProfileCrop.fitting(
            image: CGSize(width: 1200, height: 1600),
            in: CGSize(width: 390, height: 700),
            aspect: 16 / 9,
            inset: 34
        )
        let data = try #require(renderProfilePhoto(image, crop: crop, aspect: 16 / 9))
        let output = try #require(UIImage(data: data)?.cgImage)
        #expect(output.width == 1280 && output.height == 720)
        #expect(data.count <= 1_000_000)
    }

    @Test("A crop with no geometry yet renders nothing rather than a blank square")
    func emptyGeometryIsRefused() {
        let image = solid(width: 100, height: 100) { _ in
            UIColor.green.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 100, height: 100))
        }
        #expect(renderProfilePhoto(image, crop: ProfileCrop()) == nil)
    }

    // MARK: Helpers

    private func solid(width: CGFloat, height: CGFloat, draw: (UIGraphicsImageRendererContext) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image(actions: draw)
    }

    private func centrePixel(of image: CGImage) throws -> (red: UInt8, green: UInt8, blue: UInt8) {
        var pixel = [UInt8](repeating: 0, count: 4)
        try pixel.withUnsafeMutableBytes { bytes in
            let context = try #require(CGContext(
                data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return (pixel[0], pixel[1], pixel[2])
    }
}
