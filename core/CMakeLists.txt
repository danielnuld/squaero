# libdbcore — the pure C core. No UI dependencies (see .rules/general.md).
add_library(dbcore STATIC
  src/version.c
  src/runtime.c
  src/driver/validate.c
  src/driver/plugin_name.c
  src/driver/loader.c
  src/conn/manager.c
  src/query/result.c
  src/query/run.c
  src/query/materialize.c
  src/query/schema.c
  src/ipc/rpc.c
  src/ipc/methods.c
  src/ipc/conn_methods.c
  src/ipc/query_methods.c
  src/ipc/schema_methods.c
  src/ipc/result_json.c
  src/ipc/dispatch.c
)

target_include_directories(dbcore PUBLIC include)
target_compile_definitions(dbcore PRIVATE QUAERO_VERSION=\"${PROJECT_VERSION}\")
quaero_set_warnings(dbcore)

# cJSON is an internal implementation detail (PRIVATE): it is never exposed
# through a public Quaero header, so it does not propagate to consumers.
target_link_libraries(dbcore PRIVATE cjson)

# The dynamic driver loader needs the platform dl library (libdl on Linux;
# empty on Windows/macOS where dlopen lives in the C runtime).
target_link_libraries(dbcore PRIVATE ${CMAKE_DL_LIBS})

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
