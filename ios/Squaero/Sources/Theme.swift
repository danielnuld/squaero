// The prototype's look (issue #575): Squaero's violet, Schibsted Grotesk for
// titles and Martian Mono for data and SQL, in light and dark. The colours are
// the site's --accent tokens (site/home.css).

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
        .custom(titleFontName, size: size, relativeTo: .largeTitle).weight(.bold)
    }

    static func mono(_ size: CGFloat = 13) -> Font {
        .custom(monoFontName, size: size, relativeTo: .body)
    }

    /// Large navigation titles in Schibsted Grotesk, as in the prototype.
    static func applyNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithDefaultBackground()
        if let large = UIFont(name: titleFontName, size: 34) {
            appearance.largeTitleTextAttributes = [.font: large.withWeight(.bold)]
        }
        if let small = UIFont(name: titleFontName, size: 17) {
            appearance.titleTextAttributes = [.font: small.withWeight(.semibold)]
        }
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
    }
}

private extension UIFont {
    /// A weight of this variable font.
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let d = fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]])
        return UIFont(descriptor: d, size: pointSize)
    }
}
