// The prototype's look (issue #575): Squaero's violet, Schibsted Grotesk for
// titles and Martian Mono for data and SQL, in light and dark. The colours are
// the site's --accent tokens (site/home.css).

import CoreText
import SwiftUI
import UIKit

enum Theme {
    /// #5b5bd6 in light, #6d6de6 in dark.
    static let accent = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x6d / 255, green: 0x6d / 255, blue: 0xe6 / 255, alpha: 1)
            : UIColor(red: 0x5b / 255, green: 0x5b / 255, blue: 0xd6 / 255, alpha: 1)
    })

    /// PostScript names of the fonts in Resources/Fonts (listed in UIAppFonts).
    static let titleFontName = "SchibstedGrotesk-Regular"
    static let monoFontName = "MartianMono-SemiExpandedRegular"

    static func title(_ size: CGFloat = 28) -> Font {
        Font(UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: variable(titleFontName, size: size, weight: 700)))
    }

    static func mono(_ size: CGFloat = 13) -> Font {
        .custom(monoFontName, size: size, relativeTo: .body)
    }

    /// Large navigation titles in Schibsted Grotesk, as in the prototype.
    static func applyNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.largeTitleTextAttributes = [.font: variable(titleFontName, size: 34, weight: 700)]
        appearance.titleTextAttributes = [.font: variable(titleFontName, size: 17, weight: 600)]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
    }

    /// A weight of one of our variable fonts. The weight trait does not move a
    /// variable font's wght axis (the titles came out Regular); the variation
    /// attribute does. 0x77676874 is the axis tag "wght".
    static func variable(_ name: String, size: CGFloat, weight: CGFloat) -> UIFont {
        let base = UIFontDescriptor(name: name, size: size)
        let d = base.addingAttributes([
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [0x7767_6874: weight],
        ])
        return UIFont(descriptor: d, size: size)
    }
}
