# Builds the Vault SQL for the sync-feeds cloud job from the user environment variables and copies it to
# the clipboard. Paste it into the Supabase SQL editor (project mgmdrill) and run. Nothing is printed.
#   IMDEX_API_KEY, IMDEX_APIM_KEY, RJLL_API_TOKEN  -> imdex_api_key, imdex_apim_key, rjll_api_token
#   sync_key = fresh random string (only Vault needs it: the cron job and the function both read it there)
$u = 'User'
$imdex = [Environment]::GetEnvironmentVariable('IMDEX_API_KEY', $u)
$apim  = [Environment]::GetEnvironmentVariable('IMDEX_APIM_KEY', $u)
$rjll  = [Environment]::GetEnvironmentVariable('RJLL_API_TOKEN', $u)
$missing = @()
if (-not $imdex) { $missing += 'IMDEX_API_KEY' }
if (-not $apim)  { $missing += 'IMDEX_APIM_KEY' }
if (-not $rjll)  { $missing += 'RJLL_API_TOKEN' }
if ($missing.Count) { Write-Host "Missing user env vars: $($missing -join ', ')" -ForegroundColor Red; exit 1 }
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$sync = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
$q = { param($s) $s -replace "'", "''" }
$sql = @"
-- mgmdrill sync-feeds secrets (generated $(Get-Date -Format 'yyyy-MM-dd HH:mm'))
select vault.create_secret('$(& $q $imdex)', 'imdex_api_key');
select vault.create_secret('$(& $q $apim)',  'imdex_apim_key');
select vault.create_secret('$(& $q $rjll)',  'rjll_api_token');
select vault.create_secret('$sync', 'sync_key');
select name, created_at from vault.secrets order by name;
"@
Set-Clipboard -Value $sql
Write-Host "SQL for 4 Vault secrets copied to the clipboard. Paste into Supabase > SQL editor > Run." -ForegroundColor Green
