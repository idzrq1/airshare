param(
  [string]$Message = "update server"
)

Write-Host "== AirShare Server Update ==" -ForegroundColor Cyan
Write-Host "Using commit message: '$Message'" -ForegroundColor Yellow

git add .
git status

git commit -m "$Message"
if ($LASTEXITCODE -ne 0) {
  Write-Host "No changes committed (maybe no changes were staged)." -ForegroundColor Red
  exit 0
}

git push

Write-Host "✅ Server updated & pushed to GitHub (Render will redeploy automatically)." -ForegroundColor Green
