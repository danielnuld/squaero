// swift-tools-version:5.9
// The Swift facade over squaero-logic.js (issue #574, design D2). The script is
// built by `pnpm build:logic` in frontend/ and copied into Resources/ (see
// .github/workflows/ios.yml); it is not checked in.
import PackageDescription

let package = Package(
    name: "SquaeroLogic",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SquaeroLogic", targets: ["SquaeroLogic"])],
    targets: [
        .target(name: "SquaeroLogic", resources: [.copy("Resources/squaero-logic.js")]),
        .testTarget(name: "SquaeroLogicTests", dependencies: ["SquaeroLogic"]),
    ]
)
