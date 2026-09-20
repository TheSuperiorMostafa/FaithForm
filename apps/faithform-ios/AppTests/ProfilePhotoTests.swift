import Testing
import UIKit
@testable import FaithForm

@Suite("Profile photo crop")
@MainActor
struct ProfilePhotoTests {
    @Test("Dragging right selects the left side and output is 512 pixels")
    func panDirection() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 512), format: format).image { _ in
            UIColor.red.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 512, height: 512))
            UIColor.blue.setFill(); UIRectFill(CGRect(x: 512, y: 0, width: 512, height: 512))
        }
        for (x, red) in [(CGFloat(1), true), (CGFloat(-1), false)] {
            let data = try #require(renderProfilePhoto(image, zoom: 1, x: x, y: 0))
            let output = try #require(UIImage(data: data)?.cgImage)
            #expect(output.width == 512 && output.height == 512)
            var pixel = [UInt8](repeating: 0, count: 4)
            try pixel.withUnsafeMutableBytes { bytes in
                let context = try #require(CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                context.draw(output, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            }
            #expect(red ? (pixel[0] > 240 && pixel[2] < 15) : (pixel[2] > 240 && pixel[0] < 15))
        }
    }
}
