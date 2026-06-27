# Database driver plugins are registered here as they are implemented.
#
# Each driver is a shared library implementing the vtable in
# docs/DRIVER_API.md and is loaded at runtime by libdbcore.
#
# The SQLite reference driver arrives in M1 (issue #11), e.g.:
#   add_subdirectory(sqlite)
