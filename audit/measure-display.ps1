$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$screen=[System.Windows.Forms.Screen]::PrimaryScreen
$vc=Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -and $_.CurrentVerticalResolution } | Select-Object -First 1
$lp=(Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels
$physicalW=[int]$vc.CurrentHorizontalResolution
$physicalH=[int]$vc.CurrentVerticalResolution
$logicalW=[int]$screen.Bounds.Width
$logicalH=[int]$screen.Bounds.Height
$scaleX=[math]::Round($physicalW/$logicalW,4)
$scaleY=[math]::Round($physicalH/$logicalH,4)
$scale=[math]::Round(($scaleX+$scaleY)/2,4)
$dpiFromScale=[math]::Round(96*$scale)
$obj=[ordered]@{
  captured_at=(Get-Date).ToString('o')
  forms_bounds=@{width=$logicalW;height=$logicalH}
  forms_working_area=@{width=$screen.WorkingArea.Width;height=$screen.WorkingArea.Height;top=$screen.WorkingArea.Top;left=$screen.WorkingArea.Left}
  video_controller=@{name=$vc.Name;physical_width=$physicalW;physical_height=$physicalH}
  log_pixels=$lp
  scale_x=$scaleX
  scale_y=$scaleY
  scale=$scale
  dpi_estimate=$dpiFromScale
  css_estimate=@{width=$logicalW;height=$logicalH;working_height=$screen.WorkingArea.Height}
}
$obj | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 'C:\Users\airto\zevanory-product-control-audit\audit\real_display.json'
$obj | ConvertTo-Json -Depth 6