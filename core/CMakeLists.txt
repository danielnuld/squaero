# libdbcore — the pure C core. No UI dependencies (see .rules/general.md).
add_library(dbcore STATIC
  src/version.c
  src/driver/validate.c
  src/ipc/rpc.c
  src/ipc/methods.c
  src/ipc/dispatch.c
)

target_include_directories(dbcore PUBLIC include)
target_compile_definitions(dbcore PRIVATE QUAERO_VERSION=\"${PROJECT_VERSION}\")
quaero_set_warnings(dbcore)

# cJSON is an internal implementation detail (PRIVATE): it is never exposed
# through a public Quaero header, so it does not propagate to consumers.
target_link_libraries(dbcore PRIVATE cjson)

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
