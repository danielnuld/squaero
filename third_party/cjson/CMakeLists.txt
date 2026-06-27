# Vendored cJSON (https://github.com/DaveGamble/cJSON), MIT licensed.
# Built as a small static lib. Our strict warnings policy is intentionally NOT
# applied to third-party code. cJSON stays an implementation detail of libdbcore
# (it is never exposed through a public Quaero header).
add_library(cjson STATIC cJSON.c)
target_include_directories(cjson PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

if(NOT MSVC)
  target_compile_options(cjson PRIVATE -w)
else()
  target_compile_options(cjson PRIVATE /w)
endif()
