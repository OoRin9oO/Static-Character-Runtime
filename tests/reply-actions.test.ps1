$ErrorActionPreference = 'Stop'
# Load only the function AST, never start a server or access real API credentials.
$Server = Join-Path $PSScriptRoot '../server.ps1'
$Tokens = $null; $Errors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($Server, [ref]$Tokens, [ref]$Errors)
if ($Errors.Count) { throw 'Server parse failed' }
$Function = $Ast.Find({ param($Node) $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Invoke-CharacterChat' }, $true)
. ([ScriptBlock]::Create($Function.Extent.Text))
$AiConfig = @{ defaultProvider = 'mock' }
$AiProviders = @{ mock = @{ models = @('mock'); defaultModel = 'mock'; baseUrl = 'http://unused.invalid' } }
$SessionApiKeys = @{ mock = 'test-only' }
$script:AiCooldownUntil = [DateTime]::MinValue
$script:Decision = @{ allowed = $true; reply = 'test'; state = 'idle'; intensity = 0.5; durationMs = 2500; actions = @(
    @{ state = 'happy'; durationMs = 1000 }, @{ state = 'unknown'; durationMs = 1000 },
    @{ state = 'idle'; durationMs = 9000 }, @{ state = 'idle'; durationMs = 1000 }
) }
function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec)
    return @{ choices = @(@{ message = @{ content = ($script:Decision | ConvertTo-Json -Depth 8 -Compress) } }) }
}
$Request = @{ message = 'test'; includeActions = $true; states = @(@{ id = 'idle' }, @{ id = 'happy' }) }
$Result = Invoke-CharacterChat ($Request | ConvertTo-Json -Depth 8)
if ($Result.StatusCode -ne 200 -or $Result.Body.actions.Count -ne 1 -or $Result.Body.actions[0].state -ne 'happy') { throw 'Action validation failed' }
$script:Decision.actions = @(1..8 | ForEach-Object { @{ state = 'idle'; durationMs = 1000 } })
$Request.actionLimit = 99
$Result = Invoke-CharacterChat ($Request | ConvertTo-Json -Depth 8)
if ($Result.Body.actions.Count -ne 6) { throw 'Six action cap failed' }
$Request.actionLimit = 2
$Result = Invoke-CharacterChat ($Request | ConvertTo-Json -Depth 8)
if ($Result.Body.actions.Count -ne 2) { throw 'Configured action limit failed' }
$Request.includeActions = $false
$Result = Invoke-CharacterChat ($Request | ConvertTo-Json -Depth 8)
if ($Result.StatusCode -ne 200 -or $Result.Body.actions.Count -ne 0 -or $Result.Body.intent.state -ne 'idle') { throw 'Legacy reply failed' }
$script:Decision.allowed = $false
$Request.includeActions = $true
$Result = Invoke-CharacterChat ($Request | ConvertTo-Json -Depth 8)
if ($Result.Body.allowed -ne $false -or $Result.Body.ContainsKey('actions')) { throw 'Denied response returned an action sequence' }
Write-Output 'reply-actions: server allowlist, durations, limits and legacy reply passed (mock only)'
