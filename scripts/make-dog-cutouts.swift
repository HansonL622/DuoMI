import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct Pixel {
  var r: UInt8
  var g: UInt8
  var b: UInt8
  var a: UInt8
}

let inputs = [
  "dog-listening",
  "dog-recording",
  "dog-thinking",
  "dog-responding",
]

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let threshold = 34

func colorDistance(_ pixel: Pixel, _ target: Pixel) -> Int {
  let dr = Int(pixel.r) - Int(target.r)
  let dg = Int(pixel.g) - Int(target.g)
  let db = Int(pixel.b) - Int(target.b)
  return abs(dr) + abs(dg) + abs(db)
}

func pixel(at index: Int, in data: [UInt8]) -> Pixel {
  let offset = index * 4
  return Pixel(r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3])
}

func setAlpha(_ alpha: UInt8, at index: Int, in data: inout [UInt8]) {
  data[index * 4 + 3] = alpha
}

func makeCutout(named name: String) throws {
  let inputURL = root.appendingPathComponent("public/\(name).webp")
  let outputURL = root.appendingPathComponent("public/\(name)-cutout.png")

  guard let image = NSImage(contentsOf: inputURL),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    throw NSError(domain: "Cutout", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read \(inputURL.path)"])
  }

  let width = cgImage.width
  let height = cgImage.height
  let bytesPerPixel = 4
  let bytesPerRow = width * bytesPerPixel
  var data = [UInt8](repeating: 0, count: height * bytesPerRow)

  guard let context = CGContext(
    data: &data,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
  ) else {
    throw NSError(domain: "Cutout", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot create bitmap context"])
  }

  context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

  let sampleIndexes = [
    0,
    width - 1,
    (height - 1) * width,
    height * width - 1,
    width / 2,
    (height - 1) * width + width / 2,
  ]
  let samplePixels = sampleIndexes.map { pixel(at: $0, in: data) }
  let background = Pixel(
    r: UInt8(samplePixels.map { Int($0.r) }.reduce(0, +) / samplePixels.count),
    g: UInt8(samplePixels.map { Int($0.g) }.reduce(0, +) / samplePixels.count),
    b: UInt8(samplePixels.map { Int($0.b) }.reduce(0, +) / samplePixels.count),
    a: 255
  )

  var visited = [Bool](repeating: false, count: width * height)
  var queue: [Int] = []
  queue.reserveCapacity(width * height / 2)

  func enqueueIfBackground(_ index: Int) {
    if visited[index] { return }
    let current = pixel(at: index, in: data)
    if current.a > 0 && colorDistance(current, background) <= threshold {
      visited[index] = true
      queue.append(index)
    }
  }

  for x in 0..<width {
    enqueueIfBackground(x)
    enqueueIfBackground((height - 1) * width + x)
  }
  for y in 0..<height {
    enqueueIfBackground(y * width)
    enqueueIfBackground(y * width + width - 1)
  }

  var head = 0
  while head < queue.count {
    let index = queue[head]
    head += 1
    let x = index % width
    let y = index / width

    setAlpha(0, at: index, in: &data)

    if x > 0 { enqueueIfBackground(index - 1) }
    if x < width - 1 { enqueueIfBackground(index + 1) }
    if y > 0 { enqueueIfBackground(index - width) }
    if y < height - 1 { enqueueIfBackground(index + width) }
  }

  guard let outputContext = CGContext(
    data: &data,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
  ), let outputImage = outputContext.makeImage(),
     let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "Cutout", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot prepare output \(outputURL.path)"])
  }

  CGImageDestinationAddImage(destination, outputImage, nil)
  if !CGImageDestinationFinalize(destination) {
    throw NSError(domain: "Cutout", code: 4, userInfo: [NSLocalizedDescriptionKey: "Cannot write \(outputURL.path)"])
  }

  print("Wrote \(outputURL.path)")
}

for input in inputs {
  try makeCutout(named: input)
}
