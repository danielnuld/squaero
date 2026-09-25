// What the App Store looks at (issue #579, tasks 7.1, 7.2 and 7.5): the
// permission purposes in both languages, the launch screen's assets, the
// privacy manifest shipped in the bundle, the local-network hint and the
// licences screen.

import SquaeroLogic
import UIKit
import XCTest
@testable import Squaero

@MainActor
final class DistributionTests: XCTestCase {
    private let app = Bundle.main

    func testEveryPermissionHasItsPurposeInBothLanguages() throws {
        for key in ["NSFaceIDUsageDescription", "NSLocalNetworkUsageDescription"] {
            let base = try XCTUnwrap(app.object(forInfoDictionaryKey: key) as? String, key)
            XCTAssertTrue(base.contains("Squaero"), base)
            for language in ["es", "en"] {
                let path = try XCTUnwrap(app.path(forResource: "InfoPlist", ofType: "strings", inDirectory: nil,
                                                  forLocalization: language), language)
                let strings = try XCTUnwrap(NSDictionary(contentsOfFile: path) as? [String: String])
                XCTAssertFalse(strings[key]?.isEmpty ?? true, "\(language): \(key)")
            }
        }
    }

    func testTheLaunchScreenHasItsMarkAndColour() throws {
        let launch = try XCTUnwrap(app.object(forInfoDictionaryKey: "UILaunchScreen") as? [String: String])
        XCTAssertNotNil(UIImage(named: try XCTUnwrap(launch["UIImageName"])))
        XCTAssertNotNil(UIColor(named: try XCTUnwrap(launch["UIColorName"])))
    }

    func testThePrivacyManifestDeclaresNoCollectionNorTracking() throws {
        let url = try XCTUnwrap(app.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let plist = try XCTUnwrap(NSDictionary(contentsOf: url) as? [String: Any])
        XCTAssertEqual(plist["NSPrivacyTracking"] as? Bool, false)
        XCTAssertEqual((plist["NSPrivacyCollectedDataTypes"] as? [Any])?.count, 0)
        XCTAssertEqual((plist["NSPrivacyTrackingDomains"] as? [Any])?.count, 0)
    }

    func testTheLocalNetworkIsToldApartFromTheRest() throws {
        let lan = Connection(id: "a", name: "a", driver: "postgres", params: ["host": "192.168.1.20"])
        let cloud = Connection(id: "b", name: "b", driver: "postgres", params: ["host": "db.example.com"])
        XCTAssertTrue(try Logic.shared.usesLocalNetwork(lan))
        XCTAssertFalse(try Logic.shared.usesLocalNetwork(cloud))
    }

    func testEveryComponentHasItsFullLicence() throws {
        let components = LicensedComponent.bundled()
        XCTAssertGreaterThanOrEqual(components.count, 10)
        for c in components {
            XCTAssertFalse(c.texts.isEmpty, c.name)
            for part in c.texts { XCTAssertGreaterThan(part.text.count, 100, "\(c.name): \(part.file)") }
        }
        let names = Set(components.map(\.name))
        for expected in ["Squaero", "SQLite", "OpenSSL", "libssh2", "libdrda"] {
            XCTAssertTrue(names.contains(expected), expected)
        }
        // No copyleft by another author (spec ios-app-store).
        XCTAssertFalse(components.contains { $0.name != "Squaero" && $0.license.contains("GPL") })
    }
}
