# Builds deploy/bundle from the repo. Run from the repo root:  powershell -File deploy\build.ps1
# The bundle is what gets uploaded: public/ and src/ only. bin/, db/, tests/ and router.php
# are not needed on the server (no command line there). The SQL goes to phpMyAdmin instead.
# To rebuild, move the old deploy\bundle folder out of the way first; this script never deletes.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $PSScriptRoot 'bundle'
if (Test-Path $out) { throw "deploy\bundle already exists: move it away, then run again" }
New-Item -ItemType Directory -Path $out | Out-Null
robocopy (Join-Path $root 'public') (Join-Path $out 'public') /E /XF router.php /NFL /NDL /NJH /NJS | Out-Null
robocopy (Join-Path $root 'src')    (Join-Path $out 'src')    /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'config.local.php.example') (Join-Path $out 'config.local.php.example')
Copy-Item (Join-Path $root 'db\schema.mysql.sql') (Join-Path $PSScriptRoot 'sql\01-schema.sql') -Force
$bad = Get-ChildItem -Recurse -File -Force $out | Where-Object { $_.Name -in 'config.local.php', '.env', 'router.php' -or $_.Extension -in '.sqlite', '.log' }
if ($bad) { throw "bundle contains forbidden files: $($bad.FullName -join ', ')" }
Get-ChildItem -Recurse -File -Force $out | ForEach-Object { '{0,8}  {1}' -f $_.Length, $_.FullName.Substring($out.Length + 1) }
