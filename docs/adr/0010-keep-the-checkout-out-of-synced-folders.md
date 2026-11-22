# Keep the checkout out of synced folders

**Status:** accepted (2026-11-21)

The project began inside a OneDrive-synced Desktop folder. OneDrive would try to sync `node_modules` (tens of thousands of files), which is slow and can lock files mid-build. So the checkout moved to a plain folder under the user profile. Keep it out of any synced folder (OneDrive, Dropbox, Google Drive). Git (a commit for each verified change, pushed to GitHub when the user asks) is the backup and rollback mechanism.
