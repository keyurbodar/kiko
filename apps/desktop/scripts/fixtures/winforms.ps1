Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "kiko-cua-fixture"
$form.Width = 420
$form.Height = 160
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(40, 40)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Dock = "Fill"
$panel.FlowDirection = "TopDown"
$panel.WrapContents = $false
$form.Controls.Add($panel)

$label = New-Object System.Windows.Forms.Label
$label.Text = "kiko cua fixture"
$label.AutoSize = $true
$panel.Controls.Add($label)

$entry = New-Object System.Windows.Forms.TextBox
$entry.Width = 300
$entry.Text = "seed"
$entry.AccessibleName = "kiko-cua-entry"
$panel.Controls.Add($entry)

[System.Windows.Forms.Application]::Run($form)
