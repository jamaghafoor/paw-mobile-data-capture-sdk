// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PAWDataCapture",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [.library(name: "PAWDataCapture", targets: ["PAWDataCapture"])],
    targets: [
        .target(name: "PAWDataCapture", resources: [.process("PrivacyInfo.xcprivacy")]),
        .testTarget(name: "PAWDataCaptureTests", dependencies: ["PAWDataCapture"])
    ]
)
