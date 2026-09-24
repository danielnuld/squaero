# Toolchain: iOS on arm64, for the iPhone app's core (issue #573). CMake knows
# iOS natively; this only picks the SDK and the minimum version, and on the
# simulator runs the tests inside a booted device.
#
# Usage (on a Mac with Xcode):
#   cmake -S . -B build-ios-sim -G Ninja \
#         -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-ios.cmake \
#         -DQUAERO_IOS_PLATFORM=simulator \
#         -DQUAERO_BUILD_APP=OFF -DQUAERO_STATIC_DRIVERS=ON
#
# QUAERO_IOS_PLATFORM: "device" (iphoneos) or "simulator" (iphonesimulator).

set(CMAKE_SYSTEM_NAME iOS)
set(QUAERO_IOS_PLATFORM "device" CACHE STRING "iOS SDK to build for: device or simulator")
set(QUAERO_IOS_MIN "17.0" CACHE STRING "Minimum iOS version")

if(QUAERO_IOS_PLATFORM STREQUAL "simulator")
  set(CMAKE_OSX_SYSROOT iphonesimulator)
  # ctest runs each test inside the booted simulator; a plain arm64 simulator
  # executable needs no bundle or signing beyond the linker's ad-hoc one.
  set(CMAKE_CROSSCOMPILING_EMULATOR xcrun simctl spawn booted)
elseif(QUAERO_IOS_PLATFORM STREQUAL "device")
  set(CMAKE_OSX_SYSROOT iphoneos)
else()
  message(FATAL_ERROR "QUAERO_IOS_PLATFORM must be device or simulator, not '${QUAERO_IOS_PLATFORM}'")
endif()

# CMake confines find_* to the SDK on iOS, which hides the OpenSSL we build
# into the build tree (cmake/QuaeroOpenSSL.cmake). No iOS driver looks for a
# system client library, so nothing from the host can sneak in this way.
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)

set(CMAKE_OSX_ARCHITECTURES arm64)
set(CMAKE_OSX_DEPLOYMENT_TARGET "${QUAERO_IOS_MIN}")
