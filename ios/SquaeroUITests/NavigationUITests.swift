// The screens as a finger goes through them, on the demo database: what the
// model tests cannot see (a table that looped back to the table list, an
// editor whose keyboard hid the tab bar for good).

import XCTest

final class NavigationUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(es)"]
        app.launch()
    }

    private func openDemo() {
        let demo = app.buttons["demo-open"]
        XCTAssertTrue(demo.waitForExistence(timeout: 20))
        demo.tap()
    }

    func testATableOpensItsRowsAndStaysThere() {
        openDemo()
        let table = app.buttons["audiencias"]
        XCTAssertTrue(table.waitForExistence(timeout: 30))
        table.tap()
        let rows = app.navigationBars["audiencias"]
        XCTAssertTrue(rows.waitForExistence(timeout: 15))
        sleep(2) // the loop took the stack back a moment later
        XCTAssertTrue(rows.exists)
        XCTAssertFalse(app.buttons["audiencias"].exists)
    }

    func testTheQueryKeyboardCanBeHidden() {
        openDemo()
        XCTAssertTrue(app.buttons["audiencias"].waitForExistence(timeout: 30))
        app.tabBars.buttons.element(boundBy: 1).tap()
        let editor = app.textViews["sql-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        XCTAssertTrue(app.keyboards.element.waitForExistence(timeout: 5))
        app.buttons["Ocultar el teclado"].tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.element)
        wait(for: [gone], timeout: 5)
        XCTAssertTrue(app.tabBars.element.isHittable)
    }
}
