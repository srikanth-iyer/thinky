# bench_big_folders.ps1: times thinky's old and new core on big made-up notes folders, on this computer.
#
# Run it from the thinky repo, on the branch with the new code (wip/next-release):
#   powershell -ExecutionPolicy Bypass -File scripts\bench_big_folders.ps1
#
# What it does, step by step:
#   1. Makes two copies of the code in a temporary folder: "old" (origin/main, the released version)
#      and "new" (the commit you're on). Your own checkout is not changed.
#   2. Builds the timing program (core/examples/thinkybench.rs) for each, in release mode.
#   3. Makes made-up notes folders of about 1,600, 5,000 and 23,000 files in the temporary folder.
#      It never opens, reads or changes your real notes.
#   4. Times old and new on each folder, twice each, and prints a table.
# Needs: git and Rust (cargo) on the PATH. Uses about 300 MB in %TEMP%\thinky-bench, which you can
# delete afterwards (the made-up folders are kept there so a second run doesn't make them again).
# Works in Windows PowerShell 5.1 and PowerShell 7.

# git and cargo print progress on the error stream; with 'Stop', Windows PowerShell 5.1 would treat
# that as a failure, so each step's own exit code ($LASTEXITCODE) is checked instead
$ErrorActionPreference = 'Continue'

# --- 0. The tools it needs -----------------------------------------------------------------------
foreach ($tool in @('git', 'cargo')) {  # check each tool in turn
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {  # not found on the PATH
        throw "$tool was not found. Install it first (Rust: https://rustup.rs, Git: https://git-scm.com), then run this again."
    }
}

$repo = git rev-parse --show-toplevel  # the top folder of the thinky checkout we're in
if ($LASTEXITCODE -ne 0) { throw 'Run this from inside the thinky repo folder.' }
$repo = $repo.Trim()  # without a trailing new line
$work = Join-Path $env:TEMP 'thinky-bench'      # the temporary folder for everything this script makes
New-Item -ItemType Directory -Force -Path $work | Out-Null  # make it (no error if it's already there)
Write-Host "Working in $work"

# --- 1. The two copies of the code ---------------------------------------------------------------
git -C $repo fetch --quiet origin main          # the newest released code from GitHub
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch main from GitHub (no internet?).' }
$oldRev = (git -C $repo rev-parse origin/main).Trim()  # "old": what's on main now
$newRev = (git -C $repo rev-parse HEAD).Trim()         # "new": the commit you're on
Write-Host "old = origin/main $($oldRev.Substring(0,7)), new = HEAD $($newRev.Substring(0,7))"

# the timing program, taken from this checkout so old and new are timed by the very same program
$benchSrc = Join-Path $repo 'core\examples\thinkybench.rs'
if (-not (Test-Path $benchSrc)) { throw "core\examples\thinkybench.rs is missing: switch to the wip/next-release branch first." }

$exes = @{}  # where each version's timing program ends up
foreach ($v in @('old', 'new')) {  # build each version in turn
    $dir = Join-Path $work $v  # this version's copy of the code
    if (Test-Path $dir) { git -C $repo worktree remove --force $dir 2>$null }  # an earlier run's copy
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }  # still there (not a worktree): delete it
    git -C $repo worktree prune  # forget copies that are gone
    $rev = if ($v -eq 'old') { $oldRev } else { $newRev }  # which commit this copy is
    git -C $repo worktree add --force --detach --quiet $dir $rev  # check that commit out into the copy
    if ($LASTEXITCODE -ne 0) { throw "Could not make the $v copy of the code in $dir." }
    Copy-Item $benchSrc (Join-Path $dir 'core\examples\thinkybench.rs') -Force  # the same timing program

    Write-Host "Building $v (release mode; the first build takes a minute or two)..."
    $env:CARGO_TARGET_DIR = Join-Path $work 'target'  # one build folder for both, so libraries build once
    Push-Location $dir  # build from inside this copy
    cargo build --release --quiet -p outline_core --example thinkybench
    $ok = $LASTEXITCODE  # 0 if the build worked
    Pop-Location  # back to where we were
    if ($ok -ne 0) { throw "Building $v failed (see above). If it says link.exe was not found, install the Visual Studio C++ Build Tools, or run: rustup default stable-x86_64-pc-windows-gnu" }
    $exe = Join-Path $work "thinkybench-$v.exe"  # keep this version's program under its own name
    Copy-Item (Join-Path $env:CARGO_TARGET_DIR 'release\examples\thinkybench.exe') $exe -Force
    $exes[$v] = $exe
}

