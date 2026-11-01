param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Address = [Net.IPAddress]::Loopback
$Port = 4173
$Url = "http://127.0.0.1:$Port/"

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
}

function Send-Response {
    param(
        [Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body
    )

    $Header = [Text.Encoding]::ASCII.GetBytes(
        "HTTP/1.1 $StatusCode $StatusText`r`n" +
        "Content-Type: $ContentType`r`n" +
        "Content-Length: $($Body.Length)`r`n" +
        "Cache-Control: no-store`r`n" +
        "Connection: close`r`n`r`n"
    )
    $Stream.Write($Header, 0, $Header.Length)
    $Stream.Write($Body, 0, $Body.Length)
}

$EdgeCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$EdgePath = $EdgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $EdgePath) {
    Write-Host "Microsoft Edge was not found." -ForegroundColor Red
    exit 1
}

$Listener = [Net.Sockets.TcpListener]::new($Address, $Port)

try {
    try {
        $Listener.Start()
    }
    catch {
        Write-Host "The local server could not start. Port $Port may already be in use." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor DarkRed
        exit 1
    }

    Write-Host "Static Character Runtime is running: $Url" -ForegroundColor Green
    Write-Host "Close this window or press Ctrl+C to stop."
    if (-not $NoBrowser) {
        Start-Process -FilePath $EdgePath -ArgumentList $Url
    }

    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        try {
            $Stream = $Client.GetStream()
            $Reader = [IO.StreamReader]::new($Stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $RequestLine = $Reader.ReadLine()

            while ($null -ne ($Line = $Reader.ReadLine()) -and $Line -ne "") { }

            if ([string]::IsNullOrWhiteSpace($RequestLine)) {
                continue
            }

            $Parts = $RequestLine.Split(" ")
            if ($Parts.Count -lt 2 -or $Parts[0] -ne "GET") {
                $Body = [Text.Encoding]::UTF8.GetBytes("Only GET is supported.")
                Send-Response $Stream 405 "Method Not Allowed" "text/plain; charset=utf-8" $Body
                continue
            }

            $RequestPath = ($Parts[1] -split "\?", 2)[0]
            $RelativePath = [Uri]::UnescapeDataString($RequestPath).TrimStart("/")
            if ([string]::IsNullOrEmpty($RelativePath)) {
                $RelativePath = "index.html"
            }

            $RelativePath = $RelativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)
            $FilePath = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
            $RootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

            if (-not $FilePath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                $Body = [Text.Encoding]::UTF8.GetBytes("Forbidden")
                Send-Response $Stream 403 "Forbidden" "text/plain; charset=utf-8" $Body
                continue
            }

            if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
                $Body = [Text.Encoding]::UTF8.GetBytes("Not found")
                Send-Response $Stream 404 "Not Found" "text/plain; charset=utf-8" $Body
                continue
            }

            $Body = [IO.File]::ReadAllBytes($FilePath)
            $Extension = [IO.Path]::GetExtension($FilePath).ToLowerInvariant()
            $ContentType = if ($MimeTypes.ContainsKey($Extension)) {
                $MimeTypes[$Extension]
            }
            else {
                "application/octet-stream"
            }
            Send-Response $Stream 200 "OK" $ContentType $Body
        }
        catch {
            Write-Host "Request error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        finally {
            if ($Reader) { $Reader.Dispose() }
            if ($Stream) { $Stream.Dispose() }
            $Client.Close()
        }
    }
}
finally {
    $Listener.Stop()
}
