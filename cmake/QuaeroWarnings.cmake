# Applies the project's strict warning policy to a target.
# See .rules/c-core.md: C11, warnings-as-errors, no new warnings.
function(quaero_set_warnings target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /WX)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
endfunction()
