# The project lives at C:\Users\rexon\spyder, outside OneDrive

**Status:** accepted (2026-11-21)

The project began in `C:\Users\rexon\OneDrive\Desktop\spyder`. OneDrive would try to sync `node_modules` (tens of thousands of files), which is slow and can lock files mid-build. So the project moved to `C:\Users\rexon\spyder`. Keep it out of any synced folder. Git (a commit for each verified change, pushed to GitHub when the user asks) is the backup and rollback mechanism.
