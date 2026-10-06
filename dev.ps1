param(
    [string]$BackendHost = "0.0.0.0",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "nextjs-app"

if (-not (Test-Path $backendDir)) {
    throw "Missing backend directory: $backendDir"
}

if (-not (Test-Path $frontendDir)) {
    throw "Missing frontend directory: $frontendDir"
}

# Prefer the project virtual environment (backend\.venv) over whatever "python" is on PATH.
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }
Write-Host "[launcher] Using Python: $python"

Write-Host "[launcher] Ensuring database schema is up to date..."
Push-Location $backendDir
try {
    & $python -m scripts.init_db
}
finally {
    Pop-Location
}


$services = [ordered]@{
    "backend" = @{
        Script = {
            param($dir, $bindHost, $bindPort, $py)
            Set-Location $dir
            & $py -m uvicorn app.main:app --reload --host $bindHost --port $bindPort 2>&1 |
                ForEach-Object { "[backend] $_" }
        }
        Arguments = @($backendDir, $BackendHost, $BackendPort, $python)
    }
    "frontend" = @{
        Script = {
            param($dir, $port)
            Set-Location $dir
            $env:PORT = "$port"
            npm run dev 2>&1 |
                ForEach-Object { "[frontend] $_" }
        }
        Arguments = @($frontendDir, $FrontendPort)
    }
    "notifications-worker" = @{
        Script = {
            param($dir, $py)
            Set-Location $dir
            & $py -m scripts.notification_worker 2>&1 |
                ForEach-Object { "[worker] $_" }
        }
        Arguments = @($backendDir, $python)
    }
}

function Start-SafeBillService([string]$name) {
    $definition = $services[$name]
    Start-Job -Name $name -ScriptBlock $definition.Script -ArgumentList $definition.Arguments
}

$jobs = @{}
$restartCounts = @{}
foreach ($name in $services.Keys) {
    $jobs[$name] = Start-SafeBillService $name
    $restartCounts[$name] = 0
}
# A crashed service is restarted (up to this many times) instead of taking the others down.
$maxRestarts = 5

Write-Host "SafeBill dev stack started."
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "Worker:   notifications due-queue processor"
Write-Host "Keep this window open. Press Ctrl+C to stop all services."

try {
    while ($true) {
        Wait-Job -Job @($jobs.Values) -Any -Timeout 1 | Out-Null
        foreach ($name in @($jobs.Keys)) {
            $job = $jobs[$name]
            Receive-Job -Job $job -ErrorAction SilentlyContinue

            # Jobs may briefly be NotStarted right after Start-Job; do not treat that as failure.
            if ($job.State -notin @("Completed", "Failed", "Stopped", "Suspended", "Blocked", "Disconnected")) {
                continue
            }
            Write-Host ("[launcher] {0} stopped (state: {1})" -f $name, $job.State)
            $reason = $job.ChildJobs[0].JobStateInfo.Reason
            if ($reason) {
                Write-Host ("[launcher] {0} reason: {1}" -f $name, $reason.Message)
            }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

            if ($restartCounts[$name] -ge $maxRestarts) {
                Write-Warning "$name stopped $maxRestarts times; not restarting it. The other services keep running."
                $jobs.Remove($name)
                continue
            }
            $restartCounts[$name] += 1
            Write-Host ("[launcher] restarting {0} ({1}/{2})..." -f $name, $restartCounts[$name], $maxRestarts)
            Start-Sleep -Seconds 3
            $jobs[$name] = Start-SafeBillService $name
        }
        if ($jobs.Count -eq 0) {
            Write-Warning "All services have stopped."
            break
        }
    }
}
finally {
    foreach ($job in @($jobs.Values)) {
        if ($job.State -eq "Running") {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
        }
    }

    foreach ($job in @($jobs.Values)) {
        Receive-Job -Job $job -ErrorAction SilentlyContinue
    }

    Remove-Job -Job @($jobs.Values) -Force -ErrorAction SilentlyContinue
}
