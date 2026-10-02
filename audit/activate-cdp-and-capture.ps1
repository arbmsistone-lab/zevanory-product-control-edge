$ErrorActionPreference='Stop'
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9222/json/activate/3DF60D17B1C94AB3DAA25BBB243D4087' | Out-Null
Start-Sleep -Milliseconds 300
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen=[System.Windows.Forms.Screen]::PrimaryScreen
$bmp=New-Object System.Drawing.Bitmap($screen.Bounds.Width,$screen.Bounds.Height)
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Bounds.Location,[System.Drawing.Point]::Empty,$screen.Bounds.Size)
$path='C:\Users\airto\zevanory-product-control-audit\audit\screen_cdp_activated.png'
$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose()
Write-Output $path