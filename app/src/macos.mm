// macOS pieces of the shell (issue #40), in Objective-C++ because they are
// AppKit calls. main.cc stays C++ and reaches them through macos.h.

#include "macos.h"

#import <AppKit/AppKit.h>

std::string mac_write_ui(const char *html)
{
    @autoreleasepool {
        // ~/Library/Application Support/Squaero/ui, rewritten on every launch
        // like the Windows and Linux copies.
        NSArray<NSURL *> *dirs = [[NSFileManager defaultManager]
            URLsForDirectory:NSApplicationSupportDirectory
                   inDomains:NSUserDomainMask];
        if (dirs.count == 0) {
            return {};
        }
        NSURL *dir = [dirs.firstObject URLByAppendingPathComponent:@"Squaero/ui"
                                                       isDirectory:YES];
        if (![[NSFileManager defaultManager] createDirectoryAtURL:dir
                                      withIntermediateDirectories:YES
                                                       attributes:nil
                                                            error:nil]) {
            return {};
        }
        NSURL *file = [dir URLByAppendingPathComponent:@"index.html"];
        NSData *data = [NSData dataWithBytes:html length:std::strlen(html)];
        if (![data writeToURL:file atomically:YES]) {
            return {};
        }
        // absoluteString percent-encodes the space in "Application Support".
        return std::string(file.absoluteString.UTF8String);
    }
}

void mac_open_url(const char *url)
{
    @autoreleasepool {
        NSURL *u = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
        if (u != nil) {
            [[NSWorkspace sharedWorkspace] openURL:u];
        }
    }
}

bool mac_pick_file(const char *title, std::string &path)
{
    @autoreleasepool {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseFiles = YES;
        panel.canChooseDirectories = NO;
        panel.allowsMultipleSelection = NO;
        if (title != nullptr && *title != '\0') {
            panel.message = [NSString stringWithUTF8String:title];
        }
        if ([panel runModal] != NSModalResponseOK || panel.URL == nil) {
            return false;
        }
        path = panel.URL.path.UTF8String;
        return true;
    }
}

void mac_setup_app(void *window)
{
    @autoreleasepool {
        // Without an Edit menu, AppKit has nothing to route Cmd+C / Cmd+V /
        // Cmd+A to, and they do nothing in the web view: the menu IS the
        // shortcut. The app menu carries Quit (Cmd+Q).
        // Same rule as the UI's detectLocale: Spanish for "es*", else English.
        NSString *lang = [NSLocale preferredLanguages].firstObject ?: @"en";
        const bool es = [lang hasPrefix:@"es"];
        auto T = [es](NSString *spanish, NSString *english) { return es ? spanish : english; };
        NSMenu *bar = [[NSMenu alloc] init];

        NSMenuItem *appItem = [[NSMenuItem alloc] init];
        NSMenu *appMenu = [[NSMenu alloc] init];
        [appMenu addItemWithTitle:T(@"Ocultar Squaero", @"Hide Squaero") action:@selector(hide:) keyEquivalent:@"h"];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:T(@"Salir de Squaero", @"Quit Squaero") action:@selector(terminate:) keyEquivalent:@"q"];
        appItem.submenu = appMenu;
        [bar addItem:appItem];

        NSMenuItem *editItem = [[NSMenuItem alloc] init];
        NSMenu *edit = [[NSMenu alloc] initWithTitle:T(@"Edición", @"Edit")];
        [edit addItemWithTitle:T(@"Deshacer", @"Undo") action:@selector(undo:) keyEquivalent:@"z"];
        NSMenuItem *redo = [edit addItemWithTitle:T(@"Rehacer", @"Redo") action:@selector(redo:) keyEquivalent:@"z"];
        redo.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
        [edit addItem:[NSMenuItem separatorItem]];
        [edit addItemWithTitle:T(@"Cortar", @"Cut") action:@selector(cut:) keyEquivalent:@"x"];
        [edit addItemWithTitle:T(@"Copiar", @"Copy") action:@selector(copy:) keyEquivalent:@"c"];
        [edit addItemWithTitle:T(@"Pegar", @"Paste") action:@selector(paste:) keyEquivalent:@"v"];
        [edit addItemWithTitle:T(@"Seleccionar todo", @"Select All") action:@selector(selectAll:) keyEquivalent:@"a"];
        editItem.submenu = edit;
        [bar addItem:editItem];

        [NSApplication sharedApplication].mainMenu = bar;

        // Fill the screen's visible frame, and come to the front: launched from
        // the Finder or the Dock the app must own the menu bar, not Finder.
        NSWindow *win = (__bridge NSWindow *)window;
        NSScreen *screen = win.screen != nil ? win.screen : [NSScreen mainScreen];
        if (screen != nil) {
            [win setFrame:screen.visibleFrame display:YES];
        }
        [NSApp activateIgnoringOtherApps:YES];
    }
}
