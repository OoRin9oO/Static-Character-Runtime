param([Parameter(Mandatory = $true)][string]$CharacterPath)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath $CharacterPath).Path
$ManifestPath = Join-Path $Root "character.json"
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw "character.json not found: $ManifestPath" }
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Sections = @{ basic = "Basic"; emotion = "Emotion"; interact = "Interact"; interaction = "Interact"; special = "Special" }
$StateIds = @{}
foreach ($State in $Manifest.states) {
    $Source = [IO.Path]::GetFullPath((Join-Path $Root ([string]$State.image).Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $Source.StartsWith($Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe image path: $($State.image)" }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing image: $($State.image)" }
    $SectionName = if ($State.group) { [string]$State.group } else { "Basic" }
    $Section = if ($Sections.ContainsKey($SectionName.ToLowerInvariant())) { $Sections[$SectionName.ToLowerInvariant()] } else { "Basic" }
    $TargetDirectory = Join-Path $Root $Section
    $null = New-Item -ItemType Directory -Force -Path $TargetDirectory
    $Target = Join-Path $TargetDirectory ([IO.Path]::GetFileName($Source))
    if (-not $Source.Equals($Target, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $Target) { throw "Target already exists: $Target" }
        Move-Item -LiteralPath $Source -Destination $Target
    }
    $State.image = "$Section/$([IO.Path]::GetFileName($Target))"
    $State.group = $Section
    if (-not $State.label -or [string]::IsNullOrWhiteSpace([string]$State.label)) { $State.label = [IO.Path]::GetFileNameWithoutExtension($Target) }
    $StateIds[$Section] = $true
}
$Manifest.groups = @{}
foreach ($Section in @("Basic", "Emotion", "Interact", "Special")) {
    if (@($Manifest.states | Where-Object { $_.group -eq $Section }).Count -gt 0) { $Manifest.groups[$Section] = $Section }
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($ManifestPath, $ManifestJson, [Text.UTF8Encoding]::new($false))
$RegistryPath = Join-Path (Split-Path -Parent $Root) "index.json"
$Registry = if (Test-Path -LiteralPath $RegistryPath) { Get-Content -LiteralPath $RegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{ schemaVersion = 1; defaultCharacter = $Manifest.id; characters = @() } }
$Characters = @($Registry.characters | Where-Object { $_.id -ne $Manifest.id })
$Characters += [pscustomobject]@{ id = $Manifest.id; name = $Manifest.name; manifest = "./$([IO.Path]::GetFileName($Root))/character.json" }
$Registry.characters = $Characters
if (-not $Registry.defaultCharacter -or -not ($Characters | Where-Object { $_.id -eq $Registry.defaultCharacter })) { $Registry.defaultCharacter = $Manifest.id }
[IO.File]::WriteAllText($RegistryPath, ($Registry | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output "Standardized character package: $Root"
