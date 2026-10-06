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

Write-Host "[launcher] Ensuring database schema is up to date..."
Push-Location $backendDir
try {
    python -m scripts.init_db
}
finally {
    Pop-Location
}

$backendJob = Start-Job -Name "backend" -ScriptBlock {
    param($dir, $bindHost, $bindPort)
    Set-Location $dir
    python -m uvicorn app.main:app --reload --host $bindHost --port $bindPort 2>&1 |
        ForEach-Object { "[backend] $_" }
} -ArgumentList $backendDir, $BackendHost, $BackendPort

$workerJob = Start-Job -Name "notifications-worker" -ScriptBlock {
    param($dir)
    Set-Location $dir
    python -m scripts.notification_worker 2>&1 |
        ForEach-Object { "[worker] $_" }
} -ArgumentList $backendDir

$frontendJob = Start-Job -Name "frontend" -ScriptBlock {
    param($dir, $port)
    Set-Location $dir
    $env:PORT = "$port"
    npm run dev 2>&1 |
        ForEach-Object { "[frontend] $_" }
} -ArgumentList $frontendDir, $FrontendPort

$jobs = @($backendJob, $frontendJob, $workerJob)

Write-Host "SafeBill dev stack started."
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "Worker:   notifications due-queue processor"
Write-Host "Press Ctrl+C to stop all services."

try {
    while ($true) {
        Wait-Job -Job $jobs -Any -Timeout 1 | Out-Null
        foreach ($job in $jobs) {
            Receive-Job -Job $job -ErrorAction SilentlyContinue
        }

        # Jobs may briefly be NotStarted right after Start-Job; do not treat that as failure.
        $terminalJobs = $jobs | Where-Object {
            $_.State -in @("Completed", "Failed", "Stopped", "Suspended", "Blocked", "Disconnected")
        }
        if ($terminalJobs) {
            Write-Warning "One service stopped. Shutting down remaining services."
            foreach ($job in $terminalJobs) {
                Write-Host ("[launcher] {0} state: {1}" -f $job.Name, $job.State)
                $reason = $job.ChildJobs[0].JobStateInfo.Reason
                if ($reason) {
                    Write-Host ("[launcher] {0} reason: {1}" -f $job.Name, $reason.Message)
                }
            }
            break
        }
    }
}
finally {
    foreach ($job in $jobs) {
        if ($job.State -eq "Running") {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
        }
    }

    foreach ($job in $jobs) {
        Receive-Job -Job $job -ErrorAction SilentlyContinue
    }

    Remove-Job -Job $jobs -Force -ErrorAction SilentlyContinue
}
