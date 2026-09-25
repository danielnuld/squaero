// What the App Store looks at (issue #579, tasks 7.1 and 7.2): the permission
// purposes in both languages, the launch screen's assets, the privacy
// manifest shipped in the bundle, and the local-network hint.

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
}
