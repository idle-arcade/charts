# IDLE Arcade repository maps

Source: [idle-arcade/game at 390e651c](https://github.com/idle-arcade/game/commit/390e651c2177cc4da27a67f5d3a6fb277a672ab0). These images show file/folder structure, not runtime dependencies or software architecture. Generated artifacts stay in the charts repository; the game checkout is read-only.

## Repocarto

![Repocarto](repocarto.svg)

[PNG](repocarto.png) · [Existing upstream renderer](https://github.com/aurelio-nakamura/repocarto). Nested circles represent directories; file area represents lines of code and color represents language. The scan uses tracked source files with build/dependency folders, lockfiles, drawing source files and binary assets omitted in a temporary visualization checkout. Both the action and npm package are pinned.


## Gource still

![Gource repository tree](gource.png)

Real Git history rendered by Gource, retaining its final frame as a PNG. Source commit: [390e651c](https://github.com/idle-arcade/game/commit/390e651c2177cc4da27a67f5d3a6fb277a672ab0). The still keeps idle files visible and hides people/motion so directory structure remains the focus. Gource and Repocarto are regenerated together on every scheduled or manual run. No video is stored.
