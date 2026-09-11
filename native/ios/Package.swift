// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "FTCocosBridge",
    platforms: [.iOS(.v12)],
    products: [.library(name: "FTCocosBridge", targets: ["FTCocosBridge"])],
    dependencies: [
        .package(url: "https://github.com/GuanceCloud/datakit-ios.git", .exact("1.6.8-alpha.5")),
    ],
    targets: [
        .target(
            name: "FTCocosBridge",
            dependencies: [
                .product(name: "GuanceSDK", package: "datakit-ios"),
                .product(name: "GuanceSessionReplay", package: "datakit-ios"),
            ],
            path: ".",
            exclude: ["FTCocosBridge.podspec"],
            sources: ["FTCocosBridge.m", "FTCocosReplayImageJobs.m"],
            publicHeadersPath: "include",
            cSettings: [.headerSearchPath(".")],
            linkerSettings: [.linkedFramework("UIKit")]
        ),
    ]
)
