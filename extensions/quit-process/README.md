# Quit Processes for ND

An ND extension package for inspecting running processes and quitting a selected
process. Install it from **Settings → Extensions → Available**, then activate it
for **Personal**. The list refreshes only while its view is open.
After activation, open it from either ND launcher by searching for **Quit Processes**.

This is an independent ND implementation inspired by MagiBar's Quit Processes
feature. It does not include MagiBar source code, its custom renderer, or its
native binaries. ND owns process access through its permission broker and shows
a confirmation before either quit action.

The process list includes PID, CPU, and memory. CPU may be unavailable on the
first Windows sample. Processes whose start identity cannot be read are listed
but cannot be quit, to avoid acting on a reused PID.
