# libdbcore — the pure C core. No UI dependencies (see .rules/general.md).
add_library(dbcore STATIC
  src/version.c
)

target_include_directories(dbcore PUBLIC include)
target_compile_definitions(dbcore PRIVATE QUAERO_VERSION=\"${PROJECT_VERSION}\")
quaero_set_warnings(dbcore)

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