# --- 2. Make the folders and time them -----------------------------------------------------------
# folder sizes: pages and journal days (plus one hub page)
$sizes = @(@{ pages = 1200; days = 400 }, @{ pages = 4000; days = 1000 }, @{ pages = 20000; days = 3000 })
$rows = @()  # one row of the table per folder size and version
foreach ($s in $sizes) {
    $folder = Join-Path $work "notes-$($s.pages)-$($s.days)"  # the made-up notes folder
    $files = $s.pages + 1 + $s.days  # how many note files it has
    if (-not (Test-Path (Join-Path $folder 'done'))) { Write-Host "Making a made-up notes folder of $files files (once)..." }
    $runs = @{ old = @(); new = @() }  # each version's results
    foreach ($round in 1..2) {  # two rounds, old and new taking turns, so neither always goes first
        foreach ($v in @('old', 'new')) {
            $cache = Join-Path $work "cache-$v"  # this version's own cache folder (emptied by the program)
            $out = & $exes[$v] $folder $cache $s.pages $s.days  # run the timing program
            if ($LASTEXITCODE -ne 0) { throw "The $v timing program stopped with an error on $files files." }
            $line = $out | Where-Object { $_ -like 'RESULT *' } | Select-Object -Last 1  # its result line
            $r = @{}  # the line's values: first=.. usual=.. and so on
            foreach ($pair in ($line -replace '^RESULT ', '').Split(' ')) {
                $kv = $pair.Split('=')
                $r[$kv[0]] = [double]$kv[1]
            }
            $runs[$v] += , $r  # keep it (the comma keeps it as one item)
        }
    }
    foreach ($v in @('old', 'new')) {
        # the better of the two rounds for each number (the other is more likely slowed by something else)
        $best = { param($key) ($runs[$v] | ForEach-Object { $_[$key] } | Measure-Object -Minimum).Minimum }
        $saved = & $best 'saved'
        $rows += [pscustomobject]@{
            'Files'                   = $files
            'Version'                 = $v
            'First start (ms)'        = & $best 'first'
            'Usual start (ms)'        = & $best 'usual'
            'Quick capture read (ms)' = & $best 'capture'
            'Closing it (ms)'         = & $best 'close'
            'Saved page list (ms)'    = if ($saved -lt 0) { '-' } else { $saved }
        }
    }
}

# --- 3. The table --------------------------------------------------------------------------------
$cores = [Environment]::ProcessorCount  # how many processor threads this computer has
Write-Host ""
Write-Host "thinky big-folder timings on $env:COMPUTERNAME ($cores processor threads), old = released, new = wip/next-release"
$table = $rows | Format-Table -AutoSize | Out-String  # the table as text
Write-Host $table
$table | Set-Content -Encoding UTF8 (Join-Path $work 'results.txt')  # and saved, for later
Write-Host "Saved to $(Join-Path $work 'results.txt'). Delete $work when you're done with it."
Write-Host "'Saved page list' is what quick capture shows first in the new version; the old version has none (-)."

# tidy up the two code copies (the build folder and made-up notes stay for a quicker second run)
foreach ($v in @('old', 'new')) { git -C $repo worktree remove --force (Join-Path $work $v) 2>$null }
git -C $repo worktree prune
