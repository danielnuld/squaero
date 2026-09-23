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

void mac_maximize(void *window)
{
    @autoreleasepool {
        NSWindow *win = (__bridge NSWindow *)window;
        NSScreen *screen = win.screen != nil ? win.screen : [NSScreen mainScreen];
        if (screen != nil) {
            [win setFrame:screen.visibleFrame display:YES];
        }
    }
}
