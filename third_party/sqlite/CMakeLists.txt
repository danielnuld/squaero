# Vendored SQLite amalgamation (https://www.sqlite.org), public domain.
# Built as a static lib. Our strict warnings policy is intentionally NOT applied
# to third-party code. Built with GNU extensions so the amalgamation sees the
# POSIX declarations it expects under our otherwise-strict C11 build.
add_library(sqlite3 STATIC sqlite3.c)
target_include_directories(sqlite3 PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(sqlite3 PROPERTIES C_EXTENSIONS ON)

if(NOT MSVC)
  target_compile_options(sqlite3 PRIVATE -w)
else()
  target_compile_options(sqlite3 PRIVATE /w)
endif()

# SQLite needs threads + the dynamic loader on Unix-likes.
if(UNIX)
  find_package(Threads REQUIRED)
  target_link_libraries(sqlite3 PUBLIC Threads::Threads ${CMAKE_DL_LIBS})
endif()
