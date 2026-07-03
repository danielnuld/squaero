# Database driver plugins are registered here as they are implemented.
#
# Each driver is a shared library implementing the vtable in
# docs/DRIVER_API.md and is loaded at runtime by libdbcore.
add_subdirectory(sqlite)
add_subdirectory(mysql)
add_subdirectory(informix)
add_subdirectory(mongodb)
